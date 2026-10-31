// 照片處理：縮小、壓縮、旋轉、產生縮圖
// iPhone 原始照片動輒 3~5 MB；名片存 1600px 寬就很清楚，大約 200~400 KB

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

function drawScaled(src, maxSide, rotate = 0) {
  const sw = src.width, sh = src.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const swap = rotate % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

const toBlob = (canvas, quality) => new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));

/** 把相機/相簿的照片轉成：存檔用大圖 + 列表用縮圖 */
export async function prepareImage(fileOrBlob, rotate = 0) {
  const bmp = await loadBitmap(fileOrBlob);
  const full = drawScaled(bmp, 1600, rotate);
  const thumb = drawScaled(bmp, 360, rotate);
  if (bmp.close) bmp.close();
  return {
    full: await toBlob(full, 0.85),
    thumb: await toBlob(thumb, 0.75),
    width: full.width,
    height: full.height,
  };
}

/** 旋轉一張已處理過的圖 */
export async function rotateBlob(blob, deg = 90) {
  return prepareImage(blob, deg);
}
