import readExcelFile from 'read-excel-file/browser';
import { normalizeCommerceImportRow } from './commerce-import-normalizer.js';

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

export async function sha256Hex(arrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 indisponível neste navegador.');
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer));
}

export async function readCommerceXlsx(file, marketplace) {
  const market = cleanMarketplace(marketplace);
  const filename = validateFile(file);
  const buffer = await file.arrayBuffer();
  const [sha256, workbook] = await Promise.all([
    sha256Hex(buffer),
    readExcelFile(buffer)
  ]);

  if (!Array.isArray(workbook) || !workbook.length) {
    throw new Error('O arquivo não possui planilhas legíveis.');
  }

  const rows = [];
  const sheets = [];
  let physicalRows = 0;

  for (const sheet of workbook) {
    const sheetName = String(sheet?.sheet || '').trim() || 'Sem nome';
    const data = Array.isArray(sheet?.data) ? sheet.data : [];
    physicalRows += data.length;
    if (physicalRows > COMMERCE_XLSX_MAX_ROWS) {
      throw new Error(`O arquivo excede o limite operacional de ${COMMERCE_XLSX_MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
    }

    let acceptedRows = 0;
    let invalidRows = 0;
    let reviewRows = 0;

    data.forEach((rawRow, index) => {
      const row = stableRow(rawRow);
      const result = normalizeCommerceImportRow({
        marketplace: market,
        sheetName,
        row,
        rowNumber: index + 1
      });
      if (!result) return;

      const item = stagingRow(result, sheetName, index + 1);
      rows.push(item);
      acceptedRows += 1;
      if (result.status === 'INVALID') invalidRows += 1;
      else if (result.status === 'REVIEW') reviewRows += 1;
    });

    sheets.push({
      name: sheetName,
      physical_rows: data.length,
      accepted_rows: acceptedRows,
      invalid_rows: invalidRows,
      review_rows: reviewRows
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
      invalid_rows: rows.filter(row => row.parser_status === 'INVALID').length
    }
  };
}
