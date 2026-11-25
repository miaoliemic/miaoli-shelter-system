// ===== 設定：LIFF ID 與 API 網址。正式網址（GitHub Pages）一律用真資料；本機預覽才載入 mock.js 的模擬資料 =====
// 物資、居民、本所三個畫面共用同一個 Make 情境（13），免費方案只能啟用兩個情境（11 聊天室＋13）
const CONFIG = { liffId: "2012049994-PV1Y181j", apiUrl: "https://hook.us2.make.com/7t41m917ehb6cazsap56tygu0am7gi9x" };
// 只有在正式網址（GitHub Pages）才啟動 LIFF；本機預覽時略過
const IN_LIFF_HOST = location.hostname.endsWith("github.io");
// 弱點掃描模式（?scan=1）：正式網址也不登入 LINE、不連後端，改用 mock.js 的模擬資料；
// 同一個分頁之後切換畫面都維持掃描模式。掃描結束後移除這段
const SCAN = (() => {
  const on = new URLSearchParams(location.search).get("scan") === "1";
  try { if (on) sessionStorage.setItem("scan", "1"); return sessionStorage.getItem("scan") === "1"; } catch (e) { return on; }
})();

const MODES = { in: "入庫", out: "發放", count: "盤點" };
const ACCENT = { in: "var(--green)", out: "var(--blue)", count: "var(--amber)" };

const wait = ms => new Promise(r => setTimeout(r, ms));

// ===== 正式後端：Make 情境 13（物資 API）。用表單格式送出，瀏覽器不會先送 CORS 預檢 =====
class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
// 後端把姓名、收容所名稱等自由文字 URL 編碼後才放進 JSON（Make 沒有 JSON 跳脫函式），這些欄位在這裡解碼
const ENC_KEYS = new Set(["name", "opening", "staff", "area", "line", "tag", "unit", "phone", "event", "addr", "sum"]);
const safeDecode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
function decodeFields(o) {
  // Make 搜尋 0 筆時，彙整模組仍會吐出一筆「每個欄位都空白」的資料（例如沒有事件卻顯示 1 件「無」）：有 id 欄位但 id 是空的就丟掉
  if (Array.isArray(o)) return o.filter(x => !(x && typeof x === "object" && "id" in x && !x.id)).map(decodeFields);
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) o[k] = ENC_KEYS.has(k) && typeof o[k] === "string" ? safeDecode(o[k]) : decodeFields(o[k]);
  }
  return o;
}
async function post(fields) {
  // 送 Access Token：每次開啟 LIFF 都會更新、有效 12 小時；Make 會向 LINE 確認它屬於本系統並取得使用者編號
  const token = liff.getAccessToken();
  if (!token) throw new ApiError("no_token");
  const body = new URLSearchParams({ ...fields, t: token });
  const res = await fetch(CONFIG.apiUrl, { method: "POST", body });
  let data;
  try { data = decodeFields(await res.json()); } catch (e) { throw new ApiError("server"); }
  if (!data.ok) throw new ApiError(data.error || "server");
  return data;
}
// Notion 欄位值（Make 原樣轉出的 properties_value）轉成一般文字或數字
const txt = v => Array.isArray(v) ? v.map(x => x.plain_text || (x.text && x.text.content) || x.name || "").join("") : (v && v.name) || (typeof v === "string" ? v : "");
const num = v => typeof v === "number" ? v : (v && typeof v.number === "number" ? v.number : 0);
const photo = v => { const f = Array.isArray(v) && v[0]; return f ? ((f.file && f.file.url) || (f.external && f.external.url) || f.url || "") : ""; };
// 物資代碼：SUP- 加 5 碼（去掉容易看錯的 0、O、1、I），印在物資標籤 QR 上
function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = new Uint32Array(5);
  crypto.getRandomValues(r);
  return "SUP-" + Array.from(r, x => A[x % A.length]).join("");
}
// 號碼牌編號：MLS- 加 5 碼（同簽到代碼的字元，去掉 0 O 1 I L），由頁面產生、後端寫入
function newTagCode(used) {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", r = new Uint32Array(5);
  for (;;) { crypto.getRandomValues(r); const c = "MLS-" + Array.from(r, x => A[x % A.length]).join(""); if (!used.has(c)) return c; }
}
const real = {
  // o：社會處檢視某一所時指定開設（後端只對社會處接受這個參數）
  async load(o) {
    const d = await post({ a: "load", ...(o ? { o } : {}) });
    const items = (d.items || []).map(r => {
      const p = r.properties_value || {};
      const unit = txt(p["單位"]) || "個", pack = txt(p["包裝單位"]);
      return { id: r.id, code: txt(p["物資代碼"]), name: txt(p["品名"]), cat: txt(p["類別"]) || "其他",
               unit, pack: pack === unit ? "" : pack, per: num(p["每包裝數量"]) || 1,
               stock: num(p["目前庫存"]), safety: num(p["安全庫存"]), photo: photo(p["品項照片"]) };
    }).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
    return { me: { ...d.me, onDuty: true, event: "" }, items, recent: S.recent || [] };
  },
  async resident(tag) {
    const d = await post({ a: "resident", tag });
    if (d.found !== "yes") return null;
    return { id: d.residentId, name: d.name, note: d.status, inShelter: d.tagStatus !== "失效" && d.status === "在所" };
  },
  async addItem(f) {
    const code = newCode();
    const d = await post({ a: "addItem", name: f.name, unit: f.unit, pack: f.pack || "", per: String(f.per || 1),
                           cat: f.cat || "其他", safety: String(f.safety || 0), code });
    return { id: d.itemId, code, name: f.name, cat: f.cat, unit: f.unit, pack: f.pack, per: f.per || 1, stock: 0, safety: f.safety || 0 };
  },
  async submit(requestId, lines) {
    const d = await post({ a: "submit", r: requestId, g: S.recip && S.recip.kind === "resident" ? S.recip.id : "",
                           u: S.recip && S.recip.kind === "public" ? "public" : "", w: recipName(),
                           l: JSON.stringify({ lines: lines.map(l => ({ ...l, name: S.items.find(x => x.id === l.itemId).name })) }) });
    if (d.duplicate) return { duplicate: true, results: [] };
    const now = new Date(), t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    for (const l of lines) {
      const it = S.items.find(x => x.id === l.itemId);
      S.recent.unshift({ t, text: `${it.name} ${l.type} ${l.note}` + (l.type === "發放" && S.recip ? `・${recipName()}` : "") });
    }
    return { results: (d.results || []).map(r => ({ itemId: r.itemId, ok: true, stock: r.stock })) };
  },
  // 居民：號碼牌狀態（none 不是本所｜blank 空白牌｜used 使用中＋居民｜void 失效）
  async tagInfo(tag) { return await post({ a: "tagInfo", tag }); },
  // 產生空白號碼牌（管理者，本所）。社會處走 hq("hqTags", { s 收容所主檔 ID, tg })。回傳實際建立的編號
  async addTags(codes) { const d = await post({ a: "addTags", tg: codes.join(",") }); return String(d.tags || "").split(",").filter(Boolean); },
  async register(f) { return await post({ a: "register", ...f }); },
  // dest：離所去向（返家、投靠親友…），結報統計安全撤離用
  async move(tag, kind, hours, dest) { return await post({ a: "move", tag, kind, hours: String(hours || ""), dest: dest || "" }); },
  // 本所：status 狀況｜report 記錄事件｜update 寫紀錄・解決（claim 舊版保留）｜prep 整備回報｜prepDone 送出整備完成
  async ops(a, f) { return await post({ a, ...(f || {}) }); },
  // 一般畫面：info 收容所資訊｜me 我的狀態｜apply 申請開通｜feedback 我要反映｜signout 簽退
  async pub(a, f) { return await post({ a, ...(f || {}) }); },
  // 社會處（hq.js）：hqInit 指揮台資料｜hqOpen 開設｜hqApps 申請清單｜hqApprove 核准｜hqReject 不核准｜hqSites 各所現況｜
  // hqClose 撤收（社會處，或本所在班的管理者）｜hqFinish 結案｜hqReport 結報原始資料
  async hq(a, f) { return await post({ a, ...(f || {}) }); },
};
let api = null;               // 正式網址用 real；本機預覽載入 mock.js 後改用模擬資料
let REAL = false;

// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const PUB_VIEWS = ["info", "report", "sos", "staff", "signout"];
// 手機存 PDF 用的列印頁（?v=printqr｜printrep#資料）：在手機瀏覽器開啟，不登入 LINE、不連後端
const PRINT_VIEWS = ["printqr", "printrep", "printitem", "printtag"];
const S = {
  me: null, items: [], recent: [],
  mode: "in", cat: "全部", q: "",
  focusCode: params.get("item"),      // 掃物資標籤進來：只顯示該品項
  showAll: !params.get("item"),
  tag: params.get("tag"),             // 從聊天室掃號碼牌「領物資」進來：只能發放，一開始就帶好領取人
  // 發放對象：{ kind: "resident", tag, id, name, note } 或 { kind: "public" }。
  // 以最後掃到的號碼牌為準：掃錯了直接掃正確的那張就好，不用先取消。一位家人可以代領全家（數量不設限）
  recip: null,
  // 居民頁面：掃號碼牌 QR（?r=MLS-xxxxx）進來。view＝resident 顯示居民；supply 是物資
  // 一般畫面（?v=info｜report｜sos｜staff｜signout）：圖文選單直接打開，不需要在班
  // 結報（?v=report&o=…）：和民眾的「我要反映」（?v=report）同名，帶 o 的才是結報
  view: params.get("r") ? "resident" : params.get("v") === "report" && params.get("o") ? "final" : PRINT_VIEWS.includes(params.get("v")) ? params.get("v") : PUB_VIEWS.includes(params.get("v")) || HQ_VIEWS.includes(params.get("v")) || params.get("v") === "ops" ? params.get("v") : "supply",
  hqO: params.get("v") === "ops" ? params.get("o") : null,   // 社會處從「各所現況」點進來看某一所（只能看，撤收・結案除外）
  finO: params.get("v") === "report" ? params.get("o") : null,   // 結報畫面的開設 ID
  finAuto: params.get("v") === "report" && params.get("fin") === "1",   // 從「完成撤收並結案」過來：載完直接結案（確認已在前一步問過）
  hqItems: null,
  pub: { info: null, me: null, msg: "", done: "", form: { cat: "", o: "", where: "", text: "" }, ap: { name: "", unit: "", phone: "" } },
  ops: null, opsShow: "", reportRes: null,   // 本所畫面的資料、展開的名單、記錄事件時帶入的居民
  rtag: params.get("r"), rinfo: null, rform: null, rmsg: "",
  guest: params.get("as") === "guest",
  pick: {},                           // itemId → { qty, unit }
  errs: {},                           // itemId → 錯誤訊息（送出失敗的留在頁面上）
  busy: false,
};
if (S.tag) S.mode = "out";

const $ = s => document.querySelector(s);
const recipName = () => !S.recip ? "" : S.recip.kind === "public" ? "公共用途" : S.recip.name;
// 「給 王小明」或「・公共用途」
const toWho = () => !S.recip ? "" : S.recip.kind === "public" ? "・公共用途" : `給 ${S.recip.name}`;
// 沒有值（null、undefined，或後端轉出的字串 "null"）顯示「無」；數字 0 照常顯示
const isNone = v => v == null || v === "" || v === "null" || v === "undefined";
const nz = v => isNone(v) ? "無" : v;
const esc = s => String(s == null || s === "null" || s === "undefined" ? "無" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 寫入畫面一律經過 DOMPurify（業界標準的 HTML 過濾，資安掃描認得）：資料本身已用 esc() 跳脫，這裡再擋一層。
// SANITIZE_DOM 關閉：本頁的 id（例如 close）會和 document 的屬性同名，開著會被拿掉、按鈕失效
const PURIFY = { SANITIZE_DOM: false };
// CSP 不允許 style 屬性（style-src 無 'unsafe-inline'）：解析前把 style 改名成 data-css，放進畫面後再用 CSSOM 套用；
// 漏網的 style 屬性在消毒時直接移除
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => { if (data.attrName === "style") data.keepAttr = false; });
function setHTML(el, html) {
  el.innerHTML = DOMPurify.sanitize(String(html).replace(/(\s)style="/g, '$1data-css="'), PURIFY);
  for (const n of el.querySelectorAll("[data-css]")) { n.style.cssText = n.dataset.css; n.removeAttribute("data-css"); }
}
// 「載入中…」「送出中…」等等待文字：結尾的「…」自動換成三個會跳的點（不用逐一改各畫面）
// 用 MutationObserver 抓畫面上新出現、以「中…」結尾的文字，包成 <span class="ldots">
const LOADING_RE = /中…$/;
function animateDots(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => LOADING_RE.test(n.nodeValue.trim()) && !n.parentNode.closest(".ldots") ? 1 : 3 });
  const hits = []; while (w.nextNode()) hits.push(w.currentNode);
  for (const n of hits) {
    const t = n.nodeValue.replace(/…(\s*)$/, "$1");
    const sp = document.createElement("span"); sp.className = "ldots"; sp.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) { const d = document.createElement("i"); d.textContent = "."; sp.append(d); }
    n.nodeValue = t; n.after(sp);
  }
}
new MutationObserver(ms => { for (const m of ms) animateDots(m.type === "characterData" ? m.target.parentNode : m.target); })
  .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 2600); }
// 庫存文字：有包裝單位就把兩種單位都寫出來，例：庫存 50 瓶（2 箱＋2 瓶）、庫存 1 瓶（0 箱＋1 瓶）
// 工作人員的物資頁、本所畫面、社會處看該所，全部用這一個函式，顯示一定一致
function stockText(it) {
  const s = it.stock;
  const both = it.pack && it.per > 1 && s >= 0 ? `（${Math.floor(s / it.per)} ${it.pack}＋${s % it.per} ${it.unit}）` : "";
  return `庫存 ${s} ${it.unit}${both}${it.stock < it.safety ? `，低於安全庫存 ${it.safety} ${it.unit}` : ""}`;
}
function base(it, p) { return p.unit === it.pack && it.pack ? p.qty * it.per : p.qty; }
function lines() {
  return Object.entries(S.pick).filter(([, p]) => p.qty !== "" && p.qty != null && (S.mode === "count" || p.qty > 0)).map(([id, p]) => {
    const it = S.items.find(x => x.id === id), n = base(it, p);
    if (S.mode === "count") { const d = n - it.stock; return { it, p, qty: d, type: "盤點調整", note: `實點 ${n} ${it.unit}（${d >= 0 ? "+" : ""}${d}）` }; }
    return { it, p, qty: n, type: MODES[S.mode], note: `${p.qty} ${p.unit}` };
  }).filter(l => S.mode !== "count" || l.qty !== 0);
}

// ===== 畫面 =====
const TAB_TITLE = { ops: "本所總覽", resident: "居民進出管理", supply: "物資收發管理" };   // 和 title.js 一致
function render() {
  if (PRINT_VIEWS.includes(S.view)) return renderPrintView();
  document.body.classList.toggle("ops", S.view === "ops");
  document.body.classList.toggle("final", S.view === "final");
  if (S.view === "final") return renderFinal();
  // 本所三個分頁在同一頁切換，標題跟著換（社會處看某一所時，renderOps 會換成該所名稱）
  if (TAB_TITLE[S.view] && !S.hqO) document.title = TAB_TITLE[S.view];
  document.body.classList.toggle("pub", PUB_VIEWS.includes(S.view) || HQ_VIEWS.includes(S.view));
  if (HQ_VIEWS.includes(S.view)) return renderHq();
  if (PUB_VIEWS.includes(S.view)) return renderPub();
  document.documentElement.style.setProperty("--accent", ACCENT[S.mode]);
  const app = $("#app");
  if (S.guest || (S.me && !S.me.onDuty && !S.hqO)) {
    setHTML(app, `<div class="blocked"><h2>這個頁面限在班的工作人員使用</h2><p>請先到服務台掃「工作人員簽到 QR」簽到。</p></div>`);
    $("#bar").hidden = false; $("#bar .in").hidden = true; return;
  }
  if (S.view === "resident") return renderResident();
  if (S.view === "ops") return renderOps();
  if (!S.me) { setHTML(app, `<div class="blocked"><p>載入中…</p></div>`); return; }
  const focus = S.focusCode && S.items.find(x => x.code === S.focusCode);
  const cats = ["全部", ...new Set(S.items.map(x => x.cat))];
  const shown = S.items.filter(x => (S.cat === "全部" || x.cat === S.cat) && (!S.q || x.name.includes(S.q)) && x !== focus);
  const lockOut = !!S.tag;
  setHTML(app, `
  <header>
    ${tabs()}<div class="title"><h1>${esc(S.me.opening)}・物資收發管理</h1><button class="iconbtn" id="reload" aria-label="重新整理">↻</button></div>
    <div class="sub">${esc(S.me.event)}　經手人：${esc(S.me.name)}</div>
    ${focus && !S.showAll ? "" : `<div class="seg">${Object.entries(MODES).map(([k, v]) => `<button data-mode="${k}" class="${S.mode === k ? "on" : ""}" ${lockOut && k !== "out" ? "disabled" : ""}>${v}</button>`).join("")}</div>`}
    <div class="hint">${S.mode === "count" ? "填「實際點到的數量」，系統自動算出差額。沒點的品項留空。" : S.mode === "out" ? "填要發出去的數量，可一次填多項。物資標籤和居民號碼牌都用「掃描」，先掃哪個都可以。" : "填收到的數量，可切換瓶或箱，一次填多項。"}</div>
    ${focus && !S.showAll ? "" : `<div class="tools"><input id="q" placeholder="搜尋品名" value="${esc(S.q)}"><button class="scan" id="scan">掃描</button></div>
    <div class="chips">${cats.map(c => `<button data-cat="${esc(c)}" class="${S.cat === c ? "on" : ""}">${esc(c)}</button>`).join("")}</div>`}
  </header>
  ${S.mode === "out" ? recipBar() : ""}
  ${focus ? `<div class="focus"><h2>${esc(focus.name)}</h2><div class="stock">${stockText(focus)}</div>
     ${lockOut ? "" : `<div class="big"><button data-mode="in" class="${S.mode === "in" ? "on" : ""}">入庫</button><button data-mode="out" class="${S.mode === "out" ? "on" : ""}">發放</button></div>`}
     ${rowCtrl(focus)}</div>
     ${S.showAll ? "" : `<button class="showall" id="showall">顯示全部品項</button>`}` : ""}
  ${S.showAll ? `<div class="list">${shown.map(it => `<div class="row ${it.stock < it.safety ? "low" : ""} ${S.pick[it.id] && S.pick[it.id].qty !== "" ? "picked" : ""}" data-id="${it.id}">
      <div class="top"><div class="name">${esc(it.name)}${it.stock < it.safety ? " ⚠" : ""}</div>${it.code ? `<button class="lbl" data-label="${it.id}" aria-label="${esc(it.name)}的物資標籤">標籤</button>` : ""}</div>
      <div class="stock">${stockText(it)}</div>${rowCtrl(it)}</div>`).join("") || `<div class="row">找不到符合的品項</div>`}
    ${(S.me.role || "").includes("管理者") && !lockOut ? `<button class="addnew" id="addnew">＋ 新增品項</button>` : ""}
    ${S.items.some(x => x.code) ? `<button class="addnew" id="allLabels">🏷 列印全部物資標籤</button>` : ""}</div>` : ""}
  ${S.recent.length ? `<div class="recent"><h3>${REAL ? "這次登記" : "本所最近登記"}</h3>${S.recent.slice(0, 5).map(r => `<div>${esc(r.t)}　${esc(r.text)}</div>`).join("")}</div>` : ""}`);
  renderBar();
}
// ===== 分頁：本所｜居民｜物資 =====
function tabs() {
  return `<nav class="tabs">${[["ops", "本所總覽"], ["resident", "居民進出管理"], ["supply", "物資收發管理"]].map(([k, t]) => `<button data-tab="${k}" class="${S.view === k ? "on" : ""}">${t}</button>`).join("")}</nav>`;
}

// ===== 本所畫面：知道（狀況、名單、待處理事項）、記錄、處理 =====
const CATS = ["緊急事件", "重大事件", "人員相關", "物資相關", "設施環境", "交班紀錄"];
const SEV_OF = { 緊急事件: "緊急", 重大事件: "高", 交班紀錄: "低" };
const SEVS = ["緊急", "高", "中", "低"];
const PREP = ["場地清潔", "水電設備", "安全檢查", "寢具", "醫療物資"];
const sevRank = e => { const i = SEVS.indexOf(e.sev); return i < 0 ? SEVS.length : i; };   // 沒填嚴重程度的排最後
const isOpen = e => !/已解決|已結案/.test(e.status);
function staffName(id) { const d = S.ops && S.ops.duty.find(x => x.id === id); return d ? d.name : ""; }
// 負責人：在班的從名單找；已簽退的從處理紀錄裡最後一筆「MM/DD HH:mm 姓名 認領處理」取姓名
function ownerName(e) {
  const n = staffName(e.owner); if (n) return n;
  // 處理紀錄裡最後一筆「認領處理」或「接手處理」（社會處接手寫成「社會處 姓名 接手處理」）
  const m = [...(e.log || "").matchAll(/\d{2}\/\d{2} \d{2}:\d{2} (.+?) (?:認領處理|接手處理)/g)].pop();
  return m ? m[1] : "";
}
// 社會處交辦、指示或接手過：事件清單上加一個標記，現場一眼看到
const fromHq = e => e.src === "社會處" || /\d{2}\/\d{2} \d{2}:\d{2} 社會處 .+? (?:指示|接手處理)/.test(e.log || "");
const hqMark = e => fromHq(e) ? `<span class="own hq">📣 社會處</span>` : "";
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60e3);
  return isNaN(m) ? "" : m < 1 ? "剛剛" : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.floor(m / 60)} 小時前` : fmtTime(iso);
}
function openEvents() {
  return (S.ops ? S.ops.events : []).filter(e => isOpen(e) && !(e.cat === "整備回報" && !e.item && String(e.title || "").startsWith("整備完成")))
    .sort((a, b) => sevRank(a) - sevRank(b) || new Date(b.at) - new Date(a.at));
}
// 居民反映：「我要反映」來源＝民眾反映（舊資料：日誌類別＝居民反映，且標題不是「反映（工作人員／志工）」）
const fromResident = e => e.src === "民眾反映" || (e.cat === "居民反映" && !/^反映（(工作人員|志工)）/.test(String(e.title || "")));
function renderOps() {
  const app = $("#app"), d = S.ops;
  document.documentElement.style.setProperty("--accent", "var(--blue)");
  $("#bar").hidden = false; $("#bar .in").hidden = false;
  const o = d && d.opening, ro = !!S.hqO;   // ro：社會處檢視，只能看
  if (ro) { $("#bar").hidden = REAL; $("#bar .in").style.display = "none"; document.title = (o && o.name) || "各所現況"; }
  const head = ro ? `<header><div class="title"><button class="iconbtn" id="hqBack" aria-label="回各所現況">‹</button><h1>${esc((o && o.name) || "收容所")}</h1>
      <button class="iconbtn" id="opsReload" aria-label="重新整理">↻</button></div>
    <div class="sub">${o ? `${esc(o.stage)}　${esc(o.light || "")}` : ""}</div></header><div class="hqbanner" style="margin-top:10px">社會處檢視中（現場操作由該所工作人員處理；撤收、結案在最下方）</div>`
    : `<header>${tabs()}<div class="title"><h1>${esc((o && o.name) || (S.me && S.me.opening) || "本所")}・本所總覽</h1>
      <button class="iconbtn" id="opsReload" aria-label="重新整理">↻</button></div>
    <div class="sub">${o ? `${esc(o.stage)}　${esc(o.light || "")}　` : ""}經手人：${esc((d && d.me.name) || "")}</div></header>`;
  if (!d) { setHTML(app, head + `<div class="blocked"><p>${esc(S.rmsg || "讀取本所狀況中…")}</p></div>`); $("#sum").textContent = ""; $("#go").textContent = "＋記錄事件"; return; }
  const evs = openEvents(), urgent = evs.filter(e => e.sev === "緊急").length;
  const stat = (k, n, label, cls) => `<button class="stat ${cls || ""}" data-show="${k}"><b>${n}</b><span>${label}</span></button>`;
  let body = "";
  if (o.stage === "整備中" && !ro) body += prepView(d);
  if (o.stage === "待核准" && !ro) body += `<div class="rcard"><b>已送出整備完成</b><div class="meta">等社會處核准開放進駐。核准後這裡會改顯示開設中的狀況。</div></div>`;
  if (o.stage === "撤收中") body += `<div class="rcard"><b>撤收中</b><div class="meta">不再接受新的報到；外出、返回、離所、物資、事件、簽退照常。${ro ? "居民都離所後，按最下方「完成撤收（結案並產生結報）」。" : "等社會處結案。"}</div></div>`;
  // 社會處檢視才能點「在所」看全部居民（工作人員的本所狀況只回外出、未返、需關懷的人，維持原樣）
  // 數字分兩組：居民現況（人在哪、誰要照顧）＋收容所現況（事件、人力）；點居民的數字展開的名單接在居民現況下面
  body += `<div class="sec">居民現況</div><div class="stats">${stat(ro ? "all" : "", `${o.inside}<small style="font-size:0.8125rem">／${o.capacity}</small>`, "在所／容量")}
    ${stat("out", o.out, "外出", o.out ? "warn" : "")}${stat("late", o.late, "未返", o.late ? "alert" : "")}
    ${stat("care", o.care, "需關懷", o.care ? "warn" : "")}</div>`;
  const siteStats = `<div class="sec">收容所現況</div><div class="stats">${stat("", evs.length, urgent ? `待處理・緊急 ${urgent}` : "待處理事件", urgent ? "alert" : evs.length ? "warn" : "")}
    ${(() => {   // 在班人數：沒有「足額」標準，所以只顯示現在有幾人，不算缺幾人
      const vol = d.duty.filter(x => x.kind === "志工").length, staff = d.duty.length - vol;
      return stat("", d.duty.length, `在班人數<br><small>工作人員 ${staff}・志工 ${vol}</small>`);
    })()}</div>`;
  if (S.opsShow) {
    const rs = d.residents.filter(r => S.opsShow === "all" ? true : S.opsShow === "care" ? r.care : r.status === (S.opsShow === "late" ? "未返" : "外出"));
    const meta = r => S.opsShow === "all" ? [r.status, r.care].filter(Boolean).join("・") : S.opsShow === "care" ? r.care : r.back ? `預計 ${fmtTime(r.back)}` : "";
    body += `<div class="sec">${{ all: "居民名單", out: "外出中", late: "未返", care: "需關懷" }[S.opsShow]} <small>${rs.length} 人</small></div>
      <div class="plist">${rs.map(r => `<div class="prow"><span class="n">${esc(r.name)}</span><span class="meta">${esc(meta(r))}</span></div>`).join("") || `<div class="prow">沒有</div>`}</div>`;
  }
  body += siteStats;
  body += `<div class="sec">在班人員 <small>${d.duty.length} 人</small></div><div class="chips2">${d.duty.map(x => `<span>${esc(x.name)}${x.kind === "志工" ? "（志工）" : x.role ? `・${esc(x.role.replace("（收容所負責人）", ""))}` : ""}</span>`).join("")}</div>`;
  // 待處理事件分兩組：工作人員回報的優先看，居民反映（跟個人有關）放後面；各組裡緊急的排最上面
  const evtBtn = e => {
    const own = !e.owner ? `<span class="own free">還沒有人處理</span>` : e.owner === d.me.id ? `<span class="own mine">我負責</span>` : `<span class="own">${esc(ownerName(e) || "其他人")}處理中</span>`;
    return `<button class="evt ${esc(e.sev)}" data-evt="${esc(e.id)}"><div class="t">${esc(nz(e.title))}</div>${whoLine(e)}
        <div class="m"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>${own}${hqMark(e)}<span>${esc(ago(e.at))}</span></div></button>`;
  };
  // 工作人員回報組：社會處交辦／指示的排最上面，其次照原本的嚴重程度、時間
  const staffEvs = evs.filter(e => !fromResident(e)).sort((a, b) => fromHq(b) - fromHq(a)), resEvs = evs.filter(fromResident);
  body += `<div class="sec">待處理事件 <small>${evs.length} 件，工作人員回報優先，緊急的排最上面</small></div>`
    + (evs.length ? `<div class="evgrp">工作人員回報 <small>${staffEvs.length} 件</small></div>${staffEvs.map(evtBtn).join("") || `<div class="hint evnone">沒有</div>`}
      <div class="evgrp res">居民反映 <small>${resEvs.length} 件</small></div>${resEvs.map(evtBtn).join("") || `<div class="hint evnone">沒有</div>`}`
      : `<div class="hint" style="margin:0 16px">目前沒有待處理事件。</div>`);
  if (S.hqItems) {
    const low = S.hqItems.filter(it => it.stock < it.safety);
    body += `<div class="sec">物資庫存 <small>${low.length ? `${low.length} 項低於安全庫存` : "都在安全庫存以上"}</small></div>
      <div class="plist">${[...low, ...S.hqItems.filter(it => !low.includes(it))].map(it => `<div class="prow stk ${it.stock < it.safety ? "low" : ""}"><span class="n">${esc(it.name)}${it.stock < it.safety ? " ⚠" : ""}</span><span class="meta">${esc(stockText(it))}</span></div>`).join("") || `<div class="prow">沒有品項</div>`}</div>`;
  }
  // 加印空白號碼牌：開設後人數變多、空白牌不夠時用（管理者；社會處在指揮台的「居民號碼牌」產生）
  if (!ro && d.opening.stage === "開設中" && /管理者/.test(d.me.role || "")) {
    const last = lastTags();
    body += `<div class="sec">居民號碼牌</div><div class="biglinks rbtns">
      <button class="biglink" id="mkTags"><span class="ic">🏷</span><span>加印空白號碼牌<small>空白牌不夠時，產生新的號碼牌並列印</small></span></button>
      ${last ? `<button class="hq-go ghost" id="lastTags">🖨 重印上次產生的號碼牌（${esc(last.p)}・${last.c.length} 張）</button>` : ""}</div>`;
  }
  body += closeActs(d, ro);
  setHTML(app, head + body);
  if (ro) return;
  setHTML($("#sum"), evs.length ? `待處理 <b>${evs.length}</b>${urgent ? `・緊急 <b>${urgent}</b>` : ""}` : "沒有待處理事件");
  $("#go").textContent = "＋記錄事件"; $("#go").disabled = false;
}
function prepView(d) {
  const latest = item => d.events.filter(e => e.cat === "整備回報" && e.item === item).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  const rows = PREP.map(item => {
    const e = latest(item), st = !e ? "未回報" : e.status === "已解決" ? "✅ 完成" : "⚠ 有問題";
    return `<div class="prow"><span class="n">${esc(item)}</span><span class="meta">${st}</span>
      <button data-prep="${esc(item)}" data-res="已完成">完成</button><button data-prep="${esc(item)}" data-res="有問題">有問題</button></div>`;
  }).join("");
  const allDone = PREP.every(i => { const e = latest(i); return e && e.status === "已解決"; });
  const mgr = /管理者/.test(d.me.role || "");
  return `<div class="sec">整備清單 <small>每項回報完成或有問題</small></div><div class="plist">${rows}</div>
    ${mgr ? `<div class="ract"><button class="main" id="prepDone" ${allDone ? "" : "disabled style=\"opacity:.4\""}>送出整備完成（申請開放進駐）</button></div>
    ${allDone ? "" : `<div class="hint" style="margin:6px 16px 0">五項都完成後才能送出。</div>`}` : ""}`;
}
// 撤收・結案按鈕列：只有社會處能撤收、結案（開設中→撤收、撤收中→結案、隨時看結報）。
// 現場管理者不撤收，改成「撤收準備回報」：清點、打掃都完成後回報社會處可以撤收（資訊回報，不改開設狀態）
const READY_ITEMS = ["居民都已離所或轉介", "剩餘物資已盤點，系統數量正確", "場地已打掃、恢復原狀", "借用設備（床墊、桌椅、延長線等）已歸還或歸位"];
const readyLog = d => (d.events || []).filter(e => e.cat === "整備回報" && String(e.title || "").startsWith("撤收準備回報")).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
const readyBox = e => `<div class="rcard ready"><b>📋 現場已回報：可以撤收</b><div class="meta">${esc(fmtTime(e.at))}${e.who ? `・${esc(String(e.who).replace(/^.*｜/, ""))}` : ""}</div>
    ${e.text ? `<div class="meta">${esc(e.text).replace(/\n/g, "<br>")}</div>` : ""}</div>`;
function closeActs(d, ro) {
  const st = d.opening.stage, full = ' style="grid-column:1 / -1"', rep = readyLog(d);
  // 社會處：現場回報「可以撤收」→ 一個按鈕「完成撤收並結案」（撤收＋結案一次做完，接著打開結報）
  if (ro) return `<div class="sec">撤收與結案</div>${st === "開設中" ? (rep ? readyBox(rep) : `<div class="hint" style="margin:0 16px 8px">現場還沒回報可以撤收。</div>`) : ""}<div class="ract">
    ${st === "開設中" || st === "撤收中" ? `<button class="main" id="opsClose"${full}>完成撤收並結案</button>` : ""}
    <button id="opsReport"${full}>查看結報</button></div>`;
  if (st !== "開設中" || !/管理者/.test(d.me.role || "")) return "";
  if (rep) return `<div class="sec">撤收準備回報</div>${readyBox(rep)}<div class="hint" style="margin:6px 16px 0">已通知社會處。撤收由社會處確認後按，撤收前一切照常運作。</div>`;
  const R = S.ready || (S.ready = { checks: [], note: "" }), all = READY_ITEMS.every(i => R.checks.includes(i));
  return `<div class="sec">撤收準備回報 <small>災情解除、現場整理完成後回報社會處</small></div>
    <div class="chklist">${READY_ITEMS.map((i, k) => { const on = R.checks.includes(i), o = d.opening;
      const sub = k === 0 ? `目前在所 ${o.inside || 0} 人、外出 ${o.out || 0} 人${o.late ? `、未返 ${o.late} 人` : ""}` : "";
      return `<button class="chk ${on ? "on" : ""}" data-ready="${esc(i)}" role="checkbox" aria-checked="${on}"><span class="box">${on ? "✓" : ""}</span><span>${esc(i)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`; }).join("")}</div>
    <div class="form"><label>備註（可不填）<textarea id="rd-note" maxlength="500" placeholder="例：毛毯 3 條待送洗">${esc(R.note)}</textarea></label></div>
    <div class="ract"><button class="main" id="readySend"${full} ${all && !S.busy ? "" : 'disabled style="opacity:.4"'}>回報社會處：可以撤收</button></div>
    <div class="hint" style="margin:6px 16px 0">${all ? "送出後 LINE 通知社會處；撤收由社會處按。" : "四項都完成後才能回報。"}</div>`;
}
async function sendReady() {
  const R = S.ready, n = $("#rd-note");
  if (n) R.note = n.value;
  if (!READY_ITEMS.every(i => R.checks.includes(i))) return;
  if (!confirm("回報社會處：現場已整理完成，可以撤收？\n撤收由社會處確認後按。")) return;
  if (await opsAct("closeReady", { items: R.checks.join("、"), note: R.note.trim() }, "已回報社會處可以撤收")) S.ready = null;
}
// 撤收前的檢查清單（用本所狀況已有的數字）：還有沒處理完的，按下去會再問一次
function closeCheckSheet() {
  const d = S.ops, o = d.opening, evs = openEvents(), id = S.hqO || o.id;
  const rows = [["居民在所", o.inside, "人"], ["居民外出", o.out, "人"], ["居民未返", o.late, "人"], ["待處理事件", evs.length, "件"], ["在班工作人員", d.duty.length, "人"]];
  const left = rows.filter(r => r[1] > 0), rep = readyLog(d);
  sheet(`<h2>完成撤收並結案「${esc(o.name)}」</h2>
    ${rep ? readyBox(rep) : `<div class="err" style="margin:6px 0">⚠ 現場還沒回報可以撤收，確定要直接撤收嗎？</div>`}
    <div class="meta">按下後這一所改為「已撤收」，結報寫進 Notion，接著打開結報。</div>
    <label>撤收前檢查</label><div class="plist">${rows.map(([k, n, u]) => `<div class="prow"><span class="n">${k}</span><span class="meta ${n ? "bad" : "ok"}">${n ? `${n} ${u}` : "✓ 0"}</span></div>`).join("")}</div>
    <div class="err" id="cl-err"></div>
    <div class="acts"><button data-close>取消</button><button class="go" id="cl-ok" style="background:var(--red)">確定撤收並結案</button></div>`, root => {
    root.querySelector("#cl-ok").onclick = async () => {
      if (left.length && !confirm(`還有：\n${left.map(([k, n, u]) => `${k} ${n} ${u}`).join("\n")}\n\n仍要撤收嗎？`)) return;
      if (S.busy) return;
      if (!id) { root.querySelector("#cl-err").textContent = "讀不到開設編號，請關閉後重新整理"; return; }
      const b = root.querySelector("#cl-ok"); b.disabled = true; b.textContent = "撤收中…"; S.busy = true;
      try { await api.hq("hqClose", { o: id }); S.busy = false; closeSheet(); go(`?v=report&o=${encodeURIComponent(id)}&fin=1`); }
      catch (e) {
        S.busy = false; b.disabled = false; b.textContent = "確定撤收並結案";
        if (e.code === "bad_state") { closeSheet(); toast("這一所已不是開設中，已重新讀取"); loadOps(); }
        else if (e.code === "not_ours") root.querySelector("#cl-err").textContent = "只能撤收自己派駐的這一所";
        else if (e.code === "not_hq") root.querySelector("#cl-err").textContent = "只有社會處或本所的管理者可以撤收";
        else if (!handleApiError(e)) root.querySelector("#cl-err").textContent = "網路不穩，沒有送出，請再按一次";
      }
    };
  });
}
async function loadOps() {
  S.view = "ops"; S.ops = null; S.rmsg = ""; render();
  try {
    // 本所狀況和社會處看該所是同一個畫面：兩邊都一起讀物資庫存（同一支 load，數字一定一致）
    const [d, ld] = await Promise.all([api.ops("status", S.hqO ? { o: S.hqO } : undefined), api.load(S.hqO || undefined).catch(() => null)]);
    S.hqItems = ld ? ld.items : null;
    if (S.hqO) { S.ops = d; return render(); }
    S.ops = d; S.me = { ...(S.me || {}), name: d.me.name, role: d.me.role, opening: d.opening.name, onDuty: true, event: (S.me && S.me.event) || "" };
  } catch (e) { if (handleApiError(e)) return; S.rmsg = "網路不穩，沒讀到本所狀況。請按右上角重新整理。"; }
  render();
}
async function opsAct(a, f, okMsg) {
  if (S.busy) return false;
  S.busy = true;
  try {
    await api.ops(a, f); toast(okMsg); closeSheet(); S.busy = false;
    if (S.view === "ops") await loadOps(); else S.ops = null;   // 在居民畫面記錄的，留在原畫面；切到本所時再重新讀
    return true;
  }
  catch (e) {
    S.busy = false;
    if (e.code === "not_manager") toast(a === "closeReady" ? "只有管理者可以回報可撤收" : "只有管理者可以送出整備完成");
    else if (e.code === "bad_stage") { toast("本所已不在整備階段，已重新讀取"); loadOps(); }
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
    return false;
  }
}
// 反映者：後端「反映者」欄位（身分｜姓名）；舊資料沒有時，用在班名單找回報人姓名
function whoText(e) {
  if (e.who) return e.who;
  const n = staffName(e.by);
  return n ? `工作人員｜${n}` : "";
}
const whoLine = e => whoText(e) ? `<div class="whoby">👤 ${esc(whoText(e))}</div>` : "";
function eventSheet(id) {
  const e = S.ops.events.find(x => x.id === id); if (!e) return;
  if (S.hqO) return sheet(`<h2>${esc(nz(e.title))}</h2>
    <div class="meta"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>　${esc(nz(e.cat))}・${esc(nz(e.status))}・${esc(fmtTime(e.at))}${ownerName(e) ? `・${esc(ownerName(e))} 負責` : ""}</div>${whoLine(e)}
    ${e.text ? `<div class="pre">${esc(e.text)}</div>` : ""}
    <label>處理紀錄</label><div class="pre">${esc((e.log || "").trim() || "（還沒有）")}</div>
    ${isOpen(e) ? `<label>給現場的指示（回覆指示必填，接手可留空）<textarea id="hq-text" maxlength="500" placeholder="例：已協調大同國小調 2 箱水過去，14:00 前送到"></textarea></label>
    <div class="err" id="hq-err"></div>
    <div class="acts" style="grid-template-columns:1fr 1fr 1fr"><button data-close>關閉</button>
      <button id="hq-take">社會處接手</button><button class="go" id="hq-reply">回覆指示</button></div>
    <p class="hint" style="margin:8px 0 0">送出後會 LINE 通知該所在班的管理者；現場按「已解決」時會回報社會處。</p>`
    : `<div class="acts" style="grid-template-columns:1fr"><button data-close>關閉</button></div>`}`, root => {
    const btns = root.querySelectorAll("#hq-take,#hq-reply"); if (!btns.length) return;
    const send = async (a, label) => {
      const text = root.querySelector("#hq-text").value.trim(), err = root.querySelector("#hq-err");
      if (a === "hqReply" && !text) return err.textContent = "請寫給現場的指示";
      btns.forEach(b => b.disabled = true); root.querySelector(a === "hqReply" ? "#hq-reply" : "#hq-take").textContent = "送出中…";
      try { await api.hq(a, { o: S.hqO, id, text }); closeSheet(); toast(`${label}，已通知該所管理者`); loadOps(); }
      catch (e) { btns.forEach(b => b.disabled = false); root.querySelector("#hq-reply").textContent = "回覆指示"; root.querySelector("#hq-take").textContent = "社會處接手";
        err.textContent = e.code === "not_ours" ? "這個事件不屬於這一所" : "網路不穩，沒有送出，請再按一次"; }
    };
    root.querySelector("#hq-reply").onclick = () => send("hqReply", "已送出指示");
    root.querySelector("#hq-take").onclick = () => send("hqTake", "社會處已接手");
  });
  sheet(`<button class="sheetx" data-close aria-label="關閉">✕</button><h2>${esc(nz(e.title))}</h2>
    <div class="meta"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>　${esc(nz(e.cat))}・${esc(nz(e.status))}・${esc(fmtTime(e.at))}</div>${whoLine(e)}
    ${e.text ? `<div class="pre">${esc(e.text)}</div>` : ""}
    <label>處理紀錄</label><div class="pre">${esc((e.log || "").trim() || "（還沒有）")}</div>
    <label>寫下目前處理到哪裡（按「已解決」時可留空）<textarea id="ev-text" maxlength="500" placeholder="例：已通報水電師傅，明早來修，先放警示牌"></textarea></label>
    <div class="err" id="ev-err"></div>
    <div class="acts" style="grid-template-columns:1fr 1fr">
      <button id="ev-note">寫紀錄</button><button class="go" id="ev-resolve" style="background:var(--green)">已解決</button></div>
    <p class="hint">寫紀錄或按已解決，都會記下是你處理的；還沒有人處理的事件，由你負責。</p>`, root => {
    const t = () => root.querySelector("#ev-text").value.trim();
    root.querySelector("#ev-note").onclick = () => t() ? opsAct("update", { id, kind: "note", text: t() }, "已寫入處理紀錄") : (root.querySelector("#ev-err").textContent = "請先寫目前處理到哪裡");
    root.querySelector("#ev-resolve").onclick = () => confirm("確定這件事已經解決了嗎？") && opsAct("update", { id, kind: "resolve", text: t() }, "已標記解決");
  });
}
function reportSheet() {
  const f = { cat: "", sev: "中" }, rr = S.reportRes;
  const draw = root => {
    setHTML(root.querySelector("#rp-cat"), CATS.map(c => `<button data-c="${c}" class="${f.cat === c ? "on" : ""}">${c}</button>`).join(""));
    setHTML(root.querySelector("#rp-sev"), SEVS.map(v => `<button data-v="${v}" class="${f.sev === v ? "on" : ""}">${v}</button>`).join(""));
    root.querySelector("#rp-warn").textContent = /緊急|高/.test(f.sev) ? "⚠ 會標記「需回報社會處」。緊急狀況請同時電話通報。" : "";
  };
  sheet(`<h2>記錄事件</h2>
    ${rr ? `<div class="recipient" style="margin:0 0 6px"><div class="who">相關居民<br><b>${esc(rr.name)}</b></div><button id="rp-unres">不關聯</button></div>` : ""}
    <label>類別</label><div class="pick" id="rp-cat"></div>
    <label>嚴重程度</label><div class="pick" id="rp-sev"></div><div class="err" id="rp-warn"></div>
    <label>發生什麼事 <b style="color:var(--red)">*</b><textarea id="rp-text" maxlength="1000" placeholder="例：2 樓男廁洗手台漏水，地板濕滑，已放警示牌"></textarea></label>
    <div class="err" id="rp-err"></div>
    <div class="acts"><button data-close>取消</button><button class="go" id="rp-ok">送出</button></div>`, root => {
    draw(root);
    root.querySelector("#rp-cat").onclick = e => { const b = e.target.closest("button"); if (!b) return; f.cat = b.dataset.c; f.sev = SEV_OF[f.cat] || "中"; draw(root); };
    root.querySelector("#rp-sev").onclick = e => { const b = e.target.closest("button"); if (!b) return; f.sev = b.dataset.v; draw(root); };
    const un = root.querySelector("#rp-unres"); if (un) un.onclick = () => { S.reportRes = null; reportSheet(); };
    root.querySelector("#rp-ok").onclick = async () => {
      const text = root.querySelector("#rp-text").value.trim(), err = root.querySelector("#rp-err");
      if (!f.cat) return err.textContent = "請選類別";
      if (!text) return err.textContent = "請寫發生什麼事";
      const g = S.reportRes ? S.reportRes.id : "";
      const ok = await opsAct("report", { cat: f.cat, sev: f.sev, text, g }, /緊急|高/.test(f.sev) ? "已記錄，並標記需回報社會處" : "已記錄");
      if (ok) S.reportRes = null;
    };
  });
}

// ===== 居民畫面 =====
const AGES = ["成人", "長者", "兒童", "嬰幼兒"];
const CARES = ["高齡者", "身心障礙", "孕婦", "幼童", "特殊醫療需求", "其他"];
const CAN_CHECKIN = role => /管理者|門禁組/.test(role || "");
const CAN_GATE = role => /管理者|門禁組|志工/.test(role || "");
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d)) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function renderResident() {
  const app = $("#app"), d = S.rinfo;
  $("#bar").hidden = false; $("#bar .in").hidden = false;
  $("#go").textContent = "掃描"; $("#go").disabled = false;
  document.documentElement.style.setProperty("--accent", "var(--blue)");
  const head = `<header>${tabs()}<div class="title"><h1>${esc((d && d.opening) || (S.me && S.me.opening) || "收容所")}・居民進出管理</h1></div>
    <div class="sub">經手人：${esc((d && d.staff) || (S.me && S.me.name) || "")}${S.rtag ? `　號碼牌 ${esc(S.rtag)}` : ""}</div></header>`;
  if (!d) {
    // 還沒掃牌：縱向兩個大按鈕（掃描居民進出｜產生新的空白號碼牌）；讀取中或錯誤訊息照舊顯示文字
    if (S.rtag || S.rmsg) { setHTML(app, head + `<div class="blocked"><p>${esc(S.rmsg || "讀取號碼牌中…")}</p></div>`); return; }
    const mgr = S.me && (S.me.role || "").includes("管理者"), last = lastTags();
    setHTML(app, head + `<div class="biglinks rbtns">
      <button class="biglink blue" id="scanRes"><span class="ic">📷</span><span>掃描居民進出<small>掃居民號碼牌：報到、外出、返回、領物資、離所</small></span></button>
      <button class="biglink" id="mkTags" ${mgr ? "" : 'disabled style="opacity:.45"'}><span class="ic">🏷</span><span>產生新的空白號碼牌<small>${mgr ? "空白牌不夠時，產生新的號碼牌並列印" : "限收容所管理者"}</small></span></button>
      ${mgr && last ? `<button class="hq-go ghost" id="lastTags">🖨 重印上次產生的號碼牌（${esc(last.p)}・${last.c.length} 張）</button>` : ""}</div>`);
    return;
  }
  let body = "";
  if (d.state === "none") body = `<div class="rcard void"><h2>不是本所的號碼牌</h2><div class="meta">${esc(S.rtag)}　請確認後再掃一次</div></div>`;
  // 剛辦完離所：不是警告，是完成畫面（之後再掃到這張才顯示失效警告）
  else if (d.state === "left") body = `<div class="rcard done"><h2>✅ 已完成離所手續</h2><div class="meta">此號碼牌已登出（${esc(S.rtag)}）${d.leftName || d.leftDest ? `<br>${[d.leftName, d.leftDest ? `去向：${d.leftDest}` : ""].filter(Boolean).map(esc).join("・")}` : ""}<br>請收回號碼牌，不能再用於進出。</div></div>`;
  else if (d.state === "void") body = `<div class="rcard void"><h2>⚠ 此號碼牌已失效</h2><div class="meta">${esc(S.rtag)}　請勿放行，並通知現場負責人</div></div>`;
  else if (d.state === "blank") body = blankView(d);
  else body = residentView(d);
  setHTML(app, head + body);
  $("#sum").textContent = d.state === "blank" && S.rform ? "填完按上方「完成報到」" : "下一位：掃號碼牌或物資標籤";
}
function blankView(d) {
  if (d.openStatus === "撤收中" || d.openStatus === "已撤收") return `<div class="rcard"><h2>空白號碼牌</h2><div class="meta">本所${esc(d.openStatus)}，不再接受新的報到。</div></div>`;
  if (d.openStatus !== "開設中") return `<div class="rcard"><h2>空白號碼牌</h2><div class="meta">本所目前「${esc(d.openStatus)}」，社會處核准開放後才能報到。</div></div>`;
  if (!CAN_CHECKIN(d.role)) return `<div class="rcard"><h2>空白號碼牌</h2><div class="meta">報到限管理者或門禁組，請洽現場負責人。</div></div>`;
  const f = S.rform || (S.rform = { name: "", age: "", care: [], phone: "", contact: "", id4: "", noId: false, note: "", area: "" });
  const pick = (k, list, multi) => `<div class="pick">${list.map(v => `<button data-pick="${k}" data-v="${esc(v)}" class="${(multi ? f[k].includes(v) : f[k] === v) ? "on" : ""}">${esc(v)}</button>`).join("")}</div>`;
  return `<div class="form"><h2>🆕 新居民報到</h2><div class="meta">號碼牌 ${esc(S.rtag)}，一次填完按「完成報到」。只有姓名和年齡層必填。</div>
    <label>姓名 <b>*</b><input id="f-name" maxlength="40" value="${esc(f.name)}" placeholder="例：王小明" autocomplete="off"></label>
    <label>年齡層 <b>*</b></label>${pick("age", AGES)}
    <label>特殊關懷（可複選）</label>${pick("care", CARES, true)}
    <label>聯絡電話<input id="f-phone" maxlength="20" inputmode="tel" value="${esc(f.phone)}" placeholder="例：0912345678"></label>
    <label>身分證後四碼<input id="f-id4" inputmode="numeric" maxlength="4" value="${esc(f.id4)}" placeholder="本人的，只填後四碼" ${f.noId ? "disabled" : ""}></label>
    <div class="chkline"><input type="checkbox" id="f-noid" ${f.noId ? "checked" : ""}><span>沒有帶證件，之後補查</span></div>
    <label>照護需求說明（敏感資料，只有授權人員看得到）<textarea id="f-note" maxlength="500" placeholder="例：需每日服用降血壓藥">${esc(f.note)}</textarea></label>
    <label>緊急聯絡人<input id="f-contact" maxlength="60" value="${esc(f.contact)}" placeholder="例：王大明（兒子）0933…"></label>
    <label>分配區域<input id="f-area" maxlength="40" value="${esc(f.area)}" placeholder="例：A 區 3 號床"></label>
    <div class="err" id="f-err"></div>
    <div class="ract"><button class="main" id="doRegister" ${S.busy ? "disabled" : ""}>${S.busy ? "報到中…" : "完成報到"}</button></div></div>`;
}
function residentView(d) {
  const r = d.resident || {}, st = r.status || "";
  const care = (r.care || "").split(/[、,]/).filter(Boolean);
  let acts = "";
  // 送出中：按下的那顆改成「登記中…」（點點會跳），其他進出按鈕一起停用，避免連按重複登記
  const mv = S.busy && S.moving, dis = mv ? "disabled" : "";
  const lab = (k, t) => mv === k ? "登記中…" : t;
  if (!CAN_GATE(d.role)) acts = `<div class="hint" style="margin:12px 16px">進出登記限管理者、門禁組、志工。</div>`;
  else if (st === "在所") acts = `<div class="ract"><button class="main" id="doSupply" ${dis}>🎁 領物資</button>
      <button id="doOut" ${dis}>${lab("外出", "🚶 外出")}</button><button class="warn" id="doLeave" ${dis}>${lab("離所", "離所")}</button></div>
      ${S.rmsg === "pickHours" && !mv ? `<div class="form"><b>預計多久回來？</b><div class="hours">${[[1, "1 小時"], [3, "3 小時"], [6, "6 小時"], [12, "過夜"]].map(([h, t]) => `<button data-hours="${h}">${t}</button>`).join("")}</div></div>` : ""}`;
  else if (st === "外出" || st === "未返") acts = `<div class="ract"><button class="main" id="doBack" ${dis}>${lab("返回", "↩ 返回")}</button><button class="warn" id="doLeave" style="grid-column:1 / -1" ${dis}>${lab("離所", "離所")}</button></div>`;
  // 按「離所」先選去向（和外出的「預計多久回來」共用 rmsg，一次只開一個）
  if (S.rmsg === "pickDest" && !mv && CAN_GATE(d.role)) acts += `<div class="form"><b>離所後去哪裡？</b><div class="meta">結報會統計大家是否安全撤離</div>
      <div class="hours dests">${DESTS.map(t => `<button data-dest="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>`;
  if (CAN_GATE(d.role) && st !== "已離所") acts += `<div class="ract"><button id="doReport" style="grid-column:1 / -1">📝 記錄這位居民的事件</button></div>`;
  return `<div class="rcard"><h2>${esc(r.name || S.rtag)}</h2>
      <div class="meta">${esc(S.rtag)}　${esc(r.age || "")}${r.area ? `　${esc(r.area)}` : ""}</div>
      <span class="badge ${esc(st)}">${esc(st)}</span>${(st === "外出" || st === "未返") && r.back ? `<span class="meta">　預計 ${esc(fmtTime(r.back))} 返回</span>` : ""}
      ${care.length ? `<div class="tags">${care.map(x => `<span>${esc(x)}</span>`).join("")}</div>` : ""}</div>${acts}`;
}
async function loadResident(tag) {
  S.view = "resident"; S.rtag = tag; S.rinfo = null; S.rform = null; S.rmsg = ""; render();
  try {
    const d = await api.tagInfo(tag);
    S.rinfo = d; S.me = { ...(S.me || {}), name: d.staff, role: d.role, opening: d.opening, onDuty: true, event: (S.me && S.me.event) || "" };
  } catch (e) { if (handleApiError(e)) return; S.rmsg = "網路不穩，沒讀到號碼牌。請按下方「掃描」再掃一次。"; }
  render();
}
async function residentAction(kind, hours, dest) {
  if (S.busy) return;
  if (kind === "離所" && !confirm(`確定 ${S.rinfo.resident.name || S.rtag} 要離所（${dest}）嗎？\n離所後號碼牌會失效，不能再用。`)) return;
  S.busy = true; S.moving = kind; S.rmsg = ""; render();
  try {
    const d = await api.move(S.rtag, kind, hours, dest);
    S.rinfo.resident.status = d.status;
    if (kind === "外出") S.rinfo.resident.back = new Date(Date.now() + hours * 3600e3).toISOString();
    if (kind === "離所") Object.assign(S.rinfo, { state: "left", leftName: S.rinfo.resident.name || "", leftDest: dest || "" });
    const who = S.rinfo.resident.name || S.rtag;   // 志工看不到姓名，用號碼牌編號
    toast(kind === "離所" ? `${who} 已完成離所手續` : `${who} ${kind === "外出" ? `已外出，預計 ${fmtTime(S.rinfo.resident.back)} 返回` : "已返回"}`);
  } catch (e) {
    if (e.code === "bad_state") { toast("狀態已被其他人更新，已重新讀取"); S.busy = false; S.moving = null; return loadResident(S.rtag); }
    if (e.code === "no_permission") toast("進出登記限管理者、門禁組、志工");
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
  } finally { S.busy = false; S.moving = null; render(); }
}
async function doRegister() {
  const f = S.rform, err = m => { $("#f-err").textContent = m; };
  f.name = f.name.replace(/["\\]/g, "").trim();
  if (!f.name) return err("請填姓名");
  if (!f.age) return err("請選年齡層");
  if (f.id4 && !/^\d{4}$/.test(f.id4)) return err("身分證後四碼請填 4 位數字");
  S.busy = true; render();
  try {
    await api.register({ tag: S.rtag, name: f.name, age: f.age, care: f.care.join(","), phone: f.phone.trim(), contact: f.contact.trim(),
                         id4: f.noId ? "" : f.id4, verify: f.noId ? "待補查" : "不需查核", note: f.note.trim(), area: f.area.trim() });
    const name = f.name; S.busy = false;
    await loadResident(S.rtag); toast(`✅ ${name} 報到完成`);
  } catch (e) {
    S.busy = false;
    if (e.code === "tag_unusable") { toast("這張號碼牌已經被使用，已重新讀取"); return loadResident(S.rtag); }
    if (e.code === "not_open") toast("本所尚未開放報到");
    else if (e.code === "no_permission") toast("報到限管理者或門禁組");
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
    render();
  }
}
async function toSupply(recipient) {
  S.view = "supply";
  if (recipient) { S.mode = "out"; S.pick = {}; S.errs = {}; S.recip = recipient; }
  if (!S.items.length) { S.me = null; render(); await boot(); } else render();
  if (recipient) toast(`領取人：${recipient.name}，請選要發放的物資`);
}

function recipBar() {
  const r = S.recip;
  if (!r) return `<div class="recipient none"><div class="who"><b>尚未指定領取人</b><small>掃居民號碼牌；不是發給個人就選公共用途</small></div>
    <button id="rscan">掃號碼牌</button><button id="pub">公共用途</button></div>`;
  if (r.kind === "public") return `<div class="recipient"><div class="who">領取對象<br><b>公共用途</b><small>補到廁所、公共區等，不是發給個人</small></div>
    <button id="rscan">改掃號碼牌</button></div>`;
  return `<div class="recipient"><div class="who">領取人<br><b>${esc(r.name)}</b>　${esc(r.tag)}${r.note ? `・${esc(r.note)}` : ""}<small>掃錯了就直接掃另一張；可代領全家</small></div>
    <button id="rscan">換一位</button></div>`;   // 發給居民時不提供公共用途：公共用途由工作人員另外從發放進來處理
}
function rowCtrl(it) {
  const p = S.pick[it.id] || { qty: "", unit: it.unit };
  const units = it.pack && it.pack !== it.unit ? `<select class="unit" data-unit="${it.id}"><option ${p.unit === it.unit ? "selected" : ""}>${esc(it.unit)}</option><option ${p.unit === it.pack ? "selected" : ""}>${esc(it.pack)}</option></select>` : `<span class="stock">${esc(it.unit)}</span>`;
  let diff = "";
  if (S.mode === "count" && p.qty !== "") { const d = base(it, p) - it.stock; diff = `<span class="diff ${d < 0 ? "bad" : "ok"}">差額 ${d >= 0 ? "+" : ""}${d}</span>`; }
  else if (p.qty > 0 && p.unit === it.pack && it.pack) diff = `<span class="diff">＝${base(it, p)} ${esc(it.unit)}</span>`;
  return `<div class="ctrl"><button class="step" data-step="-1" data-id="${it.id}" aria-label="減少">−</button>
    <input class="qty" inputmode="numeric" data-qty="${it.id}" value="${p.qty}" placeholder="${S.mode === "count" ? "實點" : "0"}">
    <button class="step" data-step="1" data-id="${it.id}" aria-label="增加">+</button>${units}${diff}</div>
    ${S.errs[it.id] ? `<div class="err">${esc(S.errs[it.id])}</div>` : ""}`;
}
function renderBar() {
  const ls = lines(), bar = $("#bar");
  bar.hidden = false;
  const label = S.mode === "count" ? "盤點" : MODES[S.mode];
  const needWho = S.mode === "out" && !S.recip;   // 發放：物資和領取對象兩個都要有，先後不拘
  setHTML($("#sum"), !ls.length ? (S.mode === "out" && S.recip ? `請選要發放的物資（${esc(recipName())}）` : `尚未填寫數量`)
    : `${label} <b>${ls.length}</b> 項` + (S.mode === "out" && S.recip ? ` <b>${esc(toWho())}</b>` : ""));
  $("#go").textContent = S.busy ? "登記中…" : ls.length && needWho ? "掃領取人號碼牌" : `確認${label}`;
  $("#go").disabled = !ls.length || S.busy;
}

// ===== 操作 =====
function setQty(id, qty, keepFocus) {
  const it = S.items.find(x => x.id === id);
  const p = S.pick[id] || { qty: "", unit: it.unit };
  p.qty = qty === "" ? "" : Math.max(0, parseInt(qty, 10) || 0);
  S.pick[id] = p; delete S.errs[id];
  if (keepFocus) renderBar(); else render();
}
document.addEventListener("click", async e => {
  if (PUB_VIEWS.includes(S.view) || HQ_VIEWS.includes(S.view)) return;   // 一般畫面、社會處畫面有自己的點擊處理
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.mode && !b.disabled) {
    if (b.dataset.mode !== S.mode && Object.keys(S.pick).length && !confirm("切換模式會清除已填的數量，確定嗎？")) return;
    if (b.dataset.mode !== S.mode) { S.pick = {}; S.errs = {}; }
    S.mode = b.dataset.mode; render();
  }
  else if (b.dataset.cat) { S.cat = b.dataset.cat; render(); }
  else if (b.dataset.step) {
    const id = b.dataset.id, cur = (S.pick[id] && S.pick[id].qty) || 0;
    setQty(id, Math.max(0, (+cur) + (+b.dataset.step)));
  }
  else if (b.id === "showall") { S.showAll = true; render(); }
  else if (b.id === "reload") { await boot(); toast("已更新庫存"); }
  else if (b.id === "scan" || b.id === "rscan") scan();
  else if (b.dataset.tab) {
    const t = b.dataset.tab;
    if (t === "supply") toSupply();
    else if (t === "ops") { if (S.ops) { S.view = "ops"; render(); } else loadOps(); }
    else { S.view = "resident"; render(); }
  }
  else if (b.id === "opsReload") loadOps();
  else if (b.id === "hqBack") go("?v=sites");
  else if (b.id === "opsClose") S.ops && S.ops.opening.stage === "撤收中" ? go(`?v=report&o=${encodeURIComponent(S.hqO)}&fin=1`) : closeCheckSheet();
  else if (b.dataset.ready) { const R = S.ready, n = $("#rd-note"); if (n) R.note = n.value; const i = b.dataset.ready; R.checks = R.checks.includes(i) ? R.checks.filter(x => x !== i) : [...R.checks, i]; render(); }
  else if (b.id === "readySend") sendReady();
  else if (b.id === "opsFinish" || b.id === "opsReport") go(`?v=report&o=${encodeURIComponent(S.hqO)}`);
  else if (b.id === "finBack") history.length > 1 ? history.back() : go("?v=sites");
  else if (b.id === "finReload") loadFinal();
  else if (b.id === "finPrint") {
    if (F.full && !confirm("完整版含事件內容，可能有居民或工作人員姓名。\n請只交給需要的人，不要轉傳到群組。要繼續嗎？")) return;
    const R = computeReport(F.d); R.full = F.full;
    if (inLine()) openPrintView("printrep", slimReport(R)); else window.print();
  }
  else if (b.dataset.repfull !== undefined) { F.full = b.dataset.repfull === "1"; render(); }
  else if (b.id === "doPrintNow") window.print();
  else if (b.id === "finDo") doFinish();
  else if (b.dataset.show !== undefined && b.dataset.show !== "") { S.opsShow = S.opsShow === b.dataset.show ? "" : b.dataset.show; render(); }
  else if (b.dataset.evt) eventSheet(b.dataset.evt);
  else if (b.dataset.prep) {
    const item = b.dataset.prep, result = b.dataset.res;
    if (result === "已完成") (async () => {
      // 這一項之前回報過「有問題」而且還沒結案的，一併標成已解決，待處理清單才不會留著
      for (const e of S.ops.events.filter(x => x.cat === "整備回報" && x.item === item && isOpen(x))) {
        try { await api.ops("update", { id: e.id, kind: "resolve", text: "整備項目已完成" }); } catch (x) {}
      }
      opsAct("prep", { item, result, text: "" }, `已回報：${item}完成`);
    })();
    else sheet(`<h2>${esc(item)}：有問題</h2><label>是什麼問題？<textarea id="pp-text" maxlength="500" placeholder="例：2 樓緊急照明燈不亮"></textarea></label>
      <div class="acts"><button data-close>取消</button><button class="go" id="pp-ok">送出</button></div>`, root => {
      root.querySelector("#pp-ok").onclick = () => opsAct("prep", { item, result, text: root.querySelector("#pp-text").value.trim() }, `已回報：${item}有問題`);
    });
  }
  else if (b.id === "prepDone") { if (confirm("確定送出整備完成，申請開放進駐嗎？")) opsAct("prepDone", {}, "已送出，等社會處核准"); }
  else if (b.id === "doReport") { const r = S.rinfo.resident; S.reportRes = { id: r.id, name: r.name || S.rtag }; reportSheet(); }
  else if (b.id === "doSupply") { const r = S.rinfo.resident; toSupply({ kind: "resident", tag: S.rtag, id: r.id, name: r.name || S.rtag, note: r.status }); }
  else if (b.id === "doOut") { S.rmsg = S.rmsg === "pickHours" ? "" : "pickHours"; render(); }
  else if (b.dataset.hours) { S.rmsg = ""; residentAction("外出", +b.dataset.hours); }
  else if (b.id === "doBack") residentAction("返回");
  else if (b.id === "doLeave") { S.rmsg = S.rmsg === "pickDest" ? "" : "pickDest"; render(); }
  else if (b.dataset.dest) { S.rmsg = ""; residentAction("離所", null, b.dataset.dest); }
  else if (b.id === "doRegister") doRegister();
  else if (b.dataset.pick) {
    const k = b.dataset.pick, v = b.dataset.v, f = S.rform;
    if (k === "care") f.care = f.care.includes(v) ? f.care.filter(x => x !== v) : [...f.care, v]; else f[k] = v;
    render();
  }
  else if (b.id === "pub") { S.recip = { kind: "public" }; render(); toast("領取對象：公共用途"); }
  else if (b.id === "addnew") addItemSheet();
  else if (b.dataset.label) { const it = S.items.find(x => x.id === b.dataset.label); if (it) labelSheet([it]); }
  else if (b.id === "allLabels") labelSheet(S.items.filter(x => x.code));
  else if (b.id === "lblPrint") printLabels(S.lbl);
  else if (b.id === "scanRes") scan();
  else if (b.id === "mkTags") tagGenSheet(S.me.opening || "本所", codes => api.addTags(codes));
  else if (b.id === "lastTags") { const d = lastTags(); if (d) tagResultSheet(d); }
});
document.addEventListener("input", e => {
  if (S.rform && e.target.id && e.target.id.startsWith("f-") && e.target.id !== "f-noid" && document.querySelector(".form h2")) {
    S.rform[e.target.id.slice(2)] = e.target.value; return;
  }
  if (e.target.dataset.qty) setQty(e.target.dataset.qty, e.target.value, true);
  else if (e.target.id === "q") { S.q = e.target.value.trim(); const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener("change", e => {
  if (e.target.id === "f-noid") { S.rform.noId = e.target.checked; if (S.rform.noId) S.rform.id4 = ""; render(); return; }
  if (e.target.dataset.qty) render();
  if (e.target.dataset.unit) { const id = e.target.dataset.unit, it = S.items.find(x => x.id === id); S.pick[id] = { qty: (S.pick[id] && S.pick[id].qty) || "", unit: e.target.value || it.unit }; render(); }
});

async function scan() {
  let v;
  if (window.liff && liff.isInClient && liff.isInClient() && liff.isApiAvailable("scanCodeV2")) {
    try { v = (await liff.scanCodeV2()).value; } catch (e) { toast("無法開啟掃描器"); return; }
  } else {
    const codes = S.items.map(x => `${x.code} ${x.name}`).concat(REAL ? [] : Object.keys(mock.tags).map(k => `${k}（號碼牌）`)).join("\n");
    v = prompt(`（原型）輸入或貼上物資標籤或號碼牌代碼：\n${codes}`, (S.items[0] || {}).code || "MLS-W8AGZ");
  }
  if (!v) return;
  const tm = String(v).toUpperCase().match(/MLS-[A-Z0-9]{5}/);
  if (tm) return S.view === "supply" && S.mode === "out" ? pickResident(tm[0]) : loadResident(tm[0]);
  const m = String(v).toUpperCase().match(/SUP-[A-Z0-9]{5}/);
  if (m && S.view === "resident") { S.focusCode = m[0]; S.showAll = true; await toSupply(); }
  const code = m ? m[0] : "";
  if (S.view === "resident") return;
  const it = S.items.find(x => x.code === code);
  if (!it) { toast("這不是本所的物資標籤或居民號碼牌"); return; }
  if (!S.pick[it.id]) S.pick[it.id] = { qty: S.mode === "count" ? "" : 1, unit: it.unit };
  S.cat = "全部"; S.q = ""; render();
  const row = document.querySelector(`.row[data-id="${it.id}"]`); if (row) row.scrollIntoView({ block: "center" });
  toast(`已加入：${it.name}`);
}

// 掃到居民號碼牌：查居民，設為這次的領取人（取代上一位）。查不到或不在所就保留原本的
async function pickResident(tag) {
  if (S.mode !== "out") {
    if (lines().length && !confirm("掃到居民號碼牌，要切換到「發放」嗎？已填的數量會清除。")) return;
    S.pick = {}; S.errs = {}; S.mode = "out"; render();
  }
  let r;
  try { r = await api.resident(tag); }
  catch (e) { if (!handleApiError(e)) toast("網路不穩，沒查到號碼牌，請再掃一次"); return; }
  if (!r) { toast(`查無號碼牌 ${tag}` + (S.recip ? "，領取人沒有更換" : "")); return; }
  if (!r.inShelter) { toast(`${r.name}（${tag}）目前「${r.note}」，不能領物資` + (S.recip ? "，領取人沒有更換" : "")); return; }
  const changed = S.recip && S.recip.kind === "resident" && S.recip.tag !== tag;
  S.recip = { kind: "resident", tag, ...r };
  render(); toast(changed ? `領取人改為 ${r.name}` : `領取人：${r.name}`);
}

$("#go").addEventListener("click", () => {
  if (S.view === "resident") { scan(); return; }
  if (S.view === "ops") { S.reportRes = null; reportSheet(); return; }
  const ls = lines(); if (!ls.length || S.busy) return;
  if (S.mode === "out" && !S.recip) { scan(); return; }
  const label = S.mode === "count" ? "盤點" : MODES[S.mode];
  sheet(`<h2>確認${label}${S.mode === "out" ? esc(toWho()) : ""}</h2>
    ${ls.map(l => `<div class="line"><span>${esc(l.it.name)}</span><span>${esc(l.note)}${l.p.unit === l.it.pack && S.mode !== "count" ? ` <small>＝${l.qty} ${esc(l.it.unit)}</small>` : ""}</span></div>`).join("")}
    <div class="acts"><button data-close>返回修改</button><button class="go" id="doit">確認${label}</button></div>`, root => {
    root.querySelector("#doit").onclick = () => { closeSheet(); submit(ls); };
  });
});

async function submit(ls) {
  const over = ls.filter(l => l.type === "發放" && l.qty > l.it.stock);
  if (over.length) {
    for (const l of over) S.errs[l.it.id] = `庫存只剩 ${l.it.stock} ${l.it.unit}，請確認數量`;
    toast("有品項超過庫存，請看紅字"); render(); return;
  }
  S.busy = true; renderBar();
  const requestId = (crypto.randomUUID && crypto.randomUUID()) || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
  try {
    const res = await api.submit(requestId, ls.map(l => ({ itemId: l.it.id, type: l.type, qty: l.qty, note: l.note })));
    if (res.duplicate) { toast("這筆已經登記過了"); return; }
    let ok = 0, bad = 0;
    for (const r of res.results) {
      const it = S.items.find(x => x.id === r.itemId);
      if (r.ok) { ok++; it.stock = r.stock; delete S.pick[r.itemId]; delete S.errs[r.itemId];
        if (r.stock < 0) S.errs[r.itemId] = "⚠ 庫存變成負數，可能有人同時發放，請盤點確認"; }
      else { bad++; S.errs[r.itemId] = r.error; }
    }
    if (!REAL) { const d = await api.load(); S.recent = d.recent; }
    const who = S.mode === "out" ? recipName() : "";
    if (S.mode === "out" && !bad) S.recip = null;   // 發完換下一位，避免記到上一位身上
    if (who && !bad && S.rinfo && S.rinfo.resident && S.rinfo.resident.name === who) { S.view = "resident"; }
    toast(bad ? `${ok} 項已登記，${bad} 項未登記，請看紅字` : `已登記 ${ok} 項` + (who ? `（${who}）` : ""));
  } catch (err) {
    if (err.code === "no_recipient") toast("發放要先掃領取人號碼牌，或選公共用途");
    else if (!handleApiError(err)) toast("網路不穩，沒有送出。請再按一次確認（不會重複登記）。");
  } finally { S.busy = false; render(); }
}

function addItemSheet() {
  sheet(`<h2>新增品項</h2>
    <label>品名<input id="f-name" maxlength="40" placeholder="例：礦泉水、泡麵"></label>
    <label>類別<select id="f-cat">${["飲用水", "食品", "寢具", "衛生用品", "醫療", "防寒", "其他"].map(c => `<option>${c}</option>`).join("")}</select></label>
    <label>最小單位（例：瓶、碗）<input id="f-unit" maxlength="10" placeholder="發放時一個一個算的單位，例：瓶"></label>
    <label>包裝單位（例：箱、盒，可空白）<input id="f-pack" maxlength="10" placeholder="整批送來的單位，例：箱"></label>
    <label>每包裝數量（一箱裝幾瓶）<input id="f-per" inputmode="numeric" placeholder="例：24"></label>
    <label>安全庫存（以最小單位計）<input id="f-safety" inputmode="numeric" placeholder="少於這個數量會提醒補貨，例：30"></label>
    <div class="err" id="f-err"></div>
    <div class="acts"><button data-close>取消</button><button class="go" id="f-ok" style="background:var(--green)">新增</button></div>`, root => {
    root.querySelector("#f-ok").onclick = async () => {
      const v = id => root.querySelector(id).value.trim();
      if (!v("#f-name") || !v("#f-unit")) { root.querySelector("#f-err").textContent = "品名和最小單位一定要填"; return; }
      if (S.items.some(x => x.name === v("#f-name"))) { root.querySelector("#f-err").textContent = "本所已經有這個品項"; return; }
      let it;
      const okBtn = root.querySelector("#f-ok"); okBtn.disabled = true; okBtn.textContent = "新增中…";
      try { it = await api.addItem({ name: v("#f-name"), cat: v("#f-cat"), unit: v("#f-unit"), pack: v("#f-pack"), per: +v("#f-per") || 1, safety: +v("#f-safety") || 0 }); }
      catch (e) { okBtn.disabled = false; okBtn.textContent = "新增"; root.querySelector("#f-err").textContent = e.code === "not_manager" ? "只有收容所管理者可以新增品項" : "沒有新增成功，請再試一次"; return; }
      S.items = (await api.load()).items;
      if (!S.items.some(x => x.id === it.id)) S.items.push(it);   // Notion 搜尋偶爾慢一步，先放進清單
      closeSheet();
      S.mode = "in"; S.pick = { [it.id]: { qty: "", unit: it.unit } }; S.cat = "全部"; render();
      labelSheet([it], true);   // 新品項：馬上給物資標籤，列印或寄給同仁，貼在棧板上
    };
  });
}

// ===== 物資標籤：QR 內容是物資頁面網址加物資代碼（規則見 docs/QR編碼規則.md），掃了直接打開該品項 =====
// 標籤不含個資，也不能用來簽到；掃了之後仍要在班的工作人員才能入庫、發放
const itemUrl = code => `https://liff.line.me/${CONFIG.liffId}?item=${code}`;
function itemLabel(e, p, name, code) {
  return `<div class="qrcard item">
    <div class="band"><b>物資標籤</b><span>${esc(e)}</span><strong>${esc(p)}</strong></div>
    <div class="iname">${esc(name)}</div>
    <div class="qr">${qrSvg(itemUrl(code))}</div><p>${esc(code)}・工作人員用 LINE 掃描：入庫、發放</p></div>`;
}
const labelData = list => ({ e: S.me.event || "", p: S.me.opening || "", c: list.map(it => [it.name, it.code]) });
// 存 PDF 的檔名：一項「牙刷的物資標籤」；多項「清華里活動中心的物資標籤（9 項）」
const labelTitle = d => d.c.length === 1 ? `${d.c[0][0]}的物資標籤` : `${d.p}的物資標籤（${d.c.length} 項）`;
const labelPrintUrl = d => `${location.origin}${location.pathname}?v=printitem#${b64e(d)}`;
// Email 內文：mailto 的換行要用 CRLF（%0D%0A，RFC 6068），iPhone Gmail App 只認這種，只用 LF 會全部黏成一段
function mailHref(subject, lines) {
  const body = lines.join("\r\n");
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function labelMailHref(d) {
  const one = d.c.length === 1;
  return mailHref(`【物資標籤】${one ? d.c[0][0] : `${d.c.length} 項`}（${d.p}）`, [
    `■ ${d.p}｜物資標籤`,
    one ? `品項：${d.c[0][0]}` : `品項（${d.c.length} 項）：${d.c.map(x => x[0]).join("、")}`,
    `災害：${d.e}`,
    "",
    "▶ 點下面的連結，就看得到 QR Code，可以列印或存成 PDF：",
    "",
    labelPrintUrl(d),
    "",
    "▶ 用法：",
    "貼在物資棧板或存放處，工作人員用 LINE 掃描就能入庫、發放。",
  ]);
}
function printLabels(d) {
  if (inLine()) return openPrintView("printitem", d);   // LINE 裡不能列印：用手機瀏覽器開列印頁
  setHTML($("#printArea"), d.c.map(([n, c]) => itemLabel(d.e, d.p, n, c)).join(""));
  const t = document.title; document.title = fileTitle(labelTitle(d)); window.print(); document.title = t;
}
function labelSheet(list, fresh) {
  const d = S.lbl = labelData(list);
  sheet(`<h2>${fresh ? `已新增「${esc(list[0].name)}」` : esc(labelTitle(d))}</h2>
    ${fresh ? `<p class="hint">這是它的物資標籤，印出來貼在棧板上；之後掃標籤就能直接入庫、發放。關掉這個畫面就可以入庫。</p>` : ""}
    <div class="qrcards lblcards">${d.c.slice(0, 4).map(([n, c]) => itemLabel(d.e, d.p, n, c)).join("")}</div>
    ${d.c.length > 4 ? `<p class="hint">另外還有 ${d.c.length - 4} 項，列印時會一起印出（一項一頁）。</p>` : ""}
    <div class="lblacts"><button class="go" id="lblPrint">🖨 列印／存成 PDF</button>
      <a class="lblmail" href="${esc(labelMailHref(d))}">✉ 用 Email 寄給同仁</a>
      <button data-close>${fresh ? "關閉，開始入庫" : "關閉"}</button></div>`);
}

// ===== 居民號碼牌：QR 內容是現場頁面網址加號碼牌編號（?r=MLS-xxxxx），空白牌掃了出現報到表單 =====
// 號碼牌綁收容所、不綁災害（平時就能先印好放在收容所），所以牌上只印收容所名稱
const tagUrl = code => `https://liff.line.me/${CONFIG.liffId}?r=${code}`;
const TAG_RE = /^MLS-[0-9A-Z]{5}$/;
function tagCard(p, code) {
  return `<div class="tagcard"><div class="band"><b>居民號碼牌</b><strong>${esc(p)}</strong></div>
    <div class="qr">${qrSvg(tagUrl(code))}</div><div class="code">${esc(code)}</div><p>請隨身攜帶・外出、返回、領物資時出示</p></div>`;
}
// 列印：一張 A4 排 6 張（2 × 3），沿虛線剪開
const tagPages = d => Array.from({ length: Math.ceil(d.c.length / 6) }, (_, i) =>
  `<div class="tagpage">${d.c.slice(i * 6, i * 6 + 6).map(c => tagCard(d.p, c)).join("")}</div>`).join("");
const tagTitle = d => `${d.p}的居民號碼牌（${d.c.length} 張）`;
const tagPrintUrl = d => `${location.origin}${location.pathname}?v=printtag#${b64e(d)}`;
function tagMailHref(d) {
  return mailHref(`【居民號碼牌】${d.p}（${d.c.length} 張）`, [
    `■ ${d.p}｜空白居民號碼牌`,
    `數量：${d.c.length} 張`,
    "",
    "▶ 點下面的連結，就看得到號碼牌，可以列印或存成 PDF：",
    "（一張 A4 排 6 張，沿虛線剪開）",
    "",
    tagPrintUrl(d),
    "",
    "▶ 用法：",
    "居民報到時，門禁組或管理者用 LINE 掃描空白牌，就會出現報到表單。",
    "",
    "※ 請只轉給本所工作人員。",
  ]);
}
function printTags(d) {
  if (inLine()) return openPrintView("printtag", d);   // LINE 裡不能列印：用手機瀏覽器開列印頁
  setHTML($("#printArea"), tagPages(d));
  const t = document.title; document.title = fileTitle(tagTitle(d)); window.print(); document.title = t;
}
// 上次產生的號碼牌記在這支手機（關掉畫面前忘了列印還能重印；Notion「號碼牌」表也查得到）
const TAG_KEY = "lastTags";
function lastTags() { try { const d = JSON.parse(localStorage.getItem(TAG_KEY) || "null"); return d && typeof d.p === "string" && Array.isArray(d.c) && d.c.length ? d : null; } catch (e) { return null; } }
function saveLastTags(d) { try { localStorage.setItem(TAG_KEY, JSON.stringify(d)); } catch (e) {} }
const TAG_COUNTS = [6, 12, 18, 24, 30];
// run(codes) → 實際建立的編號陣列；失敗時丟出錯誤（社會處的 hqCall 失敗回 null，訊息由 hqCall 處理）
function tagGenSheet(place, run) {
  let n = 6;
  sheet(`<h2>產生空白號碼牌</h2><div class="meta">${esc(place)}</div>
    <label>要幾張？（一張 A4 排 6 張）</label><div class="pick" id="tg-n"></div>
    <p class="hint">會建立在 Notion「號碼牌」表（狀態：可用、存放收容所：${esc(place)}），列印剪開就能用。一次最多 30 張。</p>
    <div class="err" id="tg-err"></div>
    <div class="acts"><button data-close>取消</button><button class="go" id="tg-ok">產生</button></div>`, root => {
    const draw = () => setHTML(root.querySelector("#tg-n"), TAG_COUNTS.map(k => `<button data-k="${k}" class="${k === n ? "on" : ""}">${k} 張</button>`).join(""));
    draw();
    root.querySelector("#tg-n").onclick = e => { const b = e.target.closest("button"); if (b) { n = +b.dataset.k; draw(); } };
    root.querySelector("#tg-ok").onclick = async () => {
      const ok = root.querySelector("#tg-ok"), err = root.querySelector("#tg-err");
      ok.disabled = true; ok.textContent = "產生中…"; err.textContent = "";
      const used = new Set(), codes = Array.from({ length: n }, () => { const c = newTagCode(used); used.add(c); return c; });
      let got = null;
      try { got = await run(codes); } catch (e) {
        if (!handleApiError(e)) err.textContent = e.code === "not_manager" ? "只有收容所管理者可以產生號碼牌" : "沒有產生成功，請再試一次";
      }
      const c = (got || []).filter(x => TAG_RE.test(x));
      if (!c.length) { ok.disabled = false; ok.textContent = "產生"; if (got && !err.textContent) err.textContent = "沒有產生成功，請再試一次"; return; }
      const d = { p: place, c }; saveLastTags(d); tagResultSheet(d, true);
    };
  });
}
function tagResultSheet(d, fresh) {
  sheet(`<h2>${fresh ? `已產生 ${d.c.length} 張空白號碼牌` : esc(tagTitle(d))}</h2>
    <p class="hint">${fresh ? "請現在列印或寄出（這支手機會記住，之後也能重印）。" : ""}一張 A4 排 6 張，沿虛線剪開，放在服務台備用。</p>
    <div class="tagprev">${d.c.slice(0, 2).map(c => tagCard(d.p, c)).join("")}</div>
    <p class="hint">編號：${esc(d.c.join("、"))}</p>
    <div class="lblacts"><button class="go" id="tgPrint">🖨 列印／存成 PDF</button>
      <a class="lblmail" href="${esc(tagMailHref(d))}">✉ 用 Email 寄給同仁</a>
      <button data-close>關閉</button></div>`, root => {
    root.querySelector("#tgPrint").onclick = () => printTags(d);
  });
}

function sheet(html, onMount) {
  closeSheet();
  const bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "sheet";
  setHTML(bg, `<div class="sheet">${html}</div>`);
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) closeSheet(); });
  document.body.append(bg); onMount && onMount(bg);
}
function closeSheet() { const s = $("#sheet"); if (s) s.remove(); }

// ===== 一般畫面：圖文選單每一格直接打開（收容所資訊｜我要反映｜緊急聯絡｜工作人員專區｜簽退） =====
const PUB_TITLE = { info: "收容所資訊", report: "我要反映", sos: "緊急聯絡", staff: "工作人員專區", signout: "簽退" };
const REPORT_CATS = ["身體不適", "缺物資", "環境問題", "其他"];
const go = q => { location.href = location.pathname + q; };
const closeLiff = () => { try { if (window.liff && liff.isInClient()) return liff.closeWindow(); } catch (e) {} history.length > 1 ? history.back() : go("?v=info"); };
// LINE 的 QR 掃描器（掃簽到碼、物資標籤、號碼牌）
const openScanner = () => { try { if (REAL) return liff.openWindow({ url: "https://line.me/R/nv/QRCode", external: false }); } catch (e) {} location.href = "https://line.me/R/nv/QRCode"; };
const linkify = t => esc(t).replace(/\b(119|110|1999|0\d{1,2}-?\d{6,8})\b/g, n => `<a href="tel:${n.replace(/-/g, "")}">${n}</a>`);

function pubHead(title, sub) { return `<div class="pub-h"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`; }
function renderPub() {
  $("#bar").hidden = REAL; $("#bar .in").style.display = "none";   // 原型只留示範切換列
  document.title = PUB_TITLE[S.view];
  const P = S.pub, app = $("#app");
  if (P.done) { setHTML(app, P.done); return; }
  if (S.view === "sos") return renderSos();
  if (S.view === "info") {
    if (!P.info) { setHTML(app, pubHead("收容所資訊") + `<div class="blocked"><p>${esc(P.msg || "載入中…")}</p></div>`); return; }
    const qa = P.info.qa.filter(q => q.kw !== "緊急聯絡");
    const order = q => q.type === "公告" ? 0 : 1;
    setHTML(app, pubHead("收容所資訊", "最新公告、用餐與物資、生活規定") +
      qa.sort((a, b) => order(a) - order(b)).map(q => `<div class="card ${q.type === "公告" ? "notice" : ""}">
        ${q.type === "公告" ? "<small>公告</small>" : ""}<h3>${esc(q.title)}</h3><div class="body">${linkify(q.text)}</div></div>`).join("") +
      `<div class="sec">開設中的收容所 <small>${P.info.shelters.length} 所</small></div>
       <div class="shelters">${P.info.shelters.map(o => `<div>🏠 ${esc(o.name)}</div>`).join("") || "<div>目前沒有開設中的收容所</div>"}</div>
       <div class="card"><small>地址與交通請洽現場工作人員或縣府服務專線。</small></div>
       <div class="biglinks"><button class="biglink" data-go="?v=report"><span class="ic">🙋</span><span>我要反映<small>身體不適、缺物資、環境問題</small></span></button>
         <button class="biglink" data-go="?v=sos"><span class="ic">📞</span><span>緊急聯絡</span></button></div>`);
    return;
  }
  if (S.view === "report") return renderReport();
  if (S.view === "staff") return renderStaff();
  if (S.view === "signout") return renderSignout();
}
function renderSos() {
  // 電話按鈕不等資料載入，打開就能撥
  const em = S.pub.info && S.pub.info.qa.find(q => q.kw === "緊急聯絡");
  setHTML($("#app"), pubHead("緊急聯絡", "有生命危險請直接撥打") + `<div class="biglinks">
      <a class="biglink red" href="tel:119"><span class="ic">🚑</span><span>撥打 119<small>緊急救護、火警</small></span></a>
      <a class="biglink blue" href="tel:110"><span class="ic">🚓</span><span>撥打 110<small>報案</small></span></a></div>
    ${em ? `<div class="card"><h3>${esc(em.title)}</h3><div class="body">${linkify(em.text)}</div></div>` : `<div class="card"><small>${esc(S.pub.msg || "載入其他聯絡方式…")}</small></div>`}
    <div class="biglinks"><button class="biglink" data-go="?v=report"><span class="ic">🙋</span><span>不緊急，我要反映</span></button></div>`);
}
// 我要反映的表單種類：社會處（hq）｜在班的工作人員（staff）｜其他人，含志工、沒在班的工作人員（public）
function reportMode() {
  const me = S.pub.me;
  if (!me) return "public";
  if (me.role === "社會處" && me.state !== "pending" && me.state !== "none") return "hq";
  if (me.state === "on" && me.kind === "工作人員") return "staff";
  return "public";
}
function renderReport() {
  const P = S.pub, f = P.form;
  if (!P.info) { setHTML($("#app"), pubHead("我要反映") + `<div class="blocked"><p>${esc(P.msg || "載入中…")}</p></div>`); return; }
  const mode = reportMode();
  if (mode !== "public") {
    // 工作人員版：和本所總覽的「記錄事件」同一張表單（類別、嚴重程度、說明）；社會處多一個「哪一所」
    const L = P.log || (P.log = { cat: "", sev: "中", o: "", text: "" });
    const opens = P.info.shelters;
    setHTML($("#app"), pubHead("我要反映", mode === "hq" ? "社會處交辦：送出後 LINE 通知該所在班的管理者，處理完會回報您" : "工作人員：記錄到您派駐的收容所，本所總覽的待處理事件會看到") + `<div class="form">
      ${mode === "hq" ? `<label>哪一所？<b>*</b></label><div class="pick" id="lg-o">${opens.map(o => `<button data-lgo="${esc(o.id)}" class="${L.o === o.id ? "on" : ""}">${esc(o.name)}</button>`).join("") || "目前沒有開設中的收容所"}</div>` : ""}
      <label>類別 <b>*</b></label><div class="pick">${CATS.map(c => `<button data-lgc="${c}" class="${L.cat === c ? "on" : ""}">${c}</button>`).join("")}</div>
      <label>嚴重程度</label><div class="pick">${SEVS.map(v => `<button data-lgs="${v}" class="${L.sev === v ? "on" : ""}">${v}</button>`).join("")}</div>
      ${/緊急|高/.test(L.sev) ? `<p class="err">⚠ 緊急狀況請同時電話通報。</p>` : ""}
      <label>發生什麼事 <b>*</b></label><textarea id="lg-text" maxlength="1000" placeholder="例：2 樓男廁洗手台漏水，地板濕滑，已放警示牌">${esc(L.text)}</textarea>
      ${P.msg ? `<p class="err">${esc(P.msg)}</p>` : ""}
    </div>
    <div class="biglinks"><button class="biglink blue" id="sendLog" ${!S.busy ? "" : "disabled"}><span class="ic">📨</span><span>${S.busy ? "送出中…" : "送出"}</span></button></div>`);
    return;
  }
  const places = [...P.info.shelters, { id: "", name: "不在收容所" }];
  setHTML($("#app"), pubHead("我要反映", "現場工作人員會盡快處理") + `<div class="form">
      <label>要反映什麼？<b>*</b></label><div class="pick" id="cats">${REPORT_CATS.map(c => `<button data-cat="${c}" class="${f.cat === c ? "on" : ""}">${c}</button>`).join("")}</div>
      ${f.cat === "身體不適" ? `<p class="err">情況緊急請直接撥 119，或找現場工作人員。</p>` : ""}
      <label>您在哪裡？<b>*</b></label><div class="pick" id="places">${places.map(o => `<button data-o="${o.id}" data-where="${esc(o.name)}" class="${f.where === o.name ? "on" : ""}">${esc(o.name)}</button>`).join("")}</div>
      <label>說明（可不填）</label><textarea id="rtext" maxlength="500" placeholder="例：A 區 3 號床，頭很暈">${esc(f.text)}</textarea>
      ${P.msg ? `<p class="err">${esc(P.msg)}</p>` : ""}
    </div>
    <div class="biglinks"><button class="biglink blue" id="sendReport" ${f.cat && f.where && !S.busy ? "" : 'disabled style="opacity:.4"'}><span class="ic">📨</span><span>${S.busy ? "送出中…" : "送出反映"}</span></button></div>`);
}
function renderStaff() {
  const me = S.pub.me, app = $("#app");
  if (!me) { setHTML(app, pubHead("工作人員專區") + `<div class="blocked"><p>${esc(S.pub.msg || "載入中…")}</p></div>`); return; }
  const hello = me.name ? `${me.name}（${me.role || me.kind}）您好` : "";
  const ap = S.pub.ap;
  if (me.state === "none") setHTML(app, pubHead("工作人員專區", "開通後才能使用工作人員功能") + `<div class="card"><div class="body">社會處派出的人員、支援社工和志工，請填寫以下資料申請開通，由社會處審核。</div></div>
      <div class="form"><label>姓名 <b>*</b><input id="ap-name" maxlength="40" value="${esc(ap.name)}" placeholder="請填真實姓名" autocomplete="name"></label>
        <label>單位 <b>*</b><input id="ap-unit" maxlength="40" value="${esc(ap.unit)}" placeholder="例：苗栗縣社會處、○○社福協會"></label>
        <label>聯絡電話 <b>*</b><input id="ap-phone" maxlength="20" inputmode="tel" value="${esc(ap.phone)}" placeholder="例：0912345678" autocomplete="tel"></label>
        <p class="err" id="ap-err">${esc(S.pub.msg || "")}</p></div>
      <div class="biglinks"><button class="biglink blue" id="apply" ${S.busy ? "disabled" : ""}><span class="ic">📝</span><span>${S.busy ? "送出中…" : "送出申請"}<small>LINE 名稱「${esc(me.line || "")}」</small></span></button></div>`);
  else if (me.state === "pending") setHTML(app, pubHead("工作人員專區") + `<div class="done"><div class="big">⏳</div><h2>開通申請審核中</h2><p>社會處審核通過後，LINE 會通知您。到現場掃服務台的「工作人員簽到」QR 就能開始上班。</p></div>`);
  else if (me.role === "社會處" && me.state === "off") setHTML(app, pubHead("工作人員專區", hello) + hqLinks());
  else if (me.state === "off") setHTML(app, pubHead("工作人員專區", hello + "，目前未上班") + `<div class="card"><div class="body">到現場後，掃服務台張貼的「工作人員簽到」QR Code 簽到。</div></div>
      <div class="biglinks"><button class="biglink blue" id="scanner"><span class="ic">📷</span><span>打開 QR 掃描器<small>掃簽到 QR</small></span></button></div>`);
  else setHTML(app, pubHead("工作人員專區", hello + "，上班中") + (me.role === "社會處" ? hqLinks() : "") + `<div class="biglinks">
      ${me.kind === "工作人員" ? `<button class="biglink" data-go="?v=ops"><span class="ic">📊</span><span>本所畫面<small>狀況、待處理事件、記錄事件</small></span></button>` : ""}
      <button class="biglink" id="scanner"><span class="ic">📷</span><span>掃描 QR<small>物資標籤、居民號碼牌</small></span></button>
      <button class="biglink" data-go="?"><span class="ic">📦</span><span>物資<small>入庫、發放、盤點</small></span></button>
      <button class="biglink" data-go="?v=signout"><span class="ic">👋</span><span>簽退（下班）</span></button></div>`);
}
// 社會處的入口（選單之外，也從工作人員專區進得去）
function hqLinks() {
  return `<div class="biglinks"><button class="biglink blue" data-go="?v=hq"><span class="ic">🧭</span><span>指揮台<small>建立災害、開設收容所、簽到 QR</small></span></button>
    <button class="biglink" data-go="?v=inbox"><span class="ic">📥</span><span>待我處理<small>工作人員申請核准</small></span></button>
    <button class="biglink" data-go="?v=sites"><span class="ic">🏠</span><span>各所現況<small>開設中的收容所狀況</small></span></button></div>`;
}
function renderSignout() {
  const me = S.pub.me, app = $("#app");
  if (!me) { setHTML(app, pubHead("簽退") + `<div class="blocked"><p>${esc(S.pub.msg || "載入中…")}</p></div>`); return; }
  setHTML(app, pubHead("簽退", "確認後就會下班，選單恢復成一般版") + `<div class="rcard"><h2>${esc(me.name)}</h2><div class="meta">${esc(me.role || me.kind)}・上班中</div></div>
    ${S.pub.msg ? `<p class="err" style="margin:10px 16px">${esc(S.pub.msg)}</p>` : ""}
    <div class="ract"><button class="main" id="doSignout" style="background:var(--red);border-color:var(--red)" ${S.busy ? "disabled" : ""}>${S.busy ? "簽退中…" : "確定簽退"}</button>
      <button id="cancel" style="grid-column:1 / -1">取消，繼續上班</button></div>`);
}
function pubDone(icon, title, text, again) {
  S.pub.done = `<div class="done"><div class="big">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
    <div class="biglinks">${again ? `<button class="biglink" id="again"><span class="ic">↺</span><span>${esc(again)}</span></button>` : ""}
    <button class="biglink" id="close"><span class="ic">✕</span><span>關閉</span></button></div>`;
  render();
}
async function pubCall(a, f) {
  try { return await api.pub(a, f); }
  catch (e) { if (!handleApiError(e)) { S.pub.msg = "網路不穩，請稍後再試。"; S.busy = false; render(); } return null; }
}
async function loadPub() {
  const P = S.pub;
  if (S.view === "report") {
    // 我要反映：同一個按鈕，依身分打開不同的表單（在班工作人員→記錄事件、社會處→選所記錄事件、其他人→簡易反映）
    const [d, me] = await Promise.all([pubCall("info"), pubCall("me")]);
    if (d) { P.info = d; P.me = me; P.msg = ""; } return render();
  }
  if (S.view === "info" || S.view === "sos") { const d = await pubCall("info"); if (d) { P.info = d; P.msg = ""; } return render(); }
  const me = await pubCall("me"); if (!me) return;
  P.me = me; P.msg = "";
  // 簽退畫面但不在班：順手解除加乘選單（名冊和選單對不上時讓它自己恢復）
  if (S.view === "signout" && me.state !== "on") { await pubCall("signout"); return pubDone("🙂", "您目前不在班", "不需要簽退，下方選單已恢復成一般版。"); }
  render();
}
document.addEventListener("click", async e => {
  if (!PUB_VIEWS.includes(S.view)) return;
  const t = e.target.closest("button, a"); if (!t) return;
  const P = S.pub, f = P.form;
  if (t.dataset.go != null) return go(t.dataset.go);
  if (t.id === "close") return closeLiff();
  if (t.id === "scanner") return openScanner();
  if (t.id === "cancel") return closeLiff();
  if (t.id === "again") { P.done = ""; P.form = { cat: "", o: "", where: "", text: "" }; P.log = null; return render(); }
  if (t.dataset.cat) { f.text = ($("#rtext") || {}).value || f.text; f.cat = t.dataset.cat; P.msg = ""; return render(); }
  if (t.dataset.where != null) { f.text = ($("#rtext") || {}).value || f.text; f.o = t.dataset.o; f.where = t.dataset.where; P.msg = ""; return render(); }
  if (t.dataset.lgo != null || t.dataset.lgc || t.dataset.lgs) {
    const L = P.log; L.text = ($("#lg-text") || {}).value || L.text;
    if (t.dataset.lgo != null) L.o = t.dataset.lgo;
    if (t.dataset.lgc) { L.cat = t.dataset.lgc; L.sev = SEV_OF[L.cat] || "中"; }
    if (t.dataset.lgs) L.sev = t.dataset.lgs;
    P.msg = ""; return render();
  }
  if (t.id === "sendLog" && !S.busy) {
    const L = P.log, mode = reportMode(); L.text = $("#lg-text").value.trim();
    if (mode === "hq" && !L.o) { P.msg = "請選哪一所"; return render(); }
    if (!L.cat) { P.msg = "請選類別"; return render(); }
    if (!L.text) { P.msg = "請寫發生什麼事"; return render(); }
    S.busy = true; P.msg = ""; render();
    let ok = false;
    try { await (mode === "hq" ? api.hq("hqLog", { o: L.o, cat: L.cat, sev: L.sev, text: L.text }) : api.ops("report", { cat: L.cat, sev: L.sev, text: L.text, g: "" })); ok = true; }
    catch (e) { if (!handleApiError(e)) P.msg = e.code === "not_on_duty" ? "您目前不在班，請先到現場掃簽到 QR。" : "網路不穩，沒有送出，請再按一次。"; }
    S.busy = false;
    if (ok) { const cat = L.cat; P.log = null; return pubDone("📝", "已記錄", `（${cat}）${mode === "hq" ? "已 LINE 通知該所在班的管理者；現場按「已解決」時會回報您。" : "本所工作人員會在「待處理事件」看到。"}${/緊急|高/.test(L.sev) ? "緊急狀況請同時電話通報。" : ""}`, "再記錄一件"); }
    return render();
  }
  if (t.id === "sendReport" && f.cat && f.where && !S.busy) {
    f.text = $("#rtext").value.trim(); S.busy = true; render();
    const d = await pubCall("feedback", { cat: f.cat, o: f.o, where: f.where, text: f.text }); S.busy = false;
    if (d) pubDone("🙋", "已收到您的反映", `（${f.cat}）現場工作人員會盡快處理。緊急狀況請直接找現場工作人員或撥 119。`, "再反映一件事");
    return;
  }
  if (t.id === "apply" && !S.busy) {
    const ap = P.ap, val = id => $(id).value.replace(/["\\]/g, "").trim();
    ap.name = val("#ap-name"); ap.unit = val("#ap-unit"); ap.phone = val("#ap-phone");
    if (!ap.name || !ap.unit || !ap.phone) { P.msg = "姓名、單位、聯絡電話都要填"; return render(); }
    if (!/^[0-9+\-#() ]{6,20}$/.test(ap.phone)) { P.msg = "聯絡電話格式不對，請只填數字"; return render(); }
    P.msg = ""; S.busy = true; render();
    const d = await pubCall("apply", { name: ap.name, unit: ap.unit, phone: ap.phone }); S.busy = false;
    if (d) { P.me = { ...P.me, ...d }; render(); }
    return;
  }
  if (t.id === "doSignout" && !S.busy) {
    S.busy = true; render();
    const d = await pubCall("signout"); S.busy = false;
    if (d) pubDone("👋", d.already ? "您目前不在班" : `${P.me.name} 已簽退`, d.already ? "下方選單已恢復成一般版。" : "辛苦了！下方選單已恢復成一般版。");
  }
});

// ===== 結報（?v=report&o=…，限社會處）：hqReport 回原始資料，這裡統計；撤收中可以確認結案（hqFinish） =====
// 後端不回傳姓名、電話、證號、照護說明；每張表最多 100 筆，到上限時畫面會註明
const F = { d: null, msg: "", busy: false, full: false };   // full：完整版（含事件細節，可能有姓名，限社會處）
const MOVE_TYPES = ["入庫", "發放", "調撥", "報廢", "盤點調整"];
const DESTS = ["返家", "投靠親友", "轉其他收容所", "送醫", "其他"];
const NOT_EVENT = new Set(["整備回報", "交班紀錄"]);   // 不算「事件」：整備回報是開設前的檢查，交班紀錄是工作日誌
const LIMIT = 100;
const two = n => String(n).padStart(2, "0");
function fmtFull(iso) {
  const d = new Date(iso); if (!iso || isNaN(d)) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
function fmtShort(t) { const d = new Date(t); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`; }
function fmtDur(ms) {
  if (!(ms > 0)) return "0 小時";
  const h = Math.round(ms / 3600e3), d = Math.floor(h / 24);
  return d ? `${d} 天 ${h % 24} 小時` : `${h} 小時`;
}
// 處理用時：不到 1 小時用分鐘，不到 1 天用「時＋分」，再長用天
function fmtSpan(ms) {
  if (!(ms >= 0)) return "";
  const m = Math.round(ms / 60e3);
  if (m < 60) return `${m} 分鐘`;
  if (m < 1440) return `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ""}`;
  return fmtDur(ms);
}
const countBy = (list, key) => list.reduce((m, x) => { const k = key(x) || "未填"; m[k] = (m[k] || 0) + 1; return m; }, {});
const ordered = (m, order) => Object.entries(m).sort((a, b) => ((order.indexOf(a[0]) + 1) || 99) - ((order.indexOf(b[0]) + 1) || 99) || b[1] - a[1]);
const joinCounts = (pairs, unit) => pairs.map(([k, n]) => `${k} ${n}${unit || ""}`).join("、") || "無";
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : "—";
const isDone = p => /已解決|已結案/.test(p || "");
// 報到 +1、離所 −1 的時間序列（沒有離所時間的算到結束；同一時間先算離所）
function inOutEvents(rs, end) {
  const ev = [];
  for (const r of rs) {
    const a = Date.parse(r.in); if (isNaN(a)) continue;
    const b = Date.parse(r.out); ev.push([a, 1], [isNaN(b) ? end : Math.max(a, b), -1]);
  }
  return ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
function peakInside(rs, end) {
  let cur = 0, max = 0;
  for (const [, d] of inOutEvents(rs, end || Date.now())) { cur += d; if (cur > max) max = cur; }
  return max;
}
// 每日進出：報到、離所、當日最高在所、當日事件數（最多 31 天）
function dailyRows(rs, evs, start, end) {
  const s = new Date(isNaN(start) ? end : start); s.setHours(0, 0, 0, 0);
  const io = inOutEvents(rs, end), rows = [];
  let i = 0, cur = 0;
  for (let d = s.getTime(); d <= end && rows.length < 31; ) {
    const next = new Date(d); next.setDate(next.getDate() + 1); const n = next.getTime();
    let peak = cur, ins = 0, outs = 0;
    while (i < io.length && io[i][0] < n) {
      const [t, k] = io[i++]; cur += k; if (cur > peak) peak = cur;
      if (k > 0) ins++; else if (t < end) outs++;
    }
    rows.push({ day: `${new Date(d).getMonth() + 1}/${new Date(d).getDate()}`, ins, outs, peak, ev: evs.filter(e => e.t >= d && e.t < n).length });
    d = n;
  }
  return rows;
}
// 處理紀錄每一行：「MM/DD HH:mm 姓名 動作：內容」→ { t, text }（年份取發生時間的年；跨年的往後加一年）
function logSteps(log, base) {
  const y = new Date(isNaN(base) ? Date.now() : base).getFullYear();
  return String(log || "").split("\n").map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}) (.*)$/);
    if (!m) return { t: NaN, text: s };
    let t = new Date(y, m[1] - 1, +m[2], +m[3], +m[4]).getTime();
    if (!isNaN(base) && t < base - 180 * 864e5) t = new Date(y + 1, m[1] - 1, +m[2], +m[3], +m[4]).getTime();
    return { t, text: m[5] };
  });
}
function eventOf(l) {
  const t = Date.parse(l.at) || Date.parse(l.made), steps = logSteps(l.log, t), done = isDone(l.prog);
  const fin = [...steps].reverse().find(s => /標記已解決|已結案/.test(s.text) && !isNaN(s.t));
  const doneAt = done ? (fin ? fin.t : Date.parse(l.upd)) : NaN;
  const act = steps.find(s => !isNaN(s.t) && /認領|開始處理|接手|指示|標記已解決/.test(s.text));
  return { title: l.title || l.cat || "事件", text: l.text || "", cat: l.cat || "未填", sev: l.sev || "未填", prog: l.prog || "待處理",
           src: l.src || "", who: l.who || "", help: l.help || "", done, t,
           hq: l.hq === true || l.hq === "true" || l.src === "社會處" || steps.some(s => /社會處/.test(s.text)),
           res: l.src === "民眾反映" || l.cat === "居民反映",
           urgent: /緊急|高/.test(l.sev || ""), steps, dur: done && !isNaN(t) && doneAt >= t ? doneAt - t : NaN,
           react: act && !isNaN(t) && act.t >= t ? act.t - t : NaN };
}
function itemOf(r) {
  const p = r.properties_value || {};
  return { name: txt(p["品名"]) || "（未命名）", unit: txt(p["單位"]) || "", stock: num(p["目前庫存"]), safety: num(p["安全庫存"]) };
}
function computeReport(d) {
  const o = d.opening, rs = d.residents || [], logs = d.logs || [], mv = d.moves || [], att = d.att || [];
  const start = Date.parse(o.openAt), end = Date.parse(o.closeAt) || Date.now();
  const cares = rs.map(r => String(r.care || "").split(/[,、]/).map(x => x.trim()).filter(Boolean));
  const careCount = {}; for (const c of cares) for (const k of c) careCount[k] = (careCount[k] || 0) + 1;
  // 人：停留時間（已離所的用離所時間，還在的算到結束）、去向
  const stays = rs.map(r => { const a = Date.parse(r.in), b = Date.parse(r.out) || end; return isNaN(a) ? NaN : b - a; }).filter(x => x >= 0);
  const left = rs.filter(r => r.status === "已離所");
  const dests = ordered(countBy(left, r => DESTS.includes(r.dest) ? r.dest : "未記錄"), DESTS.concat("未記錄"));
  // 事：不含整備回報、交班紀錄
  const all = logs.filter(l => l.cat !== "整備回報").map(eventOf), evs = all.filter(e => !NOT_EVENT.has(e.cat));
  const open = evs.filter(e => !e.done), urgent = evs.filter(e => e.urgent);
  const byCat = {}; for (const e of evs) { const c = byCat[e.cat] || (byCat[e.cat] = [0, 0]); c[0]++; if (e.done) c[1]++; }
  // 物：異動依品項加總，再對上結案時的庫存
  const moves = {};
  for (const m of mv) {
    const name = String(m.sum || "").trim().split(/\s+/)[0] || "（未命名）", type = m.type || "其他";
    const t = moves[name] || (moves[name] = {}); t[type] = (t[type] || 0) + (+m.qty || 0);
  }
  const stock = (d.items || []).map(itemOf);
  const names = [...new Set(stock.map(x => x.name).concat(Object.keys(moves)))].sort((a, b) => a.localeCompare(b));
  const items = names.map(n => { const s = stock.find(x => x.name === n); return { name: n, mv: moves[n] || {}, unit: s ? s.unit : "", stock: s ? s.stock : null, safety: s ? s.safety : 0 }; });
  const low = items.filter(x => x.stock !== null && x.safety > 0 && x.stock < x.safety);
  let hours = 0, noOut = 0;
  for (const a of att) { const i = Date.parse(a.in), x = Date.parse(a.out); if (isNaN(i) || isNaN(x)) { noOut++; continue; } hours += Math.max(0, x - i) / 3600e3; }
  const R = {
    o, start, end, ongoing: !o.closeAt,
    total: rs.length, peak: peakInside(rs, end), inside: rs.filter(r => r.status && r.status !== "已離所").length,
    out: rs.filter(r => r.status === "外出").length, late: rs.filter(r => r.status === "未返").length,
    stay: avg(stays), left: left.length, dests, noDest: left.filter(r => !DESTS.includes(r.dest)).length,
    ages: ordered(countBy(rs, r => r.age), AGES), careN: cares.filter(c => c.length).length, cares: ordered(careCount, CARES),
    ev: evs.length, done: evs.length - open.length, open: open.length, cats: ordered(countBy(evs, e => e.cat), CATS), byCat,
    sevs: ordered(countBy(evs, e => e.sev), SEVS), urgentN: urgent.length, urgentOpen: urgent.filter(e => !e.done).length,
    urgentDur: avg(urgent.map(e => e.dur).filter(x => x >= 0)), react: avg(evs.map(e => e.react).filter(x => x >= 0)),
    hqN: evs.filter(e => e.hq).length, resN: evs.filter(e => e.res).length, resDone: evs.filter(e => e.res && e.done).length,
    shiftLogs: all.filter(e => e.cat === "交班紀錄").length,
    days: dailyRows(rs, evs, start, end),
    items, low: low.map(x => x.name),
    shifts: att.length, people: new Set(att.map(a => a.person).filter(Boolean)).size, hours: Math.round(hours * 10) / 10, noOut,
    capped: ["residents", "logs", "moves", "att"].filter(k => (d[k] || []).length >= LIMIT),
    // 完整版才用：事件細節（未解決的排最前面，再來緊急／高，最後依發生時間）
    events: evs.slice().sort((a, b) => (a.done - b.done) || (b.urgent - a.urgent) || ((a.t || 0) - (b.t || 0))),
  };
  R.verdicts = verdicts(R);
  return R;
}
// 結論：四段（安置、事件、撤離、物資與人力），每段一個燈號 ok｜warn｜bad 和一句話
function verdicts(R) {
  const V = [];
  V.push({ k: "安置", lv: "ok", t: `累計收容 ${R.total} 人，最高同時在所 ${R.peak} 人${R.stay >= 0 ? `，平均停留 ${fmtDur(R.stay)}` : ""}。`
    + (R.careN ? `需關懷 ${R.careN} 人（${joinCounts(R.cares, " 人")}）。` : "沒有需關懷的居民。") });
  const evLv = R.urgentOpen ? "bad" : R.open ? "warn" : "ok";
  V.push({ k: "事件", lv: evLv, t: !R.ev ? "沒有事件紀錄。" : `共 ${R.ev} 件，已解決 ${R.done} 件（${pct(R.done, R.ev)}）`
    + (R.open ? `，未解決 ${R.open} 件${R.urgentOpen ? `（緊急或高 ${R.urgentOpen} 件）` : ""}` : "，全部處理完畢")
    + (R.urgentN ? `。緊急或高嚴重度 ${R.urgentN} 件${R.urgentDur >= 0 ? `，平均 ${fmtSpan(R.urgentDur)}解決` : ""}` : "")
    + (R.react >= 0 ? `；平均 ${fmtSpan(R.react)}開始處理` : "")
    + (R.hqN ? `；社會處介入 ${R.hqN} 件` : "") + (R.resN ? `；居民反映 ${R.resN} 件，已處理 ${R.resDone} 件` : "") + "。" });
  const destT = R.left ? `離所去向：${joinCounts(R.dests.filter(([k]) => k !== "未記錄"), " 人") }${R.noDest ? `；未記錄去向 ${R.noDest} 人` : ""}。` : "";
  if (!R.total) V.push({ k: "撤離", lv: "ok", t: "沒有收容居民。" });
  else if (!R.inside) V.push({ k: "撤離", lv: R.noDest ? "warn" : "ok", t: `全部 ${R.total} 人已安全離所，沒有人未返。${destT}` });
  else V.push({ k: "撤離", lv: R.ongoing ? "warn" : "bad", t: `${R.ongoing ? "目前" : "結案時"}仍有 ${R.inside} 人未離所`
    + (R.out || R.late ? `（外出 ${R.out} 人、未返 ${R.late} 人）` : "") + `，已離所 ${R.left} 人。${destT}` });
  const given = R.items.map(x => [x.name, x.mv["發放"] || 0, x.unit]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const resLv = R.low.length || R.noOut ? "warn" : "ok";
  V.push({ k: "物資與人力", lv: resLv, t: (given.length ? `發放最多：${given.map(([n, q, u]) => `${n} ${q}${u ? " " + u : ""}`).join("、")}。` : "沒有物資發放紀錄。")
    + (R.low.length ? `結案時 ${R.low.length} 項低於安全庫存（${R.low.join("、")}）。` : "")
    + `出勤 ${R.shifts} 人次、${R.people} 人，共 ${R.hours} 小時${R.noOut ? `（未簽退 ${R.noOut} 筆不計）` : ""}。` });
  return V;
}
const LV_ICON = { ok: "✅", warn: "⚠", bad: "⛔" };
function headline(R) {
  const bad = R.verdicts.filter(v => v.lv !== "ok");
  return bad.length ? `${bad.length} 項需要注意：${bad.map(v => v.k).join("、")}` : (R.ongoing ? "目前一切正常" : "本次開設順利完成：人員安全撤離、事件全數處理");
}
const itemText = t => MOVE_TYPES.filter(k => t[k]).concat(Object.keys(t).filter(k => !MOVE_TYPES.includes(k) && t[k])).map(k => `${k} ${t[k]}`).join("、") || "無異動";
// 純文字摘要：hqFinish 寫進 Notion 的「結報摘要」和開設頁面內文。只放結論和數字，不放事件內容（避免個資）
function reportText(R) {
  const L = [
    `開設：${R.o.name}`,
    `期間：${fmtFull(R.o.openAt) || "未記錄"} ～ ${R.ongoing ? `${fmtFull(new Date().toISOString())}（結案時）` : fmtFull(R.o.closeAt)}，共 ${fmtDur(R.end - R.start)}`,
    `結論：${headline(R)}`,
    ...R.verdicts.map(v => `${LV_ICON[v.lv]} ${v.k}：${v.t}`),
    `年齡層：${joinCounts(R.ages, " 人")}`,
    `事件類別：${joinCounts(R.cats, " 件")}`,
    `物資：${R.items.map(x => `${x.name}（${itemText(x.mv)}${x.stock !== null ? `；結存 ${x.stock}` : ""}）`).join("；") || "沒有物資異動"}`,
  ];
  if (R.capped.length) L.push(`註：部分資料超過 ${LIMIT} 筆，只統計前 ${LIMIT} 筆`);
  return L.join("\n").slice(0, 1900);
}
function reportHtml(R) {
  const kv = (k, v, cls) => `<div class="prow"><span class="n">${esc(k)}</span><span class="meta${cls ? " " + cls : ""}">${esc(v)}</span></div>`;
  const list = (pairs, unit) => pairs.map(([k, n]) => kv(k, `${n} ${unit}`)).join("") || kv("無", "");
  const big = (n, label, cls) => `<div class="stat${cls ? " " + cls : ""}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  const bar = (k, n, max, unit) => `<div class="prow bar"><span class="n">${esc(k)}</span><span class="track"><i style="width:${max ? Math.round(n / max * 100) : 0}%"></i></span><span class="meta">${esc(n)} ${esc(unit)}</span></div>`;
  const stLabel = R.o.status === "已撤收" ? "已結案" : R.o.status;
  const allOk = R.verdicts.every(v => v.lv === "ok");
  const maxDest = Math.max(1, ...R.dests.map(x => x[1])), maxPeak = Math.max(1, ...R.days.map(x => x.peak));
  let h = `<div class="rep-h"><h2>${esc(R.o.name || "收容所")}${R.full ? "　結報（完整版）" : "　結報"}</h2>
      <div class="meta">${esc(fmtFull(R.o.openAt) || "未記錄")} ～ ${R.ongoing ? "進行中" : esc(fmtFull(R.o.closeAt))}・共 ${esc(fmtDur(R.end - R.start))}・<b>${esc(stLabel)}</b></div></div>
    <div class="rep-head ${allOk ? "ok" : "warn"}">${allOk ? "✅" : "⚠"} ${esc(headline(R))}</div>
    <div class="sec">結論</div>
    <div class="verdicts">${R.verdicts.map(v => `<div class="vd ${v.lv}"><b>${LV_ICON[v.lv]} ${esc(v.k)}</b><span>${esc(v.t)}</span></div>`).join("")}</div>
    <div class="sec">人數與進出</div>
    <div class="stats">${big(R.total, "累計收容")}${big(R.peak, "最高同時在所")}${big(R.stay >= 0 ? fmtDur(R.stay) : "—", "平均停留")}</div>
    <div class="stats">${big(R.left, "已離所")}${big(R.inside, "仍未離所", R.inside ? "bad" : "")}${big(R.late, "未返", R.late ? "bad" : "")}</div>
    ${R.left ? `<div class="sec">離所去向 <small>安全撤離</small></div><div class="plist">${R.dests.map(([k, n]) => bar(k, n, maxDest, "人")).join("")}</div>` : ""}
    ${R.days.length ? `<div class="sec">每日進出 <small>報到／離所／當日最高在所／事件</small></div>
      <div class="plist">${R.days.map(x => `<div class="prow bar day"><span class="n">${esc(x.day)}</span><span class="track"><i style="width:${Math.round(x.peak / maxPeak * 100)}%"></i></span>
        <span class="meta">+${esc(x.ins)}　−${esc(x.outs)}　最高 ${esc(x.peak)}　事件 ${esc(x.ev)}</span></div>`).join("")}</div>` : ""}
    <div class="sec">年齡層 <small>需關懷 ${esc(R.careN)} 人</small></div><div class="plist">${list(R.ages, "人")}</div>
    ${R.cares.length ? `<div class="sec">關懷類別</div><div class="plist">${list(R.cares, "人")}</div>` : ""}
    <div class="sec">事件與處理 <small>不含整備回報、交班紀錄${R.shiftLogs ? `（交班紀錄 ${esc(R.shiftLogs)} 筆）` : ""}</small></div>
    <div class="stats">${big(R.ev, "事件總數")}${big(pct(R.done, R.ev), "已解決")}${big(R.open, "未解決", R.open ? "bad" : "")}</div>
    <div class="stats">${big(R.urgentN, "緊急／高")}${big(R.urgentDur >= 0 ? fmtSpan(R.urgentDur) : "—", "緊急平均解決")}${big(R.hqN, "社會處介入")}</div>
    <div class="sec">依類別 <small>已解決／件數</small></div>
    <div class="plist">${Object.entries(R.byCat).sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, ok]]) => kv(k, `${ok}／${n} 件`, ok < n ? "bad" : "ok")).join("") || kv("無", "")}</div>
    <div class="sec">依嚴重程度</div><div class="plist">${list(R.sevs, "件")}</div>
    <div class="sec">物資 <small>異動數量與結案時庫存</small></div>
    <div class="plist">${R.items.map(x => `<div class="prow stk${R.low.includes(x.name) ? " low" : ""}"><span class="n">${esc(x.name)}</span>
      <span class="meta">${esc(itemText(x.mv))}${x.stock !== null ? `｜結存 ${esc(x.stock)}${x.unit ? " " + esc(x.unit) : ""}${x.safety ? `（安全庫存 ${esc(x.safety)}）` : ""}` : ""}</span></div>`).join("") || kv("沒有物資紀錄", "")}</div>
    <div class="sec">人力</div>
    <div class="stats">${big(R.shifts, "出勤人次")}${big(R.people, "不重複人數")}${big(R.hours, "總時數")}</div>
    ${R.noOut ? `<div class="hint" style="margin:6px 16px 0">未簽退 ${esc(R.noOut)} 筆，不計入總時數。</div>` : ""}`;
  if (R.full) h += eventDetail(R);
  if (R.capped.length) h += `<div class="hint" style="margin:10px 16px 0">⚠ 部分資料超過 ${LIMIT} 筆，只統計前 ${LIMIT} 筆。</div>`;
  return h;
}
// 完整版：逐件事件（未解決 → 緊急／高 → 其他），每件列出發生、處理紀錄的時間軸、處理用時
function eventDetail(R) {
  const card = e => `<div class="evc ${e.done ? "" : "open"}"><div class="evh"><span class="badge sev-${esc(e.sev)}">${esc(e.sev)}</span><b>${esc(e.title)}</b></div>
      <div class="meta">${esc(fmtShort(e.t) || "時間未記錄")}・${esc(e.cat)}${e.src ? "・" + esc(e.src) : ""}${e.who ? "・" + esc(e.who) : ""}</div>
      ${e.text ? `<div class="evx">${esc(e.text)}</div>` : ""}
      ${e.steps.length ? `<ol class="tl">${e.steps.map(s => `<li><time>${esc(isNaN(s.t) ? "" : fmtShort(s.t))}</time>${esc(s.text)}</li>`).join("")}</ol>` : ""}
      <div class="meta ${e.done ? "ok" : "bad"}">${e.done ? `${esc(e.prog)}${e.dur >= 0 ? `・用時 ${esc(fmtSpan(e.dur))}` : ""}` : `未解決（${esc(e.prog)}）`}</div></div>`;
  const open = R.events.filter(e => !e.done), urgent = R.events.filter(e => e.done && e.urgent), rest = R.events.filter(e => e.done && !e.urgent);
  return `<div class="sec">事件細節 <small>完整版・內容可能有姓名，請勿外傳</small></div>`
    + (open.length ? `<div class="sec sub bad">未解決 ${open.length} 件 <small>需交接或後續追蹤</small></div>${open.map(card).join("")}` : `<div class="hint" style="margin:0 16px">沒有未解決的事件。</div>`)
    + (urgent.length ? `<div class="sec sub">緊急與高嚴重度（已處理）${urgent.length} 件</div>${urgent.map(card).join("")}` : "")
    + (rest.length ? `<div class="sec sub">其他已處理 ${rest.length} 件</div>${rest.map(card).join("")}` : "");
}
function renderFinal() {
  $("#bar").hidden = REAL; $("#bar .in").style.display = "none";   // 原型只留示範切換列
  document.title = "結報";
  const head = `<header><div class="title"><button class="iconbtn" id="finBack" aria-label="回上一頁">‹</button><h1>結報</h1>
    <button class="iconbtn" id="finReload" aria-label="重新整理">↻</button></div></header>`;
  if (!F.d) { setHTML($("#app"), head + `<div class="blocked"><p>${esc(F.msg || "讀取結報資料中…")}</p></div>`); return; }
  const R = computeReport(F.d), st = F.d.opening.status;
  R.full = F.full;
  const rep = reportHtml(R);
  const note = st === "撤收中" ? "結報預覽：確認數字無誤後按「確認結案」，狀態改為已撤收，結報寫進 Notion。"
    : st === "已撤收" ? "" : `這一所目前「${st}」，數字是到現在為止的統計。`;
  // 總覽＝結論和數字（寫進 Notion 的也是這些）；完整版＝再加上逐件事件細節
  const modes = `<div class="seg repmode">${[[false, "總覽"], [true, "完整版（含事件細節）"]].map(([v, t]) => `<button data-repfull="${v ? 1 : 0}" class="${F.full === v ? "on" : ""}">${t}</button>`).join("")}</div>`;
  setHTML($("#app"), head + (note ? `<div class="hqbanner" style="margin-top:10px">${esc(note)}</div>` : "") + modes + rep
    + `<div class="ract finacts">${st === "撤收中" ? `<button class="main" id="finDo" ${F.busy ? "disabled" : ""}>${F.busy ? "結案中…" : "確認結案"}</button>` : ""}
      <button id="finPrint" style="grid-column:1 / -1">${inLine() ? "存成 PDF（用瀏覽器開啟）" : "列印結報"}</button></div>
    <p class="hint" style="margin:6px 16px 0">${esc(inLine() ? PDF_HINT : "列印視窗的「目的地」選「另存為 PDF」就能存成 PDF。")}</p>`);
  setHTML($("#printArea"), `<div class="rep-print">${rep}</div>`);   // 列印時只印結報本身（按鈕、字級按鈕不印）
}
async function loadFinal() {
  S.view = "final"; F.d = null; F.msg = ""; render();
  try { F.d = await api.hq("hqReport", { o: S.finO }); if (S.finAuto && F.d.opening.status === "撤收中") { S.finAuto = false; render(); return doFinish(true); } }
  catch (e) {
    if (e.code === "not_hq") F.msg = "結報限社會處查看。";
    else if (!handleApiError(e)) F.msg = "網路不穩，沒讀到結報資料。請按右上角重新整理。";
  }
  render();
}
async function doFinish(skipAsk) {
  if (F.busy || !F.d) return;
  const R = computeReport(F.d), s = reportText(R);
  if (!skipAsk && !confirm(`確定結案「${R.o.name}」？\n累計收容 ${R.total} 人、最高同時在所 ${R.peak} 人。\n結案後狀態改為「已撤收」，結報會寫進 Notion。`)) return;
  F.busy = true; render();
  try {
    await api.hq("hqFinish", { o: S.finO, n: String(R.total), m: String(R.peak), s });
    F.busy = false; F.d.opening.status = "已撤收"; F.d.opening.closeAt = new Date().toISOString();
    toast("已結案，結報已寫進 Notion"); render();
  } catch (e) {
    F.busy = false;
    if (e.code === "bad_state") { toast("這一所已不是撤收中，已重新讀取"); return loadFinal(); }
    if (e.code === "not_hq") toast("結案限社會處");
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
    render();
  }
}

// ===== 手機存成 PDF：LINE 內建瀏覽器不能列印，改用手機的瀏覽器開啟列印頁 =====
// 資料放在網址 # 後面（瀏覽器不會送到伺服器），內容只有名稱、簽到代碼或結報統計數字，沒有個資
const PDF_HINT = "會用手機瀏覽器開啟，按「列印／存成 PDF」。iPhone：在列印畫面點上方的分享圖示 →「儲存到檔案」；Android：印表機選「另存為 PDF」→ 下載。";
function inLine() {
  try { if (REAL) return liff.isInClient(); } catch (e) {}
  return !REAL && params.get("phone") === "1";   // 原型：?phone=1 模擬在 LINE 裡打開
}
const b64e = obj => { const u = new TextEncoder().encode(JSON.stringify(obj)); let b = ""; for (const x of u) b += String.fromCharCode(x); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64d = str => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
function openPrintView(v, data) {
  const url = `${location.origin}${location.pathname}?v=${v}#${b64e(data)}`;
  if (REAL) { try { return liff.openWindow({ url, external: true }); } catch (e) {} }
  location.href = url;   // 原型（或開不了外部瀏覽器時）：在同一個分頁開啟
}
// 結報不帶開設 ID；總覽不帶事件細節（網址裡只有結論和數字）
function slimReport(R) {
  const { id, ...o } = R.o, out = { ...R, o };
  if (!R.full) out.events = [];
  else out.events = R.events.map(e => ({ ...e, text: e.text.slice(0, 300), steps: e.steps.slice(-8).map(x => ({ t: x.t, text: x.text.slice(0, 200) })) }));
  return out;
}
// 網址來的資料一律重新整理型別：只留文字、數字、布林、陣列、一般物件（畫面仍會經過 esc 和 DOMPurify）
// JSON 會把 NaN 變成 null：時間、用時這類欄位改回 NaN，畫面才會顯示「—」
function normReport(d) {
  const clean = (v, depth) => depth > 6 ? null : typeof v === "string" ? v.slice(0, 2000) : typeof v === "number" ? (Number.isFinite(v) ? v : NaN)
    : typeof v === "boolean" ? v : Array.isArray(v) ? v.slice(0, 400).map(x => clean(x, depth + 1))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).slice(0, 200).map(([k, x]) => [String(k), clean(x, depth + 1)])) : null;
  const R = clean(d, 0) || {}, N = v => typeof v === "number" ? v : NaN, A = v => Array.isArray(v) ? v : [];
  R.o = R.o || {};
  for (const k of ["stay", "urgentDur", "react", "start", "end"]) R[k] = N(R[k]);
  for (const k of ["ages", "cares", "cats", "sevs", "dests", "days", "items", "low", "capped", "verdicts", "events"]) R[k] = A(R[k]);
  R.byCat = R.byCat && typeof R.byCat === "object" && !Array.isArray(R.byCat) ? R.byCat : {};
  R.items = R.items.map(x => ({ ...x, mv: x && x.mv && typeof x.mv === "object" ? x.mv : {}, stock: typeof (x && x.stock) === "number" ? x.stock : null }));
  R.events = R.events.map(e => ({ ...e, t: N(e.t), dur: N(e.dur), react: N(e.react), steps: A(e.steps).map(x => ({ t: N(x && x.t), text: String((x && x.text) || "") })) }));
  return R;
}
function renderPrintView() {
  $("#bar").hidden = true;
  let d = null; try { d = b64d(location.hash.slice(1)); } catch (e) {}
  let body = "", screen = "", title = "", head = "", ok = false;
  if (S.view === "printqr") {
    head = "簽到 QR";
    ok = !!d && typeof d.e === "string" && Array.isArray(d.c) && d.c.length > 0
      && d.c.every(x => Array.isArray(x) && typeof x[0] === "string" && /^SIGN-[0-9A-Z]{5}$/.test(x[1]));
    if (ok) {
      body = d.c.map(([n, c]) => qrCardRaw(d.e, n, c)).join("");
      screen = `<div class="qrcards">${d.c.map(([n, c]) => qrCardRaw(d.e, n, c, false, true)).join("")}</div>`;
      // 存 PDF 的檔名跟著收容所名稱，例：清華里活動中心的簽到 QR Code
      title = d.c.length === 1 ? `${d.c[0][0]}的簽到 QR Code` : `${d.e} 簽到 QR Code（${d.c.length} 所）`;
    }
  } else if (S.view === "printtag") {
    head = "居民號碼牌";
    ok = !!d && typeof d.p === "string" && Array.isArray(d.c) && d.c.length > 0 && d.c.length <= 60 && d.c.every(x => TAG_RE.test(x));
    if (ok) {
      body = tagPages(d);
      screen = `<div class="biglinks"><a class="biglink" href="${esc(tagMailHref(d))}"><span class="ic">✉</span><span>用 Email 寄給同仁</span></a></div>
        <p class="hint" style="margin:8px 16px 0">一張 A4 排 6 張，沿虛線剪開。</p><div class="tagprev wide">${d.c.map(c => tagCard(d.p, c)).join("")}</div>`;
      title = tagTitle(d);
    }
  } else if (S.view === "printitem") {
    head = "物資標籤";
    ok = !!d && typeof d.e === "string" && typeof d.p === "string" && Array.isArray(d.c) && d.c.length > 0
      && d.c.every(x => Array.isArray(x) && typeof x[0] === "string" && /^SUP-[0-9A-Z]{5}$/.test(x[1]));
    if (ok) {
      body = d.c.map(([n, c]) => itemLabel(d.e, d.p, n, c)).join("");
      screen = `<div class="biglinks"><a class="biglink" href="${esc(labelMailHref(d))}"><span class="ic">✉</span><span>用 Email 寄給同仁</span></a></div><div class="qrcards">${body}</div>`;
      title = labelTitle(d);
    }
  } else {
    head = "結報";
    try { if (d && d.o) { const R = normReport(d); body = `<div class="rep-print">${reportHtml(R)}</div>`; screen = body; title = `${R.o.name || ""}結報${R.full ? "（完整版）" : ""}`; ok = true; } } catch (e) {}
  }
  document.title = fileTitle(title || head);
  if (!ok) { setHTML($("#app"), pubHead(head) + `<div class="blocked"><p>列印資料不完整。請回到 LINE，再按一次「存成 PDF」。</p></div>`); return; }
  setHTML($("#app"), pubHead(head, "按下面的按鈕，選「列印」或「另存為 PDF」")
    + `<div class="biglinks"><button class="biglink blue" id="doPrintNow"><span class="ic">🖨</span><span>列印／存成 PDF</span></button></div>
    <p class="hint" style="margin:8px 16px 0">iPhone：列印畫面點上方的分享圖示 →「儲存到檔案」。Android：印表機選「另存為 PDF」→ 下載。${S.view === "printqr" ? "要直接傳給同仁：按卡片下方「用 Email 寄給同仁」。" : ""}</p>`
    + screen);
  setHTML($("#printArea"), body);
}

// 回傳 true＝已登入可以開始；false＝正在導向 LINE 登入頁
async function initLiff() {
  await liff.init({ liffId: CONFIG.liffId });
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
  return true;
}
function showFatal(msg) {
  $("#bar").hidden = true;
  setHTML($("#app"), `<div class="blocked"><h2>無法開啟</h2><p>${esc(msg)}</p></div>`);
}
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.body.append(s); });
}
// 驗證失敗就重新登入；不在班就顯示限制畫面。處理過回傳 true
function handleApiError(e) {
  if (!(e instanceof ApiError)) return false;
  if (e.code === "auth" || e.code === "no_token") {
    // 只自動重新登入一次；兩分鐘內又失敗就停下來顯示原因，避免無限重新整理、一直消耗 Make 額度
    let last = 0;
    try { last = +sessionStorage.getItem("relogin") || 0; } catch (x) {}
    if (e.code === "auth" && Date.now() - last > 120000) {
      try { sessionStorage.setItem("relogin", String(Date.now())); } catch (x) {}
      if (liff.isInClient()) location.reload(); else { liff.logout(); liff.login({ redirectUri: location.href }); }
      return true;
    }
    showAuthProblem(e.code); return true;
  }
  if (e.code === "not_on_duty") { S.me = { ...(S.me || {}), onDuty: false }; render(); return true; }
  if (e.code === "not_staff") { S.rmsg = "本所畫面限工作人員使用；志工請用物資和居民畫面。"; render(); return true; }
  return false;
}
function showAuthProblem(code) {
  const why = code === "no_token" ? "LINE 沒有提供身分憑證。請關閉頁面，從 LINE 重新開啟。"
                                  : "LINE 身分驗證沒有通過。";
  $("#bar").hidden = true;
  setHTML($("#app"), `<div class="blocked"><h2>無法確認您的身分</h2><p>${esc(why)}</p>
    <p style="margin-top:12px;font-size:0.8125rem">請截圖給管理者，並告知時間。（${esc(code)}）</p></div>`);
}
async function boot() {
  if (HQ_VIEWS.includes(S.view)) return loadHq();
  if (S.view === "final") return loadFinal();
  if (PUB_VIEWS.includes(S.view)) return loadPub();
  if (S.view === "ops" && !S.items.length) return loadOps();
  if (S.view === "resident" && !S.items.length) return loadResident(S.rtag);
  let d;
  try { d = await api.load(); }
  catch (e) { if (!handleApiError(e)) { S.me = null; setHTML($("#app"), `<div class="blocked"><h2>暫時無法讀取庫存</h2><p>請稍後按重新整理。</p></div>`); } return; }
  S.me = d.me; S.items = d.items; S.recent = d.recent;
  if (S.tag && !S.tagDone) {   // 只在第一次載入時帶入；之後按重新整理不會把發完的人又設回來
    S.tagDone = true;
    const r = await api.resident(S.tag);
    if (!r) toast("查無此號碼牌");
    else if (!r.inShelter) toast("此號碼牌已失效，不能領物資");
    else S.recip = { kind: "resident", tag: S.tag, ...r };
  }
  if (S.focusCode && !S.items.some(x => x.code === S.focusCode)) { toast("這不是本所的物資標籤"); S.focusCode = null; S.showAll = true; }
  render();
}
async function start() {
  if (PRINT_VIEWS.includes(S.view)) return render();   // 列印頁：資料在網址裡，不登入、不連後端
  render();   // 先顯示「載入中」
  if (IN_LIFF_HOST && !SCAN) {
    if (!window.liff) return showFatal("LINE 元件載入失敗，請關閉頁面後從 LINE 重新開啟。");
    try { if (!(await initLiff())) return; }
    catch (e) { return showFatal("LINE 登入失敗，請關閉頁面後從 LINE 重新開啟。"); }
    api = real; REAL = true; S.recent = [];
  } else {
    // 本機預覽（原型）：模擬資料和示範切換列放在 mock.js，正式網址不載入
    await loadScript("mock.js");
    api = mockApi; demoBar();
  }
  render();
  return boot();
}
start();
