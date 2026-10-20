import React,{useEffect,useState} from 'react';
import { dispatchPlatformLogoUrl,PLATFORM_LOGO_INITIALS } from '../notification-platform-logos.js';
import {platformColor} from '../notification-dispatch-options.js';

// Local SVG + visible fallback. The platform name remains separate in the interface.
export default function PlatformLogo({platform,size='small',className=''}){
 const src=dispatchPlatformLogoUrl(platform);
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 const name=typeof platform==='string'?platform:'Plataforma';
 return <span className={'nid-platform-logo nid-platform-logo-'+size+' '+platformColor(platform)+(className?' '+className:'')}
   role="img" aria-label={'Logo '+name}>
   {src&&!failed
     ? <img src={src} alt="" loading={size==='large'?'eager':'lazy'} decoding="async"
         onError={()=>setFailed(true)} draggable={false}/>
     : <span className="nid-platform-logo-fallback" aria-hidden="true">{PLATFORM_LOGO_INITIALS[platform]||'N'}</span>}
 </span>;
}
