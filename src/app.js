// mycards — 個人名片夾（PWA）
// 畫面：名片夾列表 / 新增＋確認 / 名片詳情 / 編輯 / 設定
import * as db from "./db.js";
import { parseCard, linesFromOcr, emptyCard, PHONE_TYPES } from "./parser.js";
import { prepareImage, cardCropRect, cropToCard, finalImage, compressBlob } from "./image.js";
import { findTemplate, applyTemplate, learnTemplate, FIELD_LABELS } from "./template.js";

const $app = document.getElementById("app");
const state = {
  cards: [],
  groups: [],
  query: "",
  groupFilter: "__all",
  sort: "new",
  draft: null, // 新增中的名片
  batch: null, // { files: File[], index: number, saved: number }
  thumbUrls: new Map(),
};

// ---------- 小工具 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** iOS 風格底部選單。options: [{label, value, danger}] → 回傳選到的 value（取消為 null） */
function sheet(title, options) {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet"><div class="grp">${title ? `<div class="ttl">${esc(title)}</div>` : ""}${options
      .map((o, i) => `<button data-i="${i}" class="${o.danger ? "danger" : ""}">${esc(o.label)}</button>`).join("")}</div>
      <div class="grp"><button class="cancel" data-i="-1">取消</button></div></div>`;
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) {
        const o = b.dataset.i === "-1" ? null : options[+b.dataset.i];
        // iPhone 只允許在「點擊當下」打開相機，所以要在這裡同步執行，不能等 Promise 之後
        if (o && o.sync) o.sync();
        close(o ? o.value : null);
      }
      else if (e.target === bg) close(null);
    });
    document.body.appendChild(bg);
  });
}

function pickFiles({ capture = false, multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    if (capture) inp.setAttribute("capture", "environment");
    if (multiple) inp.multiple = true;
    inp.style.display = "none";
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    inp.oncancel = () => { resolve([]); inp.remove(); };
    document.body.appendChild(inp);
    inp.click();
  });
}

async function thumbUrl(id) {
  if (!id) return "";
  if (state.thumbUrls.has(id)) return state.thumbUrls.get(id);
  const blob = await db.getImage(id);
  const url = blob ? URL.createObjectURL(blob) : "";
  state.thumbUrls.set(id, url);
  return url;
}

function cardSearchText(c) {
  return [c.name, c.nameEn, c.title, c.department, c.company, c.companyEn, c.taxId, c.website, c.address, c.group, c.metPlace, c.note,
    ...(c.emails || []), ...(c.phones || []).map((p) => p.value + " " + p.value.replace(/\D/g, ""))].join(" ").toLowerCase();
}

async function reload() {
  state.cards = await db.getAllCards();
  state.groups = await db.getMeta("groups", []);
}

// ---------- 底部分頁 ----------
const ICON = {
  cards: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.5 1.7-2 3-2s2.4.5 3 2M14 10h4M14 13h3"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
};

function tabbar(active) {
  return `<nav class="tabbar">
    <button class="tab ${active === "list" ? "on" : ""}" data-go="#/">${ICON.cards}名片夾</button>
    <button class="tab-add" id="addBtn" aria-label="新增名片">＋</button>
    <button class="tab ${active === "settings" ? "on" : ""}" data-go="#/settings">${ICON.gear}設定</button>
  </nav>`;
}

function bindTabbar() {
  $app.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  const add = $app.querySelector("#addBtn");
  if (add) add.addEventListener("click", startAdd);
}

async function startAdd() {
  const v = await sheet("新增名片", [
    { label: "📷 拍照", value: "camera" },
    { label: "🖼️ 從相簿選一張", value: "album" },
    { label: "📚 批次匯入多張照片", value: "batch" },
    { label: "✏️ 手動輸入", value: "manual" },
  ]);
  if (!v) return;
  if (v === "manual") {
    state.batch = null;
    state.draft = newDraft("manual");
    return go("#/review");
  }
  const files = await pickFiles({ capture: v === "camera", multiple: v === "batch" });
  if (!files.length) return;
  if (v === "batch") {
    state.batch = { files, index: 0, saved: 0 };
    return startDraftFromFile(files[0], "batch");
  }
  state.batch = null;
  startDraftFromFile(files[0], v);
}

function newDraft(source) {
  return {
    source,
    card: { ...emptyCard(), group: "", metPlace: "", note: "" },
    front: null, back: null, // {full, thumb, url}
    lines: [], backLines: [], others: [],
    status: null, // {type:'busy'|'ok'|'err', text}
  };
}

async function startDraftFromFile(file, source) {
  const d = newDraft(source);
  state.draft = d;
  d.status = { type: "busy", text: "處理照片中…" };
  go("#/review");
  try {
    d.front = await prepareImage(file);
    d.front.url = URL.createObjectURL(d.front.full);
    if (state.draft === d) renderReview();
    await runOcr(d, "front");
  } catch (e) {
    d.status = { type: "err", text: "照片讀取失敗：" + e.message };
    if (state.draft === d) renderReview();
  }
}

async function runOcr(d, side) {
  const img = side === "front" ? d.front : d.back;
  if (!img) return;
  const setStatus = (text, type = "busy") => {
    d.status = { type, text };
    if (state.draft === d) updateStatus();
  };
  try {
    setStatus("準備辨識…");
    const { recognize } = await import("./ocr.js");
    const items = await recognize(img.full, (s) => setStatus(s));
    const { linesToTraditional } = await import("./s2t.js");
    const lines = await linesToTraditional(linesFromOcr(items));
    if (side === "front") d.lines = lines; else d.backLines = lines;
    // 自動裁切：依文字範圍裁掉背景（檔案更小、名片看得更清楚）
    try {
      const rect = cardCropRect(lines, img.width, img.height);
      img.cropped = rect ? await cropToCard(img, rect) : null;
      img.cropOn = !!img.cropped;
      if (img.cropped) { URL.revokeObjectURL(img.url); img.url = URL.createObjectURL(img.cropped.full); }
    } catch (e) { console.warn("自動裁切失敗", e); img.cropped = null; }
    if (!lines.length) {
      setStatus("沒有辨識到文字，可以旋轉照片後重新辨識，或直接手動輸入。", "err");
      return;
    }
    const { card, others, notes } = parseCard(lines);
    // 先保存使用者在辨識期間已輸入的內容，再填入辨識結果
    const form = state.draft === d && $app.querySelector("#reviewForm");
    if (form) readForm(form, d.card);
    mergeInto(d, card, others, side === "front");
    // 版型記憶：同公司的名片照之前修正過的位置自動填入
    if (side === "front") {
      d.template = null;
      const found = findTemplate(await db.getMeta("templates", {}), d.card);
      if (found) {
        const before = { card: structuredClone(d.card), others: [...d.others] };
        const r = applyTemplate(found, d.card, d.others, lines);
        d.card = r.card;
        d.others = r.others;
        d.template = { label: found.tpl.label, count: found.tpl.count, filled: r.filled, before };
      }
    }
    setStatus(`辨識完成（${lines.length} 行文字），請確認下面的欄位。${(notes || []).map((n) => "　" + n).join("")}`, "ok");
    if (state.draft === d) renderReview();
  } catch (e) {
    console.error(e);
    setStatus("辨識失敗：" + (e.message || e) + "。可以手動輸入。", "err");
  }
}

// 把辨識結果填進草稿；overwrite=false 時只補空白欄位（背面用）
function mergeInto(d, card, others, overwrite) {
  const c = d.card;
  for (const k of ["name", "nameEn", "title", "department", "company", "companyEn", "taxId", "website", "address"]) {
    if (card[k] && (overwrite || !c[k])) c[k] = card[k];
  }
  const digits = (v) => v.replace(/\D/g, "");
  if (overwrite) c.phones = [];
  for (const p of card.phones) if (!c.phones.some((x) => digits(x.value) === digits(p.value))) c.phones.push(p);
  if (overwrite) c.emails = [];
  for (const e of card.emails) if (!c.emails.includes(e)) c.emails.push(e);
  d.others = overwrite ? others : [...d.others, ...others];
}

// ---------- 列表 ----------
async function renderList() {
  const lastBackup = await db.getMeta("lastBackupAt", 0);
  const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) : null;
  const needBackup = state.cards.length > 0 && (days === null || days >= 30);
  $app.innerHTML = `
    <header class="topbar"><h1 class="left">名片夾<span class="count">${state.cards.length} 張</span></h1></header>
    <div class="wrap">
      <input class="search" id="q" type="search" placeholder="搜尋姓名、公司、電話、備註…" value="${esc(state.query)}" autocomplete="off">
      <div class="chips" id="chips"></div>
      ${needBackup ? `<div class="banner warn">⚠️ ${days === null ? "還沒備份過" : `已經 ${days} 天沒備份`}，資料只存在這支手機上。<button data-go="#/settings">去備份</button></div>` : ""}
      <div class="row-tools"><span id="resultCount"></span>
        <select id="sort"><option value="new">最新加入</option><option value="old">最早加入</option><option value="name">依姓名</option><option value="company">依公司</option></select></div>
      <div id="listBody"></div>
    </div>
    ${tabbar("list")}`;
  bindTabbar();
  $app.querySelector("#sort").value = state.sort;
  $app.querySelector("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderListBody(); });
  const q = $app.querySelector("#q");
  q.addEventListener("input", () => { state.query = q.value; renderListBody(); });
  renderChips();
  renderListBody();
}

function renderChips() {
  const el = $app.querySelector("#chips");
  const used = new Set(state.cards.map((c) => c.group || ""));
  const groups = [["__all", "全部"], ...state.groups.map((g) => [g, g]), ...(used.has("") && state.groups.length ? [["", "未分組"]] : [])];
  if (groups.length <= 1) { el.style.display = "none"; return; }
  el.innerHTML = groups.map(([v, l]) => `<button class="chip ${state.groupFilter === v ? "on" : ""}" data-g="${esc(v)}">${esc(l)}</button>`).join("");
  el.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    state.groupFilter = b.dataset.g;
    renderChips();
    renderListBody();
  }));
}

let thumbObserver;
function renderListBody() {
  const body = $app.querySelector("#listBody");
  if (!body) return;
  const q = state.query.trim().toLowerCase();
  let list = state.cards.filter((c) => state.groupFilter === "__all" || (c.group || "") === state.groupFilter);
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((c) => { const t = cardSearchText(c); return terms.every((x) => t.includes(x)); });
  }
  const coll = new Intl.Collator("zh-TW");
  const sorters = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => coll.compare(a.name || a.nameEn || "~", b.name || b.nameEn || "~"),
    company: (a, b) => coll.compare(a.company || "~", b.company || "~"),
  };
  list.sort(sorters[state.sort]);
  $app.querySelector("#resultCount").textContent = q || state.groupFilter !== "__all" ? `找到 ${list.length} 張` : "";

  if (!state.cards.length) {
    body.innerHTML = `<div class="empty"><div class="big">📇</div><p>還沒有名片</p><p class="muted">按下方「＋」拍第一張名片</p></div>`;
    return;
  }
  if (!list.length) { body.innerHTML = `<div class="empty"><p>找不到符合的名片</p></div>`; return; }

  const row = (c) => `<div class="item" data-id="${c.id}">
      <img class="thumb" data-thumb="${c.thumbId || ""}" alt="">
      <div class="meta"><div class="n">${esc(c.name || c.nameEn || "（未填姓名）")}<small>${esc(c.title)}</small></div>
      <div class="c">${esc(c.company || c.companyEn)}</div></div></div>`;
  let html = "";
  if (state.sort === "new" || state.sort === "old") {
    let cur = null, buf = [];
    const flush = () => { if (buf.length) html += `<div class="date-h">${cur}</div><div class="list">${buf.join("")}</div>`; buf = []; };
    for (const c of list) {
      const d = fmtDate(c.createdAt);
      if (d !== cur) { flush(); cur = d; }
      buf.push(row(c));
    }
    flush();
  } else {
    html = `<div class="list" style="margin-top:6px">${list.map(row).join("")}</div>`;
  }
  body.innerHTML = html;
  body.querySelectorAll(".item").forEach((el) => el.addEventListener("click", () => go("#/card/" + el.dataset.id)));
  // 縮圖滑到才載入
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const img = en.target;
      thumbObserver.unobserve(img);
      thumbUrl(img.dataset.thumb).then((u) => { if (u) img.src = u; });
    }
  }, { rootMargin: "300px" });
  body.querySelectorAll("img[data-thumb]").forEach((img) => img.dataset.thumb && thumbObserver.observe(img));
}

// ---------- 新增 / 編輯 共用表單 ----------
const FIELDS = [
  ["name", "姓名"], ["nameEn", "英文姓名"], ["title", "職稱"], ["department", "部門"],
  ["company", "公司"], ["companyEn", "英文公司"], ["taxId", "統一編號"],
];
const FIELDS2 = [["website", "網站"], ["address", "地址"]];
const ASSIGNABLE = [...FIELDS, ...FIELDS2, ["phone", "電話"], ["email", "Email"], ["note", "備註"], ["metPlace", "認識場合"]];

function formHtml(c) {
  const input = ([k, l], type = "text") => `<div class="field"><label>${l}</label><input data-k="${k}" type="${type}" value="${esc(c[k])}" autocomplete="off"></div>`;
  const phoneRow = (p, i) => `<div class="field"><select class="type" data-ph-type="${i}">${Object.entries(PHONE_TYPES)
    .map(([v, l]) => `<option value="${v}" ${p.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input type="tel" data-ph="${i}" value="${esc(p.value)}"><button class="x" data-ph-del="${i}" aria-label="刪除">⊖</button></div>`;
  const emailRow = (e, i) => `<div class="field"><label>Email</label><input type="email" data-em="${i}" value="${esc(e)}" autocapitalize="off"><button class="x" data-em-del="${i}" aria-label="刪除">⊖</button></div>`;
  return `
    <div class="section">${FIELDS.map((f) => input(f)).join("")}</div>
    <div class="section-h">電話</div>
    <div class="section">${c.phones.map(phoneRow).join("")}<button class="add-line" id="addPhone">＋ 新增電話</button></div>
    <div class="section-h">Email 與其他</div>
    <div class="section">${c.emails.map(emailRow).join("")}<button class="add-line" id="addEmail">＋ 新增 Email</button></div>
    <div class="section">${FIELDS2.map((f) => input(f)).join("")}</div>
    <div class="section-h">整理</div>
    <div class="section">
      <div class="field"><label>分組</label><select data-k="group"><option value="">未分組</option>${state.groups.map((g) => `<option ${c.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}<option value="__new">＋ 新增分組…</option></select></div>
      ${input(["metPlace", "認識場合"])}
      <div class="field"><label>備註</label><textarea data-k="note" rows="3">${esc(c.note)}</textarea></div>
    </div>`;
}

// 把表單目前的值寫回 card 物件
function readForm(root, c) {
  root.querySelectorAll("[data-k]").forEach((el) => { if (el.dataset.k !== "group" || el.value !== "__new") c[el.dataset.k] = el.value.trim(); });
  root.querySelectorAll("[data-ph]").forEach((el) => { c.phones[+el.dataset.ph].value = el.value.trim(); });
  root.querySelectorAll("[data-ph-type]").forEach((el) => { c.phones[+el.dataset.phType].type = el.value; });
  root.querySelectorAll("[data-em]").forEach((el) => { c.emails[+el.dataset.em] = el.value.trim(); });
}

function bindForm(root, c, rerender) {
  root.querySelector("#addPhone").addEventListener("click", () => { readForm(root, c); c.phones.push({ type: "mobile", value: "" }); rerender(); });
  root.querySelector("#addEmail").addEventListener("click", () => { readForm(root, c); c.emails.push(""); rerender(); });
  root.querySelectorAll("[data-ph-del]").forEach((b) => b.addEventListener("click", () => { readForm(root, c); c.phones.splice(+b.dataset.phDel, 1); rerender(); }));
  root.querySelectorAll("[data-em-del]").forEach((b) => b.addEventListener("click", () => { readForm(root, c); c.emails.splice(+b.dataset.emDel, 1); rerender(); }));
  const gsel = root.querySelector('[data-k="group"]');
  gsel.addEventListener("change", async () => {
    if (gsel.value !== "__new") return;
    const name = (prompt("新分組名稱") || "").trim();
    if (name) {
      if (!state.groups.includes(name)) { state.groups.push(name); await db.setMeta("groups", state.groups); }
      readForm(root, c);
      c.group = name;
      rerender();
    } else gsel.value = c.group || "";
  });
}

function cleanCard(c) {
  c.phones = c.phones.filter((p) => p.value);
  c.emails = c.emails.filter(Boolean);
  return c;
}

// ---------- 確認畫面（新增） ----------
function updateStatus() {
  const el = $app.querySelector("#status");
  const d = state.draft;
  if (!el || !d) return;
  if (!d.status) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="status ${d.status.type === "err" ? "err" : d.status.type === "ok" ? "ok" : ""}">${d.status.type === "busy" ? '<span class="spinner"></span>' : ""}<span>${esc(d.status.text)}</span></div>`;
}

async function renderReview() {
  const d = state.draft;
  if (!d) return go("#/");
  const { aiReady } = await import("./ai.js");
  const canAi = await aiReady();
  const b = state.batch;
  const photo = (img, side) => img ? `<div class="photo"><img src="${img.url}" data-view="${side}" alt=""><span class="tag">${side === "front" ? "正面" : "背面"}</span>
      <div class="tools">${img.cropped ? `<button data-crop="${side}">${img.cropOn ? "看原圖" : "裁切"}</button>` : ""}<button data-rotate="${side}">↻ 旋轉</button><button data-reocr="${side}">重新辨識</button>${side === "back" ? '<button data-rmback="1">移除</button>' : ""}</div></div>` : "";
  $app.innerHTML = `
    <header class="topbar"><button class="tb-btn" id="cancel">取消</button><h1>${b ? `批次 ${b.index + 1} / ${b.files.length}` : "確認名片"}</h1><button class="tb-btn right" id="save"><b>存檔</b></button></header>
    <div class="wrap">
      ${d.front || d.source !== "manual" ? `<div class="photos">${photo(d.front, "front")}${d.back ? photo(d.back, "back") : `<button class="photo add-back" id="addBack">＋ 加入背面照片</button>`}</div>
      <div class="dots">左右滑動看正反面</div>` : ""}
      <div id="status"></div>
      ${d.template ? `<div class="banner info">📐 已套用「${esc(d.template.label)}」的版型（從 ${d.template.count} 張名片學到）${d.template.filled.length ? "：" + esc(d.template.filled.map((f) => FIELD_LABELS[f] || f).join("、")) : ""}<button id="undoTpl">不要套用</button></div>` : ""}
      ${d.lines.length || d.backLines.length ? `<div class="btn-row">${canAi ? '<button class="btn secondary" id="aiBtn">✨ AI 整理</button>' : ""}</div>` : ""}
      <form id="reviewForm" data-draft="1" onsubmit="return false">${formHtml(d.card)}</form>
      ${d.others.length ? `<div class="section-h">沒有歸類的文字（點一下指定欄位）</div><div class="section"><div class="ocr-chips">${d.others.map((t, i) => `<button class="ocr-chip" data-other="${i}">${esc(t)}</button>`).join("")}</div></div>` : ""}
      ${d.lines.length ? `<div class="section-h">辨識到的全部文字（點一下指定欄位）</div><div class="section"><div class="ocr-chips">${[...d.lines, ...d.backLines].map((l, i) => `<button class="ocr-chip" data-line="${i}">${esc(l.text)}</button>`).join("")}</div></div>` : ""}
      ${b ? `<button class="btn secondary" id="skip">跳過這張</button>` : ""}
      <p class="hint center">辨識在手機上完成，照片不會上傳。${canAi ? "AI 整理只會傳送辨識出的文字。" : ""}</p>
    </div>`;
  updateStatus();
  const form = $app.querySelector("#reviewForm");
  bindForm(form, d.card, renderReview);

  $app.querySelector("#cancel").addEventListener("click", async () => {
    if (b && b.index < b.files.length - 1) {
      const v = await sheet(`批次匯入還有 ${b.files.length - b.index - 1} 張`, [{ label: "結束批次匯入", value: "end", danger: true }]);
      if (v !== "end") return;
    } else if (!confirm("放棄這張名片？")) return;
    finishBatchOrExit(true);
  });
  $app.querySelector("#save").addEventListener("click", onSaveClick);
  $app.querySelector("#undoTpl")?.addEventListener("click", () => {
    d.card = d.template.before.card;
    d.others = d.template.before.others;
    d.template = null;
    toast("已取消套用版型");
    renderReview();
  });
  $app.querySelector("#skip")?.addEventListener("click", () => nextInBatch());
  $app.querySelector("#addBack")?.addEventListener("click", async () => {
    const v = await sheet("背面照片", [{ label: "📷 拍照", value: "camera" }, { label: "🖼️ 從相簿選", value: "album" }]);
    if (!v) return;
    const [f] = await pickFiles({ capture: v === "camera" });
    if (!f) return;
    readForm(form, d.card);
    d.back = await prepareImage(f);
    d.back.url = URL.createObjectURL(d.back.full);
    renderReview();
    runOcr(d, "back");
  });
  $app.querySelector("[data-rmback]")?.addEventListener("click", () => { readForm(form, d.card); d.back = null; d.backLines = []; renderReview(); });
  $app.querySelectorAll("[data-rotate]").forEach((btn) => btn.addEventListener("click", async () => {
    readForm(form, d.card);
    const side = btn.dataset.rotate;
    const img = d[side];
    const r = await prepareImage(img.full, 90);
    r.url = URL.createObjectURL(r.full);
    URL.revokeObjectURL(img.url);
    d[side] = r;
    renderReview();
  }));
  $app.querySelectorAll("[data-crop]").forEach((btn) => btn.addEventListener("click", () => {
    readForm(form, d.card);
    const img = d[btn.dataset.crop];
    img.cropOn = !img.cropOn;
    URL.revokeObjectURL(img.url);
    img.url = URL.createObjectURL(img.cropOn ? img.cropped.full : img.full);
    renderReview();
  }));
  $app.querySelectorAll("[data-reocr]").forEach((btn) => btn.addEventListener("click", () => { readForm(form, d.card); runOcr(d, btn.dataset.reocr); }));
  $app.querySelectorAll("[data-view]").forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  const assign = async (text) => {
    const v = await sheet(`「${text.length > 24 ? text.slice(0, 24) + "…" : text}」要放到哪個欄位？`, ASSIGNABLE.map(([k, l]) => ({ label: l, value: k })));
    if (!v) return;
    readForm(form, d.card);
    const c = d.card;
    if (v === "phone") c.phones.push({ type: /^(\+?886\s?9|09)/.test(text.replace(/[\s-]/g, "")) ? "mobile" : "work", value: text });
    else if (v === "email") c.emails.push(text);
    else if (v === "note" || v === "address") c[v] = c[v] ? c[v] + (v === "note" ? "\n" : " ") + text : text;
    else c[v] = text;
    d.others = d.others.filter((t) => t !== text);
    renderReview();
  };
  $app.querySelectorAll("[data-other]").forEach((btn) => btn.addEventListener("click", () => assign(d.others[+btn.dataset.other])));
  $app.querySelectorAll("[data-line]").forEach((btn) => btn.addEventListener("click", () => assign([...d.lines, ...d.backLines][+btn.dataset.line].text)));
  $app.querySelector("#aiBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    readForm(form, d.card);
    btn.disabled = true;
    d.status = { type: "busy", text: "AI 整理中（只傳送文字）…" };
    updateStatus();
    try {
      const { aiParse } = await import("./ai.js");
      const r = await aiParse([...d.lines, ...d.backLines].map((l) => l.text));
      const keep = { group: d.card.group, metPlace: d.card.metPlace, note: d.card.note };
      d.card = { ...d.card, ...r.card, ...keep };
      d.others = r.others;
      d.status = { type: "ok", text: "AI 整理完成，請確認。" };
      renderReview();
    } catch (err) {
      d.status = { type: "err", text: "AI 整理失敗：" + err.message };
      updateStatus();
      btn.disabled = false;
    }
  });
}

async function saveDraft({ navigate = true } = {}) {
  const d = state.draft;
  const form = $app.querySelector("#reviewForm");
  readForm(form, d.card);
  const c = cleanCard(d.card);
  if (!c.name && !c.nameEn && !c.company && !c.phones.length && !d.front) {
    toast("至少填一個欄位，或拍一張照片");
    return null;
  }
  const card = { id: db.uid(), ...c, source: d.source, ocrText: [...d.lines, ...d.backLines].map((l) => l.text).join("\n") };
  if (d.front) {
    const f = await finalImage(d.front);
    card.frontImageId = await db.putImage(f.full);
    card.thumbId = await db.putImage(f.thumb);
  }
  if (d.back) card.backImageId = await db.putImage((await finalImage(d.back)).full);
  card.imgV2 = true; // 已是壓縮後的照片
  await db.putCard(card);
  state.cards.push(card);
  // 版型記憶：用這張（你確認、修正過的）名片更新這間公司的版型
  if (d.lines.length) {
    try { await db.setMeta("templates", learnTemplate(await db.getMeta("templates", {}), card, d.lines)); } catch (e) { console.warn("版型學習失敗", e); }
  }
  db.requestPersist();
  if (state.batch) {
    state.batch.saved++;
    toast(`已存檔：${card.name || card.company || "名片"}`);
    nextInBatch();
  } else {
    toast("已存檔");
    state.draft = null;
    if (navigate) go("#/card/" + card.id);
  }
  return card;
}

// 按「存檔」：單張模式先問「存檔／存檔並拍下一張」；批次模式直接存並跳下一張
async function onSaveClick() {
  const d = state.draft;
  if (state.batch) return saveDraft();
  const fromAlbum = d.source === "album";
  let nextFiles = null;
  const v = await sheet(null, [
    { label: "存檔", value: "save" },
    { label: fromAlbum ? "🖼️ 存檔並從相簿選下一張" : "📷 存檔並拍下一張", value: "next",
      sync: () => { nextFiles = pickFiles({ capture: !fromAlbum }); } },
  ]);
  if (!v) return;
  const card = await saveDraft({ navigate: false });
  if (!card) return; // 欄位都空白、沒存成功
  // 先切到剛存好的名片；如果沒拍下一張（按了取消），就停在這裡
  go("#/card/" + card.id);
  if (v !== "next" || !nextFiles) return;
  const files = await nextFiles;
  if (files.length) startDraftFromFile(files[0], fromAlbum ? "album" : "camera");
}

function nextInBatch() {
  const b = state.batch;
  if (!b) return finishBatchOrExit();
  b.index++;
  if (b.index >= b.files.length) return finishBatchOrExit();
  startDraftFromFile(b.files[b.index], "batch");
}

function finishBatchOrExit(cancelled = false) {
  const b = state.batch;
  if (b) toast(`批次匯入${cancelled ? "已結束" : "完成"}：存了 ${b.saved} 張`, 3000);
  state.batch = null;
  state.draft = null;
  go("#/");
}

function viewImage(src) {
  const v = document.createElement("div");
  v.className = "viewer";
  v.innerHTML = `<img src="${src}" alt=""><button>關閉</button>`;
  v.addEventListener("click", () => v.remove());
  document.body.appendChild(v);
}

// ---------- 名片詳情 ----------
async function renderDetail(id) {
  const c = state.cards.find((x) => x.id === id) || (await db.getCard(id));
  if (!c) return go("#/");
  const urls = [];
  for (const [imgId, label] of [[c.frontImageId, "正面"], [c.backImageId, "背面"]]) {
    if (!imgId) continue;
    const blob = await db.getImage(imgId);
    if (blob) urls.push([URL.createObjectURL(blob), label]);
  }
  const firstPhone = (c.phones || []).find((p) => p.type === "mobile") || (c.phones || []).find((p) => p.type !== "fax");
  const telHref = (v) => "tel:" + v.replace(/\s*#\s*/, ",").replace(/[^\d+,]/g, "");
  const mapHref = c.address ? "https://maps.apple.com/?q=" + encodeURIComponent(c.address) : "";
  const kv = (k, v, extra = "") => v ? `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div>${extra}</div>` : "";
  const copyBtn = (text) => `<button class="copy" data-copy="${esc(text)}">複製</button>`;
  const webHref = c.website ? (/^https?:/i.test(c.website) ? c.website : "https://" + c.website) : "";
  $app.innerHTML = `
    <header class="topbar"><button class="tb-btn" id="back">‹ 返回</button><h1>名片詳情</h1><button class="tb-btn right" id="edit">編輯</button></header>
    <div class="wrap">
      ${urls.length ? `<div class="photos">${urls.map(([u, l]) => `<div class="photo"><img src="${u}" data-view alt=""><span class="tag">${l}</span></div>`).join("")}</div>${urls.length > 1 ? '<div class="dots">左右滑動看正反面</div>' : ""}` : ""}
      <div class="section">
        <div class="hero"><div class="nm">${esc(c.name || c.nameEn || "（未填姓名）")}${c.name && c.nameEn ? `<small>${esc(c.nameEn)}</small>` : ""}</div>
          <div class="tt">${esc([c.department, c.title].filter(Boolean).join(" · "))}</div>
          <div class="co">${esc(c.company)}</div></div>
        <div class="actions">
          <a class="act" ${firstPhone ? `href="${telHref(firstPhone.value)}"` : "disabled"}><span class="ic" style="background:#34c759">📞</span>電話</a>
          <a class="act" ${mapHref ? `href="${mapHref}" target="_blank"` : "disabled"}><span class="ic" style="background:#ff9f0a">📍</span>地圖</a>
          <a class="act" ${c.emails?.length ? `href="mailto:${esc(c.emails[0])}"` : "disabled"}><span class="ic" style="background:#0a84ff">✉️</span>Email</a>
          <button class="act" id="toContacts"><span class="ic" style="background:#8e8e93">👤</span>存到聯絡人</button>
        </div>
      </div>
      <div class="section">
        ${(c.phones || []).map((p) => kv(PHONE_TYPES[p.type] || "電話", p.type === "fax" ? esc(p.value) : `<a href="${telHref(p.value)}">${esc(p.value)}</a>`, copyBtn(p.value))).join("")}
        ${(c.emails || []).map((e) => kv("Email", `<a href="mailto:${esc(e)}">${esc(e)}</a>`, copyBtn(e))).join("")}
        ${kv("網站", webHref ? `<a href="${esc(webHref)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : "")}
        ${kv("地址", mapHref ? `<a href="${mapHref}" target="_blank">${esc(c.address)}</a>` : "", c.address ? copyBtn(c.address) : "")}
        ${kv("英文公司", esc(c.companyEn))}
        ${kv("統一編號", esc(c.taxId), c.taxId ? copyBtn(c.taxId) : "")}
      </div>
      <div class="section">
        ${kv("分組", esc(c.group || "未分組"))}
        ${kv("認識場合", esc(c.metPlace))}
        ${kv("備註", esc(c.note))}
        ${kv("建立", esc(new Date(c.createdAt).toLocaleString("zh-TW", { hour12: false }) + "　來源：" + ({ camera: "拍照", album: "相簿", batch: "批次匯入", manual: "手動輸入" }[c.source] || "—")))}
      </div>
      <button class="btn danger" id="del">刪除名片</button>
    </div>
    ${tabbar("list")}`;
  bindTabbar();
  $app.querySelector("#back").addEventListener("click", () => (history.length > 1 ? history.back() : go("#/")));
  $app.querySelector("#edit").addEventListener("click", () => go("#/edit/" + c.id));
  $app.querySelectorAll("[data-view]").forEach((img) => img.addEventListener("click", () => viewImage(img.src)));
  $app.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("已複製"); } catch { toast("無法複製"); }
  }));
  $app.querySelector("#toContacts").addEventListener("click", () => exportVcard(c));
  $app.querySelector("#del").addEventListener("click", async () => {
    const v = await sheet(`確定刪除「${c.name || c.company || "這張名片"}」？刪除後無法復原（除非有備份）。`, [{ label: "刪除", value: "del", danger: true }]);
    if (v !== "del") return;
    await db.deleteCard(c);
    state.cards = state.cards.filter((x) => x.id !== c.id);
    toast("已刪除");
    go("#/");
  });
}

async function exportVcard(c) {
  const v = await sheet("存到 iPhone 聯絡人", [
    { label: "直接加入聯絡人", value: "open" },
    { label: "存成檔案（備用方法）", value: "file" },
  ]);
  if (!v) return;
  const { cardToVcard } = await import("./backup.js");
  const text = await cardToVcard(c);
  const name = `${(c.name || c.company || "card").replace(/[\\/:*?"<>|]/g, "")}.vcf`;
  if (v === "open") {
    // 方法 A：以下載方式開啟 .vcf，iPhone 會跳出聯絡人預覽（有「建立新聯絡人」）
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/vcard" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    toast("如果沒有跳出聯絡人畫面，請改用「存成檔案」", 3500);
  } else {
    // 方法 B：分享選單 → 儲存到檔案 → 到「檔案」App 點開 → 建立新聯絡人
    const ok = await shareOrDownload([new File([text], name, { type: "text/vcard" })]);
    if (ok) {
      await sheet("接下來：打開「檔案」App，找到剛剛存的 " + name + "，點一下 →「建立新聯絡人」。", [{ label: "知道了", value: 1 }]);
    }
  }
}

/** 用 iPhone 的分享選單存檔（可選 iCloud 雲碟 / Google 雲端硬碟 / 我的 iPhone）；不支援時改為下載 */
async function shareOrDownload(files, hint) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files });
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
      // NotAllowedError：通常是產生檔案太久，失去「使用者點擊」的授權 → 再點一次即可
      if (e.name !== "NotAllowedError") console.warn(e);
      return new Promise((resolve) => {
        sheet(hint || "檔案已準備好", [{ label: "儲存檔案", value: "go" }]).then(async (v) => {
          if (!v) return resolve(false);
          try { await navigator.share({ files }); resolve(true); } catch { resolve(false); }
        });
      });
    }
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  return true;
}

// ---------- 編輯 ----------
async function renderEdit(id) {
  const orig = await db.getCard(id);
  if (!orig) return go("#/");
  const c = structuredClone(orig);
  c.phones ||= []; c.emails ||= [];
  const draw = () => {
    const old = $app.querySelector("#editForm");
    if (old) readForm(old, c);
    $app.innerHTML = `
      <header class="topbar"><button class="tb-btn" id="cancel">取消</button><h1>編輯名片</h1><button class="tb-btn right" id="save"><b>完成</b></button></header>
      <div class="wrap">
        <div class="btn-row mt"><button class="small-btn" id="replaceFront">更換正面照片</button><button class="small-btn" id="replaceBack">${c.backImageId ? "更換" : "加入"}背面照片</button>${c.backImageId ? '<button class="small-btn" id="removeBack">移除背面</button>' : ""}</div>
        <form id="editForm" onsubmit="return false">${formHtml(c)}</form>
        ${c.ocrText ? `<div class="section-h">當初辨識到的文字（點一下指定欄位）</div><div class="section"><div class="ocr-chips">${c.ocrText.split("\n").filter(Boolean).map((t, i) => `<button class="ocr-chip" data-t="${i}">${esc(t)}</button>`).join("")}</div></div>` : ""}
      </div>`;
    const form = $app.querySelector("#editForm");
    bindForm(form, c, draw);
    $app.querySelector("#cancel").addEventListener("click", () => history.back());
    $app.querySelector("#save").addEventListener("click", async () => {
      readForm(form, c);
      cleanCard(c);
      await db.putCard(c);
      const i = state.cards.findIndex((x) => x.id === c.id);
      if (i >= 0) state.cards[i] = c;
      toast("已儲存");
      history.back();
    });
    const replace = async (side) => {
      const v = await sheet(side === "front" ? "正面照片" : "背面照片", [{ label: "📷 拍照", value: "camera" }, { label: "🖼️ 從相簿選", value: "album" }]);
      if (!v) return;
      const [f] = await pickFiles({ capture: v === "camera" });
      if (!f) return;
      readForm(form, c);
      const img = await finalImage(await prepareImage(f));
      if (side === "front") {
        await db.deleteImage(c.frontImageId); await db.deleteImage(c.thumbId);
        c.frontImageId = await db.putImage(img.full);
        c.thumbId = await db.putImage(img.thumb);
        state.thumbUrls.delete(orig.thumbId);
      } else {
        await db.deleteImage(c.backImageId);
        c.backImageId = await db.putImage(img.full);
      }
      await db.putCard(c); // 照片已換，先存起來避免孤兒檔
      toast("照片已更新");
      draw();
    };
    $app.querySelector("#replaceFront").addEventListener("click", () => replace("front"));
    $app.querySelector("#replaceBack").addEventListener("click", () => replace("back"));
    $app.querySelector("#removeBack")?.addEventListener("click", async () => {
      readForm(form, c);
      await db.deleteImage(c.backImageId);
      c.backImageId = null;
      await db.putCard(c);
      draw();
    });
    $app.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", async () => {
      const text = b.textContent;
      const v = await sheet(`「${text}」要放到哪個欄位？`, ASSIGNABLE.map(([k, l]) => ({ label: l, value: k })));
      if (!v) return;
      readForm(form, c);
      if (v === "phone") c.phones.push({ type: "work", value: text });
      else if (v === "email") c.emails.push(text);
      else if (v === "note") c.note = c.note ? c.note + "\n" + text : text;
      else c[v] = text;
      draw();
    }));
  };
  draw();
}

// 辨識引擎（模型、wasm、opencv）存在 service worker 的快取裡，用回應標頭的檔案大小加總
async function engineCacheBytes() {
  try {
    const cache = await caches.open("mycards-big-v1");
    let total = 0;
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const len = +res.headers.get("content-length");
      total += len > 0 ? len : (await res.blob()).size;
    }
    return total;
  } catch {
    return 0;
  }
}

// 兩個模型檔都在快取裡 → 視為已下載
async function isModelCached() {
  try {
    const base = new URL("./", document.baseURI);
    for (const f of ["models/PP-OCRv5_mobile_det.tar", "models/PP-OCRv5_mobile_rec.tar", "ort/ort-wasm-simd-threaded.wasm"]) {
      if (!(await caches.match(new URL(f, base).href))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- 設定 ----------
async function renderSettings() {
  const { getAiSettings } = await import("./ai.js");
  const ai = await getAiSettings();
  const templates = await db.getMeta("templates", {});
  const lastBackup = await db.getMeta("lastBackupAt", 0);
  const est = await db.storageEstimate();
  const photoBytes = await db.imageBytes();
  const engineBytes = await engineCacheBytes();
  const modelReady = await isModelCached();
  const mb = (b) => (b / 1e6).toFixed(1) + " MB";
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $app.innerHTML = `
    <header class="topbar"><h1 class="left">設定</h1></header>
    <div class="wrap">
      ${!standalone ? `<div class="banner info">💡 請在 Safari 按「分享 → 加入主畫面」，用主畫面圖示開啟，資料才不會被 Safari 自動清掉。</div>` : ""}
      <div class="section-h">備份與還原</div>
      <div class="section">
        <div class="kv"><div class="k">上次備份</div><div class="v">${lastBackup ? new Date(lastBackup).toLocaleString("zh-TW", { hour12: false }) : "還沒備份過"}</div></div>
        <div class="kv"><div class="k">名片數</div><div class="v">${state.cards.length} 張</div></div>
        <div class="kv"><div class="k">名片照片</div><div class="v">${mb(photoBytes)}<span class="muted">（會隨名片數增加）</span></div></div>
        <div class="kv"><div class="k">辨識引擎</div><div class="v">${engineBytes ? mb(engineBytes) : "尚未下載"}<span class="muted">（固定大小，只下載一次）</span></div></div>
        <div class="kv"><div class="k">合計</div><div class="v">${est ? mb(est.usage) : mb(photoBytes + engineBytes)}${persisted ? "（已設為永久保存）" : ""}</div></div>
      </div>
      ${state.cards.some((c) => !c.imgV2 && (c.frontImageId || c.backImageId)) ? `<button class="btn secondary" id="compress">壓縮舊名片照片（${state.cards.filter((c) => !c.imgV2 && (c.frontImageId || c.backImageId)).length} 張）</button>
      <p class="hint">把舊照片縮成 1200px、畫質 80%，預估省下約一半空間。照片會被取代、無法復原，<b>請先備份</b>。新拍的名片已經會自動裁切和壓縮。</p>` : ""}
      <div id="compressStatus"></div>
      <button class="btn" id="backup">備份全部名片</button>
      <p class="hint">會產生一個 .zip 檔（照片＋資料），接著在分享選單選「儲存到檔案」，可以存到 <b>iCloud 雲碟</b>、<b>Google 雲端硬碟</b>（需裝 Google Drive App）或 <b>我的 iPhone</b>。超過 300 張會分成多個檔案。</p>
      <button class="btn secondary" id="restore">從備份還原</button>
      <p class="hint">選擇之前的備份 .zip。已存在的名片會以較新的版本為準，不會重複。</p>

      <div class="section-h">匯出</div>
      <div class="section">
        <button class="add-line" id="csv">匯出 CSV（Excel 可開）</button>
        <button class="add-line" id="vcfAll">匯出全部為 vCard（.vcf 聯絡人檔）</button>
      </div>

      <div class="section-h">分組</div>
      <div class="section" id="groupList">
        ${state.groups.map((g, i) => `<div class="field"><input data-gi="${i}" value="${esc(g)}"><span class="muted">${state.cards.filter((c) => c.group === g).length} 張</span><button class="x" data-gdel="${i}">⊖</button></div>`).join("")}
        <button class="add-line" id="addGroup">＋ 新增分組</button>
      </div>

      <div class="section-h">版型記憶</div>
      ${Object.keys(templates).length ? `
      <details class="section">
        <summary class="field" style="cursor:pointer"><span style="flex:1">已記住 ${Object.keys(templates).length} 間公司的版型</span><span class="muted">展開</span></summary>
        ${Object.entries(templates).sort((a, b) => b[1].updatedAt - a[1].updatedAt).map(([id, t]) => `<div class="field"><div style="flex:1;min-width:0"><div>${esc(t.label)}</div><div class="muted">學了 ${t.count} 張・${esc([...t.keys.domains, t.keys.taxId].filter(Boolean).join("、") || "依公司名稱比對")}</div></div><button class="x" data-tdel="${esc(id)}" aria-label="刪除">⊖</button></div>`).join("")}
      </details>
      <button class="btn danger" id="clearTpl">一鍵清除全部版型</button>` : `<div class="section"><div class="kv"><div class="v muted">還沒有。存過的名片會自動記住公司版型，同公司的下一張就會自動套用。</div></div></div>`}
      <p class="hint">用 Email 網域、統編、網站或公司名稱判斷是不是同一間公司。只會補上這張沒辨識到的欄位，不會覆蓋或重複加入。掃完一批後可以一鍵清除，不影響已存的名片。</p>

      <div class="section-h">AI 整理（選用，Cloudflare Workers AI）</div>
      <div class="section">
        <div class="field"><label>Worker 網址</label><input id="aiUrl" value="${esc(ai.workerUrl)}" placeholder="https://mycards-ai.xxx.workers.dev" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url"></div>
        <div class="field"><label>通行碼</label><input id="aiKey" type="password" value="${esc(ai.appKey)}" placeholder="和 Worker 的 APP_KEY 相同" autocapitalize="off" autocorrect="off"></div>
      </div>
      <button class="btn secondary" id="aiTest">儲存並測試</button>
      <div id="aiStatus"></div>
      <p class="hint">設定後，確認畫面會出現「✨ AI 整理」按鈕。只傳送辨識出的文字，不傳照片。通行碼不會包含在備份檔裡。</p>

      <div class="section-h">辨識引擎</div>
      <div class="section">
        <div class="kv"><div class="k">引擎</div><div class="v">PaddleOCR PP-OCRv5（手機端執行、可離線）</div></div>
      </div>
      ${modelReady
        ? `<div class="status ok"><span>✓ 辨識模型已下載，沒有網路也能辨識。</span></div>`
        : isIOS() && !isStandalone()
          ? `<div class="banner warn">請從主畫面的「名片夾」圖示開啟後再下載模型，避免在 Safari 和主畫面版各存一份（各約 46 MB）。</div>`
          : `<button class="btn secondary" id="preload">預先下載辨識模型（約 46 MB）</button>`}
      <div id="preloadStatus"></div>

      <p class="hint center mt">mycards v${esc(window.APP_VERSION || "dev")}<br>資料只存在這支 iPhone，不會上傳到任何伺服器。</p>
    </div>
    ${tabbar("settings")}`;
  bindTabbar();

  $app.querySelector("#compress")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const todo = state.cards.filter((c) => !c.imgV2 && (c.frontImageId || c.backImageId));
    const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) : null;
    const warn = days === null ? "你還沒備份過！" : days > 0 ? `上次備份是 ${days} 天前。` : "";
    const v = await sheet(`${warn}壓縮 ${todo.length} 張名片的照片？照片會被取代、無法復原。過程中請保持畫面開著，中途關掉也沒關係，下次會從沒壓縮的繼續。`, [
      { label: "開始壓縮", value: "go", danger: !!warn },
      ...(warn ? [{ label: "先去備份", value: "backup" }] : []),
    ]);
    if (v === "backup") { $app.querySelector("#backup").scrollIntoView({ behavior: "smooth" }); return; }
    if (v !== "go") return;
    btn.disabled = true;
    const el = $app.querySelector("#compressStatus");
    const show = (t, cls = "") => { el.innerHTML = `<div class="status ${cls}">${cls ? "" : '<span class="spinner"></span>'}<span>${esc(t)}</span></div>`; };
    let before = 0, after = 0, n = 0;
    const sz = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
    try {
      for (const c of todo) {
        for (const id of [c.frontImageId, c.backImageId]) {
          if (!id) continue;
          const blob = await db.getImage(id);
          if (!blob) continue;
          const out = await compressBlob(blob);
          before += blob.size; after += out.size;
          if (out !== blob) await db.putImage(out, id);
        }
        c.imgV2 = true;
        await db.putCardRaw(c); // 不改動修改時間
        n++;
        if (n % 5 === 0 || n === todo.length) show(`壓縮中… ${n} / ${todo.length}（已省下 ${sz(before - after)}）`);
      }
      show(`完成！${n} 張名片的照片從 ${sz(before)} 壓到 ${sz(after)}，省下 ${sz(before - after)}。`, "ok");
      setTimeout(renderSettings, 4000);
    } catch (err) {
      show(`壓縮到第 ${n} 張時失敗：${err.message}。已壓縮的不受影響，可以再按一次繼續。`, "err");
      btn.disabled = false;
    }
  });
  $app.querySelector("#backup").addEventListener("click", async (e) => {
    if (!state.cards.length) return toast("還沒有名片可以備份");
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { buildBackup } = await import("./backup.js");
      const files = await buildBackup((i, n) => { btn.textContent = `打包中… ${i} / ${n}`; });
      btn.textContent = "備份全部名片";
      let ok = true;
      for (let i = 0; i < files.length; i++) {
        const label = files.length > 1 ? `備份檔 ${i + 1} / ${files.length} 已準備好（${(files[i].size / 1e6).toFixed(0)} MB）` : `備份檔已準備好（${(files[i].size / 1e6).toFixed(1)} MB）`;
        const v = await sheet(label + "。按「儲存」後選「儲存到檔案」。", [{ label: "儲存", value: "go" }]);
        if (!v) { ok = false; break; }
        const saved = await shareOrDownload([files[i]]);
        if (!saved) { ok = false; break; }
      }
      if (ok) { await db.setMeta("lastBackupAt", Date.now()); toast("備份完成"); renderSettings(); }
      else toast("備份未完成");
    } catch (err) {
      toast("備份失敗：" + err.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = "備份全部名片";
    }
  });

  $app.querySelector("#restore").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".zip,application/zip";
    inp.multiple = true;
    inp.onchange = async () => {
      const { restoreBackup } = await import("./backup.js");
      let added = 0, updated = 0, skipped = 0;
      try {
        for (const f of inp.files) {
          const r = await restoreBackup(f, (i, n) => { $app.querySelector("#restore").textContent = `還原中… ${i} / ${n}`; });
          added += r.added; updated += r.updated; skipped += r.skipped;
        }
        await reload();
        toast(`還原完成：新增 ${added}、更新 ${updated}、略過 ${skipped}`, 4000);
      } catch (err) {
        toast("還原失敗：" + err.message, 4000);
      }
      renderSettings();
    };
    inp.click();
  });

  $app.querySelector("#csv").addEventListener("click", async () => {
    const { cardsToCsv, stamp } = await import("./backup.js");
    const file = new File([cardsToCsv(state.cards)], `mycards-${stamp()}.csv`, { type: "text/csv" });
    shareOrDownload([file]);
  });
  $app.querySelector("#vcfAll").addEventListener("click", async () => {
    if (!state.cards.length) return toast("還沒有名片");
    const { cardToVcard, stamp } = await import("./backup.js");
    const parts = [];
    for (const c of state.cards) parts.push(await cardToVcard(c, { withPhoto: false }));
    shareOrDownload([new File([parts.join("\r\n")], `mycards-${stamp()}.vcf`, { type: "text/vcard" })]);
  });

  // 分組
  $app.querySelector("#addGroup").addEventListener("click", async () => {
    const name = (prompt("新分組名稱") || "").trim();
    if (!name || state.groups.includes(name)) return;
    state.groups.push(name);
    await db.setMeta("groups", state.groups);
    renderSettings();
  });
  $app.querySelectorAll("[data-gi]").forEach((inp) => inp.addEventListener("change", async () => {
    const i = +inp.dataset.gi, oldName = state.groups[i], name = inp.value.trim();
    if (!name || state.groups.includes(name)) { inp.value = oldName; return; }
    state.groups[i] = name;
    await db.setMeta("groups", state.groups);
    for (const c of state.cards.filter((x) => x.group === oldName)) { c.group = name; await db.putCard(c); }
    toast("已更名");
  }));
  $app.querySelectorAll("[data-gdel]").forEach((b) => b.addEventListener("click", async () => {
    const g = state.groups[+b.dataset.gdel];
    const n = state.cards.filter((c) => c.group === g).length;
    const v = await sheet(`刪除分組「${g}」？${n ? `裡面的 ${n} 張名片會變成「未分組」（名片不會被刪）。` : ""}`, [{ label: "刪除分組", value: "del", danger: true }]);
    if (v !== "del") return;
    state.groups = state.groups.filter((x) => x !== g);
    await db.setMeta("groups", state.groups);
    for (const c of state.cards.filter((x) => x.group === g)) { c.group = ""; await db.putCard(c); }
    if (state.groupFilter === g) state.groupFilter = "__all";
    renderSettings();
  }));

  $app.querySelector("#clearTpl")?.addEventListener("click", async () => {
    const v = await sheet(`清除全部 ${Object.keys(templates).length} 個版型？已存的名片不受影響，之後存檔會重新學習。`, [{ label: "全部清除", value: "del", danger: true }]);
    if (v !== "del") return;
    await db.setMeta("templates", {});
    toast("已清除全部版型");
    renderSettings();
  });
  $app.querySelectorAll("[data-tdel]").forEach((b) => b.addEventListener("click", async () => {
    const t = { ...templates };
    const v = await sheet(`刪除「${t[b.dataset.tdel]?.label}」的版型？名片不會被刪。`, [{ label: "刪除版型", value: "del", danger: true }]);
    if (v !== "del") return;
    delete t[b.dataset.tdel];
    await db.setMeta("templates", t);
    renderSettings();
  }));

  // AI
  const readAi = () => ({ workerUrl: $app.querySelector("#aiUrl").value.trim(), appKey: $app.querySelector("#aiKey").value.trim() });
  const aiStatus = (t, cls = "") => {
    $app.querySelector("#aiStatus").innerHTML = `<div class="status ${cls}">${cls ? "" : '<span class="spinner"></span>'}<span>${esc(t)}</span></div>`;
  };
  $app.querySelector("#aiTest").addEventListener("click", async (e) => {
    const btn = e.currentTarget; // await 之後 e.currentTarget 會變成 null，要先存起來
    const s = readAi();
    btn.disabled = true;
    try {
      const { saveAiSettings, testAi } = await import("./ai.js");
      await saveAiSettings(s);
      if (!s.workerUrl || !s.appKey) { aiStatus("已儲存，但 Worker 網址或通行碼還沒填，AI 整理不會啟用。", "err"); return; }
      if (!/^https:\/\//.test(s.workerUrl)) { aiStatus("Worker 網址要以 https:// 開頭。", "err"); return; }
      aiStatus("測試中…");
      const r = await testAi(s);
      aiStatus(`連線成功：${r}。確認畫面已出現「✨ AI 整理」按鈕。`, "ok");
    } catch (err) {
      aiStatus("測試失敗：" + err.message, "err");
    } finally {
      btn.disabled = false;
    }
  });

  $app.querySelector("#preload")?.addEventListener("click", async (e) => {
    const el = $app.querySelector("#preloadStatus");
    const btn = e.currentTarget;
    btn.disabled = true;
    const show = (t, cls = "") => { el.innerHTML = `<div class="status ${cls}">${cls ? "" : '<span class="spinner"></span>'}<span>${esc(t)}</span></div>`; };
    try {
      const { getEngine } = await import("./ocr.js");
      await getEngine((s) => show(s));
      show("✓ 辨識模型已下載，沒有網路也能辨識。", "ok");
      btn.remove();
    } catch (err) {
      show("下載失敗：" + err.message, "err");
      btn.disabled = false;
    }
  });
}

// ---------- 路由 ----------
let rendering = Promise.resolve();
function render() {
  rendering = rendering.then(route).catch((e) => { console.error(e); $app.innerHTML = `<div class="wrap"><div class="status err">發生錯誤：${esc(e.message)}</div><button class="btn" onclick="location.hash='#/';location.reload()">回到名片夾</button></div>`; });
}
async function route() {
  const h = location.hash || "#/";
  window.scrollTo(0, 0);
  if (h.startsWith("#/card/")) return renderDetail(h.slice(7));
  if (h.startsWith("#/edit/")) return renderEdit(h.slice(7));
  if (h === "#/review") return state.draft ? renderReview() : go("#/");
  if (h === "#/settings") return renderSettings();
  if (state.draft && !state.batch) state.draft = null;
  return renderList();
}

window.addEventListener("hashchange", render);

// ---------- 啟動 ----------
// iPhone 上用 Safari（不是主畫面圖示）打開時，先顯示「加入主畫面」引導
// 原因：主畫面版和 Safari 的儲存空間是分開的，在 Safari 存的名片和模型，主畫面版看不到
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function showInstallGuide() {
  return new Promise((resolve) => {
    $app.innerHTML = `
      <div class="wrap" style="padding-top:calc(env(safe-area-inset-top) + 40px)">
        <div class="center"><img src="icons/icon-192.png" width="88" height="88" style="border-radius:20px" alt=""></div>
        <h1 class="center" style="font-size:24px;margin:16px 0 4px">把名片夾加到主畫面</h1>
        <p class="center muted">請從主畫面的圖示開啟，名片才會存在同一個地方</p>
        <div class="section" style="padding:6px 0">
          <div class="kv"><div class="k" style="width:22px;font-weight:600;color:var(--accent)">1</div><div class="v">按下 Safari 下方的 <b>分享</b> 按鈕 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;color:var(--accent)"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg>（方框加向上箭頭）</div></div>
          <div class="kv"><div class="k" style="width:22px;font-weight:600;color:var(--accent)">2</div><div class="v">往下滑，選 <b>加入主畫面</b></div></div>
          <div class="kv"><div class="k" style="width:22px;font-weight:600;color:var(--accent)">3</div><div class="v">按右上角 <b>加入</b>，之後從主畫面的「名片夾」圖示開啟</div></div>
        </div>
        <div class="banner warn">⚠️ 主畫面版和 Safari 的資料是分開的。在 Safari 裡存的名片和下載的辨識模型，主畫面版看不到。</div>
        <button class="btn secondary mt" id="stayBrowser">我只是看看，繼續在 Safari 使用</button>
      </div>`;
    $app.querySelector("#stayBrowser").addEventListener("click", () => {
      try { sessionStorage.setItem("stayBrowser", "1"); } catch { /* 無痕模式 */ }
      resolve();
    });
  });
}

(async () => {
  let stay = false;
  try { stay = sessionStorage.getItem("stayBrowser") === "1"; } catch { /* ignore */ }
  if (isIOS() && !isStandalone() && !stay) await showInstallGuide();
  await reload();
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            const bar = document.createElement("div");
            bar.className = "toast";
            bar.innerHTML = '有新版本，<a href="#" id="upd" style="color:#4c9bff">點此更新</a>';
            document.body.appendChild(bar);
            bar.querySelector("#upd").addEventListener("click", (e) => { e.preventDefault(); w.postMessage("skipWaiting"); });
          }
        });
      });
    }).catch((e) => console.warn("SW 註冊失敗", e));
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
})();
