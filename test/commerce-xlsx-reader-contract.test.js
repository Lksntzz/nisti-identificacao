import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('leitor distingue hyperlink presente de URL recuperada do texto visível', () => {
  const source = read('src/commerce-xlsx-reader.js');
  assert.equal(source.includes('countRecoveredHyperlinks'), true);
  assert.equal(source.includes('workbook_hyperlinks: workbookHyperlinkCount'), true);
  assert.equal(source.includes('recovered_hyperlinks: recoveredHyperlinks'), true);
  assert.equal(source.includes("!/^https?:\\/\\//i.test(displayed)"), true);
});
