export const DISPATCH_PLATFORMS=['SHOPEE','MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE','AMAZON','SHEIN','TIK TOK','MAGALU','KWAI','LOJA INTEGRADA'];
export const DISPATCH_GROUPS=[
{label:'Operação',options:['Full','Empresa','Venda Direta']},
{label:'Flex e rápidas',options:['Mercado Flex','Shopee Flex','Flex Avulso','Magalu Vapt','Amazon Same Day','Turbo','Loja Integrada Flex']},
{label:'Full específico',options:['Full Amazon','Full Shopee','Full Mercado Livre Antigo','Full Mercado Livre Novo']}];
export const SPECIAL_BY_PLATFORM={
'SHOPEE':['Shopee Flex','Full Shopee'],
'MERCADO LIVRE ANTIGO':['Mercado Flex','Full Mercado Livre Antigo'],
'MERCADO LIVRE NOVO':['Mercado Flex','Full Mercado Livre Novo'],
'MERCADO LIVRE':['Mercado Flex'],
'AMAZON':['Amazon Same Day','Full Amazon'],
'MAGALU':['Magalu Vapt'],
'LOJA INTEGRADA':['Loja Integrada Flex']};
export function optionsForPlatform(platform){
if(!DISPATCH_PLATFORMS.includes(platform))return [];
const allowed=new Set([...DISPATCH_GROUPS[0].options,...(SPECIAL_BY_PLATFORM[platform]||[]),'Flex Avulso','Turbo']);
return DISPATCH_GROUPS.map(group=>({...group,options:group.options.filter(x=>allowed.has(x))})).filter(group=>group.options.length);
}
export function validDispatchOption(platform,message){
return typeof message==='string' && optionsForPlatform(platform).some(group=>group.options.includes(message));
}
export function platformColor(platform){
  if(typeof platform!=='string')return 'other';
if(platform==='SHOPEE')return 'shopee';
if(platform.startsWith('MERCADO LIVRE'))return 'ml';
if(platform==='AMAZON')return 'amazon';
return 'other';
}


// A mensagem comum sempre existe; as demais opções são mantidas por plataforma no Supabase.
export const DISPATCH_UNIVERSAL_OPTION='RETIRAR CAPA';
export function dispatchOptionGroups(platform,config={}){
  if(!DISPATCH_PLATFORMS.includes(platform))return [];
  const customized=Array.isArray(config[platform])?config[platform]
    :optionsForPlatform(platform).flatMap(group=>group.options);
  const extra=customized.filter(x=>typeof x==='string'&&x.trim()&&x!==DISPATCH_UNIVERSAL_OPTION);
  return [
    {label:'Comum',options:[DISPATCH_UNIVERSAL_OPTION]},
    {label:'Modalidades da plataforma',options:extra}
  ].filter(group=>group.options.length);
}
export function dispatchOptionValid(platform,option,config={}){
  return dispatchOptionGroups(platform,config).some(group=>group.options.includes(option));
}
export function formatDispatchText(platform,option){
  if(!DISPATCH_PLATFORMS.includes(platform)||typeof option!=='string')return '';
  if(option===DISPATCH_UNIVERSAL_OPTION)return DISPATCH_UNIVERSAL_OPTION;
  const suffix=/^Full(?:\s|$)/i.test(option)?'FULL':option.toUpperCase();
  return platform+' RETIRAR CAPA '+suffix;
}
