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

// 開設狀態（撤收・結案）記在這個分頁的 sessionStorage，換畫面後還在；?stage= 可以直接指定
function mockStage(o, set) {
  const k = "mockStage:" + o;
  try { if (set) sessionStorage.setItem(k, set); const v = sessionStorage.getItem(k); if (v) return v; } catch (e) { if (set) return set; }
  return params0().get("stage") || (o === "o9" ? "已撤收" : "開設中");
}
const mockOps = {
  stage: mockStage("o1"), n: 3,
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
    opening: { id: S.hqO || "o1", name: S.hqO ? (mockHq.openings.find(o => o.id === S.hqO) || {}).name || mock.me.opening : mock.me.opening,
               stage: S.hqO ? mockStage(S.hqO) : mockOps.stage, light: open.some(e => e.sev === "緊急") ? "🔴" : "🟡", inside: 37, capacity: 120, out: 2, late: 1, care: 4,
               open: open.length, urgent: open.filter(e => e.sev === "緊急").length, staff: 2, vol: 1 },
    duty: [{ id: "s1", name: mock.me.name, role: mock.me.role, kind: "工作人員" }, { id: "s2", name: "測試阿明", role: "門禁組", kind: "工作人員" }, { id: "s3", name: "測試小美", role: "志工", kind: "志工" }],
    residents: [{ id: "r1", name: "測試王小明", status: "在所", back: "", care: "高齡者" }, { id: "r2", name: "測試林阿姨", status: "外出", back: new Date(Date.now() + 2 * 3600e3).toISOString(), care: "" },
                { id: "r4", name: "測試陳伯伯", status: "未返", back: new Date(Date.now() - 3600e3).toISOString(), care: "身心障礙" }],
    // o2：後端欄位沒填時會轉出 null，畫面要顯示「無」
    events: mockOps.events.map(e => ({ ...e })).concat(S.hqO === "o2" ? [{ id: "e9", title: null, cat: null, sev: null, status: "待處理", text: "", log: "", owner: "", by: "", item: "", at: new Date().toISOString() }] : []) };
}
mockOps.call = async (a, f) => {
  await wait(400);
  const now = new Date(), st = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${mock.me.name}`;
  if (a === "status") return mockStatus();
  if (a === "report") { const id = "e" + (++mockOps.n); mockOps.events.unshift({ id, title: `${f.cat}：${f.text.slice(0, 24)}`, cat: f.cat, sev: f.sev, status: "待處理", text: f.text, log: "", owner: "", by: "s1", item: "", at: now.toISOString() }); return { ok: true, id }; }
  if (a === "update") {
    const e = mockOps.events.find(x => x.id === f.id);
    if (f.kind === "claim") { e.owner = "s1"; e.status = "處理中"; e.log += `\n${st} 認領處理${f.text ? "：" + f.text : ""}`; }
    // 寫紀錄／已解決：還沒有人負責的事件，由寫的人負責（和情境 13 一樣）
    const first = !e.owner;
    if (f.kind === "note") { if (first) e.owner = "s1"; if (!e.status || e.status === "待處理") e.status = "處理中"; e.log += `\n${st}${first ? " 開始處理" : ""}：${f.text}`; }
    if (f.kind === "resolve") { if (first) e.owner = "s1"; e.status = "已解決"; e.log += `\n${st} 標記已解決${f.text ? "：" + f.text : ""}`; }
    return { ok: true };
  }
  if (a === "prep") { mockOps.events.unshift({ id: "p" + (++mockOps.n), title: `整備回報：${f.item}${f.result}`, cat: "整備回報", sev: f.result === "已完成" ? "低" : "中", status: f.result === "已完成" ? "已解決" : "待處理", text: f.text, log: "", owner: "", by: "s1", item: f.item, at: now.toISOString() }); return { ok: true }; }
  if (a === "prepDone") { mockOps.stage = "待核准"; return { ok: true }; }
  if (a === "closeReady") { mockOps.ready = now.toISOString(); mockOps.events.unshift({ id: "p" + (++mockOps.n), title: "撤收準備回報：可以撤收", cat: "整備回報", sev: "低", status: "已解決", text: `已完成：${f.items}
備註：${f.note || "無"}`, log: "", owner: "", by: "s1", item: "", who: `工作人員・管理者｜${mock.me.name}`, at: now.toISOString() }); return { ok: true }; }
};
// ===== 社會處（hq.js）的模擬後端：收容所主檔借用 qr-generator/shelters.js（公開資訊） =====
const mockHq = {
  events: [{ id: "ev1", name: "【模擬】2026-10 風災", kind: "風災", status: "應變中" }],
  openings: [{ id: "o1", eventId: "ev1", shelterId: "sh21", name: "【模擬】清華里活動中心", code: "SIGN-ZQ78G", status: "開設中" },
             { id: "o2", eventId: "ev1", shelterId: "sh15", name: "【模擬】大同國小活動中心", code: "SIGN-7K3Q9", status: "開設中" }],
  closed: { id: "o9", eventId: "ev0", name: "【模擬】2026-09 豪雨｜文山國小", openAt: new Date(Date.now() - 10 * 864e5).toISOString(), closeAt: new Date(Date.now() - 6 * 864e5).toISOString(), n: 18, m: 15 },
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
  const shelters = SHELTERS.map(x => ({ id: "sh" + x.no, no: x.no, name: x.name, addr: x.addr, cap: x.cap, kinds: x.kinds.join(","), weak: x.weak ? "適合" : "不適合" }));
  if (params0().get("role") === "staff") throw new ApiError("not_hq");
  if (a === "hqInit") return { ok: true, me: { name: "測試社會處長" }, events: mockHq.events, shelters, openings: mockHq.openings };
  if (a === "hqOpen") {
    let ev = mockHq.events.find(e => e.id === f.ev);
    if (!ev) { ev = { id: "ev" + (mockHq.events.length + 1), name: f.evName, kind: f.evKind, status: "應變中" }; mockHq.events.unshift(ev); }
    const created = [];
    for (const pair of f.sh.split(",")) {
      const [id, code] = pair.split(":");
      if (mockHq.openings.some(o => o.eventId === ev.id && o.shelterId === id)) continue;
      const sh = shelters.find(x => x.id === id);
      const o = { id: "o" + (++mockHq.n), eventId: ev.id, shelterId: id, name: `${ev.name}｜${sh.name}`, code, status: "開設中" };
      mockHq.openings.push(o); created.push(o);
    }
    return { ok: true, eventId: ev.id, created };
  }
  if (a === "hqApps") return { ok: true, apps: mockHq.apps };
  if (a === "hqReply" || a === "hqTake") {
    const e = mockOps.events.find(x => x.id === f.id); if (!e) throw new ApiError("not_ours");
    const n = new Date(), st = `${n.getMonth() + 1}/${n.getDate()} ${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`.replace(/^(\d)\//, "0$1/").replace(/\/(\d) /, "/0$1 ");
    if (a === "hqReply") e.log += `\n${st} 社會處 測試社會處長 指示：${f.text}`;
    else { e.owner = "hq1"; e.status = "處理中"; e.log += `\n${st} 社會處 測試社會處長 接手處理${f.text ? "：" + f.text : ""}`; }
    return { ok: true };
  }
  if (a === "hqLog") { if (!f.o || !f.text) throw new ApiError("bad_request"); mockOps.events.unshift({ id: "e" + (++mockOps.n), title: `${f.cat}：${f.text.slice(0, 24)}`, cat: f.cat, sev: f.sev, status: "待處理", text: f.text, log: "", owner: "", by: "", item: "", src: "社會處", who: "社會處｜測試社會處長", at: new Date().toISOString() }); return { ok: true }; }
  if (a === "hqTags") { if (!f.s || !f.tg) throw new ApiError("bad_request"); return { ok: true, tags: f.tg }; }
  if (a === "hqApprove" || a === "hqReject") { mockHq.apps = mockHq.apps.filter(x => x.id !== f.id); return { ok: true }; }
  if (a === "hqSites") return { ok: true, sites: mockHq.openings.filter(o => /開設中|撤收中/.test(mockStage(o.id))).map((o, i) => {
    const ev = mockHq.events.find(e => e.id === o.eventId), sh = shelters.find(x => x.id === o.shelterId), stage = mockStage(o.id);
    return i === 0 ? { id: o.id, eventId: ev.id, name: o.name, stage, light: "🔴", inside: 37, capacity: 120, out: 2, late: 1, care: 4, open: 2, urgent: 1, staff: 2, vol: 1, low: 1, ready: mockOps.ready || "" }
                   : { id: o.id, eventId: ev.id, name: o.name, stage, light: "🟢", inside: 12 * i, capacity: sh.cap, out: 0, late: 0, care: 1, open: 0, urgent: 0, staff: 1, vol: 0, low: 0 };
  }), events: mockHq.events.map(e => ({ id: e.id, name: e.name })),
    closed: [mockHq.closed, ...mockHq.openings.filter(o => mockStage(o.id) === "已撤收").map(o => ({ id: o.id, eventId: o.eventId, name: o.name, closeAt: new Date().toISOString(), n: 40, m: 33 }))] };
  // 撤收（開設中 → 撤收中）、結案（撤收中 → 已撤收）、結報原始資料
  if (a === "hqClose" || a === "hqFinish") {
    const from = a === "hqClose" ? "開設中" : "撤收中", to = a === "hqClose" ? "撤收中" : "已撤收";
    if (mockStage(f.o) !== from) throw new ApiError("bad_state");
    mockStage(f.o, to); if (f.o === "o1") mockOps.stage = to;
    if (a === "hqFinish") console.log("[模擬] hqFinish 寫入 Notion：", { n: f.n, m: f.m, s: f.s });
    return { ok: true };
  }
  if (a === "hqReport") return mockReport(f.o);
}

// 結報原始資料（不含姓名等個資，和正式後端相同格式）：依開設編號產生固定的模擬數字
function mockReport(o) {
  const closed = o === "o9", stage = mockStage(o), H = 3600e3, now = Date.now();
  const openAt = closed ? now - 10 * 864e5 : now - 3 * 864e5, closeAt = closed ? now - 6 * 864e5 : 0, end = closeAt || now;
  const iso = t => new Date(t).toISOString(), nRes = closed ? 18 : 40;
  const ages = ["成人", "成人", "長者", "兒童", "成人", "嬰幼兒", "長者"], cares = ["", "高齡者", "", "身心障礙", "", "幼童,其他", "", "孕婦", "特殊醫療需求", ""];
  const dests = ["返家", "返家", "投靠親友", "返家", "轉其他收容所", "返家", "投靠親友", "送醫", "返家", ""];   // "" ＝改版前離所、沒有記錄去向
  const residents = Array.from({ length: nRes }, (_, i) => {
    const t = openAt + (i * 1.3 + 1) * H, left = closed || i % 3 === 0;
    return { age: ages[i % ages.length], care: cares[i % cares.length], status: left ? "已離所" : ["在所", "在所", "外出", "未返"][i % 4],
             in: iso(t), out: left ? iso(Math.min(end - H, t + (20 + i) * H)) : "", dest: left ? dests[i % dests.length] : "" };
  });
  // 事件：處理紀錄的時間戳和正式後端相同格式（MM/DD HH:mm 姓名 動作：內容），結報從這裡算出處理用時
  const two = n => String(n).padStart(2, "0");
  const stamp = t => { const d = new Date(t); return `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
  let n = 0;
  const L = (cat, sev, prog, h, title, text, steps, extra) => {
    const at = openAt + h * H, log = (steps || []).map(([m, who, what]) => `${stamp(at + m * 60e3)} ${who} ${what}`).join("\n");
    return { id: "L" + (++n), cat, sev, prog, title, text, log: log ? "\n" + log : "", src: "LINE 回報", who: "工作人員・門禁組｜測試王小明", help: "", hq: false,
             at: iso(at), made: iso(at), upd: iso(at + (steps && steps.length ? steps[steps.length - 1][0] : 0) * 60e3), ...(extra || {}) };
  };
  const logs = [
    L("整備回報", "低", "已解決", -20, "整備回報：場地清潔", "場地清潔完成", [[5, "測試王小明", "標記已解決"]]),
    L("緊急事件", "緊急", "已解決", 6, "緊急事件：長者胸悶", "B 區一位長者胸悶、冒冷汗", [[3, "測試林護理師", "認領處理：量血壓 160/95"], [25, "社會處 測試張科長", "指示：叫救護車送醫"], [70, "測試林護理師", "標記已解決：已送苗栗醫院，家屬陪同"]], { hq: true, who: "工作人員・醫療組｜測試林護理師" }),
    L("設施環境", "高", "已解決", 10, "設施環境：女廁漏水", "2 樓女廁地板積水，有滑倒危險", [[15, "測試王小明", "認領處理：先放警示牌"], [180, "測試王小明", "標記已解決：水電師傅已修好"]], { hq: true }),
    L("居民反映", "中", "已解決", 20, "居民反映：缺物資", "需要嬰兒尿布 M 號", [[40, "測試李志工", "認領處理"], [95, "測試李志工", "標記已解決：已從物資區領 1 包"]], { src: "民眾反映", who: "居民｜測試陳美華", help: "缺物資" }),
    L("物資相關", "中", "已解決", 28, "物資相關：飲用水不足", "飲用水剩 20 瓶，預估撐不到明早", [[10, "社會處 測試張科長", "接手處理"], [240, "社會處 測試張科長", "標記已解決：已調撥 240 瓶"]], { hq: true, src: "社會處", who: "社會處｜測試張科長" }),
    L("交班紀錄", "低", "已解決", 32, "交班紀錄：晚班交接", "B 區 2 位長者夜間需留意", [[1, "測試王小明", "標記已解決"]]),
    L("人員相關", "中", closed ? "已解決" : "處理中", 40, "人員相關：夜班人力不足", "今晚只有 2 位工作人員", [[30, "測試王小明", "認領處理：已請社會處加派"]].concat(closed ? [[600, "測試王小明", "標記已解決：加派 2 位志工"]] : [])),
    L("居民反映", "中", closed ? "已解決" : "待處理", 52, "居民反映：身體不適", "孩子發燒 38 度", closed ? [[20, "測試林護理師", "標記已解決：已給退燒藥，持續觀察"]] : [], { src: "民眾反映", who: "一般民眾｜測試 LINE 名稱", help: "身體不適", hq: true }),
    L("重大事件", "高", closed ? "已結案" : "待處理", 60, "重大事件：聯外道路坍方", "苗 26 線坍方，物資車改道", closed ? [[90, "社會處 測試張科長", "指示：改走台 13 線"]] : [], { hq: true }),
  ];
  const M = (name, type, qty) => ({ sum: `${name} ${type} ${qty}`, type, qty });   // 正式後端的 sum 是 URL 編碼，post() 解碼後同這個格式
  const moves = [M("飲用水", "入庫", 240), M("飲用水", "發放", 180), M("泡麵", "入庫", 120), M("泡麵", "發放", 96), M("毛毯", "入庫", 40),
    M("毛毯", "發放", 38), M("暖暖包", "報廢", 5), M("衛生紙", "盤點調整", -2), M("口罩", "調撥", 50)];
  const att = Array.from({ length: closed ? 8 : 14 }, (_, i) => ({ person: "s" + (i % 6), in: iso(openAt + i * 5 * H), out: i % 5 === 4 && !closed ? "" : iso(openAt + (i * 5 + 8) * H) }));
  return { ok: true, opening: { id: o, name: closed ? mockHq.closed.name : (mockHq.openings.find(x => x.id === o) || { name: mock.me.opening }).name,
    status: stage, openAt: iso(openAt), closeAt: stage === "已撤收" ? iso(closed ? closeAt : now) : "" }, residents, logs, moves, att, items: mockReportItems() };
}
// 物資品項（正式後端原樣轉出 properties_value，格式同 load）
function mockReportItems() {
  const P = (name, unit, stock, safety) => ({ id: "it-" + name, properties_value: { "品名": [{ plain_text: name }], "單位": { name: unit }, "目前庫存": stock, "安全庫存": safety } });
  return [P("飲用水", "瓶", 60, 50), P("泡麵", "碗", 24, 30), P("毛毯", "條", 2, 10), P("暖暖包", "包", 40, 20), P("口罩", "片", 150, 50)];
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
  async move(tag, kind, hours, dest) {
    await wait(500);
    const r = mock.people[mock.tags[tag]];
    if (kind === "離所") { r.status = "已離所"; r.dest = dest || "未填寫"; mock.tags[tag] = "void"; console.log("[模擬] 離所去向：", r.dest); }
    else if (kind === "外出") { r.status = "外出"; r.back = new Date(Date.now() + hours * 3600e3).toISOString(); }
    else r.status = "在所";
    return { ok: true, status: r.status };
  },
  async addTags(codes) {
    await wait(600);
    if (!(mock.me.role || "").includes("管理者")) throw new ApiError("not_manager");
    for (const c of codes) mock.tags[c] = "blank";
    return codes;
  },
  async addItem(f) {
    await wait(400);
    const id = "i" + (mock.items.length + 1), code = newCode();
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
    ["社會處：指揮台", "?v=hq"], ["社會處：待我處理", "?v=inbox"], ["社會處：各所現況", "?v=sites"], ["社會處看某一所", "?v=ops&o=o1"], ["社會處看某一所（撤收中）", "?v=ops&o=o1&stage=撤收中"],
    ["結報（撤收中，可結案）", "?v=report&o=o2&stage=撤收中"], ["結報（已結案）", "?v=report&o=o9"],
    ["指揮台（手機 LINE：存成 PDF）", "?v=hq&phone=1"], ["結報（手機 LINE：存成 PDF）", "?v=report&o=o9&phone=1"], ["空值顯示「無」", "?v=ops&o=o2"], ["專區（社會處）", "?v=staff&me=off&role=hq"], ["非社會處開指揮台", "?v=hq&role=staff"]];
  setHTML($("#demo"), (SCAN ? `弱點掃描模式（模擬資料，不連後端）：` : `原型示範：`) + links.map(([t, q]) => `<a href="${base}${q}">${t}</a>`).join(""));
}
