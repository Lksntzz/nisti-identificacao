# NISTI ID

Sistema operacional da NISTI PRINT para cadastro de produtos, leitura de EAN na expedição, gestão do catálogo comercial e publicação de conteúdo no Mural NISTI.

Produção: [nisti-identificacao.lksntz1411.workers.dev](https://nisti-identificacao.lksntz1411.workers.dev)

## Como o sistema opera hoje

O NISTI ID identifica produtos pelo código EAN-13 lido na câmera do celular ou informado pelo operador. O código é consultado no cadastro oficial e retorna o produto, SKU, capa, variação e imagem correspondentes.

O sistema não usa inteligência artificial, reconhecimento visual, embeddings ou geração automática de SKU. Toda identificação é determinística e baseada nos dados cadastrados.

Fluxo operacional:

1. O produto é cadastrado no painel administrativo com SKU, EAN e dados comerciais.
2. O cadastro principal é gravado no Supabase PostgreSQL.
3. A imagem original é preservada no Cloudflare R2.
4. O tratamento de imagem gera uma versão PNG transparente para revisão.
5. O Produto Mestre e os anúncios compatíveis são sincronizados com o Catálogo Comercial.
6. Na expedição, o operador lê o EAN e recebe o produto exato.
7. Leituras, códigos não cadastrados e falhas técnicas ficam disponíveis no painel administrativo.

## Módulos ativos

### Identificação e expedição

- leitura de EAN-13 pela câmera;
- consulta direta ao cadastro oficial;
- resultado com produto, SKU, capa e imagem;
- histórico de leituras por operador;
- fila de EANs não cadastrados;
- painel de cobertura EAN e erros técnicos.

### Administração do NISTI ID

- cadastro, edição e exclusão de produtos;
- vínculo e desvínculo de EANs;
- importação em lote por CSV;
- geração de etiquetas EAN-13 em PNG;
- gestão de produtos sem EAN;
- diagnóstico da sincronização com o Catálogo;
- notificações e saúde operacional do sistema.

### Catálogo Comercial

- Produto Mestre com anúncios de múltiplas plataformas;
- Catálogo, Vendas, Central de Importações e Pendências;
- importação de planilhas e staging antes do commit;
- reconciliação por SKU, família e capa;
- controle independente dos estados de anúncio;
- sincronização com os produtos do NISTI ID;
- revisão manual de conflitos e casos ambíguos.

### Mural NISTI

- publicações de produtos, coleções e avisos;
- editor com prévia do visual do operador;
- agendamento, prioridade e ordenação editorial;
- Mural QA separado da liberação pública;
- confirmação de leitura por operador;
- gestão e aprovação das imagens tratadas.

## Tratamento de imagens

O tratamento é executado localmente no navegador, sem IA. Ele usa máscaras, geometria e análise determinística de pixels para:

- remover o fundo conectado às bordas;
- proteger capas brancas e claras;
- preservar Wire-O, tassel, elástico, páginas, luz e sombra reais;
- eliminar marcas e componentes desconectados do produto;
- enquadrar o recorte com margem transparente mínima;
- gerar PNG com canal alfa real, sem contorno branco artificial.

A geometria das agendas foi ajustada a partir do mockup oficial do Photoshop. O arquivo PSD é apenas referência visual; ele não é necessário no Worker e não executa instruções.

As imagens originais nunca são sobrescritas. Cada nova versão do processador coloca os tratamentos antigos novamente na fila. O resultado passa por revisão antes da aprovação para uso no Mural e nas demais interfaces.

Versão atual do processador: `10`.

## Arquitetura de produção

```text
Operador/Admin
      │
      ▼
React + Vite (SPA)
      │
      ▼
Cloudflare Worker
  ├── Supabase PostgreSQL — banco principal e autoridade de escrita
  ├── Cloudflare R2 — imagens originais e tratadas
  └── Cloudflare D1 — armazenamento de compatibilidade e reserva emergencial
```

### Autoridade dos dados

- `SUPABASE_READS_ENABLED=1`: leituras principais no Supabase.
- `SUPABASE_WRITE_MODE=primary`: escritas principais no Supabase.
- `SUPABASE_CUTOVER_WRITE_FREEZE=0`: operação normal de escrita.
- D1 não é o banco principal; permanece como compatibilidade e reserva emergencial controlada.
- Um cron executado a cada 30 minutos mantém rotinas de reserva e manutenção.

### Armazenamento de imagens

- originais e derivados ficam no bucket R2 `nisti-identificacao-images`;
- o banco guarda as chaves e o estado do tratamento;
- imagens tratadas possuem versão, status de revisão e histórico de aprovação;
- uma falha de tratamento não elimina nem substitui o original.

## Rotas principais

- `/` — scanner EAN e experiência do operador;
- `/admin` — painel administrativo protegido;
- `/admin-commerce` — Catálogo Comercial protegido;
- `/?mural=qa` — validação interna do Mural;
- `/api/health` — diagnóstico público mínimo do serviço.

O Mural público permanece protegido por gate de liberação. Estar autenticado como administrador não libera automaticamente a interface pública.

## Segurança

- operações administrativas exigem sessão válida;
- credenciais de serviço permanecem no Worker e não são enviadas ao navegador;
- RPCs sensíveis do Supabase são restritas ao service role;
- arquivos originais são preservados para recuperação;
- gravações críticas retornam confirmação da autoridade principal;
- o sistema registra atividades operacionais, falhas de tratamento e tentativas recusadas.

## Stack atual

- React 18;
- Vite 6;
- Cloudflare Workers;
- Cloudflare R2;
- Supabase PostgreSQL;
- Cloudflare D1 como reserva de compatibilidade;
- GitHub Actions para testes, build, preview e deploy.

## Desenvolvimento

Requisitos: Node.js 20 ou superior e acesso aos recursos configurados no Cloudflare/Supabase.

```bash
npm install
npm run dev
```

Validação local:

```bash
npm test
npm run build
```

Deploy manual:

```bash
npm run deploy
```

Migrações D1 de compatibilidade:

```bash
npm run db:migrate
```

## Entrega contínua

Os workflows do GitHub executam:

- validação das migrations D1 em ambiente local;
- suíte automatizada de testes;
- build de produção;
- preview isolado do Catálogo Comercial;
- aplicação controlada de migrations modificadas;
- deploy do Worker de produção;
- exportações de segurança das imagens originais e do snapshot final do D1.

O deploy de produção é serializado para evitar duas publicações concorrentes.

## Estado atual

- banco principal: Supabase;
- armazenamento de imagens: Cloudflare R2;
- identificação operacional: EAN-13;
- tratamento de imagens: determinístico, versão 10;
- inteligência artificial: não utilizada;
- produção: ativa no Cloudflare Workers.
