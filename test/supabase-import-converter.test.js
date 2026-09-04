import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_ORDER,
  splitSqlStatements,
  insertTableName,
  convertD1DataSql
} from '../scripts/convert-d1-export-for-supabase.mjs';

test('SQL splitter preserves semicolons inside quoted values', () => {
  const source = `BEGIN TRANSACTION;\nINSERT INTO "products" VALUES(7,'SKU_A','M','CAPA','AC','W','T','E','Nome; com ponto','Var',NULL,'2026-09-04','2026-09-04');\nCOMMIT;`;
  const statements = splitSqlStatements(source);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /Nome; com ponto/);
});

test('quoted and plain INSERT table names are recognized', () => {
  assert.equal(insertTableName('INSERT INTO "products" VALUES(1);'), 'products');
  assert.equal(insertTableName('INSERT INTO product_platforms VALUES(1,1,\'SHOPEE\',NULL);'), 'product_platforms');
});

test('converter preserves IDs and orders dependency tables', () => {
  const source = `
PRAGMA defer_foreign_keys=TRUE;
BEGIN TRANSACTION;
INSERT INTO "product_platforms" VALUES(22,10,'SHOPEE',NULL);
INSERT INTO "products" VALUES(10,'M_CAPA_WTE','M','CAPA','WTE','W','T','E','Nome','Variação',NULL,'2026-09-04 10:00:00','2026-09-04 10:00:00');
INSERT INTO "gemini_call_budget" VALUES('lane',123,1);
COMMIT;
`;
  const converted = convertD1DataSql(source);
  assert.equal(converted.statementCounts.products, 1);
  assert.equal(converted.statementCounts.product_platforms, 1);
  assert.equal(converted.ignored.gemini_call_budget, 1);
  assert.match(converted.sql, /VALUES\(10,'M_CAPA_WTE'/);
  assert.ok(converted.sql.indexOf('-- products: 1 statement') < converted.sql.indexOf('-- product_platforms: 1 statement'));
  assert.equal(Object.keys(converted.statementCounts).length, 13);
  assert.deepEqual(Object.keys(converted.statementCounts), [...TABLE_ORDER]);
});

test('converter fails closed for unknown application tables', () => {
  assert.throws(
    () => convertD1DataSql(`INSERT INTO "mystery_business_table" VALUES(1,'x');`),
    /Tabela não mapeada mystery_business_table/
  );
});

test('converter fails closed for SQLite-only conflict inserts', () => {
  assert.throws(
    () => convertD1DataSql(`INSERT OR REPLACE INTO "products" VALUES(1);`),
    /não convertidas/
  );
});

test('converter fails closed for SQLite blob literals', () => {
  assert.throws(
    () => convertD1DataSql(`INSERT INTO "cover_embeddings" VALUES('C','k','m',768,X'ABCD','2026-09-04');`),
    /SQLite blob literal/
  );
});

test('converter detects truncated quoted SQL', () => {
  assert.throws(
    () => splitSqlStatements(`INSERT INTO "products" VALUES(1,'unterminated);`),
    /snapshot pode estar truncado/
  );
});
