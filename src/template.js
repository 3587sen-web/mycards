// 版型記憶：記住「這間公司名片」的欄位位置和共用資料，同公司的下一張自動套用
// 全部在手機上運作，存在 IndexedDB 的 meta「templates」。

const GENERIC_DOMAINS = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|qq|163|126|sina|hinet|ms\d+\.hinet|seed|pchome|kimo|yahoo\.com)\./i;
// 每個人不同、要照位置抓的欄位
const POS_FIELDS = ["name", "nameEn", "title", "department"];
// 同公司共用、直接帶入的欄位
const CONST_FIELDS = ["company", "companyEn", "address", "website", "taxId"];

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s.,，。·・()（）]/g, "");

function domainOf(s) {
  const m = String(s || "").toLowerCase().match(/(?:@|\/\/|www\.|^)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  if (!m) return "";
  return m[1].replace(/^www\./, "");
}

/** 公司的識別鑰匙：Email 網域、網站網域、統編、公司名稱 */
export function companyKeys(card) {
  const domains = new Set();
  for (const e of card.emails || []) {
    const d = domainOf("@" + String(e).split("@")[1]);
    if (d && !GENERIC_DOMAINS.test(d)) domains.add(d);
  }
  const w = domainOf(card.website);
  if (w && !GENERIC_DOMAINS.test(w)) domains.add(w);
  return { domains: [...domains], taxId: card.taxId || "", company: norm(card.company) };
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[m][n] / Math.max(m, n);
}

/** 找出符合的版型；回傳 { id, tpl, strong }，strong＝用網域或統編比對到（很可靠） */
export function findTemplate(templates, card) {
  const k = companyKeys(card);
  let best = null;
  for (const [id, tpl] of Object.entries(templates || {})) {
    const strong = (k.domains.length && tpl.keys.domains.some((d) => k.domains.includes(d))) ||
      (k.taxId && tpl.keys.taxId === k.taxId);
    const sim = similarity(k.company, tpl.keys.company);
    if (strong || (k.company.length >= 4 && sim >= 0.8)) {
      const score = (strong ? 2 : 0) + sim;
      if (!best || score > best.score) best = { id, tpl, strong: !!strong, score };
    }
  }
  return best;
}

// 以「名片上所有文字的範圍」為基準換算相對位置，降低拍照位置、遠近不同的影響
function extent(lines) {
  if (!lines.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.min(...lines.map((l) => l.box.x)), y0 = Math.min(...lines.map((l) => l.box.y));
  const x1 = Math.max(...lines.map((l) => l.box.x + l.box.w)), y1 = Math.max(...lines.map((l) => l.box.y + l.box.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
function rel(line, ext) {
  return { x: (line.box.x - ext.x) / ext.w, y: (line.box.y + line.box.h / 2 - ext.y) / ext.h, h: line.box.h / ext.h };
}

// Email、網址、電話這類行不會是姓名/職稱的位置
const isContactLine = (t) => /@|www\.|https?:|\.com|\.tw|\d{4,}/i.test(String(t));

// 一行裡屬於這個值的部分（中英混排時只取中文或英文那段）
const CJK = /[㐀-鿿]/;
function pickPart(text, field) {
  const t = String(text).normalize("NFKC").trim();
  const zh = (t.match(/[㐀-鿿·．]+/g) || []).join("");
  const en = t.replace(/[㐀-鿿·．]+/g, " ").replace(/\s+/g, " ").trim();
  if (field === "name") return zh && zh.length <= 4 ? zh : t;
  if (field === "nameEn") return en || t;
  return t;
}

/** 存檔時學習：記住欄位位置和共用資料。回傳更新後的 templates */
export function learnTemplate(templates, card, lines) {
  const keys = companyKeys(card);
  if (!keys.domains.length && !keys.taxId && keys.company.length < 4) return templates; // 沒有可辨認公司的線索
  const next = { ...(templates || {}) };
  const found = findTemplate(next, card);
  const id = found ? found.id : (keys.domains[0] || keys.taxId || keys.company);
  const old = found ? found.tpl : { fields: {}, constants: {}, count: 0, keys: { domains: [], taxId: "", company: "" } };
  const ext = extent(lines);
  const fields = { ...old.fields };
  for (const f of POS_FIELDS) {
    const v = norm(card[f]);
    if (!v) continue;
    const cand = lines.filter((l) => !isContactLine(l.text));
    const line = cand.find((l) => norm(l.text) === v) || cand.find((l) => norm(l.text).includes(v)) ||
      cand.find((l) => v.includes(norm(l.text)) && norm(l.text).length >= 2);
    if (line) fields[f] = rel(line, ext);
  }
  const constants = { ...old.constants };
  for (const f of CONST_FIELDS) if (card[f]) constants[f] = card[f];
  const sharedPhones = (card.phones || []).filter((p) => p.type === "work" || p.type === "fax");
  if (sharedPhones.length) constants.phones = sharedPhones;
  next[id] = {
    label: card.company || keys.domains[0] || id,
    keys: {
      domains: [...new Set([...old.keys.domains, ...keys.domains])],
      taxId: keys.taxId || old.keys.taxId,
      company: keys.company || old.keys.company,
    },
    fields, constants,
    count: (old.count || 0) + 1,
    updatedAt: Date.now(),
  };
  return next;
}

/**
 * 套用版型：照位置填入姓名等欄位，帶入公司共用資料。
 * @returns {{card, others, filled: string[]}}
 */
export function applyTemplate(found, card, others, lines) {
  const { tpl, strong } = found;
  const c = structuredClone(card);
  let rest = [...others];
  const filled = [];
  const ext = extent(lines);
  const taken = new Set();
  for (const f of POS_FIELDS) {
    const p = tpl.fields[f];
    if (!p) continue;
    let best = null;
    for (const l of lines) {
      if (taken.has(l) || isContactLine(l.text)) continue;
      const r = rel(l, ext);
      if (r.h < p.h * 0.5 || r.h > p.h * 2) continue; // 字的大小差太多，不是同一個欄位
      const dist = Math.hypot((r.x - p.x) * 0.7, r.y - p.y);
      if (dist < 0.12 && (!best || dist < best.dist)) best = { l, dist };
    }
    if (!best) continue;
    const v = pickPart(best.l.text, f);
    if (!v) continue;
    if (f === "name" && !CJK.test(v) && c.name && CJK.test(c.name)) continue;
    taken.add(best.l);
    if (norm(c[f]) !== norm(v)) { c[f] = v; filled.push(f); }
    rest = rest.filter((t) => norm(t) !== norm(best.l.text) && norm(t) !== norm(v));
  }
  for (const f of CONST_FIELDS) {
    const v = tpl.constants[f];
    if (!v) continue;
    // 用網域或統編確認是同公司時，以版型（你修正過的）為準；否則只補空白欄位
    if (!c[f] || (strong && norm(c[f]) !== norm(v))) { c[f] = v; filled.push(f); }
  }
  const digits = (s) => String(s).replace(/\D/g, "");
  for (const p of tpl.constants.phones || []) {
    if (!c.phones.some((x) => digits(x.value) === digits(p.value))) { c.phones.push({ ...p }); filled.push("phones"); }
  }
  return { card: c, others: rest, filled: [...new Set(filled)] };
}

export const FIELD_LABELS = {
  name: "姓名", nameEn: "英文姓名", title: "職稱", department: "部門", company: "公司", companyEn: "英文公司",
  address: "地址", website: "網站", taxId: "統編", phones: "公司電話",
};
