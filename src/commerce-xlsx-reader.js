import readExcelFile from 'read-excel-file/browser';
import { normalizeCommerceImportRow } from './commerce-import-normalizer.js';
import { extractCommerceXlsxHyperlinks, hyperlinksForRow } from './commerce-xlsx-hyperlinks.js';

export const COMMERCE_XLSX_MAX_BYTES = 25 * 1024 * 1024;
export const COMMERCE_XLSX_MAX_ROWS = 50000;

function cleanMarketplace(value) {
  const token = String(value || '').trim().toUpperCase();
  if (token === 'SHOPEE' || token === 'MERCADO_LIVRE') return token;
  throw new Error('Selecione Shopee ou Mercado Livre antes de ler o arquivo.');
}

function validateFile(file) {
  if (!(file instanceof Blob)) throw new Error('Selecione um arquivo .xlsx válido.');
  const name = String(file.name || '').trim();
  if (!/\.xlsx$/i.test(name)) throw new Error('Somente arquivos .xlsx são aceitos.');
  if (file.size <= 0) throw new Error('O arquivo Excel está vazio.');
  if (file.size > COMMERCE_XLSX_MAX_BYTES) {
    throw new Error('O arquivo Excel excede o limite operacional de 25 MB.');
  }
  return name;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function stableCell(value) {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function stableRow(row) {
  return Array.isArray(row) ? row.map(stableCell) : [];
}

function stagingRow(result, sheetName, rowNumber) {
  return {
    sheet_name: String(sheetName || '').trim() || 'Sem nome',
    row_number: rowNumber,
    parser_status: result.status,
    issues: Array.isArray(result.issues) ? result.issues : [],
    original: Array.isArray(result.original) ? result.original : [],
    normalized: result.normalized || null
  };
}

function rowWithHyperlinks(row, links) {
  const normalizedRow = row.slice();
  for (const [indexRaw, target] of Object.entries(links || {})) {
    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0) continue;
    while (normalizedRow.length <= index) normalizedRow.push(null);
    normalizedRow[index] = target;
  }
  return normalizedRow;
}

function countRecoveredHyperlinks(row, links) {
  let recovered = 0;
  for (const indexRaw of Object.keys(links || {})) {
    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0) continue;
    const displayed = String(row?.[index] ?? '').trim();
    if (!/^https?:\/\//i.test(displayed)) recovered += 1;
  }
  return recovered;
}

export async function sha256Hex(arrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 indisponível neste navegador.');
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer));
}

export async function readCommerceXlsx(file, marketplace) {
  const market = cleanMarketplace(marketplace);
  const filename = validateFile(file);
  const buffer = await file.arrayBuffer();
  const [sha256, workbook, workbookHyperlinks] = await Promise.all([
    sha256Hex(buffer),
    readExcelFile(buffer),
    extractCommerceXlsxHyperlinks(buffer)
  ]);

  if (!Array.isArray(workbook) || !workbook.length) {
    throw new Error('O arquivo não possui planilhas legíveis.');
  }

  const rows = [];
  const sheets = [];
  let physicalRows = 0;
  let workbookHyperlinkCount = 0;
  let recoveredHyperlinks = 0;

  for (const sheet of workbook) {
    const sheetName = String(sheet?.sheet || '').trim() || 'Sem nome';
    const data = Array.isArray(sheet?.data) ? sheet.data : [];
    const sheetLinks = workbookHyperlinks.get(sheetName) || new Map();
    physicalRows += data.length;
    if (physicalRows > COMMERCE_XLSX_MAX_ROWS) {
      throw new Error(`O arquivo excede o limite operacional de ${COMMERCE_XLSX_MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
    }

    let acceptedRows = 0;
    let invalidRows = 0;
    let reviewRows = 0;
    let sheetWorkbookHyperlinks = 0;
    let sheetRecoveredHyperlinks = 0;

    data.forEach((rawRow, index) => {
      const row = stableRow(rawRow);
      const hyperlinks = hyperlinksForRow(sheetLinks, index + 1);
      const hyperlinkCount = Object.keys(hyperlinks).length;
      const recoveredCount = countRecoveredHyperlinks(row, hyperlinks);
      const normalizedInput = hyperlinkCount ? rowWithHyperlinks(row, hyperlinks) : row;
      const result = normalizeCommerceImportRow({
        marketplace: market,
        sheetName,
        row: normalizedInput,
        rowNumber: index + 1
      });
      if (!result) return;

      // Preserve exactly what the operator saw in the workbook while using the
      // actual hyperlink target for normalized listing URLs.
      result.original = row;
      const item = stagingRow(result, sheetName, index + 1);
      rows.push(item);
      acceptedRows += 1;
      workbookHyperlinkCount += hyperlinkCount;
      recoveredHyperlinks += recoveredCount;
      sheetWorkbookHyperlinks += hyperlinkCount;
      sheetRecoveredHyperlinks += recoveredCount;
      if (result.status === 'INVALID') invalidRows += 1;
      else if (result.status === 'REVIEW') reviewRows += 1;
    });

    sheets.push({
      name: sheetName,
      physical_rows: data.length,
      accepted_rows: acceptedRows,
      invalid_rows: invalidRows,
      review_rows: reviewRows,
      workbook_hyperlinks: sheetWorkbookHyperlinks,
      recovered_hyperlinks: sheetRecoveredHyperlinks
    });
  }

  if (!rows.length) {
    throw new Error('Nenhuma linha de produto reconhecível foi encontrada no arquivo.');
  }

  return {
    filename,
    marketplace: market,
    sha256,
    size_bytes: file.size,
    sheets,
    rows,
    summary: {
      sheet_count: sheets.length,
      physical_rows: physicalRows,
      accepted_rows: rows.length,
      ready_rows: rows.filter(row => row.parser_status === 'READY').length,
      review_rows: rows.filter(row => row.parser_status === 'REVIEW').length,
      invalid_rows: rows.filter(row => row.parser_status === 'INVALID').length,
      workbook_hyperlinks: workbookHyperlinkCount,
      recovered_hyperlinks: recoveredHyperlinks
    }
  };
}
