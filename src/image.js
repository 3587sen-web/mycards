// 照片處理：縮小、壓縮、旋轉、裁切到名片範圍、產生縮圖
// 流程：原圖 → 1600px「辨識用」工作圖 → 辨識完依文字範圍裁掉背景 → 存檔用 1200px、畫質 0.8

export const SAVE_MAX = 1200; // 存檔用的最長邊
export const SAVE_QUALITY = 0.8;
const WORK_MAX = 1600; // 辨識用的最長邊（大一點，小字比較準）
const THUMB_MAX = 360;

export async function loadBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // 舊版 Safari 不支援選項時的備案
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function drawScaled(src, maxSide, rotate = 0, rect = null) {
  const r = rect || { x: 0, y: 0, w: src.width, h: src.height };
  const scale = Math.min(1, maxSide / Math.max(r.w, r.h));
  const w = Math.max(1, Math.round(r.w * scale)), h = Math.max(1, Math.round(r.h * scale));
  const swap = rotate % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, r.x, r.y, r.w, r.h, -w / 2, -h / 2, w, h);
  return c;
}

const toBlob = (canvas, quality) => new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));

/** 相機/相簿的照片 → 辨識用工作圖（src 保留原檔，裁切時用原檔取得最好的畫質） */
export async function prepareImage(fileOrBlob, rotate = 0) {
  const bmp = await loadBitmap(fileOrBlob);
  const full = drawScaled(bmp, WORK_MAX, rotate);
  const thumb = drawScaled(bmp, THUMB_MAX, rotate);
  const srcW = rotate % 180 ? bmp.height : bmp.width;
  if (bmp.close) bmp.close();
  return {
    src: rotate ? null : fileOrBlob,
    full: await toBlob(full, 0.85),
    thumb: await toBlob(thumb, 0.75),
    width: full.width,
    height: full.height,
    srcScale: rotate ? 1 : srcW / full.width,
  };
}

/**
 * 依 OCR 文字的位置算出名片範圍（工作圖座標）。不適合裁切時回傳 null。
 * 往外留邊：文字範圍的 12%，且至少畫面的 3%，避免切到沒有文字的 Logo 或名片邊緣。
 */
export function cardCropRect(lines, W, H) {
  const ls = lines.filter((l) => (l.score ?? 1) >= 0.5 && l.box.w > 0 && l.box.h > 0);
  if (ls.length < 3) return null;
  const x0 = Math.min(...ls.map((l) => l.box.x)), y0 = Math.min(...ls.map((l) => l.box.y));
  const x1 = Math.max(...ls.map((l) => l.box.x + l.box.w)), y1 = Math.max(...ls.map((l) => l.box.y + l.box.h));
  const padX = Math.max((x1 - x0) * 0.12, W * 0.03), padY = Math.max((y1 - y0) * 0.12, H * 0.03);
  const r = { x: Math.max(0, x0 - padX), y: Math.max(0, y0 - padY) };
  r.w = Math.min(W, x1 + padX) - r.x;
  r.h = Math.min(H, y1 + padY) - r.y;
  if (r.w * r.h > W * H * 0.85) return null; // 名片本來就佔滿畫面，不用裁
  return r;
}

/** 裁切到名片範圍並壓縮成存檔用大小 */
export async function cropToCard(img, rect) {
  const s = img.src && img.srcScale ? img.srcScale : 1;
  const bmp = await loadBitmap(img.src && img.srcScale ? img.src : img.full);
  const R = { x: rect.x * s, y: rect.y * s, w: rect.w * s, h: rect.h * s };
  const full = drawScaled(bmp, SAVE_MAX, 0, R);
  const thumb = drawScaled(bmp, THUMB_MAX, 0, R);
  if (bmp.close) bmp.close();
  return { full: await toBlob(full, SAVE_QUALITY), thumb: await toBlob(thumb, 0.75) };
}

/** 存檔用的最終照片：有裁切就用裁切版，否則把工作圖壓成存檔大小 */
export async function finalImage(img) {
  if (img.cropped && img.cropOn !== false) return img.cropped;
  return { full: await compressBlob(img.full), thumb: img.thumb };
}

/** 壓縮一張照片到存檔大小；壓完沒有變小就回傳原檔 */
export async function compressBlob(blob) {
  const bmp = await loadBitmap(blob);
  const c = drawScaled(bmp, SAVE_MAX);
  if (bmp.close) bmp.close();
  const out = await toBlob(c, SAVE_QUALITY);
  return out && out.size < blob.size ? out : blob;
}
