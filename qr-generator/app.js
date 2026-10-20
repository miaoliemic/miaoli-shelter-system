// QR Code 產生器：① 開設收容所（簽到 QR）
// 不連網路、不連系統。這一批的代碼存在瀏覽器 localStorage，重新整理不會變；按「清除這批」才會重來。
(function () {
  "use strict";

  const OA_ID = "@796juukk";             // 官方帳號 Basic ID；換帳號時要改這裡並重印所有 QR
  const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";   // 排除 0 O 1 I L
  const KINDS = ["風災", "水災", "震災", "土石流", "海嘯", "其他"];
  const STORE = "qrgen.open.v1";
  const LOGO = "../assets/logo.png";     // 縣徽；檔案不存在時卡片不顯示

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- 狀態 ----------
  // codes：收容所編號 → 簽到代碼（產生後固定）；selected：勾選的收容所編號
  let st = { ev: "", kind: "水災", time: "", selected: [], codes: {}, generated: false };
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.codes) st = Object.assign(st, s); } catch (e) {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} };

  let logoOk = false;
  const probe = new Image();
  probe.onload = () => { logoOk = true; renderResult(); };
  probe.src = LOGO;

  // ---------- 工具 ----------
  function newCode(used) {
    const buf = new Uint32Array(5);
    for (;;) {
      crypto.getRandomValues(buf);
      const c = "SIGN-" + Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join("");
      if (!used.has(c)) return c;
    }
  }
  const signUrl = code => `https://line.me/R/oaMessage/${OA_ID}/?` + encodeURIComponent("簽到 " + code);

  function qrSvg(text) {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  function nowLocal() {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  const fmtTime = t => t ? t.replace("T", " ") : "";
  const shelter = no => SHELTERS.find(s => s.no === no);

  // ---------- 1. 災害資訊 ----------
  $("kind").innerHTML = KINDS.map(k => `<option>${k}</option>`).join("");
  $("ev").value = st.ev;
  $("kind").value = st.kind;
  $("time").value = st.time || nowLocal();
  st.time = $("time").value;
  for (const id of ["ev", "kind", "time"]) {
    $(id).addEventListener("input", () => {
      st[id] = $(id).value.trim();
      save();
      renderList();
      renderResult();
    });
  }

  // ---------- 2. 選擇收容所 ----------
  const fits = s => s.kinds.includes(st.kind);

  function renderList() {
    const only = $("onlyFit").checked;
    const rows = SHELTERS.filter(s => !only || fits(s) || st.selected.includes(s.no));
    $("list").innerHTML = rows.length ? rows.map(s => {
      const on = st.selected.includes(s.no);
      const tags = s.kinds.map(k => `<span class="tag${k === st.kind ? " hit" : ""}">${esc(k)}</span>`).join("") +
        (s.weak ? '<span class="tag weak">弱者安置</span>' : "");
      return `<label class="sh${on ? " on" : ""}${fits(s) ? "" : " dim"}">
        <input type="checkbox" data-no="${s.no}"${on ? " checked" : ""}>
        <span><span class="nm">${s.no}. ${esc(s.name)}</span><br>
        <span class="meta">${esc(s.addr)}・容納 ${s.cap} 人</span><br>${tags}</span></label>`;
    }).join("") : `<p class="empty">沒有標示適用「${esc(st.kind)}」的收容所。取消上方勾選，可以看全部 21 所。</p>`;
    const sel = st.selected.map(shelter);
    const cap = sel.reduce((a, s) => a + s.cap, 0);
    $("sum").textContent = sel.length ? `已選 ${sel.length} 所，可容納 ${cap} 人` : "尚未選擇";
    $("gen").disabled = !sel.length || !st.ev;
    $("gen").textContent = !st.ev ? "請先填災害名稱" : st.generated ? "更新簽到 QR" : "產生簽到 QR";
  }

  $("list").addEventListener("change", e => {
    const no = Number(e.target.dataset.no);
    if (!no) return;
    st.selected = e.target.checked ? [...new Set([...st.selected, no])] : st.selected.filter(n => n !== no);
    st.selected.sort((a, b) => a - b);
    save();
    renderList();
  });
  $("onlyFit").addEventListener("change", renderList);
  $("selFit").addEventListener("click", () => {
    st.selected = [...new Set([...st.selected, ...SHELTERS.filter(fits).map(s => s.no)])].sort((a, b) => a - b);
    save(); renderList();
  });
  $("selNone").addEventListener("click", () => { st.selected = []; save(); renderList(); });

  // ---------- 3. 產生 ----------
  $("gen").addEventListener("click", () => {
    const used = new Set(Object.values(st.codes));
    for (const no of st.selected) {
      if (!st.codes[no]) { st.codes[no] = newCode(used); used.add(st.codes[no]); }
    }
    st.generated = true;
    save();
    renderList();
    renderResult();
  });

  function items() {
    return st.generated ? st.selected.map(no => ({ s: shelter(no), code: st.codes[no] })).filter(x => x.code) : [];
  }

  function cardHtml(x) {
    return `<div class="card">
      <div class="band">
        <img class="logo${logoOk ? " ok" : ""}" src="${logoOk ? LOGO : ""}" alt="">
        <span class="t">工作人員簽到</span>
        <span class="ev">${esc(st.ev)}</span>
        <span class="pl">${esc(x.s.name)}</span>
      </div>
      <div class="qr">${qrSvg(signUrl(x.code))}</div>
      <p class="who">本所工作人員共用</p>
      <p class="how">用 LINE 掃描 → 按「傳送」→ 完成簽到</p>
      <p class="foot">開設時間 ${esc(fmtTime(st.time))}｜苗栗縣政府災時避難所管理系統</p>
    </div>`;
  }

  function renderResult() {
    const list = items();
    $("print").disabled = $("csv").disabled = !list.length;
    $("reset").disabled = !Object.keys(st.codes).length;
    if (!list.length) { $("result").innerHTML = ""; $("sheet").innerHTML = ""; return; }
    const table = `<table class="out"><tr><th>收容所</th><th>簽到代碼（只給管理用，卡片上不印）</th><th>開設名稱（CSV）</th></tr>` +
      list.map(x => `<tr><td>${x.s.no}. ${esc(x.s.name)}</td><td><code>${x.code}</code></td><td>${esc(openName(x))}</td></tr>`).join("") +
      "</table>";
    const cards = list.map(cardHtml).join("");
    $("result").innerHTML = table + `<div class="cards">${cards}</div>`;
    $("sheet").innerHTML = cards;
  }

  const openName = x => `${st.ev}｜${x.s.name}`;

  $("print").addEventListener("click", () => window.print());

  $("csv").addEventListener("click", () => {
    // 欄位名稱對應 Notion「收容所開設」；災害事件、收容所是關聯欄，匯入時依名稱連到同名頁面
    const head = ["開設名稱", "災害事件", "收容所", "開設時間", "開設狀態", "簽到代碼", "備註"];
    const cell = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [head.join(",")].concat(items().map(x =>
      [openName(x), st.ev, x.s.name, fmtTime(st.time), "整備中", x.code, "QR 產生器第一版產生"].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `收容所開設_${st.ev.replace(/[\\/:*?"<>|]/g, "_")}_${st.time.slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("reset").addEventListener("click", () => {
    if (!confirm("清除這一批的簽到代碼？\n已經印出或匯入 Notion 的 QR，代碼不會跟著改；清除後重新產生的會是新的代碼。")) return;
    st = { ev: "", kind: st.kind, time: nowLocal(), selected: [], codes: {}, generated: false };
    save();
    $("ev").value = ""; $("time").value = st.time;
    renderList();
    renderResult();
  });

  renderList();
  renderResult();
})();
