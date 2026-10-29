export const growth=(cur,base)=>{const c=Number(cur||0),b=Number(base||0);return b>0?(c-b)/b*100:null;};
export const pctText=p=>p==null?'—':(p>=0?'+':'')+p.toFixed(1).replace('.',',')+'%';
