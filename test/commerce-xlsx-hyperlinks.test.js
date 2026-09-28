import test from 'node:test';
import assert from 'node:assert/strict';
import {
  excelColumnIndex,
  hyperlinksForRow,
  parseWorkbookSheetTargets,
  parseWorksheetHyperlinks
} from '../src/commerce-xlsx-hyperlinks.js';

test('mapeia nomes de abas para arquivos OOXML mesmo após reordenação', () => {
  const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Agendas" sheetId="7" r:id="rId3"/><sheet name="Planner" sheetId="2" r:id="rId9"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId3" Target="worksheets/sheet8.xml"/><Relationship Id="rId9" Target="worksheets/sheet2.xml"/></Relationships>`;
  assert.deepEqual(parseWorkbookSheetTargets(workbook, rels), [
    { name: 'Agendas', path: 'xl/worksheets/sheet8.xml' },
    { name: 'Planner', path: 'xl/worksheets/sheet2.xml' }
  ]);
});

test('preserva hyperlink externo quando a célula mostra apenas o título do anúncio', () => {
  const sheet = `<?xml version="1.0"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hyperlinks><hyperlink ref="G3" r:id="rId4"/></hyperlinks></worksheet>`;
  const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId4" Target="https://www.mercadolivre.com.br/agenda-2027/up/MLBU123?pdp_filters=item_id:MLB456" TargetMode="External"/></Relationships>`;
  const links = parseWorksheetHyperlinks(sheet, rels);
  assert.equal(links.get('G3'), 'https://www.mercadolivre.com.br/agenda-2027/up/MLBU123?pdp_filters=item_id:MLB456');
});

test('converte referência de célula em coluna zero-based e separa links por linha', () => {
  assert.equal(excelColumnIndex('A1'), 0);
  assert.equal(excelColumnIndex('G3'), 6);
  assert.equal(excelColumnIndex('AA10'), 26);
  const links = new Map([
    ['G3', 'https://example.test/3'],
    ['G4', 'https://example.test/4']
  ]);
  assert.deepEqual(hyperlinksForRow(links, 3), { 6: 'https://example.test/3' });
});

test('ignora links internos e esquemas não HTTP', () => {
  const sheet = `<worksheet xmlns:r="x"><hyperlinks><hyperlink ref="G3" r:id="r1"/><hyperlink ref="G4" r:id="r2"/></hyperlinks></worksheet>`;
  const rels = `<Relationships><Relationship Id="r1" Target="#A1"/><Relationship Id="r2" Target="javascript:alert(1)"/></Relationships>`;
  assert.equal(parseWorksheetHyperlinks(sheet, rels).size, 0);
});
