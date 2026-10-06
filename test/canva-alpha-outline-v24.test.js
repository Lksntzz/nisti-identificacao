import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { __canvaAlphaOutlineInternals } from '../src/canva-alpha-outline.js';
import { fitDesignSize } from '../src/canva-product-cutout.js';

test('alpha outline dilation expands outside the original mask',()=>{
  const mask=new Uint8Array(25);
  mask[12]=255;
  const expanded=__canvaAlphaOutlineInternals.dilate(mask,5,5,1);
  const expected=[
    6,7,8,
    11,12,13,
    16,17,18
  ];
  assert.deepEqual(
    [...expanded].map((value,index)=>value?index:-1).filter(index=>index>=0),
    expected
  );
});

test('Canva design keeps normal image dimensions unchanged',()=>{
  assert.deepEqual(
    fitDesignSize({metadata:{width:1024,height:1024}}),
    {width:1024,height:1024}
  );
});

test('Canva design safely scales dimensions above API maximum',()=>{
  const size=fitDesignSize({metadata:{width:10000,height:1000}});
  assert.equal(size.width,8000);
  assert.equal(size.height,800);
});


test('Mural outline uses thicker 12px target and white backing under alpha fringe',()=>{
  const source=fs.readFileSync(new URL('../src/canva-alpha-outline.js',import.meta.url),'utf8');
  assert.ok(source.includes('const TARGET_OUTLINE_AT_1024=12;'));
  assert.ok(source.includes('TARGET_OUTLINE_AT_1024/1024),7,16)'));
  assert.ok(source.includes('if(!expanded[i]) continue;'));
  assert.equal(source.includes('if(!expanded[i] || binary[i]) continue;'),false);
  assert.ok(source.includes('outputCtx.putImageData(outlineData,0,0);'));
  assert.ok(source.includes('outputCtx.drawImage(sourceCanvas,radius,radius);'));
});


test('white inner seam removes dark outer fringe but preserves opaque interior',()=>{
  const width=7;
  const height=7;
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=1;y<=5;y+=1){
    for(let x=1;x<=5;x+=1){
      const offset=(y*width+x)*4;
      data[offset]=20;
      data[offset+1]=20;
      data[offset+2]=20;
      data[offset+3]=255;
    }
  }
  const imageData={data};
  __canvaAlphaOutlineInternals.whitenOuterSeam(imageData,width,height);

  const edge=(1*width+1)*4;
  assert.deepEqual(Array.from(data.slice(edge,edge+4)),[255,255,255,255]);

  const center=(3*width+3)*4;
  assert.deepEqual(Array.from(data.slice(center,center+4)),[20,20,20,255]);
});

test('weak Canva alpha fringe is discarded before mask generation',()=>{
  const width=3;
  const height=3;
  const data=new Uint8ClampedArray(width*height*4);
  const center=(1*width+1)*4;
  data[center]=10;
  data[center+1]=10;
  data[center+2]=10;
  data[center+3]=10;
  __canvaAlphaOutlineInternals.whitenOuterSeam({data},width,height);
  assert.equal(data[center+3],0);
});
