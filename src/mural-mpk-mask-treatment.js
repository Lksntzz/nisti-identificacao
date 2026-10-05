import { __muralTransparentImageInternals } from './mural-transparent-image.js';
import { parseSku } from './sku.js';

const REFERENCE_SIZE = 1200;
const CLASSIFIER_MAX_SIDE = 180;
const OUTLINE_RADIUS_AT_1200 = 8;

// These paths are generated directly from the two Photoshop MPKs supplied by
// NISTI. They are geometry masks, not hand-drawn approximations.
// Vertical base source: exact union of "TROCA A CAPA" with only the physical
// wire-o region from "Camada 4 copiar". Stored as row-runs so the browser
// reproduces the raster Photoshop silhouette instead of approximating it with
// a polygon.
// Horizontal base source: "MOCKUP HORIZONTAL(1).psd" / layer "Base".
// Optional vertical accessories use the PSD's tassel and elastic silhouettes.
const VERTICAL_BASE_RLE = `32-32:901-906,909-927;33-33:889-928;34-34:878-928;35-35:868-929;36-36:855-929;37-37:843-929;38-38:832-929;39-39:822-929;40-40:811-929;41-41:796-929;42-42:786-929;43-43:776-929;44-44:764-929;45-45:751-929;46-46:740-929;47-47:729-929;48-48:716-929;49-49:705-929;50-50:693-929;51-51:682-929;52-52:668-929;53-53:657-929;54-54:646-929;55-55:636-929;56-56:624-929;57-57:613-929;58-58:602-929;59-59:592-929;60-60:580-929;61-61:566-929;62-62:555-929;63-63:545-929;64-64:532-929;65-65:519-929;66-66:508-929;67-67:498-929;68-68:485-929;69-69:472-929;70-70:461-929;71-71:450-929;72-72:436-929;73-73:425-929;74-74:414-929;75-75:403-929;76-76:391-929;77-77:380-929;78-78:369-929;79-79:343-344,358-930;80-80:330-344,346-930;81-81:319-930;82-82:307-930;83-83:293-930;84-84:288-930;85-123:287-930;124-130:288-930;131-131:284-284,287-930;132-132:262-930;133-133:250-930;134-134:244-930;135-135:241-930;136-136:240-930;137-142:238-930;143-143:239-930;144-144:241-930;145-145:243-930;146-146:241-930;147-147:239-930;148-153:238-930;154-154:239-930;155-155:241-930;156-156:245-930;157-157:251-930;158-158:267-279,288-930;159-175:288-930;176-191:288-931;192-192:275-931;193-193:257-931;194-194:246-931;195-195:242-931;196-196:240-931;197-198:239-931;199-201:238-931;202-202:239-931;203-203:240-931;204-204:241-931;205-205:244-931;206-206:242-931;207-207:240-931;208-209:239-931;210-211:238-931;212-213:239-931;214-214:240-931;215-215:241-931;216-216:244-931;217-217:251-931;218-218:261-286,288-931;219-240:289-931;241-251:289-932;252-252:265-932;253-253:249-932;254-254:244-932;255-255:242-932;256-256:240-932;257-260:239-932;261-262:240-932;263-263:242-932;264-264:245-932;265-265:244-932;266-266:241-932;267-268:240-932;269-271:239-932;272-272:240-932;273-273:241-932;274-274:242-932;275-275:245-932;276-276:255-932;277-301:290-932;302-306:290-933;307-307:290-932;308-311:290-933;312-312:285-933;313-313:262-933;314-314:247-933;315-315:243-933;316-317:241-933;318-321:240-933;322-322:241-933;323-323:242-933;324-324:246-933;325-325:247-933;326-326:243-933;327-328:241-933;329-331:240-933;332-333:241-933;334-334:243-933;335-335:247-933;336-336:265-272,290-933;337-359:290-933;360-371:291-933;372-372:266-933;373-373:247-933;374-374:243-933;375-375:242-933;376-380:241-933;381-381:242-933;382-382:243-933;383-383:246-933;384-384:249-933;385-385:244-933;386-386:242-933;387-390:241-933;391-391:241-934;392-392:242-934;393-393:244-934;394-394:251-934;395-469:291-934;470-471:291-935;472-540:292-935;541-563:292-936;564-627:293-936;628-641:294-936;642-642:293-936;643-698:293-937;699-718:294-937;719-745:294-938;746-785:295-938;786-788:295-939;789-789:270-939;790-790:258-939;791-791:251-939;792-792:249-939;793-794:247-939;795-798:246-939;799-799:247-939;800-800:249-939;801-801:252-939;802-802:251-939;803-803:248-939;804-805:247-939;806-808:246-939;809-810:247-939;811-811:249-939;812-812:252-939;813-846:295-939;847-847:282-939;848-848:266-939;849-849:257-939;850-850:252-939;851-851:249-939;852-852:248-939;853-857:247-939;858-858:248-939;859-859:250-939;860-860:253-939;861-861:251-939;862-862:249-939;863-863:248-939;864-868:247-939;869-869:248-939;870-870:250-939;871-871:253-939;872-872:264-268,274-939;873-876:296-939;877-906:296-940;907-907:273-940;908-908:263-940;909-909:256-940;910-910:252-940;911-911:250-940;912-912:249-940;913-913:248-940;914-916:247-940;917-917:248-940;918-918:249-940;919-919:250-940;920-921:252-940;922-922:250-940;923-923:249-940;924-928:248-940;929-929:249-940;930-930:250-940;931-931:253-940;932-932:261-940;933-944:296-940;945-947:296-941;948-950:296-940;951-964:296-941;965-965:280-941;966-966:268-941;967-967:260-941;968-968:255-941;969-969:252-941;970-970:250-941;971-972:249-941;973-975:248-941;976-977:249-941;978-978:250-941;979-979:253-941;980-980:252-941;981-981:250-941;982-983:249-941;984-986:248-941;987-987:249-941;988-988:250-941;989-989:251-941;990-990:253-941;991-991:258-941;992-992:273-941;993-1022:297-941;1023-1023:297-942;1024-1024:294-942;1025-1025:275-942;1026-1026:267-942;1027-1027:261-942;1028-1028:256-942;1029-1029:253-942;1030-1030:251-942;1031-1032:250-942;1033-1036:249-942;1037-1037:250-942;1038-1038:251-942;1039-1040:253-942;1041-1041:251-942;1042-1042:250-942;1043-1046:249-942;1047-1048:250-942;1049-1049:252-942;1050-1050:254-942;1051-1051:258-942;1052-1052:267-942;1053-1093:297-942;1094-1094:298-942;1095-1097:300-942;1098-1098:301-344,350-942;1099-1099:305-344,365-942;1100-1100:323-344,380-942;1101-1101:338-344,395-942;1102-1102:410-942;1103-1103:425-942;1104-1104:440-942;1105-1105:455-942;1106-1106:470-942;1107-1107:485-942;1108-1108:500-942;1109-1109:515-942;1110-1110:530-942;1111-1111:544-942;1112-1112:559-942;1113-1113:574-942;1114-1114:589-942;1115-1115:604-942;1116-1116:619-942;1117-1117:634-942;1118-1118:649-942;1119-1119:664-942;1120-1120:679-942;1121-1121:694-942;1122-1122:708-942;1123-1123:723-942;1124-1124:738-942;1125-1125:753-942;1126-1126:768-942;1127-1127:783-942;1128-1128:798-942;1129-1129:813-942;1130-1130:827-942;1131-1131:842-942;1132-1132:857-942;1133-1133:872-942;1134-1134:887-942;1135-1135:902-942;1136-1136:917-942;1137-1137:932-942`;

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

function fillVerticalBaseFromRle(ctx, width, height) {
  ctx.save();
  ctx.scale(width / REFERENCE_SIZE, height / REFERENCE_SIZE);
  ctx.fillStyle = '#fff';
  for (const rowRun of VERTICAL_BASE_RLE.split(';')) {
    if (!rowRun) continue;
    const [rows, ranges] = rowRun.split(':');
    const [y0, y1] = rows.split('-').map(Number);
    for (const range of ranges.split(',')) {
      const [x0, x1] = range.split('-').map(Number);
      ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
  }
  ctx.restore();
}

function buildAlphaMask(width, height, profile, flags) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (profile === 'horizontal_v1') {
    fillReferencePath(ctx, HORIZONTAL_BASE_PATH, width, height);
  } else {
    fillVerticalBaseFromRle(ctx, width, height);
  }
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
  if (profile === 'horizontal_v1') {
    fillReferencePath(ctx, HORIZONTAL_BASE_PATH, width, height);
  } else {
    fillVerticalBaseFromRle(ctx, width, height);
  }
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
