// mycards AI 整理用的 Cloudflare Worker
// 作用：接收名片夾送來的「OCR 文字」，交給 Cloudflare Workers AI 整理成欄位 JSON。
// 設定（在 Cloudflare 後台）：
//   - Binding：Workers AI，變數名稱 AI
//   - Secret：APP_KEY = 你自訂的通行碼（名片夾設定頁填同一組）
// 安全：只接受名片夾網址發出的請求、通行碼不對就拒絕、不儲存任何內容。

const ALLOWED_ORIGINS = ["https://3587sen-web.github.io"];
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const SYSTEM = `你是名片資料整理助手。使用者會給你一張名片經 OCR 辨識出的文字（每行一筆，可能有錯字或順序錯亂）。
請整理成 JSON，只輸出 JSON，不要任何說明或 markdown。格式：
{"name":"中文姓名","nameEn":"英文姓名","title":"職稱","department":"部門","company":"公司全名","companyEn":"英文公司名","taxId":"統一編號8碼",
"phones":[{"type":"mobile|work|fax|other","value":"號碼含分機"}],"emails":[""],"website":"","address":"地址","others":["無法歸類的文字"]}
規則：
- 只能使用原文出現的資訊，不可編造；沒有的欄位給空字串或空陣列。
- 可以修正明顯的 OCR 錯字（例如 0 和 O、1 和 l），但不要改寫內容。
- 台灣手機 09 開頭；TEL/電話 是 work；FAX/傳真 是 fax。
- title 只放中文職稱；英文職稱放進 others。`;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) } });

function textOf(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const c = r.choices?.[0]?.message?.content;
  if (typeof c === "string" && c) return c;
  if (Array.isArray(c)) return c.map((x) => x.text || "").join("");
  if (r.output_text) return r.output_text;
  return "";
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return json({ error: "只接受 POST" }, 405, origin);
    if (!env.APP_KEY || request.headers.get("X-App-Key") !== env.APP_KEY) return json({ error: "通行碼錯誤" }, 401, origin);
    if (!env.AI) return json({ error: "Worker 還沒綁定 Workers AI（變數名稱要是 AI）" }, 500, origin);

    const path = new URL(request.url).pathname;
    try {
      if (path === "/ping") {
        const r = await env.AI.run(MODEL, { messages: [{ role: "user", content: "只回覆 OK" }], max_tokens: 20, chat_template_kwargs: { enable_thinking: false } });
        return json({ ok: true, model: MODEL, reply: textOf(r).slice(0, 40) }, 200, origin);
      }
      if (path === "/parse") {
        const body = await request.json().catch(() => ({}));
        const lines = Array.isArray(body.lines) ? body.lines.map(String).slice(0, 80) : [];
        const text = lines.join("\n").slice(0, 4000);
        if (!text.trim()) return json({ error: "沒有文字" }, 400, origin);
        const r = await env.AI.run(MODEL, {
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
          max_tokens: 1500,
          temperature: 0,
          // 關掉「思考模式」：整理名片不需要，開著會把字數額度用在思考上，導致回傳空白
          chat_template_kwargs: { enable_thinking: false },
        });
        const content = textOf(r);
        // 回傳空白時附上診斷資訊（只有回應結構，不含名片內容）
        const debug = content ? undefined : { keys: Object.keys(r || {}), finish: r?.choices?.[0]?.finish_reason, usage: r?.usage };
        return json({ model: MODEL, content, debug }, 200, origin);
      }
      return json({ error: "找不到這個路徑" }, 404, origin);
    } catch (e) {
      return json({ error: "AI 執行失敗：" + (e && e.message ? e.message : String(e)) }, 502, origin);
    }
  },
};
