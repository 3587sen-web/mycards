// 簡體字 → 繁體字（台灣用字）
// OCR 模型同時認得簡繁體，偶爾會把「曉」讀成「晓」。辨識完統一轉回繁體。
// 轉換字典約 1 MB，第一次用到才下載，之後離線可用。

let convPromise = null;
function getConverter() {
  if (!convPromise) {
    convPromise = import("opencc-js/cn2t").then((m) => m.Converter({ from: "cn", to: "tw" }));
  }
  return convPromise;
}

// 這些字在台灣本來就常用，不要被換成異體字（例如「台北」不要變「臺北」）
const KEEP = new Set(["台"]);

export function makeToTraditional(conv) {
  return (text) => {
    const s = String(text ?? "");
    if (!/[㐀-鿿]/.test(s)) return s;
    const out = conv(s);
    if (out.length !== s.length) return out;
    let r = "";
    for (let i = 0; i < s.length; i++) r += KEEP.has(s[i]) ? s[i] : out[i];
    return r;
  };
}

export async function toTraditional(text) {
  return makeToTraditional(await getConverter())(text);
}

/** OCR 每一行轉繁體（失敗就原樣回傳，不影響辨識） */
export async function linesToTraditional(lines) {
  try {
    const f = makeToTraditional(await getConverter());
    return lines.map((l) => ({ ...l, text: f(l.text) }));
  } catch (e) {
    console.warn("簡轉繁失敗", e);
    return lines;
  }
}
