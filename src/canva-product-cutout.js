const CANVA_API_URL = 'https://api.canva.com/rest/v1';
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const JOB_ATTEMPTS = 36;
const JOB_DELAY_MS = 350;

export class CanvaCutoutError extends Error {
  constructor(message,{status=502,code='canva_cutout_error'}={}){
    super(message);
    this.name='CanvaCutoutError';
    this.status=status;
    this.code=code;
  }
}

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function detectImageType(bytes){
  const b=new Uint8Array(bytes);
  if(b.length>=3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return 'image/jpeg';
  if(b.length>=8 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47
    && b[4]===0x0d && b[5]===0x0a && b[6]===0x1a && b[7]===0x0a) return 'image/png';
  if(b.length>=12
    && String.fromCharCode(...b.slice(0,4))==='RIFF'
    && String.fromCharCode(...b.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}

function safeCanvaDownloadUrl(value){
  try{
    const url=new URL(String(value||''));
    const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:' || url.username || url.password) return null;
    if(url.port && url.port!=='443') return null;
    if(host!=='export-download.canva.com' && !host.endsWith('.export-download.canva.com')) return null;
    return url.toString();
  }catch{
    return null;
  }
}

function safeMessage(data){
  return String(
    data?.message
    || data?.error?.message
    || data?.job?.error?.message
    || data?.error_description
    || ''
  ).slice(0,300);
}

function safeCode(data){
  return String(
    data?.code
    || data?.error?.code
    || data?.job?.error?.code
    || ''
  ).slice(0,120);
}

function utf8Base64(value){
  const bytes=new TextEncoder().encode(String(value||''));
  let binary='';
  for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary);
}

async function canvaJson(path,token,{method='GET',body,headers={}}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('canva-request-timeout'),15000);
  try{
    const response=await fetch(`${CANVA_API_URL}${path}`,{
      method,
      signal:controller.signal,
      headers:{
        authorization:`Bearer ${token}`,
        accept:'application/json',
        ...headers
      },
      body
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const code=safeCode(data);
      const quota=code==='credit_quota_exceeded' || response.status===429;
      throw new CanvaCutoutError(
        quota
          ? 'O limite de créditos de IA do Canva foi atingido. Nenhuma imagem foi alterada.'
          : safeMessage(data) || `Canva respondeu com erro ${response.status}.`,
        {
          status:quota ? 429 : (response.status===401 ? 401 : 502),
          code:quota ? 'canva_credit_quota_exceeded' : (code || 'canva_api_error')
        }
      );
    }
    return data;
  }catch(error){
    if(error instanceof CanvaCutoutError) throw error;
    if(controller.signal.aborted || error?.name==='AbortError'){
      throw new CanvaCutoutError('Canva excedeu o tempo limite.',{
        status:504,code:'canva_api_timeout'
      });
    }
    throw new CanvaCutoutError('Falha de comunicação com o Canva.',{
      status:502,code:'canva_api_transport_error'
    });
  }finally{
    clearTimeout(timer);
  }
}

async function pollJob(path,token,kind){
  for(let attempt=0;attempt<JOB_ATTEMPTS;attempt+=1){
    const data=await canvaJson(path,token);
    const job=data?.job;
    if(job?.status==='success') return job;
    if(job?.status==='failed'){
      const code=safeCode(data);
      const quota=code==='credit_quota_exceeded';
      throw new CanvaCutoutError(
        quota
          ? 'O limite de créditos de IA do Canva foi atingido. Nenhuma imagem foi alterada.'
          : safeMessage(data) || `O Canva não concluiu ${kind}.`,
        {
          status:quota ? 429 : 422,
          code:quota ? 'canva_credit_quota_exceeded' : (code || 'canva_job_failed')
        }
      );
    }
    await sleep(JOB_DELAY_MS);
  }
  throw new CanvaCutoutError(`O Canva demorou demais para concluir ${kind}.`,{
    status:504,code:'canva_job_timeout'
  });
}

export async function canvaUploadAsset(bytes,token,name){
  if(!(bytes instanceof ArrayBuffer) || bytes.byteLength<1 || bytes.byteLength>MAX_INPUT_BYTES){
    throw new CanvaCutoutError('Imagem de entrada inválida ou maior que 20 MB.',{
      status:400,code:'canva_input_invalid'
    });
  }
  if(!detectImageType(bytes)){
    throw new CanvaCutoutError('O conteúdo enviado ao Canva não é uma imagem JPEG, PNG ou WebP válida.',{
      status:400,code:'canva_input_type_invalid'
    });
  }
  const started=await canvaJson('/asset-uploads',token,{
    method:'POST',
    headers:{
      'content-type':'application/octet-stream',
      'asset-upload-metadata':JSON.stringify({name_base64:utf8Base64(name.slice(0,50))})
    },
    body:bytes
  });
  const initial=started?.job;
  if(initial?.status==='success' && initial?.asset?.id) return initial.asset;
  if(!initial?.id) throw new CanvaCutoutError('Canva não retornou o job de upload.',{
    code:'canva_upload_job_missing'
  });
  const job=await pollJob(`/asset-uploads/${encodeURIComponent(initial.id)}`,token,'o upload');
  if(!job?.asset?.id) throw new CanvaCutoutError('Canva concluiu o upload sem retornar o asset.',{
    code:'canva_upload_asset_missing'
  });
  return job.asset;
}

async function removeBackground(assetId,token,name){
  const started=await canvaJson('/image-transformations',token,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      asset_id:assetId,
      name:name.slice(0,255),
      transformations:[{type:'background_removal'}]
    })
  });
  const initial=started?.job;
  if(initial?.status==='success' && initial?.result?.asset?.id) return initial.result.asset;
  if(!initial?.id) throw new CanvaCutoutError('Canva não retornou o job de remoção de fundo.',{
    code:'canva_transform_job_missing'
  });
  const job=await pollJob(
    `/image-transformations/${encodeURIComponent(initial.id)}`,
    token,
    'a remoção de fundo'
  );
  const asset=job?.result?.asset;
  if(!asset?.id) throw new CanvaCutoutError('Canva concluiu o recorte sem retornar a imagem.',{
    code:'canva_transform_asset_missing'
  });
  return asset;
}

export function fitDesignSize(asset){
  const width=Math.max(1,Number(asset?.metadata?.width||0));
  const height=Math.max(1,Number(asset?.metadata?.height||0));
  if(!Number.isFinite(width) || !Number.isFinite(height)){
    throw new CanvaCutoutError('Canva não informou as dimensões da imagem tratada.',{
      code:'canva_dimensions_missing'
    });
  }
  const maxDimension=8000;
  const maxArea=25_000_000;
  const dimensionScale=Math.min(1,maxDimension/width,maxDimension/height);
  const areaScale=Math.min(1,Math.sqrt(maxArea/(width*height)));
  const scale=Math.min(dimensionScale,areaScale);
  return {
    width:Math.max(40,Math.round(width*scale)),
    height:Math.max(40,Math.round(height*scale))
  };
}

async function createDesign(asset,token){
  const size=fitDesignSize(asset);
  const data=await canvaJson('/designs',token,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      type:'type_and_asset',
      design_type:{type:'custom',width:size.width,height:size.height},
      asset_id:asset.id,
      title:`NISTI TMP recorte ${new Date().toISOString()}`
    })
  });
  if(!data?.design?.id) throw new CanvaCutoutError('Canva não conseguiu preparar o PNG transparente.',{
    code:'canva_design_missing'
  });
  return {design:data.design,size};
}

async function exportTransparentPng(designId,token,size){
  const started=await canvaJson('/exports',token,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      design_id:designId,
      format:{
        type:'png',
        lossless:true,
        transparent_background:true,
        width:size.width,
        height:size.height
      }
    })
  });
  const initial=started?.job;
  let job=initial;
  if(initial?.status!=='success'){
    if(!initial?.id) throw new CanvaCutoutError('Canva não retornou o job de exportação.',{
      code:'canva_export_job_missing'
    });
    job=await pollJob(`/exports/${encodeURIComponent(initial.id)}`,token,'a exportação PNG');
  }
  const url=safeCanvaDownloadUrl(Array.isArray(job?.urls) ? job.urls[0] : '');
  if(!url) throw new CanvaCutoutError('Canva retornou uma URL de exportação inválida ou não autorizada.',{
    code:'canva_export_url_invalid'
  });

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('canva-download-timeout'),15000);
  try{
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok) throw new CanvaCutoutError('Não foi possível baixar o PNG tratado do Canva.',{
      status:502,code:'canva_export_download_failed'
    });
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    const bytes=await response.arrayBuffer();
    if(!type.includes('image/png') || bytes.byteLength<1 || bytes.byteLength>MAX_OUTPUT_BYTES){
      throw new CanvaCutoutError('O Canva não retornou um PNG transparente válido.',{
        status:502,code:'canva_export_invalid'
      });
    }
    return bytes;
  }catch(error){
    if(error instanceof CanvaCutoutError) throw error;
    throw new CanvaCutoutError('Falha ao baixar o PNG tratado do Canva.',{
      status:502,code:'canva_export_transport_error'
    });
  }finally{
    clearTimeout(timer);
  }
}

async function deleteAssetBestEffort(assetId,token){
  if(!assetId) return;
  try{
    await fetch(`${CANVA_API_URL}/assets/${encodeURIComponent(assetId)}`,{
      method:'DELETE',
      headers:{authorization:`Bearer ${token}`}
    });
  }catch{}
}

export async function canvaBackgroundRemoveToPng({bytes,token,name='NISTI produto'}){
  let sourceAssetId='';
  let cutoutAssetId='';
  try{
    const source=await canvaUploadAsset(bytes,token,`${name} original`);
    sourceAssetId=source.id;
    const cutout=await removeBackground(source.id,token,`${name} sem fundo`);
    cutoutAssetId=cutout.id;
    const {design,size}=await createDesign(cutout,token);
    return await exportTransparentPng(design.id,token,size);
  }finally{
    await Promise.all([
      deleteAssetBestEffort(sourceAssetId,token),
      deleteAssetBestEffort(cutoutAssetId,token)
    ]);
  }
}

export const __canvaCutoutInternals={
  utf8Base64,
  safeMessage,
  safeCode,
  fitDesignSize,
  detectImageType,
  safeCanvaDownloadUrl
};
