import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('GlareHover uses the React classic JSX runtime configured by Vite',async()=>{
  const viteConfig=fs.readFileSync('vite.config.js','utf8');
  const component=fs.readFileSync('src/vendor/react-bits/GlareHover.jsx','utf8');
  assert.doesNotMatch(viteConfig,/@vitejs\/plugin-react|jsxImportSource|jsx:\s*['"]automatic/);
  assert.match(component,/import React,\s*\{\s*useEffect,\s*useRef\s*\} from 'react';/);
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},
    appType:'custom',logLevel:'silent'});
  try{
    const module=await server.ssrLoadModule('/src/vendor/react-bits/GlareHover.jsx');
    const html=renderToStaticMarkup(React.createElement(module.default,{children:'Indicador de teste'}));
    assert.match(html,/Indicador de teste/);
    assert.match(html,/glare-hover/);
  }finally{await server.close();}
});
