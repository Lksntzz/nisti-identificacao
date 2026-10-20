import React,{useEffect,useState} from 'react';
import CommercialIcon from './vendor/CommercialIcon.jsx';

// Never let a catalog value become a script/data URL or arbitrary internal route.
// Relative images are the existing NISTI product image endpoint only.
export function safeEvolutionImageUrl(value){
  if(typeof value!=='string')return null;
  const url=value.trim();
  if(!url||url.length>2048||/[\x00-\x1f\x7f]/.test(url))return null;
  if(/^\/api\/images\/[1-9]\d*$/.test(url))return url;
  try{
    const parsed=new URL(url);
    if(parsed.protocol==='https:'&&parsed.username===''&&parsed.password==='')
      return parsed.href;
  }catch{return null;}
  return null;
}

export default function CommerceEvolutionProductThumbnail({url,source}){
  const safeUrl=safeEvolutionImageUrl(url);
  const [failed,setFailed]=useState(false);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{setFailed(false);setLoaded(false);},[safeUrl]);
  const hasImage=Boolean(safeUrl)&&!failed;
  return <span className="nim-evolution-product-icon nim-evolution-thumbnail"
    title={hasImage?'Imagem vinculada ao SKU ('+(source||'origem confirmada')+')':'Imagem não vinculada ao SKU'}>
    {(!hasImage||!loaded)&&<CommercialIcon name="notebook-tabs" size={23} strokeWidth={1.7}/>}
    {hasImage&&<img src={safeUrl} alt="" loading="lazy" decoding="async"
      referrerPolicy="no-referrer" className={'nim-evolution-thumb-image'+(loaded?' is-ready':'')}
      onLoad={()=>setLoaded(true)} onError={()=>{setFailed(true);setLoaded(false);}}/>}
  </span>;
}
