# NISTI ID

Sistema operacional da NISTI PRINT para cadastro mestre de produtos, identificação por EAN na expedição, gestão do Catálogo Comercial, vendas, importações e publicação de conteúdo no Mural NISTI.

**Produção:** [nisti-identificacao.lksntz1411.workers.dev](https://nisti-identificacao.lksntz1411.workers.dev)  
**Última revisão deste README:** 06/10/2026

## Estado operacional atual

O NISTI ID opera com duas experiências principais:

- **Operador:** identificação de produtos por EAN e acesso às funções operacionais liberadas.
- **Administrador:** cadastro de produtos, Mural NISTI, Catálogo Comercial, vendas, importações, histórico de bipagens, EANs não cadastrados, geração de códigos e Saúde & Logs.

O painel administrativo usa uma única navegação em `/admin`. As ferramentas do **Mural NISTI** e do **Catálogo** ficam organizadas em menus expansíveis na barra lateral e são carregadas dentro do próprio painel, sem abrir módulos separados durante a navegação normal.

## Como o sistema opera

### 1. Cadastro mestre

O produto é cadastrado em **Produtos NISTI** com seus dados principais, SKU, EAN, acessórios e imagem.

O Supabase PostgreSQL é a autoridade principal de leitura e escrita. As imagens originais e derivadas ficam no Cloudflare R2.

A imagem original é preservada. Processos de tratamento geram arquivos derivados e nunca substituem silenciosamente o original.

### 2. Identificação por EAN

Na operação de expedição:

1. o operador lê o código EAN-13;
2. o sistema consulta o cadastro oficial;
3. localiza o produto correspondente;
4. mostra as informações operacionais necessárias, incluindo SKU, imagem e acessórios;
5. registra a bipagem;
6. códigos sem correspondência entram na fila de **EAN não Cadastrados**.

A identificação não depende de reconhecimento visual, embeddings ou geração automática de SKU.

### 3. Sincronização com o Catálogo Comercial

O Catálogo Comercial consolida o Produto Mestre e os anúncios conhecidos das plataformas.

O fluxo atual permite:

- cruzar Produto Mestre e anúncios;
- revisar vínculos por SKU e evidências disponíveis;
- visualizar presença por plataforma;
- tratar conflitos e casos ambíguos;
- controlar estados de anúncios;
- analisar produtos com e sem venda;
- importar novos dados antes de efetivar alterações.

As alterações do NISTI ID devem refletir no Catálogo por meio das rotinas de sincronização e reconciliação.

## Navegação administrativa

### CADASTRO

#### Produtos NISTI

Cadastro mestre do sistema.

Principais funções:

- cadastrar produtos;
- editar dados e SKU;
- vincular ou corrigir EAN;
- manter imagens;
- importar cadastros em lote;
- consultar sincronização comercial;
- abrir detalhes do Produto Mestre.

#### Mural NISTI ▾

O Mural possui três ferramentas:

**Painel**

Visualiza e administra as publicações já criadas.

Inclui métricas, publicações existentes, status e ações administrativas.

**Publicar**

Editor unificado de novas publicações.

Tipos disponíveis:

- **Produto**
- **Informação**
- **Coleção**

O editor possui hierarquia por etapas, campos específicos para cada tipo, configurações de publicação e prévia lateral da experiência do operador.

**Tratamento**

Área responsável pelo tratamento, revisão e aprovação das imagens usadas pelo Mural.

É nessa ferramenta que a integração direta com o Canva está ativa.

#### Gerador de Barras

Gera códigos EAN-13 e arquivos para uso operacional.

### COMERCIAL

#### Catálogo ▾

O item **Catálogo** é um menu expansível. Clicar no item principal abre ou fecha as ferramentas; ele não redireciona o administrador para outra aplicação.

As ferramentas são:

**Catálogo**

Visão consolidada dos Produtos Mestre e anúncios de múltiplas plataformas.

**Vendas**

Painel de faturamento, pedidos, unidades, produtos com venda e análise de itens sem venda.

**Central de Importações**

Importação controlada de arquivos de catálogo e vendas, com validação e conferência antes da efetivação.

**Pendências**

Fila de vínculos, divergências e casos que exigem revisão.

Todas essas ferramentas são renderizadas dentro do painel principal `/admin`.

A rota `/admin-commerce` ainda é aceita pelo backend por compatibilidade, mas não é usada pela navegação administrativa principal.

### BIPAGENS

- **Histórico de Bipagens**
- **EAN não Cadastrados**

### SISTEMA

- **Saúde & Logs**

## Mural NISTI

O Mural é a central de comunicação visual para os operadores.

### Painel

O Painel mostra o conteúdo já publicado e concentra a gestão editorial.

### Publicar

O editor atual foi reorganizado em um fluxo único.

#### Produto

Permite:

- buscar o produto por nome ou SKU;
- selecionar o Produto Mestre;
- usar imagem editorial opcional;
- definir título, subtítulo, descrição e selo;
- configurar destaque, publicação, expiração e ordem;
- visualizar a prévia no formato do Mural antes de publicar.

#### Informação

Permite:

- prioridade Normal, Atenção ou Importante;
- classificação como Comunicado Interno, Processo ou Novidade;
- título;
- linha de apoio;
- mensagem;
- imagem editorial opcional;
- programação e ordenação;
- prévia do conteúdo.

#### Coleção

Permite:

- nome da coleção;
- ano;
- frase curta;
- banner/arte da coleção;
- busca e seleção de produtos;
- ordenação dos produtos;
- direção visual e notas de tema;
- descrição;
- escolha de exibir ou não o ano;
- prévia da coleção.

## Integração Canva

O Canva está integrado diretamente ao NISTI e é usado em dois fluxos: **Mural → Tratamento**, para recorte de imagens, e **Mural → Publicar**, para criação de artes a partir de Brand Templates com campos de preenchimento automático.

### Autenticação

A integração usa OAuth com PKCE.

Escopos solicitados atualmente:

- `asset:read`
- `asset:write`
- `design:content:read`
- `design:content:write`
- `design:meta:read`
- `brandtemplate:meta:read`
- `brandtemplate:content:read`
- `profile:read`

O painel possui ações para:

- conectar a conta Canva;
- verificar o estado da conexão;
- desconectar a conta.

### Segurança da conexão

Os segredos da aplicação Canva permanecem no Cloudflare Worker:

- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`
- `CANVA_TOKEN_ENCRYPTION_KEY`

Tokens OAuth não são gravados em texto puro.

O payload da conexão é criptografado com AES-GCM antes de ser armazenado no Supabase. As tabelas e RPCs da conexão são restritas ao `service_role`.

### Criação de artes no Publicar

O editor **Mural → Publicar** usa a mesma conexão OAuth do Canva para criar artes de Produto, Informação e Coleção.

Fluxo:

1. o administrador preenche os dados da publicação no NISTI;
2. o sistema lista os Brand Templates Canva que possuem dataset/autofill;
3. o administrador escolhe um template;
4. o NISTI envia textos e imagens compatíveis com os campos do template;
5. o Canva cria um novo design por Autofill;
6. o sistema disponibiliza **Editar no Canva**;
7. depois da edição, **Usar esta arte** exporta a primeira página em PNG;
8. o PNG volta para o editor do NISTI e entra na prévia da publicação;
9. ao salvar/publicar, a arte segue o mesmo fluxo de imagem editorial da publicação.

A criação de arte não publica conteúdo automaticamente. O administrador continua responsável por confirmar **Salvar rascunho** ou **Publicar** no NISTI.

Conexões Canva criadas antes da inclusão dos novos escopos podem exigir uma reconexão única para autorizar Brand Templates e criação/exportação de designs.

### Tratamento de imagem com Canva

Fluxo atual:

1. o NISTI carrega a imagem original do produto;
2. envia a imagem para o Canva;
3. o Canva executa **background removal**;
4. o NISTI solicita/exporta o resultado como PNG transparente;
5. o navegador executa o pós-processamento NISTI;
6. é criada uma máscara individual;
7. é aplicado o contorno branco externo;
8. imagem e máscara são gravadas como derivados;
9. o produto entra em revisão;
10. somente após aprovação a imagem tratada passa a ser considerada pronta.

O sistema verifica se a conta Canva conectada possui as capacidades:

- `background_removal`
- `export_png_transparency`

Se a conta não possuir esses recursos, o tratamento é bloqueado de forma controlada.

### Processador atual

**Versão:** `25`

Pipeline ativo:

```text
Imagem original
      │
      ▼
Canva Asset Upload
      │
      ▼
Canva Background Removal
      │
      ▼
PNG transparente
      │
      ▼
NISTI Alpha + Outline
  ├── saneamento do alpha
  ├── preservação da silhueta
  ├── máscara individual
  └── contorno branco externo
      │
      ▼
Revisão manual
      │
      ▼
Aprovação
```

O contorno atual usa referência aproximada de 12 px em uma imagem de 1024 px, com ajuste proporcional limitado pelo processador.

### Execução da fila

O tratamento é manual por padrão:

- uma nova sessão começa pausada;
- o administrador precisa iniciar o tratamento;
- a fila processa um item por vez;
- existe lock entre abas administrativas;
- falhas transitórias possuem tentativas controladas;
- um produto com erro não deve bloquear a fila inteira;
- ao atingir limite de créditos do Canva, a fila é pausada e o erro é exibido;
- o original permanece preservado.

## Inteligência artificial e automação

O NISTI **não usa IA generativa para identificar produtos, gerar SKU, decidir EAN ou sincronizar o Catálogo**.

As integrações antigas com Gemini/Workers AI para reconhecimento visual foram removidas.

O processamento externo inteligente ativo hoje é a transformação de imagem fornecida pelo Canva para remoção de fundo. O restante do fluxo NISTI — máscara, contorno, persistência, revisão e aprovação — é controlado pelo próprio sistema.

## Arquitetura de produção

```text
Operador / Administrador
          │
          ▼
React 18 + Vite 6
          │
          ▼
Cloudflare Worker
  ├── Edge Router e APIs administrativas
  ├── autenticação administrativa
  ├── integração Canva OAuth/API
  └── rotinas de sincronização
          │
          ├────────► Supabase PostgreSQL
          │          banco principal / autoridade de escrita
          │
          ├────────► Cloudflare R2
          │          imagens originais e derivadas
          │
          └────────► Canva API
                     remoção de fundo, Brand Templates,
                     Autofill e exportação PNG
```

### Supabase

Configuração de produção atual:

- `SUPABASE_READS_ENABLED=1`
- `SUPABASE_WRITE_MODE=primary`
- `SUPABASE_CUTOVER_WRITE_FREEZE=0`

O Supabase é a autoridade principal de dados.

Se uma escrita crítica não for confirmada no banco principal, a operação é tratada como falha em vez de simular sucesso.

### Cloudflare R2

Bucket de produção:

`nisti-identificacao-images`

Usado para imagens originais e arquivos derivados do sistema.

### Cloudflare D1

D1 não é a autoridade principal do sistema atual.

O repositório ainda mantém scripts e migrations de compatibilidade para D1, mas o `wrangler.toml` de produção não possui binding D1 como banco operacional principal.

## Rotas principais

- `/` — experiência do operador / identificação por EAN;
- `/admin` — painel administrativo protegido;
- `/admin-login` — autenticação administrativa;
- `/admin-logout` — encerramento da sessão;
- `/admin-commerce` — rota protegida mantida por compatibilidade;
- `/api/health` — diagnóstico mínimo do serviço.

### Rotas administrativas Canva

Protegidas pela sessão administrativa:

- `GET /api/admin/canva/status`
- `POST /api/admin/canva/connect`
- `POST /api/admin/canva/background-remove`
- `GET /api/admin/canva/templates`
- `POST /api/admin/canva/art/create`
- `POST /api/admin/canva/art/export`
- `POST /api/admin/canva/disconnect`
- `GET /canva-oauth/callback` — callback OAuth.

## Segurança

- sessão administrativa protegida por cookie `HttpOnly`, `Secure` e `SameSite=Strict`;
- APIs administrativas exigem sessão válida;
- credenciais de serviço não são enviadas ao navegador;
- tokens Canva são criptografados antes de persistir;
- RPCs sensíveis do Supabase ficam restritas ao `service_role`;
- imagens originais são preservadas;
- operações críticas não devem retornar sucesso sem confirmação da autoridade principal;
- atividades administrativas e falhas operacionais são registradas.

## Stack atual

- React 18;
- React DOM 18;
- Vite 6;
- Cloudflare Workers;
- Cloudflare R2;
- Supabase PostgreSQL;
- Canva REST API + OAuth;
- GitHub Actions;
- Node.js test runner;
- `read-excel-file` para importações XLSX;
- `fflate` para geração/manipulação de arquivos compactados.

## Desenvolvimento local

Requisitos:

- Node.js 20 ou superior;
- dependências instaladas;
- acesso às configurações necessárias do Cloudflare/Supabase para testar integrações reais.

Instalação:

```bash
npm install
```

Servidor local:

```bash
npm run dev
```

Testes:

```bash
npm test
```

Build:

```bash
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

Os workflows do GitHub são responsáveis por validar alterações antes da produção.

O fluxo inclui:

- checkout;
- instalação das dependências;
- validação local das migrations D1;
- suíte automatizada de testes;
- build de produção;
- detecção de mudanças de migration;
- aplicação controlada de migrations quando necessário;
- deploy do Worker de produção.

O deploy de produção é serializado para reduzir risco de publicações concorrentes.

## Resumo do estado atual

| Área | Estado |
| --- | --- |
| Banco principal | Supabase PostgreSQL |
| Imagens | Cloudflare R2 |
| Identificação operacional | EAN-13 |
| Administração | Painel único em `/admin` |
| Mural | Painel / Publicar / Tratamento |
| Publicar | Produto / Informação / Coleção |
| Catálogo | Catálogo / Vendas / Central de Importações / Pendências |
| Canva | OAuth ativo no tratamento de imagens e na criação de artes do Publicar |
| Processador de imagens | Versão 25 |
| Reconhecimento visual próprio | Removido |
| Gemini / Workers AI | Removidos |
| Produção | Cloudflare Workers |
