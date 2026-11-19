/**
 * client/src/utils/imageTileSlicer.ts
 * 모바일 카카오톡 범위 캡처(세로로 긴 스크롤 이미지 포함)를 고화질 타일로 분할하는 유틸리티
 *
 * 왜 프론트엔드에서 분할하는가:
 * 카톡 범위 캡처로 대화 10~30개를 찍으면 세로 길이가 4,000px~15,000px 이상 길어짐.
 * 이를 통째로 AI API에 전송하면 모델 내부에서 이미지를 축소해 전화번호 숫자나 태국어 성조가 뭉개질 수 있음.
 * 따라서 가로 해상도는 선명하게 유지하면서 말풍선 사이 빈 배경 줄(단색 구간)을 찾아 깔끔하게 잘라 전송함.
 */

export interface ImageTilePayload {
  mimeType: string;
  data: string; // data URL 접두사가 제거된 순수 base64
}

const MAX_TARGET_WIDTH = 1280;
const SINGLE_TILE_MAX_HEIGHT = 2100;
const TARGET_SLICE_HEIGHT = 1900;
const MIN_REMAINDER_HEIGHT = 320;
const FALLBACK_OVERLAP_PX = 120;

/**
 * File 객체를 HTMLImageElement로 로드
 */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`이미지 파일을 읽을 수 없습니다: ${file.name}`));
    };
    img.src = objectUrl;
  });
}

/**
 * 캔버스의 특정 y 구간([minY, maxY])을 아래에서 위로 탐색하여
 * 말풍선이나 글자가 없는 '단색 배경 가로줄'의 y 좌표를 찾음.
 * 찾지 못하면 null을 반환하여 겹침(overlap) 절단으로 폴백함.
 */
function findCleanHorizontalGapY(
  ctx: CanvasRenderingContext2D,
  width: number,
  minY: number,
  maxY: number
): number | null {
  const safeMinY = Math.max(0, Math.floor(minY));
  const safeMaxY = Math.floor(maxY);
  if (safeMaxY <= safeMinY) return null;

  const bandHeight = safeMaxY - safeMinY + 1;
  // 좌우 프로필 아이콘이나 스크롤바 영역을 피하기 위해 가로 14% ~ 86% 중앙 본문 영역만 검사
  const startX = Math.floor(width * 0.14);
  const checkWidth = Math.max(40, Math.floor(width * 0.72));

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(startX, safeMinY, checkWidth, bandHeight);
  } catch {
    return null;
  }

  const { data } = imageData;
  const sampleStepX = 4;

  // 연속 3줄 이상 단색이면 확실한 말풍선 사이 여백으로 판단
  let consecutiveUniformRows = 0;

  for (let rowOffset = bandHeight - 1; rowOffset >= 0; rowOffset--) {
    const rowBase = rowOffset * checkWidth * 4;
    const baseR = data[rowBase];
    const baseG = data[rowBase + 1];
    const baseB = data[rowBase + 2];

    let isUniform = true;
    for (let x = sampleStepX; x < checkWidth; x += sampleStepX) {
      const idx = rowBase + x * 4;
      const diff =
        Math.abs(data[idx] - baseR) +
        Math.abs(data[idx + 1] - baseG) +
        Math.abs(data[idx + 2] - baseB);
      if (diff > 18) {
        isUniform = false;
        break;
      }
    }

    if (isUniform) {
      consecutiveUniformRows++;
      if (consecutiveUniformRows >= 4) {
        return safeMinY + rowOffset + 2;
      }
    } else {
      consecutiveUniformRows = 0;
    }
  }

  return null;
}

/**
 * 캡처 이미지 1장을 위 -> 아래 순서의 고화질 JPEG Base64 타일 배열로 변환
 */
export async function sliceKakaoImageIntoTiles(file: File): Promise<ImageTilePayload[]> {
  const img = await loadImageFromFile(file);

  const scale = img.naturalWidth > MAX_TARGET_WIDTH ? MAX_TARGET_WIDTH / img.naturalWidth : 1;
  const targetWidth = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(img.naturalHeight * scale));

  // 1. 일반 길이 캡처본(2,100px 이하)은 분할 없이 1장으로 변환
  if (targetHeight <= SINGLE_TILE_MAX_HEIGHT) {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('브라우저 캔버스 초기화에 실패했습니다.');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return [
      {
        mimeType: 'image/jpeg',
        data: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      },
    ];
  }

  // 2. 세로로 긴 스크롤/범위 캡처본은 전체 캔버스에서 말풍선 여백을 찾아 위->아래 순차 분할
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = targetWidth;
  fullCanvas.height = targetHeight;
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) throw new Error('브라우저 캔버스 초기화에 실패했습니다.');

  fullCtx.fillStyle = '#FFFFFF';
  fullCtx.fillRect(0, 0, targetWidth, targetHeight);
  fullCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const tiles: ImageTilePayload[] = [];
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = targetWidth;
  const tileCtx = tileCanvas.getContext('2d');
  if (!tileCtx) throw new Error('타일 캔버스 초기화에 실패했습니다.');

  let currentY = 0;

  while (currentY < targetHeight) {
    const remaining = targetHeight - currentY;

    // 남은 길이가 한 타일 + 자투리 이하라면 끝까지 한 번에 묶어 마무리
    if (remaining <= TARGET_SLICE_HEIGHT + MIN_REMAINDER_HEIGHT) {
      const sliceH = remaining;
      tileCanvas.height = sliceH;
      tileCtx.fillStyle = '#FFFFFF';
      tileCtx.fillRect(0, 0, targetWidth, sliceH);
      tileCtx.drawImage(
        fullCanvas,
        0,
        currentY,
        targetWidth,
        sliceH,
        0,
        0,
        targetWidth,
        sliceH
      );

      const dataUrl = tileCanvas.toDataURL('image/jpeg', 0.88);
      tiles.push({
        mimeType: 'image/jpeg',
        data: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      });
      break;
    }

    // 말풍선 사이 깨끗한 단색 배경 줄 탐색 (1,350px ~ 2,050px 구간)
    const idealMaxY = Math.min(targetHeight - MIN_REMAINDER_HEIGHT, currentY + 2050);
    const idealMinY = currentY + 1350;
    const cleanGapY = findCleanHorizontalGapY(fullCtx, targetWidth, idealMinY, idealMaxY);

    const cutY = cleanGapY ?? currentY + TARGET_SLICE_HEIGHT;
    const sliceH = cutY - currentY;

    tileCanvas.height = sliceH;
    tileCtx.fillStyle = '#FFFFFF';
    tileCtx.fillRect(0, 0, targetWidth, sliceH);
    tileCtx.drawImage(
      fullCanvas,
      0,
      currentY,
      targetWidth,
      sliceH,
      0,
      0,
      targetWidth,
      sliceH
    );

    const dataUrl = tileCanvas.toDataURL('image/jpeg', 0.88);
    tiles.push({
      mimeType: 'image/jpeg',
      data: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
    });

    // 단색 여백에서 깔끔히 잘랐다면 겹침 없이 바로 이어가고, 아니면 글자 잘림 방지용 120px 겹침 적용
    currentY = cleanGapY ? cutY : Math.max(currentY + 500, cutY - FALLBACK_OVERLAP_PX);
  }

  // 메모리 즉시 해제 유도
  fullCanvas.width = 0;
  fullCanvas.height = 0;

  return tiles;
}
