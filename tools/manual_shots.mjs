// 使用說明用的手機截圖（原型模擬資料、?shot=1 隱藏示範列）。需先開「物資頁面原型」預覽（localhost:5180）。
// 用法：node tools/manual_shots.mjs <輸出資料夾> 名稱=查詢字串[|點擊用的 JS] ...
// 例：node tools/manual_shots.mjs output/shots "apply=?v=staff&me=none&shot=1" "done=?v=signout&shot=1|document.querySelector(\"#doSignout\").click()"
// 用 Chrome DevTools Protocol 截手機畫面：390×844、2 倍解析度、淺色主題
// node cdp_shot.mjs <輸出資料夾> name=查詢字串 ...
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const [outDir, ...jobs] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const CH = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const BASE = "http://localhost:5180/liff/supplies/";
const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + outDir + "/_profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch (e) {}
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
for (const job of jobs) {
  const [name, q] = job.split("=", 2).length === 2 ? [job.slice(0, job.indexOf("=")), job.slice(job.indexOf("=") + 1)] : [job, ""];
  // 查詢字串後面可以加「|JS」：載入後先執行這段（例如點按鈕），再截圖
  const [qs, js] = q.split("|");
  await send("Page.navigate", { url: BASE + qs });
  await sleep(2500);
  if (js) { await send("Runtime.evaluate", { expression: js, awaitPromise: true }); await sleep(1800); }
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log(name);
}
ws.close();
chrome.kill();
