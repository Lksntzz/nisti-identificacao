# Exportação de imagens originais — catálogo Supabase

## Situação em 21/10/2026

O catálogo principal de imagens do NISTI está em `public.products` do Supabase PostgreSQL. Consulta de leitura constatou 375 produtos com `image_key` preenchida, cujas chaves começam com `products/`.

O workflow `.github/workflows/export-original-product-images.yml` agora consulta o índice do Supabase via `scripts/export-original-image-index-supabase.mjs`, não mais o D1 legado. O exportador existente continua usando o índice gerado para baixar os objetos do Cloudflare R2.

### Segurança e configuração

1. Execução **somente manual** pelo GitHub Actions. Não executar automaticamente em pushes, inclusive mudanças de workflow.
2. Configure os Secrets `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN` e `NISTI_IMAGE_EXPORT_PASSPHRASE` no GitHub Actions. A chave Supabase é altamente privilegiada; use ambiente protegido com aprovação manual quando possível. A senha de exportação deve ter **pelo menos 20 caracteres**, ser exclusiva e ficar fora do GitHub/Drive em formato legível. Nunca exponha os valores em commits, relatórios, logs ou artefatos.
3. O script acessa a URL HTTPS do Supabase e lê as colunas `id`, `sku`, `image_key`. Usa paginação por ID com contagem exata para falhar caso o PostgREST trunque a resposta silenciosamente.
4. Falha na autenticação, na consulta, em páginas incompletas ou em um catálogo vazio **interrompe a exportação**. Não existe fallback D1.
5. O workflow cria ZIP localmente e **criptografa antes do upload**, utilizando AES-256-GCM e scrypt, com o formato distinto `NISTIIMG1`. No GitHub Actions, somente `nisti-imagens-originais.zip.nisti.enc` é disponibilizado como artefato temporário por **um dia**. O ZIP puro não é publicado. A execução falha se não houver chave/senha, se a indexação falhar ou se a exportação for parcial. O arquivo criptografado ainda deve ser guardado em local privado, com senha preservada separadamente.
6. O índice considera apenas imagens originais **referenciadas** na tabela de produtos. Não inclui necessariamente imagens órfãs, artes Mural, documentos comerciais ou derivados R2. Portanto **não é backup completo do bucket**.
7. O fluxo requer permissões adequadas de leitura do R2 e o Secret `CLOUDFLARE_API_TOKEN`. Não pressupor que a existência do workflow comprova execução ou recuperação.

### Evidências e testes

- Testes automatizados: `test/export-original-image-index-supabase.test.js` exercita paginação, limite de páginas do PostgREST, falta de credencial, respostas inválidas e compatibilidade com o formato de entrada do downloader R2.
- Verificação pendente: confirmar que o Secret `SUPABASE_SERVICE_ROLE_KEY` existe e tem acesso à tabela `public.products`; executar exportação **controlada** com download de amostra, conferir contagens, falhas do `manifest.csv` e integridade física dos objetos.
- Backups no Google Drive: as pastas `Banco Supabase - Criptografado` e `Imagens R2 - Criptografadas` foram verificadas em 21/10/2026 e estavam **vazias**. Uma pasta vazia não comprova ausência de backups armazenados em outro destino, mas significa que não há cópia restaurável confirmada nessas pastas.
- Não criar índices novos no Supabase até existir backup recuperável confirmado e avaliação de custo/benefício.

## Configuração manual para o administrador

No repositório GitHub, acesse **Settings → Secrets and variables → Actions** e confira `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN` e `NISTI_IMAGE_EXPORT_PASSPHRASE`. Não envie credenciais pelo chat.

Somente após conferir permissões e segredos, use **Actions → Export Original Product Images → Run workflow**. Esse fluxo não substitui a primeira cópia criptografada do banco Supabase nem um backup completo do bucket R2.

Para recuperar localmente o ZIP criptografado, salve o artefato `.zip.nisti.enc`, configure no seu próprio computador a mesma variável `NISTI_IMAGE_EXPORT_PASSPHRASE` de forma privada e execute:

```bash
node scripts/nisti-encrypt-image-export.mjs verify nisti-imagens-originais.zip.nisti.enc
node scripts/nisti-encrypt-image-export.mjs decrypt nisti-imagens-originais.zip.nisti.enc DIRETORIO_PRIVADO
```

O ZIP descriptografado contém arquivos internos e não deve ser enviado a um repositório público ou pasta compartilhada. A validação de criptografia **não equivale** à verificação de integridade de cada objeto R2 nem a um teste de restauração completo.

Ver detalhes do legado em [Auditoria de D1 e índices](AUDITORIA-D1-INDICES-MIGRACOES-2026-10-21.md).
