// 原型用的模擬後端與示範切換列：只在本機預覽時由 app.js 載入，正式網址（GitHub Pages）不會用到。
// 依賴 app.js 的全域：S、ApiError、wait、recipName、$
// ===== 模擬後端（原型用）。正式版由 Make 情境 13 提供相同格式的回應 =====
const mock = {
  me: { name: "測試小芳", role: "管理者（收容所負責人）", onDuty: true,
        opening: "【模擬】清華里活動中心", event: "【模擬】2026-10 風災" },
  items: [
    { id: "i1", code: "SUP-7K2QX", name: "飲用水", cat: "飲用水", unit: "瓶", pack: "箱", per: 24, stock: 216, safety: 48 },
    { id: "i2", code: "SUP-M4TZ8", name: "泡麵", cat: "食品", unit: "碗", pack: "箱", per: 12, stock: 60, safety: 24 },
    { id: "i3", code: "SUP-R9WD2", name: "餅乾", cat: "食品", unit: "包", pack: "箱", per: 30, stock: 90, safety: 30 },
    { id: "i4", code: "SUP-H3NV6", name: "衛生紙", cat: "衛生用品", unit: "包", pack: "串", per: 12, stock: 72, safety: 24 },
    { id: "i5", code: "SUP-Q8LJ5", name: "成人紙尿褲", cat: "衛生用品", unit: "片", pack: "包", per: 10, stock: 30, safety: 20 },
    { id: "i6", code: "SUP-B6XC7", name: "口罩", cat: "醫療", unit: "片", pack: "盒", per: 50, stock: 300, safety: 100 },
    { id: "i7", code: "SUP-T2FY9", name: "暖暖包", cat: "防寒", unit: "片", pack: "盒", per: 10, stock: 38, safety: 50 },
    { id: "i8", code: "SUP-W5KP3", name: "毛毯", cat: "寢具", unit: "條", pack: "", per: 1, stock: 30, safety: 10 },
  ],
  residents: { "MLS-W8AGZ": { id: "r1", name: "測試王小明", note: "長者・高齡者", inShelter: true },
               "MLS-K7PQ2": { id: "r2", name: "測試林阿姨", note: "在所", inShelter: true },
               "MLS-RXKK3": { id: "r3", name: "測試陳美華", note: "已離所", inShelter: false } },
  // 居民頁面（?r=MLS-xxxxx）用的號碼牌
  tags: { "MLS-W8AGZ": "r1", "MLS-K7PQ2": "r2", "MLS-RXKK3": "void", "MLS-NEW01": "blank" },
  people: { r1: { id: "r1", name: "測試王小明", age: "長者", care: "高齡者", status: "在所", back: "", area: "A 區 3 號床" },
            r2: { id: "r2", name: "測試林阿姨", age: "成人", care: "", status: "外出", back: new Date(Date.now() + 2 * 3600e3).toISOString(), area: "" } },
  recent: [
    { t: "10:42", text: "衛生紙 發放 1 包・王大明" },
    { t: "10:35", text: "成人紙尿褲 入庫 30 片" },
    { t: "10:20", text: "飲用水 入庫 2 箱" },
  ],
  seen: new Set(),
};

const mockOps = {
  stage: params0().get("stage") || "開設中", n: 3,
  events: [
    { id: "e1", title: "設施環境：2 樓男廁漏水", cat: "設施環境", sev: "高", status: "待處理", text: "2 樓男廁洗手台下方漏水，地板濕滑", log: "", owner: "", by: "s2", item: "", at: new Date(Date.now() - 50 * 60e3).toISOString() },
    { id: "e2", title: "人員相關：夜班志工不足", cat: "人員相關", sev: "中", status: "處理中", text: "今晚 22:00 後只有 1 位志工", log: "\n10/19 14:20 測試小芳 認領處理：已聯絡社會處調派", owner: "s1", by: "s1", item: "", at: new Date(Date.now() - 3 * 3600e3).toISOString() },
    { id: "e3", title: "緊急事件：長者跌倒", cat: "緊急事件", sev: "緊急", status: "待處理", text: "A 區 3 號床長者跌倒，意識清楚，右手腕疼痛", log: "", owner: "", by: "s2", item: "", at: new Date(Date.now() - 8 * 60e3).toISOString() },
    { id: "p1", title: "整備回報：場地清潔已完成", cat: "整備回報", sev: "低", status: "已解決", text: "", log: "", owner: "", by: "s1", item: "場地清潔", at: new Date().toISOString() },
  ],
};
function params0() { return new URLSearchParams(location.search); }
const mockPub = { state: params0().get("me") || "on" };   // 原型：?me=none｜pending｜off｜on
function mockStatus() {
  const open = mockOps.events.filter(e => !/已解決|已結案/.test(e.status));
  return { ok: true, me: { id: "s1", name: mock.me.name, role: mock.me.role },
    opening: { name: mock.me.opening, stage: mockOps.stage, light: open.some(e => e.sev === "緊急") ? "🔴" : "🟡", inside: 37, capacity: 120, out: 2, late: 1, care: 4,
               open: open.length, urgent: open.filter(e => e.sev === "緊急").length, needStaff: 1, needVol: 2 },
    duty: [{ id: "s1", name: mock.me.name, role: mock.me.role, kind: "工作人員" }, { id: "s2", name: "測試阿明", role: "門禁組", kind: "工作人員" }, { id: "s3", name: "測試小美", role: "志工", kind: "志工" }],
    residents: [{ id: "r1", name: "測試王小明", status: "在所", back: "", care: "高齡者" }, { id: "r2", name: "測試林阿姨", status: "外出", back: new Date(Date.now() + 2 * 3600e3).toISOString(), care: "" },
                { id: "r4", name: "測試陳伯伯", status: "未返", back: new Date(Date.now() - 3600e3).toISOString(), care: "身心障礙" }],
    events: mockOps.events.map(e => ({ ...e })) };
}
mockOps.call = async (a, f) => {
  await wait(400);
  const now = new Date(), st = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${mock.me.name}`;
  if (a === "status") return mockStatus();
  if (a === "report") { const id = "e" + (++mockOps.n); mockOps.events.unshift({ id, title: `${f.cat}：${f.text.slice(0, 24)}`, cat: f.cat, sev: f.sev, status: "待處理", text: f.text, log: "", owner: "", by: "s1", item: "", at: now.toISOString() }); return { ok: true, id }; }
  if (a === "update") {
    const e = mockOps.events.find(x => x.id === f.id);
    if (f.kind === "claim") { e.owner = "s1"; e.status = "處理中"; e.log += `\n${st} 認領處理${f.text ? "：" + f.text : ""}`; }
    if (f.kind === "note") e.log += `\n${st}：${f.text}`;
    if (f.kind === "resolve") { e.status = "已解決"; e.log += `\n${st} 標記已解決${f.text ? "：" + f.text : ""}`; }
    return { ok: true };
  }
  if (a === "prep") { mockOps.events.unshift({ id: "p" + (++mockOps.n), title: `整備回報：${f.item}${f.result}`, cat: "整備回報", sev: f.result === "已完成" ? "低" : "中", status: f.result === "已完成" ? "已解決" : "待處理", text: f.text, log: "", owner: "", by: "s1", item: f.item, at: now.toISOString() }); return { ok: true }; }
  if (a === "prepDone") { mockOps.stage = "待核准"; return { ok: true }; }
};
// ===== 社會處（hq.js）的模擬後端：收容所主檔借用 qr-generator/shelters.js（公開資訊） =====
const mockHq = {
  events: [{ id: "ev1", name: "【模擬】2026-10 風災", kind: "風災", status: "應變中" }],
  openings: [{ id: "o1", eventId: "ev1", shelterId: "sh21", name: "【模擬】清華里活動中心", code: "SIGN-ZQ78G", status: "開設中" },
             { id: "o2", eventId: "ev1", shelterId: "sh15", name: "【模擬】大同國小活動中心", code: "SIGN-7K3Q9", status: "開設中" }],
  apps: [{ id: "a1", name: "測試陳志明", unit: "苗栗縣社會處", phone: "0912000111", line: "志明", at: new Date(Date.now() - 12 * 60e3).toISOString() },
         { id: "a2", name: "測試李小華", unit: "○○社福協會", phone: "0933000222", line: "Hua", at: new Date(Date.now() - 2 * 3600e3).toISOString() }],
  n: 2,
};
function mockCode() {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", r = new Uint32Array(5); crypto.getRandomValues(r);
  return "SIGN-" + Array.from(r, x => A[x % A.length]).join("");
}
async function mockHqCall(a, f) {
  await wait(400);
  if (!window.SHELTERS) await loadScript("../../qr-generator/shelters.js");
  const shelters = SHELTERS.map(x => ({ id: "sh" + x.no, no: x.no, name: x.name, addr: x.addr, cap: x.cap, kinds: x.kinds, weak: x.weak }));
  if (params0().get("role") === "staff") throw new ApiError("not_hq");
  if (a === "hqInit") return { ok: true, me: { name: "測試社會處長" }, events: mockHq.events, shelters, openings: mockHq.openings };
  if (a === "hqOpen") {
    let ev = mockHq.events.find(e => e.id === f.ev);
    if (!ev) { ev = { id: "ev" + (mockHq.events.length + 1), name: f.evName, kind: f.evKind, status: "應變中" }; mockHq.events.unshift(ev); }
    const created = [];
    for (const id of f.sh.split(",")) {
      if (mockHq.openings.some(o => o.eventId === ev.id && o.shelterId === id)) continue;
      const sh = shelters.find(x => x.id === id);
      const o = { id: "o" + (++mockHq.n), eventId: ev.id, shelterId: id, name: sh.name, code: mockCode(), status: "開設中" };
      mockHq.openings.push(o); created.push(o);
    }
    return { ok: true, eventId: ev.id, created };
  }
  if (a === "hqApps") return { ok: true, apps: mockHq.apps };
  if (a === "hqApprove" || a === "hqReject") { mockHq.apps = mockHq.apps.filter(x => x.id !== f.id); return { ok: true }; }
  if (a === "hqSites") return { ok: true, sites: mockHq.openings.filter(o => o.status === "開設中").map((o, i) => {
    const ev = mockHq.events.find(e => e.id === o.eventId), sh = shelters.find(x => x.id === o.shelterId);
    return i === 0 ? { id: o.id, event: ev.name, name: o.name, light: "🔴", inside: 37, capacity: 120, out: 2, late: 1, care: 4, open: 2, urgent: 1, needStaff: 1, needVol: 2, low: 1 }
                   : { id: o.id, event: ev.name, name: o.name, light: "🟢", inside: 12 * i, capacity: sh.cap, out: 0, late: 0, care: 1, open: 0, urgent: 0, needStaff: 0, needVol: 0, low: 0 };
  }) };
}

const mockApi = {
  async load() { await wait(300); return { me: mock.me, items: mock.items.map(x => ({ ...x })), recent: mock.recent.slice(0, 5) }; },
  async resident(tag) { await wait(150); return mock.residents[tag] || null; },
  // lines: [{ itemId, type: 入庫|發放|盤點調整, qty(最小單位，盤點調整可正負), note }]
  async submit(requestId, lines) {
    await wait(700);
    if (mock.seen.has(requestId)) return { duplicate: true, results: [] };
    if (lines.some(l => l.type === "發放") && !S.recip) throw new ApiError("no_recipient");
    mock.seen.add(requestId);
    const results = lines.map(l => {
      const it = mock.items.find(x => x.id === l.itemId);
      if (l.type === "發放" && l.qty > it.stock) return { itemId: l.itemId, ok: false, error: `庫存只剩 ${it.stock} ${it.unit}` };
      it.stock += l.type === "發放" ? -l.qty : l.qty;
      const now = new Date(), t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      mock.recent.unshift({ t, text: `${it.name} ${l.type} ${l.note}` + (l.type === "發放" && S.recip ? `・${recipName()}` : "") });
      return { itemId: l.itemId, ok: true, stock: it.stock };
    });
    return { results };
  },
  ops: (a, f) => mockOps.call(a, f),
  hq: (a, f) => mockHqCall(a, f),
  async pub(a, f) {
    await wait(400);
    if (a === "info") return { ok: true, shelters: [{ id: "o1", name: "【模擬】清華里活動中心" }, { id: "o2", name: "【模擬】大同國小" }], qa: [
      { title: "【演練】豪雨水災：收容所已開設", text: "受豪雨影響，苗栗市清華里、大同里一帶已開設收容所。請持號碼牌進出。", kw: "最新公告", type: "公告" },
      { title: "用餐與物資領取", text: "用餐：早餐 07:00、午餐 12:00、晚餐 18:00，在服務台旁領取。\n物資：飲用水、毛毯、盥洗用品請向服務台登記領取。", kw: "用餐與物資", type: "物資領取" },
      { title: "生活規定", text: "1. 進出請出示號碼牌。\n2. 外出請告知預計返回時間。\n3. 22:00 熄燈。", kw: "生活規定", type: "常見問題" },
      { title: "緊急聯絡", text: "緊急救護、火警：119\n報案：110\n在收容所內有緊急狀況，請直接找穿背心的現場工作人員。", kw: "緊急聯絡", type: "常見問題" }] };
    const st = mockPub.state;
    const hq = params0().get("role") === "hq";   // 原型：?role=hq 模擬社會處身分
    const me = { ok: true, state: st, name: st === "none" ? "" : hq ? "測試社會處長" : mock.me.name, role: st === "none" ? "" : hq ? "社會處" : mock.me.role, kind: params.get("kind") || "工作人員", line: "測試帳號" };
    if (a === "me") return me;
    if (a === "apply") { if (st === "none") mockPub.state = "pending"; return { ...me, state: mockPub.state }; }
    if (a === "feedback") return { ok: true };
    if (a === "signout") { if (st !== "on") return { ok: true, already: true }; mockPub.state = "off"; return { ok: true, name: mock.me.name }; }
  },
  async tagInfo(tag) {
    await wait(300);
    const v = mock.tags[tag], base = { ok: true, tag, role: mock.me.role, staff: mock.me.name, opening: mock.me.opening, openStatus: "開設中" };
    if (!v) return { ...base, state: "none" };
    if (v === "void" || v === "blank") return { ...base, state: v };
    return { ...base, state: "used", resident: { ...mock.people[v] } };
  },
  async register(f) {
    await wait(600);
    const id = "r" + (Object.keys(mock.people).length + 1);
    mock.people[id] = { id, name: f.name, age: f.age, care: f.care.split(",").filter(Boolean).join("、"), status: "在所", back: "", area: f.area };
    mock.tags[f.tag] = id; return { ok: true, residentId: id };
  },
  async move(tag, kind, hours) {
    await wait(500);
    const r = mock.people[mock.tags[tag]];
    if (kind === "離所") { r.status = "已離所"; mock.tags[tag] = "void"; }
    else if (kind === "外出") { r.status = "外出"; r.back = new Date(Date.now() + hours * 3600e3).toISOString(); }
    else r.status = "在所";
    return { ok: true, status: r.status };
  },
  async addItem(f) {
    await wait(400);
    const id = "i" + (mock.items.length + 1), code = "SUP-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const it = { id, code, name: f.name, cat: f.cat, unit: f.unit, pack: f.pack, per: f.per || 1, stock: 0, safety: f.safety || 0 };
    mock.items.push(it); return it;
  },
};

// ===== 原型示範切換（正式版移除） =====
function demoBar() {
  // 截圖模式（?shot=1）：不顯示示範切換列，一般畫面連同底部列一起隱藏
  if (new URLSearchParams(location.search).get("shot")) {
    $("#demo").style.display = "none";
    if (PUB_VIEWS.includes(S.view)) $("#bar").style.display = "none";
    return;
  }
  const base = location.pathname, links = [["一般進入", ""], ["掃物資標籤", "?item=SUP-7K2QX"], ["掃號碼牌（在所）", "?r=MLS-W8AGZ"], ["掃號碼牌（外出）", "?r=MLS-K7PQ2"], ["空白牌報到", "?r=MLS-NEW01"], ["失效牌", "?r=MLS-RXKK3"], ["本所", "?v=ops"], ["本所（整備中）", "?v=ops&stage=整備中"], ["非工作人員", "?as=guest"],
    ["收容所資訊", "?v=info"], ["我要反映", "?v=report"], ["緊急聯絡", "?v=sos"], ["專區（上班中）", "?v=staff"], ["專區（志工）", "?v=staff&kind=志工"],
    ["專區（未上班）", "?v=staff&me=off"], ["專區（未申請）", "?v=staff&me=none"], ["簽退", "?v=signout"], ["簽退（不在班）", "?v=signout&me=off"],
    ["社會處：指揮台", "?v=hq"], ["社會處：待我處理", "?v=inbox"], ["社會處：各所現況", "?v=sites"], ["社會處看某一所", "?v=ops&o=o1"], ["專區（社會處）", "?v=staff&me=off&role=hq"], ["非社會處開指揮台", "?v=hq&role=staff"]];
  $("#demo").innerHTML = `原型示範：` + links.map(([t, q]) => `<a href="${base}${q}">${t}</a>`).join("");
}
