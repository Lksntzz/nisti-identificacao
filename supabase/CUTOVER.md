# NISTI ID — Cutover D1 → Supabase

## Estado padrão

O repositório mantém o Supabase configurado, mas desabilitado:

```text
SUPABASE_URL=https://yioetdcbgorunwgwuawg.supabase.co
SUPABASE_READS_ENABLED=0
SUPABASE_READ_TIMEOUT_MS=2500
```

`SUPABASE_SERVICE_ROLE_KEY` **não** pode ser versionada. Ela deve existir apenas como segredo do Cloudflare Worker.

## Antes de habilitar

Todos os itens são obrigatórios:

1. snapshot D1 concluído e SHA-256 preservado;
2. 13 tabelas importadas no Supabase com IDs preservados;
3. contagens D1 = Supabase;
4. zero violações referenciais;
5. zero violações dos invariantes de negócio;
6. domínio de plataformas somente `MERCADO LIVRE`, `SHOPEE`, `AMAZON`;
7. RPCs `nisti_*` validadas somente para `service_role`;
8. Production Gate verde;
9. secret `SUPABASE_SERVICE_ROLE_KEY` configurado no Worker;
10. teste controlado antes de qualquer rollout amplo.

## Configurar o segredo

Executar localmente. O valor deve ser digitado diretamente no prompt do Wrangler e nunca enviado por chat, commit ou arquivo `.env` versionado.

```powershell
npx.cmd wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Ativação

A ativação será feita em commit/deploy específico, mudando somente:

```toml
SUPABASE_READS_ENABLED = "1"
```

Não alterar os thresholds de reconhecimento durante o cutover.

## Semântica do fallback

Com `SUPABASE_READS_ENABLED=1`:

- resposta Supabase válida, inclusive `[]`, `false` ou `null`, é autoritativa;
- D1 não é consultado para mascarar dado ausente/divergente;
- fallback D1 temporário ocorre somente em timeout, erro de transporte, HTTP 429 ou 5xx;
- 401, 403, 404 e erro de configuração falham fechado para tornar problemas de cutover visíveis.

## Rollback

Enquanto D1 permanecer disponível, o rollback operacional é:

```toml
SUPABASE_READS_ENABLED = "0"
```

seguido de build, gate e deploy controlado. Não excluir D1 antes da estabilização completa dos reads e writes no Supabase.
