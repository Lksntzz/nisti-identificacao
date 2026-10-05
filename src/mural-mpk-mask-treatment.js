import { __muralTransparentImageInternals } from './mural-transparent-image.js';
import { parseSku } from './sku.js';

const REFERENCE_SIZE = 1200;
const CLASSIFIER_MAX_SIDE = 180;
const OUTLINE_RADIUS_AT_1200 = 8;

// These paths are generated directly from the two Photoshop MPKs supplied by
// NISTI. They are geometry masks, not hand-drawn approximations.
// Vertical base source: "MKP FRENTE ATUAL copiar 2.psd" / layer "Camada 4 copiar".
// Horizontal base source: "MOCKUP HORIZONTAL(1).psd" / layer "Base".
// Optional vertical accessories use the PSD's tassel and elastic silhouettes.
const VERTICAL_BASE_PATH = `M930,30 289,84 287,86 288,131 252,133 242,135 238,138 238,141 244,145 238,149 238,152 242,155 255,157 288,158 289,191 280,193 249,194 241,196 239,198 239,202 245,205 239,209 239,213 242,215 254,217 288,217 290,250 288,252 246,254 242,255 239,258 239,260 242,263 246,264 240,268 240,272 243,274 290,277 290,312 244,315 240,318 240,320 243,323 249,325 243,326 240,330 244,334 291,336 291,371 244,374 241,377 242,381 253,383 251,385 243,386 241,390 245,393 290,393 292,398 297,690 297,788 249,792 246,795 246,797 249,800 256,801 249,803 246,807 248,810 256,812 297,813 297,847 273,848 250,851 247,853 247,856 250,859 254,860 249,862 247,864 247,867 255,871 296,871 298,873 298,906 266,908 250,911 248,913 248,917 253,920 248,924 248,927 251,930 255,931 298,933 299,964 271,966 253,969 249,972 249,976 254,979 249,983 249,987 261,991 298,991 299,1024 269,1026 254,1029 249,1033 250,1037 254,1039 250,1042 249,1046 252,1049 260,1051 299,1052 301,1098 701,1122 714,1124 767,1126 797,1129 908,1135 919,1137 943,1136 932,63Z M298,1042 299,1044 297,1045 296,1044Z`;

const HORIZONTAL_BASE_PATH = `M949,232 775,265 730,275 693,281 678,285 610,297 585,303 584,302 549,310 527,313 410,337 404,337 358,347 347,348 322,354 316,354 291,360 212,374 166,384 154,385 115,394 93,397 92,400 97,416 96,418 81,420 59,427 45,435 37,442 33,448 33,455 37,467 44,472 40,482 43,489 43,493 45,497 52,502 48,510 50,523 54,529 60,532 56,537 55,544 58,549 57,551 59,556 67,562 63,570 65,584 70,590 75,593 70,601 70,605 73,610 72,612 74,617 83,623 78,632 80,645 86,652 91,654 86,661 85,666 88,671 88,677 90,680 99,685 93,697 96,702 97,710 100,713 108,716 101,725 101,730 104,734 103,738 107,744 116,748 109,758 109,762 112,766 111,770 115,776 125,780 117,788 119,803 125,809 133,812 125,821 125,826 128,830 127,835 131,840 142,844 134,851 132,857 135,862 135,868 140,873 151,876 144,882 141,887 141,891 144,895 143,899 147,905 160,909 154,913 149,919 149,924 152,928 151,933 157,939 170,941 159,950 157,957 160,961 160,967 163,971 168,973 180,974 172,979 165,987 165,990 169,995 168,1001 171,1004 188,1008 180,1013 174,1020 174,1025 177,1028 176,1033 180,1038 185,1040 205,1040 228,1036 247,1030 250,1035 256,1059 262,1060 270,1057 285,1055 347,1040 356,1036 363,1036 507,999 521,997 549,989 708,951 747,940 860,913 867,910 909,901 996,878 1133,845 1135,843 1133,835 1135,833 1147,830 1145,821 1064,581Z M247,1024 240,1028 205,1035 187,1035 181,1032 182,1030 198,1031 220,1028 244,1021Z M243,1007 245,1015 240,1018 215,1024 199,1026 188,1025 203,1017 226,1009 239,1006Z M241,999 238,1002 226,1004 207,1010 186,1020 181,1024 179,1023 183,1017 204,1006 238,997Z M238,989 237,992 229,993 202,1001 181,1002 173,999 174,996 198,997 216,994 235,988Z M236,981 234,984 211,990 187,993 180,991 197,982 230,972 234,974Z M232,966 229,968 204,974 183,983 173,990 170,989 178,981 196,972 215,969 230,964Z M229,956 228,958 210,962 195,968 175,969 166,967 164,965 165,963 177,965 203,962 227,955Z M228,948 226,951 198,958 170,958 194,946 224,938Z M200,939 181,946 168,953 164,957 162,956 168,948 179,942 195,938Z M223,932 222,934 218,933 222,931Z M200,929 180,936 167,936 158,934 156,932 157,930 173,932 185,931 196,928Z M216,924 219,922 221,923 219,925Z M188,907 169,914 155,924 154,923 157,917 171,908 183,906Z M217,907 219,917 216,919 186,926 167,927 162,925 170,919 196,909 211,905 215,905Z M148,899 149,897 154,899 172,899 180,897 184,898 172,903 156,903Z M172,876 157,883 149,889 146,889 147,886 155,879 164,875Z M209,874 211,885 208,887 173,894 152,893 158,888 180,878 207,871Z M140,866 142,865 149,867 170,867 161,871 153,871 143,869Z M162,844 152,848 139,858 137,857 142,850 151,844Z M203,852 202,854 192,857 171,861 150,862 144,860 157,851 178,843 198,838 200,840Z M132,834 135,833 143,835 159,835 151,839 135,837Z M191,832 178,836 173,835 186,831Z M152,812 141,817 131,825 130,824 131,820 138,814 148,811Z M195,820 194,822 165,829 144,830 135,828 139,824 156,815 187,806 190,806 192,808Z M124,801 125,800 134,803 149,803 142,807 128,805Z M189,798 171,804 161,806 158,805 161,803 184,797Z M140,781 128,788 123,793 121,792 123,788 133,780Z M187,789 174,794 151,798 134,798 127,796 135,789 147,783 181,773 183,774Z M116,770 118,769 123,771 137,772 133,775 122,774Z M181,766 177,769 149,775 146,774 179,764Z M131,749 115,760 114,759 115,756 123,749Z M179,757 176,760 148,766 124,766 119,764 125,758 138,751 172,741 175,742Z M108,738 110,737 114,739 128,741 122,744 111,741Z M173,734 171,737 162,738 151,742 137,742 147,738 156,737 171,732Z M121,718 107,729 106,726 114,718Z M171,726 169,728 137,735 119,735 111,732 120,724 138,716 160,712 163,710 167,711Z M100,707 102,706 118,710 115,712 111,712 104,710Z M165,703 163,705 143,709 137,712 125,712 133,708 156,704 163,701Z M112,687 99,697 98,696 99,693 106,686Z M160,682 162,690 161,696 148,698 130,704 113,704 102,701 113,692 125,686 140,684 157,679Z M141,676 126,681 116,681 123,677 130,677 136,675Z M93,676 95,675 99,677 108,677 109,679 103,681Z M157,671 156,673 152,674 147,673 155,670Z M103,656 91,666 90,665 91,662 98,655Z M155,663 131,669 122,673 104,673 95,670 101,663 116,655 135,653 150,648Z M124,647 115,651 106,650 112,647Z M85,645 87,644 100,648 94,650Z M94,626 83,635 82,634 83,631 89,625Z M144,619 146,629 145,633 128,636 107,643 94,642 86,638 94,631 105,625 121,624 142,618Z M112,617 103,621 97,620 102,617Z M79,615 81,614 92,617 89,619 85,619Z M75,602 76,601 77,603 76,604Z M84,594 85,595 77,602 77,598 81,594Z M139,600 119,605 102,612 85,611 79,608 86,600 95,595 117,593 134,588 136,589Z M102,587 95,590 88,589 97,586Z M70,584 72,583 83,587 79,589Z M76,564 77,565 68,573 68,569 73,564Z M131,569 128,571 111,574 92,582 79,581 71,577 75,572 86,565 105,564 127,558 129,560 129,566Z M91,557 86,560 80,559 88,556Z M65,555 73,555 74,557 69,558Z M125,554 111,558 107,557 120,553Z M124,545 108,550 103,549 120,544Z M68,535 61,542 61,538 65,534Z M123,537 122,540 104,543 92,547 83,552 68,550 64,547 69,540 77,535 99,534 116,530 119,528 121,530Z M71,529 74,527 80,528 77,530Z M57,525 65,525 66,527 62,528Z M119,523 110,527 94,530 90,529 115,522Z M117,514 116,516 102,520 90,520 101,516 115,513Z M60,505 53,512 52,510 57,504Z M115,507 111,510 91,514 74,522 64,521 56,517 60,511 69,505 87,505 112,499Z M63,499 66,497 72,498 67,501Z M49,495 52,494 58,497 54,498Z M112,493 111,495 83,501 80,500 101,493Z M110,485 108,487 79,493 77,492 79,490 96,485 107,483Z M51,474 52,475 46,482 46,478Z M107,475 106,479 89,482 72,488 66,492 55,491 48,487 59,476 85,475 103,470 106,471Z M54,470 56,468 62,469 59,471Z M43,466 46,465 50,467 48,469Z M104,463 102,466 92,469 80,471 72,470 78,467 92,465 102,461Z M102,455 101,457 88,459 80,462 68,462 77,458 100,453Z M99,444 98,449 77,453 56,463 46,461 40,457 46,450 56,443 77,435 95,431Z M98,424 95,427 77,430 60,436 49,442 39,451 38,450 39,447 45,441 60,432 81,425 92,423Z`;

const VERTICAL_TASSEL_PATH = `M335,965 332,967 333,974 337,968Z M244,129 239,133 235,141 236,150 241,160 241,163 236,171 234,192 232,195 232,229 229,236 229,245 227,250 228,258 226,267 227,291 217,309 217,316 222,326 217,336 217,355 215,359 210,384 210,394 207,402 207,413 201,432 202,436 197,453 195,474 191,488 190,510 192,515 192,589 191,600 188,605 188,608 191,611 195,612 195,621 199,620 200,613 202,611 207,611 209,614 210,621 212,621 215,624 218,624 225,620 231,620 230,615 235,610 245,622 250,623 252,618 254,618 252,628 254,630 257,627 262,626 263,611 265,612 267,618 272,614 277,614 281,619 284,619 285,611 289,605 288,596 295,590 304,590 305,588 300,577 291,541 280,514 280,509 277,505 277,492 275,489 276,480 274,479 271,450 269,447 269,437 265,419 266,406 262,391 262,385 259,380 259,374 256,366 256,353 260,347 260,337 256,336 254,333 254,328 257,322 255,315 255,307 251,299 245,295 244,249 246,242 245,215 247,213 245,172 246,168 253,164 253,156 256,154 256,152 245,153 243,149 247,145 251,147 257,147 257,141 251,135 249,137 251,143 248,145 243,139 244,134 248,130Z M237,241 238,254 235,288 234,271Z M238,232 238,241 236,239Z`;

const VERTICAL_ELASTIC_PATH = `M854,29 841,31 838,36 838,128 843,372 843,463 845,527 853,1133 854,1136 857,1138 884,1139 887,1136 882,1133 881,1127 881,1004 878,883 878,794 875,668 868,103 866,48 867,37 870,35 875,35 877,31 869,29Z`;

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas, message) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.size && blob.type === 'image/png') resolve(blob);
      else reject(new Error(message));
    }, 'image/png');
  });
}

async function loadBitmap(src) {
  const response = await fetch(src, { credentials:'same-origin', cache:'no-store' });
  if (!response.ok) throw new Error(`Não foi possível carregar a imagem original do produto (HTTP ${response.status}).`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function accessoryFlags(options = {}) {
  let tasselCode = String(options.tasselCode || options.tassel_code || '').trim().toUpperCase();
  let elasticCode = String(options.elasticCode || options.elasticoCode || options.elastico_code || '').trim().toUpperCase();
  try {
    const parsed = parseSku(options.sku);
    tasselCode = parsed.tasselCode;
    elasticCode = parsed.elasticoCode;
  } catch {}
  return {
    tassel:Boolean(tasselCode && tasselCode !== 'X'),
    elastic:Boolean(elasticCode && elasticCode !== 'X')
  };
}

function resolveMpkProfile(geometry) {
  const kind = String(geometry?.kind || '');
  const aspect = Number(geometry?.metrics?.aspect || 0);
  if (kind === 'horizontal' || (kind === 'disc' && aspect > 1.04)) return 'horizontal_v1';
  return 'vertical_v1';
}

function classifyBitmap(bitmap, options = {}) {
  const scale = Math.min(1, CLASSIFIER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return __muralTransparentImageInternals.classifyProductGeometry(
    image.data,
    width,
    height,
    { sku:options.sku, name:options.name }
  );
}

function fillReferencePath(ctx, pathData, width, height) {
  ctx.save();
  ctx.scale(width / REFERENCE_SIZE, height / REFERENCE_SIZE);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(pathData), 'evenodd');
  ctx.restore();
}

function buildAlphaMask(width, height, profile, flags) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  fillReferencePath(
    ctx,
    profile === 'horizontal_v1' ? HORIZONTAL_BASE_PATH : VERTICAL_BASE_PATH,
    width,
    height
  );
  if (profile === 'vertical_v1' && flags.tassel) {
    fillReferencePath(ctx, VERTICAL_TASSEL_PATH, width, height);
  }
  if (profile === 'vertical_v1' && flags.elastic) {
    fillReferencePath(ctx, VERTICAL_ELASTIC_PATH, width, height);
  }
  return canvas;
}

async function buildOpaqueMaskBlob(width, height, profile, flags) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  fillReferencePath(
    ctx,
    profile === 'horizontal_v1' ? HORIZONTAL_BASE_PATH : VERTICAL_BASE_PATH,
    width,
    height
  );
  if (profile === 'vertical_v1' && flags.tassel) {
    fillReferencePath(ctx, VERTICAL_TASSEL_PATH, width, height);
  }
  if (profile === 'vertical_v1' && flags.elastic) {
    fillReferencePath(ctx, VERTICAL_ELASTIC_PATH, width, height);
  }
  return canvasBlob(canvas, 'Falha ao gerar a máscara oficial do MPK.');
}

function buildCutout(bitmap, maskCanvas) {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function buildOutlinedCutout(cutoutCanvas, maskCanvas) {
  const width = cutoutCanvas.width;
  const height = cutoutCanvas.height;
  const radius = Math.max(6, Math.min(11, Math.round(
    OUTLINE_RADIUS_AT_1200 * Math.max(width, height) / REFERENCE_SIZE
  )));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // The outline is generated only from the official physical mask. Drawing the
  // mask at circular offsets creates a crisp external ring without changing the
  // product pixels themselves.
  for (let step = 0; step < 32; step += 1) {
    const angle = step * Math.PI * 2 / 32;
    const dx = Math.round(Math.cos(angle) * radius);
    const dy = Math.round(Math.sin(angle) * radius);
    ctx.drawImage(maskCanvas, dx, dy);
  }
  ctx.drawImage(cutoutCanvas, 0, 0);
  return canvas;
}

async function buildMpkArtifacts(src, options = {}, maskOnly = false) {
  const normalized = String(src || '').trim();
  if (!normalized) return null;
  if (typeof document === 'undefined' || typeof Path2D === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('O navegador não suporta o tratamento por máscara MPK.');
  }

  const bitmap = await loadBitmap(normalized);
  try {
    const ratio = bitmap.width / Math.max(1, bitmap.height);
    if (ratio < .96 || ratio > 1.04) {
      throw new Error('A imagem não corresponde ao canvas quadrado dos MPKs oficiais.');
    }

    const geometry = classifyBitmap(bitmap, options);
    const profile = resolveMpkProfile(geometry);
    const flags = accessoryFlags(options);
    const maskCanvas = buildAlphaMask(bitmap.width, bitmap.height, profile, flags);
    const maskBlob = await buildOpaqueMaskBlob(bitmap.width, bitmap.height, profile, flags);
    if (maskOnly) return { maskBlob, profile, geometry, flags };

    const cutout = buildCutout(bitmap, maskCanvas);
    const outlined = buildOutlinedCutout(cutout, maskCanvas);
    const imageBlob = await canvasBlob(outlined, 'Falha ao gerar o PNG tratado pelo MPK.');
    return { imageBlob, maskBlob, profile, geometry, flags };
  } finally {
    bitmap.close?.();
  }
}

export async function mpkProductImageTreatmentArtifactsBlob(src, options = {}) {
  const result = await buildMpkArtifacts(src, options, false);
  return result?.imageBlob && result?.maskBlob
    ? { imageBlob:result.imageBlob, maskBlob:result.maskBlob }
    : null;
}

export async function mpkProductImageMaskBlob(src, options = {}) {
  const result = await buildMpkArtifacts(src, options, true);
  return result?.maskBlob || null;
}

export const __muralMpkMaskInternals = {
  REFERENCE_SIZE,
  accessoryFlags,
  resolveMpkProfile
};
