# mycards 名片夾

個人用的名片夾 PWA（加到 iPhone 主畫面使用）。

- 📷 拍照 / 相簿 / 批次匯入名片
- 🔍 **手機端文字辨識**：PaddleOCR PP-OCRv5（WebAssembly），照片不上傳、可離線
- 🧩 規則式分欄位（姓名、職稱、公司、電話、Email、地址、統編…），存檔前可修正
- ✨ 選用：OpenCode（OpenAI 相容 API）AI 整理，只傳文字
- 💾 資料只存在手機的 IndexedDB；備份成 .zip 可存到 iCloud 雲碟 / Google 雲端硬碟 / 我的 iPhone
- 📤 匯出 CSV、vCard（存到 iPhone 聯絡人）

## 使用

網址：https://3587sen-web.github.io/mycards/
用 iPhone Safari 打開 →「分享」→「加入主畫面」。

## 開發

```bash
npm install
npm test        # 欄位解析器測試
npm run build   # 輸出到 docs/（GitHub Pages 從 main 分支 /docs 發佈）
```

| 檔案 | 用途 |
|---|---|
| `src/app.js` | 畫面與流程 |
| `src/parser.js` | 規則式分欄位 |
| `src/ocr.js` | PaddleOCR 載入與辨識 |
| `src/db.js` | IndexedDB |
| `src/backup.js` | 備份 / 還原 / CSV / vCard |
| `src/ai.js` | OpenCode AI 整理（選用） |
| `src/sw.js` | 離線快取 |

模型來源：PP-OCRv5 mobile（PaddlePaddle，Apache-2.0），由 npm 套件 `pdfmarkdown-ppocrv5-models`、`@rustors/model-ppocrv5-mobile` 取得，建置時包成 SDK 所需的 tar。

## AI 整理（選用）：Cloudflare Worker

`worker/worker.js` 是 AI 整理用的 Cloudflare Worker（Workers AI，模型 `@cf/google/gemma-4-26b-a4b-it`）。

1. Cloudflare 後台建立 Worker（Hello World 範本），貼上 `worker/worker.js` 後部署
2. Bindings 加入 **Workers AI**，變數名稱 `AI`
3. Variables and Secrets 加入 Secret：`APP_KEY` = 自訂通行碼
4. 名片夾「設定 → AI 整理」填入 Worker 網址和通行碼

Worker 只接受 `https://3587sen-web.github.io` 發出的請求，不儲存任何內容。
