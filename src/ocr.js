// 手機端文字辨識（PaddleOCR PP-OCRv5 mobile，在瀏覽器裡用 WebAssembly 執行，不上網）
// 第一次使用時下載模型與執行環境（約 40 MB），之後由 service worker 快取，可離線使用。
import { PaddleOCR } from "@paddleocr/paddleocr-js";

let enginePromise = null;

export function getEngine(onStatus = () => {}) {
  if (!enginePromise) {
    const base = new URL("./", document.baseURI);
    onStatus("載入辨識引擎中（第一次約需下載 46 MB，建議用 Wi-Fi）…");
    enginePromise = PaddleOCR.create({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: { url: new URL("models/PP-OCRv5_mobile_det.tar", base).href },
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textRecognitionModelAsset: { url: new URL("models/PP-OCRv5_mobile_rec.tar", base).href },
      textRecognitionBatchSize: 6,
      ortOptions: {
        backend: "wasm",
        wasmPaths: new URL("ort/", base).href,
        numThreads: 1, // GitHub Pages 沒有跨來源隔離標頭，不能用多執行緒
        simd: true,
      },
    }).catch((e) => {
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

/** @returns {Promise<{text:string, score:number, poly:number[][]}[]>} */
export async function recognize(blob, onStatus = () => {}) {
  const ocr = await getEngine(onStatus);
  onStatus("辨識文字中…");
  const [result] = await ocr.predict(blob, { textDetLimitSideLen: 1280, textDetLimitType: "max" });
  return result.items || [];
}
