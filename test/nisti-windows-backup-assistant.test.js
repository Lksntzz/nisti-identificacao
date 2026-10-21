import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wrapper = fs.readFileSync('scripts/nisti-backup-assistant.ps1', 'utf8');
const launcher = fs.readFileSync('scripts/iniciar-backup-nisti.cmd', 'utf8');

test('Windows launcher runs only the local PowerShell assistant', () => {
  assert.match(launcher, /powershell\.exe -NoProfile -ExecutionPolicy RemoteSigned -File/);
  assert.match(launcher, /nisti-backup-assistant\.ps1/);
  assert.doesNotMatch(launcher, /https?:\/\/|token=|password=/i);
});

test('backup assistant prompts for secrets and deletes inherited session variables', () => {
  assert.match(wrapper, /Read-Host 'Senha do PostgreSQL \(oculta\)' -AsSecureString/);
  assert.match(wrapper, /Read-Host 'Senha EXCLUSIVA do backup \(20\+ caracteres, oculta\)' -AsSecureString/);
  assert.match(wrapper, /NISTI_BACKUP_PASSPHRASE/);
  assert.match(wrapper, /PGPASSWORD/);
  assert.match(wrapper, /finally\s*\{/);
  assert.match(wrapper, /Remove-Item -Path \('Env:' \+ \$item\)/);
  assert.doesNotMatch(wrapper, /CLOUDFLARE_API_TOKEN|SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN/);
});

test('assistant uses safe encrypted local backup, no database mutation', () => {
  assert.match(wrapper, /'scripts\/nisti-free-backup\.mjs' status/);
  assert.match(wrapper, /'scripts\/nisti-drive-backup\.mjs' backup --output-dir/);
  assert.match(wrapper, /'scripts\/nisti-drive-backup\.mjs' verify --file/);
  assert.match(wrapper, /'scripts\/nisti-drive-backup\.mjs' inspect --file/);
  assert.match(wrapper, /NISTI_BACKUP_MAX_MB = '100'/);
  assert.match(wrapper, /PGSSLMODE = 'require'/);
  assert.match(wrapper, /Para gerar a copia criptografada, digite BACKUP/);
  assert.match(wrapper, /A pasta escolhida nao existe/);
  assert.match(wrapper, /NISTI-Criptografado/);
  assert.doesNotMatch(wrapper, /pg_restore\s+--dbname|DROP TABLE|DELETE FROM|wrangler d1|r2 object put|Invoke-WebRequest/);
});

test('encrypted backup never falsely claims R2 objects are included or restore tested', () => {
  assert.match(wrapper, /NAO inclui imagens do Cloudflare R2/);
  assert.match(wrapper, /restauracao isolada ainda precisa ser testada/);
  assert.match(wrapper, /\.nisti\.enc/);
  assert.match(wrapper, /\.nisti\.json/);
});
