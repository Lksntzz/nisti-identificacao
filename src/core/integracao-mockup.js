// chave própria do app de mockup: só cadastra produto (POST /api/products), sem login de administrador
const CAMINHO_DO_CADASTRO = '/api/products';
const CHAVE_MINIMA = 32;

const bytes = texto => new TextEncoder().encode(texto);

async function iguais(a, b) {
  const [esq, dir] = await Promise.all([
    crypto.subtle.digest('SHA-256', bytes(a)),
    crypto.subtle.digest('SHA-256', bytes(b))
  ]);
  const x = new Uint8Array(esq);
  const y = new Uint8Array(dir);
  let diferenca = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diferenca |= (x[i] || 0) ^ (y[i] || 0);
  return diferenca === 0;
}

/**
 * Vale só para POST /api/products com `Authorization: Bearer <chave>`.
 * Chave ausente ou com menos de 32 caracteres no servidor = integração desligada (nunca abre por engano).
 * Qualquer outra rota, método ou chave errada continua exigindo o login de administrador.
 */
export async function autorizadaPelaChaveDoMockup(request, env) {
  if (String(request?.method || '').toUpperCase() !== 'POST') return false;
  let caminho;
  try { caminho = new URL(request.url).pathname; } catch { return false; }
  if (caminho !== CAMINHO_DO_CADASTRO) return false;

  const chave = String(env?.MOCKUP_INTEGRATION_KEY || '').trim();
  if (chave.length < CHAVE_MINIMA) return false;

  const cabecalho = /^Bearer\s+(\S+)$/i.exec(String(request.headers.get('authorization') || '').trim());
  if (!cabecalho) return false;
  return iguais(cabecalho[1], chave);
}
