export function normalizeGtin(value) {
  return String(value ?? '').trim();
}

export function gtin13CheckDigit(firstTwelveDigits) {
  const value = normalizeGtin(firstTwelveDigits);
  if (!/^\d{12}$/.test(value)) return null;

  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(value[index]);
    sum += digit * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin13(value) {
  const gtin = normalizeGtin(value);
  if (!/^\d{13}$/.test(gtin)) return false;
  const expected = gtin13CheckDigit(gtin.slice(0, 12));
  return expected === Number(gtin[12]);
}

export function requireValidGtin13(value) {
  const gtin = normalizeGtin(value);
  if (!isValidGtin13(gtin)) {
    const error = new Error('GTIN/EAN-13 inválido.');
    error.code = 'invalid_gtin';
    error.status = 400;
    throw error;
  }
  return gtin;
}
