# NISTI — Proteção de publicações e plano de recuperação

**Situação: primeira etapa de segurança.** Nenhuma alteração de dados, imagens ou usuários é executada por este documento.

## 1. Proteger de verdade a versão principal no GitHub

O arquivo `.github/workflows/deploy-production.yml` passa a bloquear o deploy se o commit da branch `main` não vier de um pull request já integrado **e** com o teste `Production Gate / build` concluído com sucesso no commit de origem.

Isso evita que um push direto sem aprovação do CI seja automaticamente publicado no Cloudflare.

**Importante:** esse bloqueio impede a publicação, mas não impede que um usuário com permissão de escrita altere o código na `main`. Para impedir isso, o proprietário deve configurar no site do GitHub:

1. Abrir [Settings → Rules → Rulesets](https://github.com/Lksntzz/nisti-identificacao/settings/rules).
2. Criar uma regra para a branch `main` e ativá-la (Active).
3. Exigir pull request antes do merge.
4. Exigir teste de status `build` (workflow **Production Gate**) bem-sucedido. Se o GitHub pedir origem, selecionar **GitHub Actions**.
5. Bloquear exclusão e force-push da branch.
6. Não habilitar bypass para contas de automação, salvo necessidade justificada e auditada.
7. Caso haja mais de um revisor disponível, exigir aprovação de outro responsável. Se o proprietário trabalhar sozinho, configurar com cuidado para não se bloquear permanentemente.

**Validação:** tentar abrir um PR com teste reprovado; o botão de mesclar deve ficar bloqueado. A configuração do Ruleset não pode ser aplicada pela integração atual do assistente.

## 2. Estado atual dos dados

| Recurso | Origem operacional | Backup confirmado? |
| --- | --- | --- |
| Código e mudanças | GitHub | Histórico Git disponível; restauração do Worker não testada aqui |
| Produtos, anúncios, vendas e notificações | Supabase PostgreSQL | **Não confirmado** |
| Imagens originais e tratadas | Cloudflare R2 | **Não confirmado** |
| Banco Cloudflare D1 | Histórico/compatibilidade | Não é a fonte principal de produção |

A configuração de produção `wrangler.toml` usa `SUPABASE_WRITE_MODE="primary"`. Não trate uma exportação feita via D1 como cópia completa e atual dos dados do Supabase.

O workflow `supabase-final-snapshot.yml`, apesar do nome, exporta o **D1 congelado da migração antiga**. O workflow `export-original-product-images.yml` também obtém seu índice de imagens do D1. **Nenhum dos dois comprova a existência de backup atual da produção.**

## 3. Backup seguro do Supabase

- Verificar, no painel oficial do Supabase, em Database → Backups, quais backups de produção existem, data, retenção, recuperação disponível e eventuais custos.
- Habilitar ou provisionar backup periódico apropriado ao plano contratado, com cópia restaurável para destino privado, de preferência em infraestrutura independente. Backups automáticos do provedor dependem do plano.
- Proteger toda credencial de conexão como **secret**. Nunca colocá-la em arquivos versionados, logs ou artifacts de GitHub Actions de um repositório público.
- Registrar a última data de backup e fazer **restauração de teste isolada**, nunca diretamente sobre produção.
- Uma cópia SQL do banco **não inclui automaticamente imagens e objetos no R2**.

## 4. Backup seguro das imagens do R2

- Consultar o cadastro **atual do Supabase** para obter as referências das imagens dos produtos e do Mural, não o índice antigo D1.
- Copiar os objetos do bucket `nisti-identificacao-images` para um **destino privado separado**, com histórico de versões, criptografia e retenção definida.
- Conferir quantidade, tamanho e hash dos objetos da cópia, incluindo imagens originais e derivadas.
- Recuperar uma amostra representativa em ambiente separado e conferir visualmente.
- Não disponibilizar arquivos ZIP com imagens ou cadastros como artifacts públicos do GitHub.

## 5. Teste de recuperação antes de alterar infraestrutura

1. Criar um ambiente de teste isolado.
2. Restaurar uma cópia do PostgreSQL nele.
3. Restaurar e conferir as imagens numa área privada de testes.
4. Verificar leitura de EAN, login, listagem de produtos, Mural, anúncios, vendas e notificações.
5. Registrar resultado, tempo da restauração, data do backup e problemas.
6. Só depois avaliar remoção de rotinas antigas do D1.

## 6. Critérios de conclusão

- [ ] `main` protegida por Ruleset ativo
- [x] Deploy bloqueado para commits sem PR testado
- [ ] Backup Supabase com data e retenção verificados
- [ ] Cópia R2 com quantidade e integridade verificadas
- [ ] Uma restauração de teste validada
- [ ] Plano de frequência e responsável documentados

Não apagar tabelas, desativar o banco antigo, remover imagens ou alterar produção como parte do processo de verificação.
