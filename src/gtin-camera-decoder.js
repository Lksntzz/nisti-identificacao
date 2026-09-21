import { isValidGtin13 } from './gtin.js';

const LEFT_ODD = new Map([
  ['0001101', '0'], ['0011001', '1'], ['0010011', '2'], ['0111101', '3'], ['0100011', '4'],
  ['0110001', '5'], ['0101111', '6'], ['0111011', '7'], ['0110111', '8'], ['0001011', '9']
]);

const LEFT_EVEN = new Map([
  ['0100111', '0'], ['0110011', '1'], ['0011011', '2'], ['0100001', '3'], ['0011101', '4'],
  ['0111001', '5'], ['0000101', '6'], ['0010001', '7'], ['0001001', '8'], ['0010111', '9']
]);

const RIGHT = new Map([
  ['1110010', '0'], ['1100110', '1'], ['1101100', '2'], ['1000010', '3'], ['1011100', '4'],
  ['1001110', '5'], ['1010000', '6'], ['1000100', '7'], ['1001000', '8'], ['1110100', '9']
]);

const FIRST_DIGIT_BY_PARITY = new Map([
  ['LLLLLL', '0'], ['LLGLGG', '1'], ['LLGGLG', '2'], ['LLGGGL', '3'], ['LGLLGG', '4'],
  ['LGGLLG', '5'], ['LGGGLL', '6'], ['LGLGLG', '7'], ['LGLGGL', '8'], ['LGGLGL', '9']
]);

function sliceBits(bits, start, length) {
  return bits.slice(start, start + length);
}

export function decodeEan13Bits(bits) {
  if (typeof bits !== 'string' || bits.length !== 95) return null;
  if (sliceBits(bits, 0, 3) !== '101') return null;
  if (sliceBits(bits, 45, 5) !== '01010') return null;
  if (sliceBits(bits, 92, 3) !== '101') return null;

  let leftDigits = '';
  let parity = '';
  for (let index = 0; index < 6; index += 1) {
    const chunk = sliceBits(bits, 3 + index * 7, 7);
    if (LEFT_ODD.has(chunk)) {
      leftDigits += LEFT_ODD.get(chunk);
      parity += 'L';
    } else if (LEFT_EVEN.has(chunk)) {
      leftDigits += LEFT_EVEN.get(chunk);
      parity += 'G';
    } else {
      return null;
    }
  }

  const firstDigit = FIRST_DIGIT_BY_PARITY.get(parity);
  if (!firstDigit) return null;

  let rightDigits = '';
  for (let index = 0; index < 6; index += 1) {
    const chunk = sliceBits(bits, 50 + index * 7, 7);
    const digit = RIGHT.get(chunk);
    if (digit == null) return null;
    rightDigits += digit;
  }

  const gtin = `${firstDigit}${leftDigits}${rightDigits}`;
  return isValidGtin13(gtin) ? gtin : null;
}

function otsuThreshold(luma) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < luma.length; index += 1) {
    histogram[luma[index]] += 1;
  }

  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value];

  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestThreshold = 127;
  let bestVariance = -1;

  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundCount += histogram[threshold];
    if (!backgroundCount) continue;

    const foregroundCount = luma.length - backgroundCount;
    if (!foregroundCount) break;

    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (totalSum - backgroundSum) / foregroundCount;
    const difference = backgroundMean - foregroundMean;
    const variance = backgroundCount * foregroundCount * difference * difference;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function buildRuns(binary) {
  const runs = [];
  if (!binary.length) return runs;

  let value = binary[0];
  let start = 0;
  for (let index = 1; index <= binary.length; index += 1) {
    const next = index < binary.length ? binary[index] : -1;
    if (next !== value) {
      runs.push({ value, start, length: index - start });
      value = next;
      start = index;
    }
  }
  return runs;
}

function sampleModules(binary, startX, moduleWidth) {
  const bits = [];
  for (let moduleIndex = 0; moduleIndex < 95; moduleIndex += 1) {
    const moduleStart = startX + moduleIndex * moduleWidth;
    const from = Math.max(0, Math.floor(moduleStart + moduleWidth * 0.22));
    const to = Math.min(binary.length, Math.ceil(moduleStart + moduleWidth * 0.78));
    if (from >= to) return null;

    let black = 0;
    for (let pixel = from; pixel < to; pixel += 1) black += binary[pixel];
    bits.push(black * 2 >= (to - from) ? '1' : '0');
  }
  return bits.join('');
}

function nearSameWidth(a, b, c) {
  const min = Math.min(a, b, c);
  const max = Math.max(a, b, c);
  return min > 0 && max / min <= 1.9;
}

export function decodeEan13LumaRow(luma) {
  if (!luma || luma.length < 190) return null;

  const threshold = otsuThreshold(luma);
  const binary = new Uint8Array(luma.length);
  for (let index = 0; index < luma.length; index += 1) {
    binary[index] = luma[index] <= threshold ? 1 : 0;
  }

  const runs = buildRuns(binary);
  let checkedCandidates = 0;

  for (let runIndex = 1; runIndex + 3 < runs.length; runIndex += 1) {
    const first = runs[runIndex];
    const second = runs[runIndex + 1];
    const third = runs[runIndex + 2];
    const quiet = runs[runIndex - 1];

    if (first.value !== 1 || second.value !== 0 || third.value !== 1 || quiet.value !== 0) continue;
    if (!nearSameWidth(first.length, second.length, third.length)) continue;

    const baseModule = (first.length + second.length + third.length) / 3;
    if (baseModule < 1.2 || quiet.length < baseModule * 3.5) continue;

    checkedCandidates += 1;
    if (checkedCandidates > 16) break;

    for (let step = -18; step <= 18; step += 1) {
      const moduleWidth = baseModule * (1 + step * 0.01);
      const endX = first.start + moduleWidth * 95;
      if (endX > binary.length + moduleWidth) continue;

      const bits = sampleModules(binary, first.start, moduleWidth);
      if (!bits) continue;
      const decoded = decodeEan13Bits(bits);
      if (decoded) return decoded;
    }
  }

  return null;
}

export function imageDataToLumaRow(imageData) {
  const { data, width, height } = imageData;
  if (!data || !width || !height) return null;

  const luma = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      sum += data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    }
    luma[x] = Math.round(sum / height);
  }
  return luma;
}
