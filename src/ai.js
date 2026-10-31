// 選用：用 OpenCode Zen（或任何 OpenAI 相容 API）把 OCR 文字整理成欄位
// 只傳「辨識出的文字」，不傳照片。API 金鑰只存在這支手機的 IndexedDB。
import * as db from "./db.js";

export const DEFAULT_AI = { baseUrl: "https://opencode.ai/zen/v1", model: "", apiKey: "" };

export async function getAiSettings() {
  return { ...DEFAULT_AI, ...(await db.getMeta("ai", {})) };
}
export async function saveAiSettings(s) {
  await db.setMeta("ai", s);
}
export async function aiReady() {
  const s = await getAiSettings();
  return !!(s.baseUrl && s.model && s.apiKey);
}

const SYSTEM = `你是名片資料整理助手。使用者會給你一張名片經 OCR 辨識出的文字（每行一筆，可能有錯字或順序錯亂）。
請整理成 JSON，只輸出 JSON，不要任何說明。格式：
{"name":"中文姓名","nameEn":"英文姓名","title":"職稱","department":"部門","company":"公司全名","companyEn":"英文公司名","taxId":"統一編號8碼",
"phones":[{"type":"mobile|work|fax|other","value":"號碼含分機"}],"emails":[""],"website":"","address":"地址","others":["無法歸類的文字"]}
規則：
- 只能使用原文出現的資訊，不可編造；沒有的欄位給空字串或空陣列。
- 可以修正明顯的 OCR 錯字（例如 0 和 O、1 和 l），但不要改寫內容。
- 台灣手機 09 開頭；TEL/電話 是 work；FAX/傳真 是 fax。`;

function friendlyError(e, status) {
  if (e instanceof TypeError) return "連線失敗：可能是網路問題，或此服務不允許從瀏覽器直接呼叫（CORS 限制）。";
  if (status === 401 || status === 403) return "API 金鑰無效或沒有權限。";
  if (status === 402) return "OpenCode 儲值餘額不足。";
  if (status === 404) return "找不到這個模型或網址，請檢查設定。";
  if (status === 429) return "呼叫太頻繁，請稍後再試。";
  return e.message || String(e);
}

async function call(path, body, s, extraHeaders = {}) {
  let status = 0;
  try {
    const r = await fetch(s.baseUrl.replace(/\/+$/, "") + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}`, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = r.status;
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
    }
    return await r.json();
  } catch (e) {
    throw new Error(friendlyError(e, status));
  }
}

// OpenCode Zen 依模型使用不同的 API 格式：
//   gpt-*            → /responses（OpenAI Responses API）
//   claude-* / qwen* → /messages（Anthropic Messages API）
//   其他              → /chat/completions（OpenAI 相容）
export function endpointFor(model) {
  const m = model.toLowerCase().replace(/^opencode\//, "");
  if (/^gpt-/.test(m)) return "responses";
  if (/^(claude|qwen)/.test(m)) return "messages";
  return "chat";
}

async function chat(s, system, user, maxTokens = 1200) {
  const model = s.model.replace(/^opencode\//, "");
  const kind = endpointFor(model);
  if (kind === "responses") {
    const j = await call("/responses", { model, instructions: system, input: user, max_output_tokens: Math.max(maxTokens, 16) }, s);
    if (j.output_text) return j.output_text;
    return (j.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");
  }
  if (kind === "messages") {
    const j = await call("/messages", { model, system, max_tokens: maxTokens, messages: [{ role: "user", content: user }] }, s,
      { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" });
    return (j.content || []).map((c) => c.text || "").join("");
  }
  const j = await call("/chat/completions", {
    model, temperature: 0, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  }, s);
  return j.choices?.[0]?.message?.content || "";
}

export async function listModels(s) {
  const j = await call("/models", null, s);
  return (j.data || []).map((m) => m.id).sort();
}

/** @param {string[]} lines OCR 文字 */
export async function aiParse(lines) {
  const s = await getAiSettings();
  if (!s.apiKey || !s.model) throw new Error("尚未設定 OpenCode（設定頁 → AI 整理）");
  const text = await chat(s, SYSTEM, lines.join("\n"));
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

export async function testAi(s) {
  const r = await chat(s, "你是測試助手。", "只回覆 OK 兩個字", 20);
  return r || "(沒有內容)";
}
