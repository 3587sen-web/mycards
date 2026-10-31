// 備份、還原、匯出 CSV、匯出 vCard（iPhone 聯絡人格式）
import JSZip from "jszip";
import * as db from "./db.js";
import { PHONE_TYPES } from "./parser.js";

const BACKUP_FORMAT = 1;
// 每個 zip 最多放幾張名片：太大的檔案 iPhone 可能分享失敗或記憶體不足
const CARDS_PER_ZIP = 300;

const pad = (n) => String(n).padStart(2, "0");
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * 產生備份檔（可能分成多個 zip）
 * @returns {Promise<File[]>}
 */
export async function buildBackup(onProgress = () => {}) {
  const cards = await db.getAllCards();
  cards.sort((a, b) => a.createdAt - b.createdAt);
  const groups = await db.getMeta("groups", []);
  const templates = await db.getMeta("templates", {});
  const parts = Math.max(1, Math.ceil(cards.length / CARDS_PER_ZIP));
  const name = `mycards-backup-${stamp()}`;
  const files = [];
  let done = 0;
  for (let p = 0; p < parts; p++) {
    const slice = cards.slice(p * CARDS_PER_ZIP, (p + 1) * CARDS_PER_ZIP);
    const zip = new JSZip();
    zip.file("data.json", JSON.stringify({
      app: "mycards", format: BACKUP_FORMAT, exportedAt: new Date().toISOString(),
      part: p + 1, parts, groups, templates, cards: slice,
    }, null, 1));
    const imgDir = zip.folder("images");
    for (const c of slice) {
      for (const id of [c.frontImageId, c.backImageId, c.thumbId]) {
        if (!id) continue;
        const blob = await db.getImage(id);
        if (blob) imgDir.file(`${id}.jpg`, blob);
      }
      done++;
      onProgress(done, cards.length);
    }
    // 照片本身已是 JPEG，不再壓縮（快很多）；JSON 才壓縮
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const fname = parts > 1 ? `${name}-part${p + 1}of${parts}.zip` : `${name}.zip`;
    files.push(new File([blob], fname, { type: "application/zip" }));
  }
  return files;
}

/** 從備份 zip 還原（合併：已存在的名片以較新的為準） */
export async function restoreBackup(file, onProgress = () => {}) {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file("data.json");
  if (!dataFile) throw new Error("這不是 mycards 的備份檔（找不到 data.json）");
  const data = JSON.parse(await dataFile.async("string"));
  if (data.app !== "mycards") throw new Error("這不是 mycards 的備份檔");
  let added = 0, updated = 0, skipped = 0;
  const groups = new Set(await db.getMeta("groups", []));
  (data.groups || []).forEach((g) => groups.add(g));
  await db.setMeta("groups", [...groups]);
  // 版型記憶：同一間公司保留學得比較多的那份
  if (data.templates) {
    const cur = await db.getMeta("templates", {});
    for (const [id, t] of Object.entries(data.templates)) if (!cur[id] || (t.count || 0) > (cur[id].count || 0)) cur[id] = t;
    await db.setMeta("templates", cur);
  }
  for (let i = 0; i < data.cards.length; i++) {
    const c = data.cards[i];
    const existing = await db.getCard(c.id);
    if (existing && (existing.updatedAt || 0) >= (c.updatedAt || 0)) {
      skipped++;
    } else {
      for (const id of [c.frontImageId, c.backImageId, c.thumbId]) {
        if (!id) continue;
        const f = zip.file(`images/${id}.jpg`);
        if (f) await db.putImage(new Blob([await f.async("arraybuffer")], { type: "image/jpeg" }), id);
      }
      await db.putCardRaw(c);
      existing ? updated++ : added++;
    }
    onProgress(i + 1, data.cards.length);
  }
  return { added, updated, skipped, part: data.part, parts: data.parts };
}

// ---------- CSV（Excel 可直接開） ----------
const CSV_COLS = [
  ["name", "姓名"], ["nameEn", "英文姓名"], ["title", "職稱"], ["department", "部門"], ["company", "公司"], ["companyEn", "英文公司名"],
  ["taxId", "統一編號"], ["mobile", "手機"], ["work", "公司電話"], ["fax", "傳真"], ["otherPhone", "其他電話"], ["emails", "Email"],
  ["website", "網站"], ["address", "地址"], ["group", "分組"], ["metPlace", "認識場合"], ["note", "備註"], ["createdAt", "建立日期"],
];

export function cardsToCsv(cards) {
  const q = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [CSV_COLS.map((c) => c[1]).join(",")];
  for (const c of cards) {
    const ph = (t) => (c.phones || []).filter((p) => p.type === t).map((p) => p.value).join(" / ");
    const v = {
      ...c,
      mobile: ph("mobile"), work: ph("work"), fax: ph("fax"), otherPhone: ph("other"),
      emails: (c.emails || []).join(" / "),
      createdAt: c.createdAt ? new Date(c.createdAt).toLocaleString("zh-TW", { hour12: false }) : "",
    };
    rows.push(CSV_COLS.map(([k]) => q(v[k])).join(","));
  }
  // 開頭加 BOM，Excel 才會用 UTF-8 正確顯示中文
  return "\uFEFF" + rows.join("\r\n");
}

// ---------- vCard 3.0 ----------
const vEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function cardToVcard(c, { withPhoto = true } = {}) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const name = c.name || c.nameEn || c.company || "未命名";
  // 中文姓名：第一個字當姓（複姓無法判斷，iPhone 顯示時仍會用 FN 全名）
  if (c.name && /^[\u3400-\u9fff]{2,4}$/.test(c.name)) lines.push(`N:${vEsc(c.name.slice(0, 1))};${vEsc(c.name.slice(1))};;;`);
  else lines.push(`N:${vEsc(name)};;;;`);
  lines.push(`FN:${vEsc(name)}`);
  if (c.company || c.department) lines.push(`ORG:${vEsc(c.company)}${c.department ? ";" + vEsc(c.department) : ""}`);
  if (c.title) lines.push(`TITLE:${vEsc(c.title)}`);
  const typeMap = { mobile: "CELL", work: "WORK,VOICE", fax: "WORK,FAX", other: "VOICE" };
  for (const p of c.phones || []) lines.push(`TEL;TYPE=${typeMap[p.type] || "VOICE"}:${vEsc(p.value)}`);
  for (const e of c.emails || []) lines.push(`EMAIL;TYPE=INTERNET,WORK:${vEsc(e)}`);
  if (c.website) lines.push(`URL:${vEsc(/^https?:/i.test(c.website) ? c.website : "https://" + c.website)}`);
  if (c.address) lines.push(`ADR;TYPE=WORK:;;${vEsc(c.address)};;;;`);
  const note = [c.nameEn && `英文名：${c.nameEn}`, c.metPlace && `認識場合：${c.metPlace}`, c.note, "（由 mycards 名片夾匯出）"].filter(Boolean).join("\n");
  lines.push(`NOTE:${vEsc(note)}`);
  if (withPhoto && c.thumbId) {
    const blob = await db.getImage(c.thumbId);
    if (blob) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${await blobToBase64(blob)}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export { PHONE_TYPES };
