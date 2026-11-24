// 啟動器：LINE 內建瀏覽器會把 index.html 存在手機裡，光改 index.html 裡的 ?v= 版本號，手機不一定看得到。
// 這支檔案內容固定不變；每次打開都向伺服器要最新的 version.txt（不使用快取），再用那個版本號載入樣式和程式。
// 之後更新畫面：只要改 version.txt 的內容（例如 20261124f），手機下次打開就會抓新版。
(function () {
  const FILES = ["purify.min.js", "qrcode.js", "hq.js", "app.js"];   // 依序載入（後面的會用到前面的）
  const load = (src) => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.body.appendChild(s);
  });
  const start = async () => {
    let v = "0";
    try {
      const r = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) v = (await r.text()).trim().replace(/[^0-9A-Za-z._-]/g, "") || v;
    } catch (e) { /* 讀不到就用沒有版本號的網址，照樣能開 */ }
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "styles.css?v=" + v;
    document.head.appendChild(css);
    for (const f of FILES) await load(f + "?v=" + v);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
