// ===== 設定：LIFF ID 與 API 網址。正式網址（GitHub Pages）一律用真資料；本機預覽才載入 mock.js 的模擬資料 =====
// 物資、居民、本所三個畫面共用同一個 Make 情境（13），免費方案只能啟用兩個情境（11 聊天室＋13）
const CONFIG = { liffId: "2012049994-PV1Y181j", apiUrl: "https://hook.us2.make.com/7t41m917ehb6cazsap56tygu0am7gi9x" };
// 只有在正式網址（GitHub Pages）才啟動 LIFF；本機預覽時略過
const IN_LIFF_HOST = location.hostname.endsWith("github.io");

const MODES = { in: "入庫", out: "發放", count: "盤點" };
const ACCENT = { in: "var(--green)", out: "var(--blue)", count: "var(--amber)" };

const wait = ms => new Promise(r => setTimeout(r, ms));

// ===== 正式後端：Make 情境 13（物資 API）。用表單格式送出，瀏覽器不會先送 CORS 預檢 =====
class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
// 後端把姓名、收容所名稱等自由文字 URL 編碼後才放進 JSON（Make 沒有 JSON 跳脫函式），這些欄位在這裡解碼
const ENC_KEYS = new Set(["name", "opening", "staff", "area", "line", "tag", "unit", "phone", "event", "addr"]);
const safeDecode = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
function decodeFields(o) {
  if (Array.isArray(o)) return o.map(decodeFields);
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
  async register(f) { return await post({ a: "register", ...f }); },
  async move(tag, kind, hours) { return await post({ a: "move", tag, kind, hours: String(hours || "") }); },
  // 本所：status 狀況｜report 記錄事件｜update 認領・追加紀錄・解決｜prep 整備回報｜prepDone 送出整備完成
  async ops(a, f) { return await post({ a, ...(f || {}) }); },
  // 一般畫面：info 收容所資訊｜me 我的狀態｜apply 申請開通｜feedback 我要反映｜signout 簽退
  async pub(a, f) { return await post({ a, ...(f || {}) }); },
  // 社會處（hq.js）：hqInit 指揮台資料｜hqOpen 開設｜hqApps 申請清單｜hqApprove 核准｜hqReject 不核准｜hqSites 各所現況
  async hq(a, f) { return await post({ a, ...(f || {}) }); },
};
let api = null;               // 正式網址用 real；本機預覽載入 mock.js 後改用模擬資料
let REAL = false;

// ===== 狀態 =====
const params = new URLSearchParams(location.search);
const PUB_VIEWS = ["info", "report", "sos", "staff", "signout"];
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
  view: params.get("r") ? "resident" : PUB_VIEWS.includes(params.get("v")) || HQ_VIEWS.includes(params.get("v")) || params.get("v") === "ops" ? params.get("v") : "supply",
  hqO: params.get("v") === "ops" ? params.get("o") : null,   // 社會處從「各所現況」點進來看某一所（只能看）
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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 2600); }
function stockText(it) {
  const extra = it.pack && it.per > 1 ? `（約 ${Math.floor(it.stock / it.per)} ${it.pack}）` : "";
  return `庫存 ${it.stock} ${it.unit}${extra}`;
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
function render() {
  document.body.classList.toggle("ops", S.view === "ops");
  document.body.classList.toggle("pub", PUB_VIEWS.includes(S.view) || HQ_VIEWS.includes(S.view));
  if (HQ_VIEWS.includes(S.view)) return renderHq();
  if (PUB_VIEWS.includes(S.view)) return renderPub();
  document.documentElement.style.setProperty("--accent", ACCENT[S.mode]);
  const app = $("#app");
  if (S.guest || (S.me && !S.me.onDuty && !S.hqO)) {
    app.innerHTML = `<div class="blocked"><h2>這個頁面限在班的工作人員使用</h2><p>請先到服務台掃「工作人員簽到 QR」簽到。</p></div>`;
    $("#bar").hidden = false; $("#bar .in").hidden = true; return;
  }
  if (S.view === "resident") return renderResident();
  if (S.view === "ops") return renderOps();
  if (!S.me) { app.innerHTML = `<div class="blocked"><p>載入中…</p></div>`; return; }
  const focus = S.focusCode && S.items.find(x => x.code === S.focusCode);
  const cats = ["全部", ...new Set(S.items.map(x => x.cat))];
  const shown = S.items.filter(x => (S.cat === "全部" || x.cat === S.cat) && (!S.q || x.name.includes(S.q)) && x !== focus);
  const lockOut = !!S.tag;
  app.innerHTML = `
  <header>
    ${tabs()}<div class="title"><h1>${esc(S.me.opening)}・物資</h1><button class="iconbtn" id="reload" aria-label="重新整理">↻</button></div>
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
      <div class="top"><div class="name">${esc(it.name)}${it.stock < it.safety ? " ⚠" : ""}</div></div>
      <div class="stock">${stockText(it)}${it.stock < it.safety ? `，低於安全庫存 ${it.safety}` : ""}</div>${rowCtrl(it)}</div>`).join("") || `<div class="row">找不到符合的品項</div>`}
    ${(S.me.role || "").includes("管理者") && !lockOut ? `<button class="addnew" id="addnew">＋ 新增品項</button>` : ""}</div>` : ""}
  ${S.recent.length ? `<div class="recent"><h3>${REAL ? "這次登記" : "本所最近登記"}</h3>${S.recent.slice(0, 5).map(r => `<div>${esc(r.t)}　${esc(r.text)}</div>`).join("")}</div>` : ""}`;
  renderBar();
}
// ===== 分頁：本所｜居民｜物資 =====
function tabs() {
  return `<nav class="tabs">${[["ops", "本所"], ["resident", "居民"], ["supply", "物資"]].map(([k, t]) => `<button data-tab="${k}" class="${S.view === k ? "on" : ""}">${t}</button>`).join("")}</nav>`;
}

// ===== 本所畫面：知道（狀況、名單、待處理事項）、記錄、處理 =====
const CATS = ["緊急事件", "重大事件", "人員相關", "物資相關", "設施環境", "交班紀錄"];
const SEV_OF = { 緊急事件: "緊急", 重大事件: "高", 交班紀錄: "低" };
const SEVS = ["緊急", "高", "中", "低"];
const PREP = ["場地清潔", "水電設備", "安全檢查", "寢具", "醫療物資"];
const isOpen = e => !/已解決|已結案/.test(e.status);
function staffName(id) { const d = S.ops && S.ops.duty.find(x => x.id === id); return d ? d.name : ""; }
// 負責人：在班的從名單找；已簽退的從處理紀錄裡最後一筆「MM/DD HH:mm 姓名 認領處理」取姓名
function ownerName(e) {
  const n = staffName(e.owner); if (n) return n;
  const m = [...(e.log || "").matchAll(/\d{2}\/\d{2} \d{2}:\d{2} (.+?) 認領處理/g)].pop();
  return m ? m[1] : "";
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60e3);
  return isNaN(m) ? "" : m < 1 ? "剛剛" : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.floor(m / 60)} 小時前` : fmtTime(iso);
}
function openEvents() {
  return (S.ops ? S.ops.events : []).filter(e => isOpen(e) && !(e.cat === "整備回報" && !e.item && e.title.startsWith("整備完成")))
    .sort((a, b) => SEVS.indexOf(a.sev) - SEVS.indexOf(b.sev) || new Date(b.at) - new Date(a.at));
}
function renderOps() {
  const app = $("#app"), d = S.ops;
  document.documentElement.style.setProperty("--accent", "var(--blue)");
  $("#bar").hidden = false; $("#bar .in").hidden = false;
  const o = d && d.opening, ro = !!S.hqO;   // ro：社會處檢視，只能看
  if (ro) { $("#bar").hidden = REAL; $("#bar .in").style.display = "none"; document.title = (o && o.name) || "各所現況"; }
  const head = ro ? `<header><div class="title"><button class="iconbtn" id="hqBack" aria-label="回各所現況">‹</button><h1>${esc((o && o.name) || "收容所")}</h1>
      <button class="iconbtn" id="opsReload" aria-label="重新整理">↻</button></div>
    <div class="sub">${o ? `${esc(o.stage)}　${esc(o.light || "")}` : ""}</div></header><div class="hqbanner" style="margin-top:10px">社會處檢視中（只能看，現場操作由該所工作人員處理）</div>`
    : `<header>${tabs()}<div class="title"><h1>${esc((o && o.name) || (S.me && S.me.opening) || "本所")}・本所</h1>
      <button class="iconbtn" id="opsReload" aria-label="重新整理">↻</button></div>
    <div class="sub">${o ? `${esc(o.stage)}　${esc(o.light || "")}　` : ""}經手人：${esc((d && d.me.name) || "")}</div></header>`;
  if (!d) { app.innerHTML = head + `<div class="blocked"><p>${esc(S.rmsg || "讀取本所狀況中…")}</p></div>`; $("#sum").textContent = ""; $("#go").textContent = "＋記錄事件"; return; }
  const evs = openEvents(), urgent = evs.filter(e => e.sev === "緊急").length;
  const stat = (k, n, label, cls) => `<button class="stat ${cls || ""}" data-show="${k}"><b>${n}</b><span>${label}</span></button>`;
  let body = "";
  if (o.stage === "整備中" && !ro) body += prepView(d);
  if (o.stage === "待核准" && !ro) body += `<div class="rcard"><b>已送出整備完成</b><div class="meta">等社會處核准開放進駐。核准後這裡會改顯示開設中的狀況。</div></div>`;
  // 社會處檢視才能點「在所」看全部居民（工作人員的本所狀況只回外出、未返、需關懷的人，維持原樣）
  body += `<div class="stats">${stat(ro ? "all" : "", `${o.inside}<small style="font-size:13px">／${o.capacity}</small>`, "在所／容量")}
    ${stat("out", o.out, "外出", o.out ? "warn" : "")}${stat("late", o.late, "未返", o.late ? "alert" : "")}
    ${stat("care", o.care, "需關懷", o.care ? "warn" : "")}${stat("", evs.length, urgent ? `未結・緊急 ${urgent}` : "未結事件", urgent ? "alert" : evs.length ? "warn" : "")}
    ${stat("", o.needStaff + o.needVol, `缺工 ${o.needStaff}・缺志 ${o.needVol}`, o.needStaff + o.needVol ? "warn" : "")}</div>`;
  if (S.opsShow) {
    const rs = d.residents.filter(r => S.opsShow === "all" ? true : S.opsShow === "care" ? r.care : r.status === (S.opsShow === "late" ? "未返" : "外出"));
    const meta = r => S.opsShow === "all" ? [r.status, r.care].filter(Boolean).join("・") : S.opsShow === "care" ? r.care : r.back ? `預計 ${fmtTime(r.back)}` : "";
    body += `<div class="sec">${{ all: "居民名單", out: "外出中", late: "未返", care: "需關懷" }[S.opsShow]} <small>${rs.length} 人</small></div>
      <div class="plist">${rs.map(r => `<div class="prow"><span class="n">${esc(r.name)}</span><span class="meta">${esc(meta(r))}</span></div>`).join("") || `<div class="prow">沒有</div>`}</div>`;
  }
  body += `<div class="sec">在班人員 <small>${d.duty.length} 人</small></div><div class="chips2">${d.duty.map(x => `<span>${esc(x.name)}${x.kind === "志工" ? "（志工）" : x.role ? `・${esc(x.role.replace("（收容所負責人）", ""))}` : ""}</span>`).join("")}</div>`;
  body += `<div class="sec">待處理事項 <small>${evs.length} 件，緊急的排最上面</small></div>`
    + (evs.map(e => {
      const own = !e.owner ? `<span class="own free">待認領</span>` : e.owner === d.me.id ? `<span class="own mine">我負責</span>` : `<span class="own">${esc(ownerName(e) || "其他人")}處理中</span>`;
      return `<button class="evt ${esc(e.sev)}" data-evt="${esc(e.id)}"><div class="t">${esc(e.title)}</div>
        <div class="m"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>${own}<span>${esc(ago(e.at))}</span></div></button>`;
    }).join("") || `<div class="hint" style="margin:0 16px">目前沒有待處理的事項。</div>`);
  if (ro && S.hqItems) {
    const low = S.hqItems.filter(it => it.stock < it.safety);
    body += `<div class="sec">物資庫存 <small>${low.length ? `${low.length} 項低於安全庫存` : "都在安全庫存以上"}</small></div>
      <div class="plist">${[...low, ...S.hqItems.filter(it => !low.includes(it))].map(it => `<div class="prow"><span class="n">${esc(it.name)}${it.stock < it.safety ? " ⚠" : ""}</span><span class="meta">${esc(stockText(it))}</span></div>`).join("") || `<div class="prow">沒有品項</div>`}</div>`;
  }
  app.innerHTML = head + body;
  if (ro) return;
  $("#sum").innerHTML = evs.length ? `未結 <b>${evs.length}</b>${urgent ? `・緊急 <b>${urgent}</b>` : ""}` : "沒有未結事項";
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
async function loadOps() {
  S.view = "ops"; S.ops = null; S.rmsg = ""; render();
  try {
    const d = await api.ops("status", S.hqO ? { o: S.hqO } : undefined);
    if (S.hqO) { S.ops = d; S.hqItems = (await api.load(S.hqO)).items; return render(); }
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
    if (e.code === "not_manager") toast("只有管理者可以送出整備完成");
    else if (e.code === "bad_stage") { toast("本所已不在整備階段，已重新讀取"); loadOps(); }
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
    return false;
  }
}
function eventSheet(id) {
  const e = S.ops.events.find(x => x.id === id); if (!e) return;
  if (S.hqO) return sheet(`<h2>${esc(e.title)}</h2>
    <div class="meta"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>　${esc(e.cat)}・${esc(e.status)}・${esc(fmtTime(e.at))}${ownerName(e) ? `・${esc(ownerName(e))} 負責` : ""}</div>
    ${e.text ? `<div class="pre">${esc(e.text)}</div>` : ""}
    <label>處理紀錄</label><div class="pre">${esc((e.log || "").trim() || "（還沒有）")}</div>
    <div class="acts" style="grid-template-columns:1fr"><button data-close>關閉</button></div>`);
  const mine = e.owner === S.ops.me.id;
  sheet(`<h2>${esc(e.title)}</h2>
    <div class="meta"><span class="sev ${esc(e.sev)}">${esc(e.sev)}</span>　${esc(e.cat)}・${esc(e.status)}・${esc(fmtTime(e.at))}${staffName(e.by) ? `・${esc(staffName(e.by))} 記錄` : ""}</div>
    ${e.text ? `<div class="pre">${esc(e.text)}</div>` : ""}
    <label>處理紀錄</label><div class="pre">${esc((e.log || "").trim() || "（還沒有）")}</div>
    <label>寫一句處理情形（追加紀錄時必填，認領和解決可留空）<textarea id="ev-text" maxlength="500" placeholder="例：已請水電師傅明早來修，先放警示牌"></textarea></label>
    <div class="err" id="ev-err"></div>
    <div class="acts" style="grid-template-columns:1fr 1fr 1fr">
      ${mine ? `<button data-close>關閉</button>` : `<button id="ev-claim">我來處理</button>`}
      <button id="ev-note">追加紀錄</button><button class="go" id="ev-resolve" style="background:var(--green)">已解決</button></div>`, root => {
    const t = () => root.querySelector("#ev-text").value.trim();
    const c = root.querySelector("#ev-claim"); if (c) c.onclick = () => opsAct("update", { id, kind: "claim", text: t() }, "已認領，負責人是你");
    root.querySelector("#ev-note").onclick = () => t() ? opsAct("update", { id, kind: "note", text: t() }, "已追加處理紀錄") : (root.querySelector("#ev-err").textContent = "請先寫處理情形");
    root.querySelector("#ev-resolve").onclick = () => confirm("確定這件事已經解決了嗎？") && opsAct("update", { id, kind: "resolve", text: t() }, "已標記解決");
  });
}
function reportSheet() {
  const f = { cat: "", sev: "中" }, rr = S.reportRes;
  const draw = root => {
    root.querySelector("#rp-cat").innerHTML = CATS.map(c => `<button data-c="${c}" class="${f.cat === c ? "on" : ""}">${c}</button>`).join("");
    root.querySelector("#rp-sev").innerHTML = SEVS.map(v => `<button data-v="${v}" class="${f.sev === v ? "on" : ""}">${v}</button>`).join("");
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
  const head = `<header>${tabs()}<div class="title"><h1>${esc((d && d.opening) || (S.me && S.me.opening) || "收容所")}・居民</h1></div>
    <div class="sub">經手人：${esc((d && d.staff) || (S.me && S.me.name) || "")}${S.rtag ? `　號碼牌 ${esc(S.rtag)}` : ""}</div></header>`;
  if (!d) { app.innerHTML = head + `<div class="blocked"><p>${esc(S.rmsg || (S.rtag ? "讀取號碼牌中…" : "請按下方「掃描」，掃居民號碼牌。"))}</p></div>`; return; }
  let body = "";
  if (d.state === "none") body = `<div class="rcard void"><h2>不是本所的號碼牌</h2><div class="meta">${esc(S.rtag)}　請確認後再掃一次</div></div>`;
  else if (d.state === "void") body = `<div class="rcard void"><h2>⚠ 此號碼牌已失效</h2><div class="meta">${esc(S.rtag)}　請勿放行，並通知現場負責人</div></div>`;
  else if (d.state === "blank") body = blankView(d);
  else body = residentView(d);
  app.innerHTML = head + body;
  $("#sum").textContent = d.state === "blank" && S.rform ? "填完按上方「完成報到」" : "下一位：掃號碼牌或物資標籤";
}
function blankView(d) {
  if (d.openStatus !== "開設中") return `<div class="rcard"><h2>空白號碼牌</h2><div class="meta">本所目前「${esc(d.openStatus)}」，社會處核准開放後才能報到。</div></div>`;
  if (!CAN_CHECKIN(d.role)) return `<div class="rcard"><h2>空白號碼牌</h2><div class="meta">報到限管理者或門禁組，請洽現場負責人。</div></div>`;
  const f = S.rform || (S.rform = { name: "", age: "", care: [], phone: "", contact: "", id4: "", noId: false, note: "", area: "" });
  const pick = (k, list, multi) => `<div class="pick">${list.map(v => `<button data-pick="${k}" data-v="${esc(v)}" class="${(multi ? f[k].includes(v) : f[k] === v) ? "on" : ""}">${esc(v)}</button>`).join("")}</div>`;
  return `<div class="form"><h2>🆕 新居民報到</h2><div class="meta">號碼牌 ${esc(S.rtag)}，一次填完按「完成報到」。只有姓名和年齡層必填。</div>
    <label>姓名 <b>*</b><input id="f-name" maxlength="40" value="${esc(f.name)}" placeholder="例：王小明" autocomplete="off"></label>
    <label>年齡層 <b>*</b></label>${pick("age", AGES)}
    <label>特殊關懷（可複選）</label>${pick("care", CARES, true)}
    <label>聯絡電話<input id="f-phone" maxlength="20" inputmode="tel" value="${esc(f.phone)}" placeholder="例：0912345678"></label>
    <label>緊急聯絡人<input id="f-contact" maxlength="60" value="${esc(f.contact)}" placeholder="例：王大明（兒子）0933…"></label>
    <label>身分證後四碼<input id="f-id4" inputmode="numeric" maxlength="4" value="${esc(f.id4)}" placeholder="只填後四碼" ${f.noId ? "disabled" : ""}></label>
    <div class="chkline"><input type="checkbox" id="f-noid" ${f.noId ? "checked" : ""}><span>沒有帶證件，之後補查</span></div>
    <label>照護需求說明（敏感資料，只有授權人員看得到）<textarea id="f-note" maxlength="500" placeholder="例：需每日服用降血壓藥">${esc(f.note)}</textarea></label>
    <label>分配區域<input id="f-area" maxlength="40" value="${esc(f.area)}" placeholder="例：A 區 3 號床"></label>
    <div class="err" id="f-err"></div>
    <div class="ract"><button class="main" id="doRegister" ${S.busy ? "disabled" : ""}>${S.busy ? "報到中…" : "完成報到"}</button></div></div>`;
}
function residentView(d) {
  const r = d.resident || {}, st = r.status || "";
  const care = (r.care || "").split(/[、,]/).filter(Boolean);
  let acts = "";
  if (!CAN_GATE(d.role)) acts = `<div class="hint" style="margin:12px 16px">進出登記限管理者、門禁組、志工。</div>`;
  else if (st === "在所") acts = `<div class="ract"><button class="main" id="doSupply">🎁 領物資</button>
      <button id="doOut">🚶 外出</button><button class="warn" id="doLeave">離所</button></div>
      ${S.rmsg === "pickHours" ? `<div class="form"><b>預計多久回來？</b><div class="hours">${[[1, "1 小時"], [3, "3 小時"], [6, "6 小時"], [12, "過夜"]].map(([h, t]) => `<button data-hours="${h}">${t}</button>`).join("")}</div></div>` : ""}`;
  else if (st === "外出" || st === "未返") acts = `<div class="ract"><button class="main" id="doBack">↩ 返回</button><button class="warn" id="doLeave" style="grid-column:1 / -1">離所</button></div>`;
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
async function residentAction(kind, hours) {
  if (S.busy) return;
  if (kind === "離所" && !confirm(`確定 ${S.rinfo.resident.name || S.rtag} 要離所嗎？\n離所後號碼牌會失效，不能再用。`)) return;
  S.busy = true; S.rmsg = ""; render();
  try {
    const d = await api.move(S.rtag, kind, hours);
    S.rinfo.resident.status = d.status;
    if (kind === "外出") S.rinfo.resident.back = new Date(Date.now() + hours * 3600e3).toISOString();
    if (kind === "離所") S.rinfo.state = "void";
    const who = S.rinfo.resident.name || S.rtag;   // 志工看不到姓名，用號碼牌編號
    toast(kind === "離所" ? `${who} 已離所，號碼牌已回收` : `${who} ${kind === "外出" ? `已外出，預計 ${fmtTime(S.rinfo.resident.back)} 返回` : "已返回"}`);
  } catch (e) {
    if (e.code === "bad_state") { toast("狀態已被其他人更新，已重新讀取"); S.busy = false; return loadResident(S.rtag); }
    if (e.code === "no_permission") toast("進出登記限管理者、門禁組、志工");
    else if (!handleApiError(e)) toast("網路不穩，沒有送出，請再按一次");
  } finally { S.busy = false; render(); }
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
    <button id="pub">改公共用途</button></div>`;
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
  $("#sum").innerHTML = !ls.length ? (S.mode === "out" && S.recip ? `請選要發放的物資（${esc(recipName())}）` : `尚未填寫數量`)
    : `${label} <b>${ls.length}</b> 項` + (S.mode === "out" && S.recip ? ` <b>${esc(toWho())}</b>` : "");
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
  else if (b.id === "doLeave") residentAction("離所");
  else if (b.id === "doRegister") doRegister();
  else if (b.dataset.pick) {
    const k = b.dataset.pick, v = b.dataset.v, f = S.rform;
    if (k === "care") f.care = f.care.includes(v) ? f.care.filter(x => x !== v) : [...f.care, v]; else f[k] = v;
    render();
  }
  else if (b.id === "pub") { S.recip = { kind: "public" }; render(); toast("領取對象：公共用途"); }
  else if (b.id === "addnew") addItemSheet();
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
  const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
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
    <label>品名<input id="f-name" maxlength="40" placeholder="例：牙刷"></label>
    <label>類別<select id="f-cat">${["飲用水", "食品", "寢具", "衛生用品", "醫療", "防寒", "其他"].map(c => `<option>${c}</option>`).join("")}</select></label>
    <label>最小單位<input id="f-unit" maxlength="10" placeholder="例：支"></label>
    <label>包裝單位（可空白）<input id="f-pack" maxlength="10" placeholder="例：盒"></label>
    <label>每包裝數量<input id="f-per" inputmode="numeric" placeholder="例：20"></label>
    <label>安全庫存<input id="f-safety" inputmode="numeric" placeholder="例：30"></label>
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
      toast(`已新增「${it.name}」，現在可以入庫`);
    };
  });
}

function sheet(html, onMount) {
  closeSheet();
  const bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "sheet";
  bg.innerHTML = `<div class="sheet">${html}</div>`;
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
  if (P.done) { app.innerHTML = P.done; return; }
  if (S.view === "sos") return renderSos();
  if (S.view === "info") {
    if (!P.info) { app.innerHTML = pubHead("收容所資訊") + `<div class="blocked"><p>${esc(P.msg || "載入中…")}</p></div>`; return; }
    const qa = P.info.qa.filter(q => q.kw !== "緊急聯絡");
    const order = q => q.type === "公告" ? 0 : 1;
    app.innerHTML = pubHead("收容所資訊", "最新公告、用餐與物資、生活規定") +
      qa.sort((a, b) => order(a) - order(b)).map(q => `<div class="card ${q.type === "公告" ? "notice" : ""}">
        ${q.type === "公告" ? "<small>公告</small>" : ""}<h3>${esc(q.title)}</h3><div class="body">${linkify(q.text)}</div></div>`).join("") +
      `<div class="sec">開設中的收容所 <small>${P.info.shelters.length} 所</small></div>
       <div class="shelters">${P.info.shelters.map(o => `<div>🏠 ${esc(o.name)}</div>`).join("") || "<div>目前沒有開設中的收容所</div>"}</div>
       <div class="card"><small>地址與交通請洽現場工作人員或縣府服務專線。</small></div>
       <div class="biglinks"><button class="biglink" data-go="?v=report"><span class="ic">🙋</span><span>我要反映<small>身體不適、缺物資、環境問題</small></span></button>
         <button class="biglink" data-go="?v=sos"><span class="ic">📞</span><span>緊急聯絡</span></button></div>`;
    return;
  }
  if (S.view === "report") return renderReport();
  if (S.view === "staff") return renderStaff();
  if (S.view === "signout") return renderSignout();
}
function renderSos() {
  // 電話按鈕不等資料載入，打開就能撥
  const em = S.pub.info && S.pub.info.qa.find(q => q.kw === "緊急聯絡");
  $("#app").innerHTML = pubHead("緊急聯絡", "有生命危險請直接撥打") + `<div class="biglinks">
      <a class="biglink red" href="tel:119"><span class="ic">🚑</span><span>撥打 119<small>緊急救護、火警</small></span></a>
      <a class="biglink blue" href="tel:110"><span class="ic">🚓</span><span>撥打 110<small>報案</small></span></a></div>
    ${em ? `<div class="card"><h3>${esc(em.title)}</h3><div class="body">${linkify(em.text)}</div></div>` : `<div class="card"><small>${esc(S.pub.msg || "載入其他聯絡方式…")}</small></div>`}
    <div class="biglinks"><button class="biglink" data-go="?v=report"><span class="ic">🙋</span><span>不緊急，我要反映</span></button></div>`;
}
function renderReport() {
  const P = S.pub, f = P.form;
  if (!P.info) { $("#app").innerHTML = pubHead("我要反映") + `<div class="blocked"><p>${esc(P.msg || "載入中…")}</p></div>`; return; }
  const places = [...P.info.shelters, { id: "", name: "不在收容所" }];
  $("#app").innerHTML = pubHead("我要反映", "現場工作人員會盡快處理") + `<div class="form">
      <label>要反映什麼？<b>*</b></label><div class="pick" id="cats">${REPORT_CATS.map(c => `<button data-cat="${c}" class="${f.cat === c ? "on" : ""}">${c}</button>`).join("")}</div>
      ${f.cat === "身體不適" ? `<p class="err">情況緊急請直接撥 119，或找現場工作人員。</p>` : ""}
      <label>您在哪裡？<b>*</b></label><div class="pick" id="places">${places.map(o => `<button data-o="${o.id}" data-where="${esc(o.name)}" class="${f.where === o.name ? "on" : ""}">${esc(o.name)}</button>`).join("")}</div>
      <label>說明（可不填）</label><textarea id="rtext" maxlength="500" placeholder="例：A 區 3 號床，頭很暈">${esc(f.text)}</textarea>
      ${P.msg ? `<p class="err">${esc(P.msg)}</p>` : ""}
    </div>
    <div class="biglinks"><button class="biglink blue" id="sendReport" ${f.cat && f.where && !S.busy ? "" : "disabled style='opacity:.4'"}><span class="ic">📨</span><span>${S.busy ? "送出中…" : "送出反映"}</span></button></div>`;
}
function renderStaff() {
  const me = S.pub.me, app = $("#app");
  if (!me) { app.innerHTML = pubHead("工作人員專區") + `<div class="blocked"><p>${esc(S.pub.msg || "載入中…")}</p></div>`; return; }
  const hello = me.name ? `${me.name}（${me.role || me.kind}）您好` : "";
  const ap = S.pub.ap;
  if (me.state === "none") app.innerHTML = pubHead("工作人員專區", "開通後才能使用工作人員功能") + `<div class="card"><div class="body">社會處派出的人員、支援社工和志工，請填寫以下資料申請開通，由社會處審核。</div></div>
      <div class="form"><label>姓名 <b>*</b><input id="ap-name" maxlength="40" value="${esc(ap.name)}" placeholder="請填真實姓名" autocomplete="name"></label>
        <label>單位 <b>*</b><input id="ap-unit" maxlength="40" value="${esc(ap.unit)}" placeholder="例：苗栗縣社會處、○○社福協會"></label>
        <label>聯絡電話 <b>*</b><input id="ap-phone" maxlength="20" inputmode="tel" value="${esc(ap.phone)}" placeholder="例：0912345678" autocomplete="tel"></label>
        <p class="err" id="ap-err">${esc(S.pub.msg || "")}</p></div>
      <div class="biglinks"><button class="biglink blue" id="apply" ${S.busy ? "disabled" : ""}><span class="ic">📝</span><span>${S.busy ? "送出中…" : "送出申請"}<small>LINE 名稱「${esc(me.line || "")}」</small></span></button></div>`;
  else if (me.state === "pending") app.innerHTML = pubHead("工作人員專區") + `<div class="done"><div class="big">⏳</div><h2>開通申請審核中</h2><p>社會處審核通過後，LINE 會通知您。到現場掃服務台的「工作人員簽到」QR 就能開始上班。</p></div>`;
  else if (me.role === "社會處" && me.state === "off") app.innerHTML = pubHead("工作人員專區", hello) + hqLinks();
  else if (me.state === "off") app.innerHTML = pubHead("工作人員專區", hello + "，目前未上班") + `<div class="card"><div class="body">到現場後，掃服務台張貼的「工作人員簽到」QR Code 簽到。</div></div>
      <div class="biglinks"><button class="biglink blue" id="scanner"><span class="ic">📷</span><span>打開 QR 掃描器<small>掃簽到 QR</small></span></button></div>`;
  else app.innerHTML = pubHead("工作人員專區", hello + "，上班中") + (me.role === "社會處" ? hqLinks() : "") + `<div class="biglinks">
      ${me.kind === "工作人員" ? `<button class="biglink" data-go="?v=ops"><span class="ic">📊</span><span>本所畫面<small>狀況、待處理事項、記錄事件</small></span></button>` : ""}
      <button class="biglink" id="scanner"><span class="ic">📷</span><span>掃描 QR<small>物資標籤、居民號碼牌</small></span></button>
      <button class="biglink" data-go="?"><span class="ic">📦</span><span>物資<small>入庫、發放、盤點</small></span></button>
      <button class="biglink" data-go="?v=signout"><span class="ic">👋</span><span>簽退（下班）</span></button></div>`;
}
// 社會處的入口（選單之外，也從工作人員專區進得去）
function hqLinks() {
  return `<div class="biglinks"><button class="biglink blue" data-go="?v=hq"><span class="ic">🧭</span><span>指揮台<small>建立災害、開設收容所、簽到 QR</small></span></button>
    <button class="biglink" data-go="?v=inbox"><span class="ic">📥</span><span>待我處理<small>工作人員申請核准</small></span></button>
    <button class="biglink" data-go="?v=sites"><span class="ic">🏠</span><span>各所現況<small>開設中的收容所狀況</small></span></button></div>`;
}
function renderSignout() {
  const me = S.pub.me, app = $("#app");
  if (!me) { app.innerHTML = pubHead("簽退") + `<div class="blocked"><p>${esc(S.pub.msg || "載入中…")}</p></div>`; return; }
  app.innerHTML = pubHead("簽退", "確認後就會下班，選單恢復成一般版") + `<div class="rcard"><h2>${esc(me.name)}</h2><div class="meta">${esc(me.role || me.kind)}・上班中</div></div>
    ${S.pub.msg ? `<p class="err" style="margin:10px 16px">${esc(S.pub.msg)}</p>` : ""}
    <div class="ract"><button class="main" id="doSignout" style="background:var(--red);border-color:var(--red)" ${S.busy ? "disabled" : ""}>${S.busy ? "簽退中…" : "確定簽退"}</button>
      <button id="cancel" style="grid-column:1 / -1">取消，繼續上班</button></div>`;
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
  if (S.view === "info" || S.view === "report" || S.view === "sos") { const d = await pubCall("info"); if (d) { P.info = d; P.msg = ""; } return render(); }
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
  if (t.id === "again") { P.done = ""; P.form = { cat: "", o: "", where: "", text: "" }; return render(); }
  if (t.dataset.cat) { f.text = ($("#rtext") || {}).value || f.text; f.cat = t.dataset.cat; P.msg = ""; return render(); }
  if (t.dataset.where != null) { f.text = ($("#rtext") || {}).value || f.text; f.o = t.dataset.o; f.where = t.dataset.where; P.msg = ""; return render(); }
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

// 回傳 true＝已登入可以開始；false＝正在導向 LINE 登入頁
async function initLiff() {
  await liff.init({ liffId: CONFIG.liffId });
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
  return true;
}
function showFatal(msg) {
  $("#bar").hidden = true;
  $("#app").innerHTML = `<div class="blocked"><h2>無法開啟</h2><p>${esc(msg)}</p></div>`;
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
  $("#app").innerHTML = `<div class="blocked"><h2>無法確認您的身分</h2><p>${esc(why)}</p>
    <p style="margin-top:12px;font-size:13px">請截圖給管理者，並告知時間。（${esc(code)}）</p></div>`;
}
async function boot() {
  if (HQ_VIEWS.includes(S.view)) return loadHq();
  if (PUB_VIEWS.includes(S.view)) return loadPub();
  if (S.view === "ops" && !S.items.length) return loadOps();
  if (S.view === "resident" && !S.items.length) return loadResident(S.rtag);
  let d;
  try { d = await api.load(); }
  catch (e) { if (!handleApiError(e)) { S.me = null; $("#app").innerHTML = `<div class="blocked"><h2>暫時無法讀取庫存</h2><p>請稍後按重新整理。</p></div>`; } return; }
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
  render();   // 先顯示「載入中」
  if (IN_LIFF_HOST) {
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
