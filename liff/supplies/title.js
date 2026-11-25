// 頁面標題：index.html 不寫死 <title>，由這支檔案一打開就依頁面設定。
// 原因：LINE 標題列會先顯示 HTML 裡的 <title>，等 app.js／hq.js 載完才改，中間會閃一下舊標題。
// 對照要和 hq.js 的 HQ_TITLE、app.js 的 PUB_TITLE、TAB_TITLE 一致；列印頁由程式自己設定（先留空白）。
(function () {
  const TITLES = {
    hq: "指揮台", sites: "各所現況", inbox: "待我處理",
    info: "收容所資訊", report: "我要反映", sos: "緊急聯絡", staff: "工作人員專區", signout: "簽退",
    ops: "本所總覽",
  };
  const p = new URLSearchParams(location.search);
  const v = p.get("v") || "";
  let t = "";
  if (p.get("r")) t = "居民進出管理";                          // 掃號碼牌打開
  else if (v === "report" && p.get("o")) t = "結報";
  else if (v === "ops" && p.get("o")) t = "各所現況";           // 社會處看某一所，載完換成該所名稱
  else if (TITLES[v]) t = TITLES[v];
  else if (!v || v === "supply") t = "物資收發管理";            // 不帶 v（或掃物資標籤 ?item=）
  document.title = t;
})();
