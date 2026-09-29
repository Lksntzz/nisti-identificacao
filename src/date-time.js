const SQL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function explicitUtcTimestamp(value) {
  if (!value) return value;
  const raw = String(value).trim();
  if (!raw) return raw;
  return SQL_UTC_TIMESTAMP.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
}

export function parseNistiTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  // SQLite/D1 CURRENT_TIMESTAMP returns UTC without a timezone suffix.
  // Mark it explicitly as UTC before JavaScript parses it.
  const normalized = explicitUtcTimestamp(raw);

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSaoPauloDateTime(value, {
  emptyDate = '—',
  emptyTime = '—',
  includeSeconds = false
} = {}) {
  const date = parseNistiTimestamp(value);
  if (!date) return { date: emptyDate, time: emptyTime };

  return {
    date: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date),
    time: new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {})
    }).format(date)
  };
}

export function formatSaoPauloTimestamp(value, options = {}) {
  const formatted = formatSaoPauloDateTime(value, options);
  if (formatted.date === (options.emptyDate || '—')) return formatted.date;
  return `${formatted.date}, ${formatted.time}`;
}
