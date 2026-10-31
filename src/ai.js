// 選用：AI 整理（透過你自己的 Cloudflare Worker 呼叫 Workers AI）
// 只傳「辨識出的文字」，不傳照片。手機上只存 Worker 網址和你自訂的通行碼，沒有任何 AI 金鑰。
import * as db from "./db.js";

export async function getAiSettings() {
  const s = await db.getMeta("aiWorker", {});
  return { workerUrl: s.workerUrl || "", appKey: s.appKey || "" };
}
export async function saveAiSettings(s) {
  await db.setMeta("aiWorker", { workerUrl: s.workerUrl.trim().replace(/\/+$/, ""), appKey: s.appKey.trim() });
}
export async function aiReady() {
  const s = await getAiSettings();
  return !!(s.workerUrl && s.appKey);
}

async function post(s, path, body) {
  let status = 0;
  try {
    const r = await fetch(s.workerUrl.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Key": s.appKey },
      body: JSON.stringify(body || {}),
    });
    status = r.status;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error("連不到 Worker：請檢查網址是否正確（https://….workers.dev）、Worker 是否已部署，以及網路是否正常。");
    }
    if (status === 403) throw new Error("Worker 拒絕了這個網址（請確認 Worker 程式碼是最新版）。");
    throw e;
  }
}

export async function testAi(s) {
  const j = await post(s, "/ping");
  return `${j.model.replace("@cf/", "")} 回覆「${(j.reply || "").trim()}」`;
}

/** @param {string[]} lines OCR 文字 */
export async function aiParse(lines) {
  const s = await getAiSettings();
  if (!s.workerUrl || !s.appKey) throw new Error("尚未設定 AI 整理（設定頁 → AI 整理）");
  const j = await post(s, "/parse", { lines });
  const text = (j.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 回傳的內容不是 JSON：" + text.slice(0, 120));
  const o = JSON.parse(m[0]);
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  return {
    card: {
      name: str(o.name), nameEn: str(o.nameEn), title: str(o.title), department: str(o.department),
      company: str(o.company), companyEn: str(o.companyEn), taxId: str(o.taxId),
      phones: Array.isArray(o.phones) ? o.phones.filter((p) => p && p.value).map((p) => ({
        type: ["mobile", "work", "fax", "other"].includes(p.type) ? p.type : "other", value: str(p.value),
      })) : [],
      emails: Array.isArray(o.emails) ? o.emails.map(str).filter(Boolean) : [],
      website: str(o.website), address: str(o.address),
    },
    others: Array.isArray(o.others) ? o.others.map(str).filter(Boolean) : [],
  };
}
