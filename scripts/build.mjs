// 建置腳本：把 src/ 打包到 docs/（GitHub Pages 從 main 分支的 /docs 發佈）
// 用法：npm run build
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "docs");
const nm = (p) => path.join(root, "node_modules", p);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// 1) 打包 JS（OCR 相關程式碼會被拆成獨立的 chunk，第一次辨識時才下載）
await build({
  entryPoints: [path.join(root, "src/app.js")],
  outdir: path.join(out, "assets"),
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  target: ["safari16"],
  alias: { "onnxruntime-web": "onnxruntime-web/wasm" },
  logLevel: "warning",
  // opencv.js 會引用 node 模組，瀏覽器用不到
  external: ["fs", "path", "crypto"],
});

// 2) 靜態檔
await cp(path.join(root, "public"), out, { recursive: true });
await cp(path.join(root, "src/styles.css"), path.join(out, "assets/styles.css"));

// 3) ONNX Runtime 的 wasm（自己放，離線也能用）
await mkdir(path.join(out, "ort"), { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await cp(nm(`onnxruntime-web/dist/${f}`), path.join(out, "ort", f));
}

// 4) 辨識模型：PP-OCRv5 mobile（偵測＋辨識），包成 SDK 需要的 .tar（inference.onnx + inference.yml）
await mkdir(path.join(out, "models"), { recursive: true });
const detBytes = await readFile(nm("pdfmarkdown-ppocrv5-models/detection/PP-OCRv5_mobile_det_infer.ort"));
const recBytes = await readFile(nm("pdfmarkdown-ppocrv5-models/recognition/PP-OCRv5_mobile_rec_infer.onnx"));
const dictLines = (await readFile(nm("@rustors/model-ppocrv5-mobile/models/dict.txt"), "utf8")).split("\n");
if (dictLines.at(-1) === "") dictLines.pop();
if (dictLines.length !== 18383) throw new Error(`字典行數不符：${dictLines.length}`);

const detYml = `Global:
  model_name: PP-OCRv5_mobile_det
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - DetResizeForTest:
      resize_long: 960
  - NormalizeImage:
      mean: [0.485, 0.456, 0.406]
      std: [0.229, 0.224, 0.225]
      scale: 1./255.
      order: hwc
  - ToCHWImage: null
  - KeepKeys:
      keep_keys: [image, shape]
PostProcess:
  name: DBPostProcess
  thresh: 0.3
  box_thresh: 0.6
  max_candidates: 1000
  unclip_ratio: 1.5
`;
const recYml = `Global:
  model_name: PP-OCRv5_mobile_rec
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - MultiLabelEncode:
      gtc_encode: NRTRLabelEncode
  - RecResizeImg:
      image_shape: [3, 48, 320]
  - KeepKeys:
      keep_keys: [image, label_ctc, label_gtc, length, valid_ratio]
PostProcess:
  name: CTCLabelDecode
  character_dict:
${dictLines.map((c) => "  - " + JSON.stringify(c)).join("\n")}
`;
await writeFile(path.join(out, "models/PP-OCRv5_mobile_det.tar"), makeTar([
  ["inference.onnx", detBytes], ["inference.yml", Buffer.from(detYml)],
]));
await writeFile(path.join(out, "models/PP-OCRv5_mobile_rec.tar"), makeTar([
  ["inference.onnx", recBytes], ["inference.yml", Buffer.from(recYml)],
]));

// 5) Service worker：依所有輸出檔內容算出版本號，內容變了才會更新快取
const files = await listFiles(out);
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(await readFile(path.join(out, f)));
const version = hash.digest("hex").slice(0, 10);
// 預先快取「小檔案」（App 外殼）；大檔（模型、wasm、opencv）第一次用到時才下載並快取
const shell = [];
for (const f of files) {
  if (f.startsWith("models/") || f.startsWith("ort/") || f === "sw.js" || f.endsWith(".map")) continue;
  if ((await stat(path.join(out, f))).size < 1_500_000) shell.push(f);
}
let sw = await readFile(path.join(root, "src/sw.js"), "utf8");
const big = files.filter((f) => !shell.includes(f) && f !== "sw.js" && !f.endsWith(".map") && f !== ".nojekyll");
sw = sw.replace("__VERSION__", version)
  .replace("__SHELL__", JSON.stringify(["./", ...shell.filter((f) => f !== "index.html" && f !== ".nojekyll")]))
  .replace("__BIG__", JSON.stringify(big));
await writeFile(path.join(out, "sw.js"), sw);
const html = (await readFile(path.join(out, "index.html"), "utf8")).replace("__VERSION__", version);
await writeFile(path.join(out, "index.html"), html);
// GitHub Pages：不要用 Jekyll 處理
await writeFile(path.join(out, ".nojekyll"), "");

let total = 0;
for (const f of files) total += (await stat(path.join(out, f))).size;
console.log(`建置完成 v${version}，${files.length} 個檔案，共 ${(total / 1e6).toFixed(1)} MB`);

// ---- helpers ----
async function listFiles(dir, base = dir) {
  const res = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...(await listFiles(p, base)));
    else res.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return res.sort();
}

// 最小的 ustar tar 產生器（不壓縮）
function makeTar(entries) {
  const blocks = [];
  for (const [name, data] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write(Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(8).padStart(11, "0") + "\0", 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
