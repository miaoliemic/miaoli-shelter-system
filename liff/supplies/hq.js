// ===== 社會處畫面：指揮台（?v=hq）｜待我處理（?v=inbox）｜各所現況（?v=sites） =====
// 社會處的權限跟著身分走、不需要簽到；後端（Make 情境 13）每次都檢查角色＝社會處、啟用中。
// 依賴 app.js 的全域（執行時才用到）：S、api、REAL、esc、$、toast、sheet、go、ago、fmtTime、handleApiError、pubHead、render
const HQ_VIEWS = ["hq", "sites", "inbox"];   // 順序同社會處選單：指揮台｜各所現況｜待我處理
const HQ_TITLE = { hq: "指揮台", inbox: "待我處理", sites: "各所現況" };
const HQ_KINDS = ["風災", "水災", "震災", "土石流", "海嘯", "其他"];
const HQ_ROLES = ["管理者（收容所負責人）", "門禁組", "物資組", "醫療組"];
const OA_ID = "@796juukk";   // 官方帳號 Basic ID；換帳號時要改這裡並重印簽到 QR
const signUrl = code => `https://line.me/R/oaMessage/${OA_ID}/?` + encodeURIComponent("簽到 " + code);

const H = {
  init: null, apps: null, sites: null, closed: null, msg: "", busy: false,
  ev: "",                              // 選到的災害事件 id；"new" 表示要建立新的
  newEv: { name: "", kind: "風災" },
  sel: [],                             // 勾選要開設的收容所 id
  onlyFit: true,
  lastNew: [],                         // 剛開設的收容所 id（QR 卡片標藍框）
  pickOpen: true,                      // 收容所清單展開中；按「選好了」收合成一行摘要
};

// 後端（Make）回傳的欄位整理成頁面要的型別：編號、容量是數字，適用災害是陣列，關聯只取第一個 ID
const first = v => Array.isArray(v) ? (v[0] || "") : (v || "");
const toNum = v => typeof v === "number" ? v : (v && typeof v.number === "number" ? v.number : +v || 0);
function normInit(d) {
  d.shelters = (d.shelters || []).map(s => ({ ...s, no: toNum(s.no), cap: toNum(s.cap),
    kinds: Array.isArray(s.kinds) ? s.kinds : String(s.kinds || "").split(",").filter(Boolean),
    weak: s.weak === true || s.weak === "適合" })).sort((a, b) => a.no - b.no);
  d.openings = (d.openings || []).map(o => ({ ...o, eventId: first(o.eventId), shelterId: first(o.shelterId) }));
  d.events = d.events || [];
  return d;
}
// 簽到代碼：SIGN- 加 5 碼（去掉容易看錯的 0 O 1 I L），由頁面產生、後端寫入（規則見 docs/QR編碼規則.md）
function newSignCode(used) {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", r = new Uint32Array(5);
  for (;;) { crypto.getRandomValues(r); const c = "SIGN-" + Array.from(r, x => A[x % A.length]).join(""); if (!used.has(c)) return c; }
}

function qrSvg(text) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function hqCall(a, f) {
  try { return await api.hq(a, f); }
  catch (e) {
    H.busy = false;
    if (e.code === "not_hq") { H.msg = "這個畫面限社會處使用。社會處身分由系統管理者設定。"; render(); return null; }
    if (!handleApiError(e)) { H.msg = "網路不穩，請稍後按右上角重新整理。"; render(); }
    return null;
  }
}

async function loadHq() {
  H.msg = "";
  if (S.view === "hq") {
    const d = await hqCall("hqInit");
    if (d) {
      H.init = normInit(d);
      if (!H.ev || (H.ev !== "new" && !d.events.some(e => e.id === H.ev))) {
        const act = d.events.find(e => e.status === "應變中");
        H.ev = act ? act.id : "new";
      }
    }
  }
  // 待我處理：工作人員申請＋現場回報社會處的事件（各所的「待社會處」件數，點進去看）
  if (S.view === "inbox") { const [d, st] = await Promise.all([hqCall("hqApps"), hqCall("hqSites")]); if (d) H.apps = d.apps || []; if (st) H.sites = st.sites || []; }
  if (S.view === "sites") {
    const d = await hqCall("hqSites");
    if (d) {
      const evName = id => ((d.events || []).find(e => e.id === id) || {}).name || "其他";
      H.sites = (d.sites || []).map(s => ({ ...s, event: s.event || evName(first(s.eventId)) }));
      // 最近結案（已撤收）：依撤收時間新到舊
      H.closed = (d.closed || []).sort((a, b) => (Date.parse(b.closeAt) || 0) - (Date.parse(a.closeAt) || 0));
    }
  }
  render();
}

function hqNav() {
  return `<div class="pick" style="margin:0 16px">${HQ_VIEWS.map(v =>
    `<button data-go="?v=${v}" class="${S.view === v ? "on" : ""}">${HQ_TITLE[v]}</button>`).join("")}
    <button id="hq-reload" aria-label="重新整理" style="margin-left:auto">↻</button></div>`;
}
function hqHead(sub) { return pubHead(HQ_TITLE[S.view], sub) + hqNav(); }
const hqWait = () => `<div class="blocked"><p>${esc(H.msg || "載入中…")}</p></div>`;

function renderHq() {
  $("#bar").hidden = REAL; $("#bar .in").style.display = "none";   // 原型只留示範切換列
  document.title = HQ_TITLE[S.view];
  if (S.view === "hq") return renderCmd();
  if (S.view === "inbox") return renderInbox();
  return renderSites();
}

// ---------- 指揮台：① 災害事件 → ② 勾選收容所 → 開設 → ③ 簽到 QR ----------
function cmdState() {
  const d = H.init, ev = d.events.find(e => e.id === H.ev);
  const kind = ev ? ev.kind : H.newEv.kind;
  const opened = new Map(ev ? d.openings.filter(o => o.eventId === ev.id).map(o => [o.shelterId, o]) : []);
  return { d, ev, kind, opened };
}
const canOpen = () => H.sel.length && !H.busy && (H.ev !== "new" || H.newEv.name.trim());

function renderCmd() {
  const app = $("#app");
  if (!H.init) { setHTML(app, hqHead("社會處") + hqWait()); return; }
  const { d, ev, kind, opened } = cmdState();
  const evs = d.events.filter(e => e.status !== "已結束");
  const fit = s => s.kinds.includes(kind);
  const list = d.shelters.filter(s => !H.onlyFit || fit(s) || H.sel.includes(s.id) || opened.has(s.id));
  const sel = H.sel.map(id => d.shelters.find(s => s.id === id)).filter(Boolean);
  const cap = sel.reduce((a, s) => a + s.cap, 0);

  let html = hqHead(`社會處｜${d.me.name}`);
  html += `<div class="hq-step"><h2><span class="n">1</span>災害事件</h2><p class="hint">選擇進行中的災害，或建立新的。</p>
    ${evs.map(e => `<button class="opt ${H.ev === e.id ? "on" : ""}" data-ev="${esc(e.id)}"><span class="box">${H.ev === e.id ? "✓" : ""}</span>
      <span><span class="nm">${esc(e.name)}</span><br><span class="meta">${esc(e.kind)}・${esc(e.status)}・已開設 ${d.openings.filter(o => o.eventId === e.id).length} 所</span></span></button>`).join("")}
    <button class="opt ${H.ev === "new" ? "on" : ""}" data-ev="new"><span class="box">${H.ev === "new" ? "✓" : ""}</span><span class="nm">＋ 建立新的災害</span></button>
    ${H.ev === "new" ? `<label>災害名稱<input id="hq-evname" maxlength="40" placeholder="例：2026-10 ○○颱風" value="${esc(H.newEv.name)}"></label>
      <label>災害類別<select id="hq-evkind">${HQ_KINDS.map(k => `<option ${k === H.newEv.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>` : ""}</div>`;

  // 選了之後可以收合清單，只留一行摘要；展開時下方有固定的「已選 N 所・選好了」列，不用捲到最下面找開設按鈕
  const listOpen = H.pickOpen || !sel.length;
  const needName = H.ev === "new" && !H.newEv.name.trim();
  html += `<div class="hq-step" id="hq-step2"><h2><span class="n">2</span>選擇收容所</h2>
    ${!listOpen ? `<div class="hq-picked"><span>已選 ${sel.length} 所：${esc(sel.map(s => s.name).join("、"))}</span><button id="hq-pickopen">▸ 修改</button></div>` : `<p class="hint">綠色標籤＝適用「${esc(kind)}」；橘色＝適合安置避難弱者。已開設的不能重複開設。</p>
    <button class="opt" id="hq-fit" style="margin-top:8px"><span class="box" style="${H.onlyFit ? "background:var(--blue);border-color:var(--blue)" : ""}">${H.onlyFit ? "✓" : ""}</span>
      <span class="meta">只顯示適用「${esc(kind)}」的收容所</span></button>
    ${list.map(s => {
      const o = opened.get(s.id), on = H.sel.includes(s.id);
      const tags = s.kinds.map(k => `<span class="ktag ${k === kind ? "hit" : ""}">${esc(k)}</span>`).join("") + (s.weak ? `<span class="ktag weak">弱者安置</span>` : "");
      return `<button class="opt ${on ? "on" : ""} ${fit(s) ? "" : "dim"}" data-sh="${esc(s.id)}" ${o ? "disabled" : ""}>
        <span class="box">${on ? "✓" : ""}</span>
        <span><span class="nm">${s.no}. ${esc(s.name)}</span><br><span class="meta">${esc(nz(s.addr))}・容納 ${s.cap} 人</span><br>${tags}</span>
        ${o ? `<span class="done-tag">已開設</span>` : ""}</button>`;
    }).join("") || `<p class="hint" style="margin-top:8px">沒有標示適用「${esc(kind)}」的收容所，請取消上方篩選看全部。</p>`}
    ${sel.length ? `<div class="hq-sticky"><span>已選 <b>${sel.length}</b> 所，可容納 ${cap} 人</span><button id="hq-pickdone">選好了 ▾</button></div>`
      : `<p class="hint" style="margin-top:10px;font-weight:700;color:var(--blue)">尚未選擇</p>`}`}
    <p class="hint" style="margin-top:10px">之後要加開收容所，選既有的災害再勾選即可。</p></div>
    ${needName && sel.length ? `<p class="err" id="hq-needname" style="margin:8px 16px 0">請先在上方填「災害名稱」，才能開設。</p>` : ""}
    <button class="hq-go" id="hq-open" ${canOpen() ? "" : "disabled"}>${H.busy ? "開設中…" : `開設 ${sel.length || ""} 所`}</button>
    ${H.msg ? `<p class="err" style="margin:8px 16px">${esc(H.msg)}</p>` : ""}`;

  const last = lastTags();
  html += `<div class="hq-step"><h2><span class="n">🏷</span>居民號碼牌</h2>
    <p class="hint">替收容所產生空白號碼牌。不用先開設，平時就能先印好放在收容所；收容所管理者在班時也能自己產生。</p>
    <label>收容所<select id="hq-tagsh">${[...d.shelters].sort((a, b) => (opened.has(b.id) ? 1 : 0) - (opened.has(a.id) ? 1 : 0) || a.no - b.no)
      .map(s => `<option value="${esc(s.id)}" ${s.id === H.tagSh ? "selected" : ""}>${opened.has(s.id) ? "【開設中】" : ""}${s.no}. ${esc(s.name)}</option>`).join("")}</select></label>
    <button class="hq-go" id="hq-tags">產生空白號碼牌</button>
    ${last ? `<button class="hq-go ghost" id="hq-lasttags">重印上次產生的（${esc(last.p)}・${last.c.length} 張）</button>` : ""}</div>`;

  if (ev && opened.size) {
    const os = [...opened.values()];
    html += `<div class="hq-step"><h2><span class="n">3</span>簽到 QR <small style="font-weight:400;color:var(--soft)">${os.length} 所</small></h2>
      <p class="hint">每所一張，貼在服務台給工作人員掃描簽到，一所一張 A4。</p>
      <button class="hq-go" id="hq-print" style="margin:10px 0 0;width:100%;background:var(--green)">${inLine() ? "存成 PDF（用瀏覽器開啟）" : `列印簽到 QR（${os.length} 張）`}</button>
      <p class="hint">${esc(inLine() ? PDF_HINT : "列印視窗的「目的地」選「另存為 PDF」就能存成 PDF。")}</p></div>
      <div class="mailtip">📧 <b>要請同事幫忙列印？</b><br>按每張卡最下面的藍色按鈕 <b>「✉ 用 Email 寄給同仁」</b> → 手機郵件 App 會打開 → 填同事的信箱寄出。同事用電腦點信裡的連結就能列印。</div>
      <div class="qrcards">${os.map(o => qrCard(o, ev.name, true)).join("")}</div>`;
  }
  setHTML(app, html);
}

function qrCard(o, evName, withMail) {
  const s = H.init.shelters.find(x => x.id === o.shelterId) || { name: o.name };
  return qrCardRaw(evName, s.name, o.code, H.lastNew.includes(o.shelterId), withMail);
}
function qrCardRaw(evName, name, code, isNew, withMail) {
  return `<div class="qrcard ${isNew ? "new" : ""}">
    <div class="band"><b>工作人員簽到</b><span>${esc(evName)}</span><strong>${esc(name)}</strong></div>
    <div class="qr">${qrSvg(signUrl(code))}</div><p>本所工作人員共用・用 LINE 掃描 → 按「傳送」</p>
    ${withMail ? `<a class="qrmail" href="${esc(qrMailHref(evName, name, code))}">✉ 用 Email 寄給同仁</a>` : ""}</div>`;
}
// 手機上直接寄出簽到 QR：打開郵件 App，內文附「QR 列印頁」連結（收件人點開就看得到 QR，可列印或存 PDF，不需登入）
// 不直接附簽到連結：避免收件人不在現場就點連結簽到
function qrPrintUrl(evName, name, code) {
  return `${location.origin}${location.pathname}?v=printqr#${b64e({ e: evName, c: [[name, code]] })}`;
}
function qrMailHref(evName, name, code) {
  return mailHref(`【簽到 QR Code】${name}（${evName}）`, [
    `■ ${name}｜工作人員簽到 QR Code`,
    `災害：${evName}`,
    "",
    "▶ 點下面的連結，就看得到 QR Code，可以列印或存成 PDF：",
    "",
    qrPrintUrl(evName, name, code),
    "",
    "▶ 用法：",
    "印出來貼在服務台，給本所工作人員用 LINE 掃描簽到。",
    "",
    "※ 這個連結含有簽到碼，請只轉給本所工作人員。",
  ]);
}
// 存成 PDF 時的檔名（手機瀏覽器用網頁標題當檔名）：去掉檔名不能用的字元
const fileTitle = s => String(s).replace(/[\\/:*?"<>|]/g, "_").trim();

async function doOpen() {
  const { d, ev } = cmdState();
  const evName = ev ? ev.name : H.newEv.name.trim();
  const names = H.sel.map(id => d.shelters.find(s => s.id === id).name);
  if (!confirm(`在「${evName}」開設以下 ${names.length} 所？\n\n${names.join("\n")}\n\n開設後直接是「開設中」，民眾的收容所資訊會列出這幾所。`)) return;
  H.busy = true; H.msg = ""; render();
  const used = new Set(d.openings.map(o => o.code));
  const sh = H.sel.map(id => { const code = newSignCode(used); used.add(code); return `${id}:${code}`; }).join(",");
  const r = await hqCall("hqOpen", { ev: ev ? ev.id : "", evName, evKind: ev ? ev.kind : H.newEv.kind, sh });
  H.busy = false;
  if (!r) { H.init = null; render(); await loadHq(); return; }   // 網路中斷時重新讀取，看實際開了哪幾所
  H.ev = r.eventId; H.lastNew = H.sel.slice(); H.sel = []; H.pickOpen = true; H.newEv = { name: "", kind: H.newEv.kind };
  toast(`已開設 ${names.length} 所，簽到 QR 已產生`);
  await loadHq();
  const q = document.querySelector(".qrcards"); if (q) q.scrollIntoView({ block: "start" });
}

function doPrint() {
  const { ev, opened } = cmdState();
  // LINE 裡不能列印：改用手機瀏覽器開啟列印頁（?v=printqr），資料放在網址 # 後面（只有災害名稱、收容所名稱、簽到代碼），不需登入
  if (inLine()) return openPrintView("printqr", { e: ev.name, c: [...opened.values()].map(o => [(H.init.shelters.find(x => x.id === o.shelterId) || o).name, o.code]) });
  setHTML($("#printArea"), [...opened.values()].map(o => qrCard(o, ev.name)).join(""));
  window.print();
}

// ---------- 待我處理：工作人員申請 ----------
function renderInbox() {
  const app = $("#app");
  if (!H.apps) { setHTML(app, hqHead("社會處") + hqWait()); return; }
  setHTML(app, hqHead("有人申請時，LINE 會通知社會處") +
    `<div class="sec">工作人員申請 <small>${H.apps.length} 件待核准</small></div>` +
    (H.apps.map(a => `<button class="app" data-app="${esc(a.id)}"><div class="t">${esc(a.name)}</div>
      <div class="meta">${esc(nz(a.unit))}・${esc(nz(a.phone))}</div><div class="meta">LINE：${esc(nz(a.line))}・${esc(ago(a.at))}申請</div></button>`).join("")
      || `<div class="card"><small>目前沒有待核准的申請。</small></div>`) +
    (() => { const hs = (H.sites || []).filter(s => toNum(s.hqn) > 0);
      return `<div class="sec">現場回報的事件 <small>${hs.length ? `${hs.length} 所有事件等社會處處理` : "目前沒有"}</small></div>` +
        (hs.map(s => `<button class="site" data-site="${esc(s.id)}"><div class="t">📣 ${esc(s.name)}<small>待社會處 ${toNum(s.hqn)} 件</small></div>
          <div class="nums"><span>點進去看事件，回覆指示或接手處理</span></div></button>`).join("")
          || `<div class="card"><small>現場處理不了、回報社會處的事件會列在這裡；工作人員從選單「我要反映」送來的也是。</small></div>`); })());
}

function appSheet(id) {
  const a = H.apps.find(x => x.id === id); if (!a) return;
  // 雛形測試先簡化：不分身分、角色，核准的人一律是「工作人員・管理者（收容所負責人）」（11/25 使用者決定）
  const f = { kind: "工作人員", role: "管理者（收容所負責人）" };
  sheet(`<h2>${esc(a.name)}</h2>
    <div class="meta">${esc(nz(a.unit))}・${esc(nz(a.phone))}<br>LINE 名稱：${esc(nz(a.line))}・${esc(ago(a.at))}申請</div>
    <p class="hint" style="margin-top:8px">核准後權限是「管理者」，對方會收到 LINE 通知，到收容所掃簽到 QR 就能開始上班；簽到的那一所就是他派駐的收容所。</p>
    <div class="err" id="ap-err"></div>
    <div class="acts"><button id="ap-no">不核准</button><button class="go" id="ap-ok" style="background:var(--green)">核准</button></div>`, root => {
    root.querySelector("#ap-ok").onclick = async () => {
      const role = f.role;
      const b = root.querySelector("#ap-ok"); b.disabled = true; b.textContent = "核准中…";
      const r = await hqCall("hqApprove", { id, kind: f.kind, role });
      if (!r) { b.disabled = false; b.textContent = "核准"; return; }
      closeSheet(); H.apps = H.apps.filter(x => x.id !== id); render();
      toast(`已核准 ${a.name}，已用 LINE 通知對方`);
    };
    root.querySelector("#ap-no").onclick = async () => {
      if (!confirm(`不核准 ${a.name} 的申請？\n對方之後可以重新申請。`)) return;
      const r = await hqCall("hqReject", { id });
      if (!r) return;
      closeSheet(); H.apps = H.apps.filter(x => x.id !== id); render();
      toast(`已退回 ${a.name} 的申請`);
    };
  });
}

// ---------- 各所現況：開設中、撤收中的收容所一覽，點進去看該所的本所畫面（只能看，撤收・結案除外）；下方列出最近結案 ----------
function renderSites() {
  const app = $("#app");
  if (!H.sites) { setHTML(app, hqHead("社會處") + hqWait()); return; }
  const groups = [...new Set(H.sites.map(s => s.event))];
  const n = (v, label, cls) => `<span class="${v ? cls : ""}">${label} <b>${v}</b></span>`;
  const closed = H.closed || [];
  setHTML(app, hqHead("開設中、撤收中的收容所，點進去看該所狀況") + (groups.map(g => `<div class="sec">${esc(g)} <small>${H.sites.filter(s => s.event === g).length} 所</small></div>` +
    H.sites.filter(s => s.event === g).map(s => `<button class="site" data-site="${esc(s.id)}">
      <div class="t">${esc(s.light || "")} ${esc(s.name)}${s.stage === "撤收中" ? `<span class="stagetag">撤收中</span>` : s.ready ? `<span class="stagetag ready">已回報可撤收</span>` : ""}<small>${s.inside}／${s.capacity} 人</small></div>
      <div class="nums">${n(s.out, "外出", "warn")}${n(s.late, "未返", "alert")}${n(s.care, "需關懷", "warn")}
        ${n(toNum(s.hqn), "待社會處", "alert")}<span>在班 <b>${(s.staff || 0) + (s.vol || 0)}</b></span>${n(s.low, "低庫存", "warn")}</div></button>`).join("")).join("")
    || `<div class="card"><small>目前沒有開設中的收容所。到「指揮台」開設。</small></div>`)
    + (closed.length ? `<div class="sec">最近結案 <small>點進去看結報</small></div>` + closed.map(c => `<button class="site" data-final="${esc(c.id)}">
      <div class="t">${esc(c.name)}<small>${esc(fmtTime(c.closeAt))} 結案</small></div>
      <div class="nums"><span>累計收容 <b>${toNum(c.n)}</b></span><span>最高在所 <b>${toNum(c.m)}</b></span></div></button>`).join("") : ""));
}

// ---------- 點擊與輸入 ----------
document.addEventListener("click", e => {
  if (!HQ_VIEWS.includes(S.view)) return;
  const t = e.target.closest("button, a"); if (!t || t.closest("#sheet")) return;
  if (t.dataset.go != null) return go(t.dataset.go);
  if (t.id === "hq-reload") { H.init = H.apps = H.sites = null; render(); return loadHq(); }
  if (t.dataset.ev) { H.ev = t.dataset.ev; H.sel = []; H.lastNew = []; H.msg = ""; H.pickOpen = true; return render(); }
  if (t.id === "hq-pickopen") { H.pickOpen = true; return render(); }
  if (t.id === "hq-pickdone") {
    H.pickOpen = false; render();
    const st = $("#hq-step2"); if (st) st.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (t.dataset.sh && !t.disabled) { const id = t.dataset.sh; H.sel = H.sel.includes(id) ? H.sel.filter(x => x !== id) : [...H.sel, id]; return render(); }
  if (t.id === "hq-fit") { H.onlyFit = !H.onlyFit; return render(); }
  if (t.id === "hq-open" && canOpen()) return doOpen();
  if (t.id === "hq-print") return doPrint();
  if (t.id === "hq-tags") {
    const sel = $("#hq-tagsh"), s = H.init.shelters.find(x => x.id === (sel && sel.value)); if (!s) return;
    H.tagSh = s.id;
    return tagGenSheet(s.name, async codes => { const r = await hqCall("hqTags", { s: s.id, tg: codes.join(",") }); return r ? String(r.tags || "").split(",").filter(Boolean) : null; });
  }
  if (t.id === "hq-lasttags") { const d = lastTags(); if (d) tagResultSheet(d); return; }
  if (t.dataset.app) return appSheet(t.dataset.app);
  if (t.dataset.site) return go(`?v=ops&o=${encodeURIComponent(t.dataset.site)}`);
  if (t.dataset.final) return go(`?v=report&o=${encodeURIComponent(t.dataset.final)}`);
});
document.addEventListener("input", e => {
  if (S.view !== "hq") return;
  if (e.target.id === "hq-evname") {
    H.newEv.name = e.target.value; const b = $("#hq-open"); if (b) b.disabled = !canOpen();
    const w = $("#hq-needname"); if (w) w.hidden = !!H.newEv.name.trim();
  }
  if (e.target.id === "hq-evkind") { H.newEv.kind = e.target.value; H.sel = []; render(); }
});
