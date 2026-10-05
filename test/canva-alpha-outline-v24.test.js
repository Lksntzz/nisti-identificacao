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
