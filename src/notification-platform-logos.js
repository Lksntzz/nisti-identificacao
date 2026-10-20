// Platform logos are bundled as public SVG files; no external image hosts at runtime.
// The three Mercado Livre queues deliberately use the same visual trademark.
export const PLATFORM_LOGO_FILES=Object.freeze({
 'SHOPEE':'shopee',
 'MERCADO LIVRE ANTIGO':'mercado-livre',
 'MERCADO LIVRE NOVO':'mercado-livre',
 'MERCADO LIVRE':'mercado-livre',
 'AMAZON':'amazon',
 'SHEIN':'shein',
 'TIK TOK':'tik-tok',
 'MAGALU':'magalu',
 'KWAI':'kwai',
 'LOJA INTEGRADA':'loja-integrada'
});
export const PLATFORM_LOGO_INITIALS=Object.freeze({
 'SHOPEE':'S', 'MERCADO LIVRE ANTIGO':'ML', 'MERCADO LIVRE NOVO':'ML',
 'MERCADO LIVRE':'ML', 'AMAZON':'A', 'SHEIN':'S',
 'TIK TOK':'TT', 'MAGALU':'M', 'KWAI':'K', 'LOJA INTEGRADA':'LI'
});
export function dispatchPlatformLogoUrl(platform){
 const slug=PLATFORM_LOGO_FILES[platform];
 return slug?'/platform-logos/'+slug+'.svg':null;
}
