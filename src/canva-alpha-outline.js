const MAX_RENDER_DIMENSION=1280;
const TARGET_OUTLINE_AT_1024=12;

function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }

function canvasBlob(canvas){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(
      blob=>blob?.type==='image/png' && blob.size>0
        ? resolve(blob)
        : reject(new Error('Falha ao gerar PNG com contorno.')),
      'image/png'
    );
  });
}

async function decodeImage(blob){
  if(typeof createImageBitmap==='function') return createImageBitmap(blob);
  const url=URL.createObjectURL(blob);
  try{
    const image=new Image();
    image.decoding='async';
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error('Não foi possível abrir o recorte do Canva.'));
      image.src=url;
    });
    return image;
  }finally{
    URL.revokeObjectURL(url);
  }
}

function dilate(mask,width,height,radius){
  let current=mask;
  const horizontal=new Uint8Array(width*height);
  const vertical=new Uint8Array(width*height);

  for(let step=0;step<radius;step+=1){
    horizontal.fill(0);
    vertical.fill(0);
    for(let y=0;y<height;y+=1){
      const row=y*width;
      for(let x=0;x<width;x+=1){
        const index=row+x;
        let value=current[index];
        if(x>0 && current[index-1]>value) value=current[index-1];
        if(x+1<width && current[index+1]>value) value=current[index+1];
        horizontal[index]=value;
      }
    }
    for(let y=0;y<height;y+=1){
      const row=y*width;
      for(let x=0;x<width;x+=1){
        const index=row+x;
        let value=horizontal[index];
        if(y>0 && horizontal[index-width]>value) value=horizontal[index-width];
        if(y+1<height && horizontal[index+width]>value) value=horizontal[index+width];
        vertical[index]=value;
      }
    }
    current=new Uint8Array(vertical);
  }
  return current;
}

export async function canvaAlphaOutlineArtifactsBlob(cutoutBlob){
  if(!(cutoutBlob instanceof Blob) || cutoutBlob.type!=='image/png' || cutoutBlob.size<1){
    throw new Error('O Canva não retornou um PNG transparente válido.');
  }

  const image=await decodeImage(cutoutBlob);
  const sourceWidth=Number(image.width||image.naturalWidth||0);
  const sourceHeight=Number(image.height||image.naturalHeight||0);
  if(!sourceWidth || !sourceHeight) throw new Error('O PNG do Canva não possui dimensões válidas.');

  const scale=Math.min(1,MAX_RENDER_DIMENSION/Math.max(sourceWidth,sourceHeight));
  const width=Math.max(1,Math.round(sourceWidth*scale));
  const height=Math.max(1,Math.round(sourceHeight*scale));
  const radius=clamp(Math.round(Math.min(width,height)*TARGET_OUTLINE_AT_1024/1024),7,16);
  const paddedWidth=width+radius*2;
  const paddedHeight=height+radius*2;

  const sourceCanvas=document.createElement('canvas');
  sourceCanvas.width=width;
  sourceCanvas.height=height;
  const sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true});
  if(!sourceCtx) throw new Error('Canvas indisponível para o tratamento da imagem.');
  sourceCtx.clearRect(0,0,width,height);
  sourceCtx.drawImage(image,0,0,width,height);
  if(typeof image.close==='function') image.close();

  const sourceData=sourceCtx.getImageData(0,0,width,height);
  const productMask=new Uint8Array(paddedWidth*paddedHeight);
  let opaquePixels=0;
  for(let y=0;y<height;y+=1){
    for(let x=0;x<width;x+=1){
      const sourceIndex=y*width+x;
      const alpha=sourceData.data[sourceIndex*4+3];
      if(alpha<8) continue;
      productMask[(y+radius)*paddedWidth+(x+radius)]=alpha;
      opaquePixels+=1;
    }
  }
  if(opaquePixels<Math.max(32,Math.round(width*height*.01))){
    throw new Error('O recorte do Canva veio praticamente vazio.');
  }

  const binary=new Uint8Array(productMask.length);
  for(let i=0;i<productMask.length;i+=1) binary[i]=productMask[i]>=8 ? 255 : 0;
  const expanded=dilate(binary,paddedWidth,paddedHeight,radius);

  const outputCanvas=document.createElement('canvas');
  outputCanvas.width=paddedWidth;
  outputCanvas.height=paddedHeight;
  const outputCtx=outputCanvas.getContext('2d');
  if(!outputCtx) throw new Error('Canvas indisponível para gerar o contorno.');
  const outlineData=outputCtx.createImageData(paddedWidth,paddedHeight);
  for(let i=0;i<expanded.length;i+=1){
    if(!expanded[i] || binary[i]) continue;
    const offset=i*4;
    outlineData.data[offset]=255;
    outlineData.data[offset+1]=255;
    outlineData.data[offset+2]=255;
    outlineData.data[offset+3]=255;
  }
  outputCtx.putImageData(outlineData,0,0);
  outputCtx.drawImage(sourceCanvas,radius,radius);

  const maskCanvas=document.createElement('canvas');
  maskCanvas.width=paddedWidth;
  maskCanvas.height=paddedHeight;
  const maskCtx=maskCanvas.getContext('2d');
  if(!maskCtx) throw new Error('Canvas indisponível para gerar a máscara.');
  const maskData=maskCtx.createImageData(paddedWidth,paddedHeight);
  for(let i=0;i<productMask.length;i+=1){
    const alpha=productMask[i];
    if(!alpha) continue;
    const offset=i*4;
    maskData.data[offset]=255;
    maskData.data[offset+1]=255;
    maskData.data[offset+2]=255;
    maskData.data[offset+3]=alpha;
  }
  maskCtx.putImageData(maskData,0,0);

  const [imageBlob,maskBlob]=await Promise.all([
    canvasBlob(outputCanvas),
    canvasBlob(maskCanvas)
  ]);
  return {imageBlob,maskBlob,outlinePx:radius,width:paddedWidth,height:paddedHeight};
}

export const __canvaAlphaOutlineInternals={clamp,dilate};
