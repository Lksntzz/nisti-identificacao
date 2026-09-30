# Mural NISTI — Matriz de conformidade com o PDP

Atualização: 29/09/2026  
Escopo: implementação do Mural NISTI comparada ao PDP de implementação.  
Regra de release: o operador continua vendo apenas **“Em breve”** até autorização explícita de liberação.

## Implementado e coberto por código/testes

| Requisito | Estado | Evidência técnica |
|---|---|---|
| Feed público separado do Scanner | Concluído | `src/mural-router.js`, `src/mural-nisti.jsx` |
| Filtros Tudo/Produtos/Coleções/Avisos | Concluído | `src/mural-nisti.jsx` |
| Published/future/expired/archived fora do feed | Concluído | filtros SQL e testes do router |
| Leitura idempotente e unread por operador | Concluído | `mural_post_reads`, endpoints `/read`, `/unread-count` |
| Paginação por cursor, máximo inicial de 20 | Concluído | cursor validado; cursor inválido retorna 400 |
| Última resposta em memória da sessão | Concluído | cache de sessão compartilhado entre remounts |
| Produto usa dados atuais e labels resolvidos | Concluído | JOIN atual de `products` + `productTypeLabel` |
| `product_available:false` quando o vínculo some | Concluído para produto inexistente | derivado do LEFT JOIN |
| Coleção ordenada por `sort_order` com fallback por produto | Concluído | associação carregada de forma determinística |
| Banner de coleção como fallback visual | Concluído | URL versionada do banner da coleção |
| Imagens versionadas por `image_key` | Concluído | query `?v=...` |
| Imagens públicas respeitam visibilidade do conteúdo | Concluído | post publicado/janela válida; coleção ativa |
| Upload valida MIME, assinatura, tamanho e chave server-side | Concluído | JPEG/PNG/WebP, 5 MB, `crypto.randomUUID()` |
| Remoção de imagem editorial | Concluído | DELETE protegido no Admin |
| Preview de publicação usa o mesmo card do operador | Concluído | Admin reutiliza `MuralCard` |
| Preview de post existente hidrata imagem/acabamentos atuais | Concluído | lista Admin retorna estado atual do produto |
| Coleção permite ordenar produtos no Admin | Concluído | controles ↑/↓ persistem a sequência |
| Banner de coleção possui preview e remoção | Concluído | rota Admin protegida + UI |
| Métricas básicas do PDP | Concluído | publicados/mês, leitores, mais lidos e tamanho médio de imagem |
| Erros internos não são expostos ao operador | Concluído | mensagem pública genérica + log estruturado |
| Acessibilidade estrutural | Concluído em código | 44 px, dialog/aria, foco, ESC, reduced-motion, safe-area |
| Release gate | Concluído | operador continua em “Em breve” |
| QA readiness automatizado | Concluído | Admin valida estrutura D1, mínimo de conteúdo e orçamento de imagens da primeira dobra no ambiente atual |

## Pendências que exigem validação real

| Requisito | Estado | Motivo |
|---|---|---|
| Smoke Scanner → Mural → Scanner com reinício da câmera | Pendente | requer aparelho real após habilitar temporariamente o Mural em ambiente controlado |
| Validação visual 360/390/430 px no Mural real | Pendente | CSS/testes existem, mas o Mural público continua gated |
| Safe-area real em iPhone com o Mural completo | Pendente | precisa do fluxo real habilitado para teste |
| Tempo de abertura < 1 s | Pendente | requer medição em rede/aparelho real |
| Hero <= 250 KB, produto <= 120 KB, coleção <= 180 KB e primeira dobra <= 1,5 MB | Instrumentado | aba **QA de liberação** mede os objetos R2 reais do hero/primeiros cards; falta confirmar resultado verde com conteúdo real |
| 3–5 conteúdos editoriais de teste | Instrumentado | aba **QA de liberação** conta publicações válidas no ambiente atual; falta cadastrar/aprovar o conteúdo real |
| Aplicação remota da migration D1 em produção | Instrumentado | endpoint Admin consulta `sqlite_master` no ambiente em execução; falta registrar evidência verde no ambiente alvo |

## Dependência de domínio não implementada

O PDP diz que produtos arquivados/inativos não devem entrar automaticamente em coleções. A tabela `products` atual não possui estado de ciclo de vida (por exemplo `active`, `archived` ou `deleted_at`). O Mural já ignora vínculos inexistentes por JOIN/FK, mas **não inventa um conceito de inatividade que não existe no domínio atual**.

Para fechar esse item de forma correta, primeiro é necessário definir o lifecycle oficial do produto no NISTI ID e então aplicar a mesma regra no Scanner, Admin e Mural.

## Condição para liberação

Não remover o gate **“Em breve”** até que:
1. o Production Gate esteja verde no commit final;
2. migrations necessárias estejam comprovadamente aplicadas no ambiente alvo;
3. conteúdo editorial de teste esteja cadastrado;
4. smoke test real em iPhone/Android valide Mural e retorno da câmera;
5. metas de peso/performance tenham sido medidas com dados reais;
6. haja autorização explícita para liberar o Mural aos operadores.
