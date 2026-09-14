export function normalizeGtin(value) {
  return String(value ?? '').replace(/[\s-]+/g, '');
}

export function gtin13CheckDigit(value) {
  const digits = normalizeGtin(value);
  if (!/^\d{12}$/.test(digits)) return null;
  const sum = [...digits].reduce((total, digit, index) => {
    return total + Number(digit) * (index % 2 === 0 ? 1 : 3);
  }, 0);
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin13(value) {
  const digits = normalizeGtin(value);
  return /^\d{13}$/.test(digits) && gtin13CheckDigit(digits.slice(0, 12)) === digits.at(-1);
}
