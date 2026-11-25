// 頁面標題：index.html 不寫死 <title>，由這支檔案一打開就依頁面設定。
// 原因：LINE 標題列會先顯示 HTML 裡的 <title>，等 app.js／hq.js 載完才改，中間會閃一下「收容所物資」。
// 對照要和 hq.js 的 HQ_TITLE、app.js 的 PUB_TITLE 一致；其他頁面先用「收容所物資」，程式載完會自己再改（號碼牌、結報、某一所名稱等）。
(function () {
  const TITLES = {
    hq: "指揮台", sites: "各所現況", inbox: "待我處理",
    info: "收容所資訊", report: "我要反映", sos: "緊急聯絡", staff: "工作人員專區", signout: "簽退",
  };
  const p = new URLSearchParams(location.search);
  const v = p.get("v");
  const special = p.get("r") || (v === "report" && p.get("o"));   // 號碼牌頁、結報
  document.title = (!special && TITLES[v]) || "收容所物資";
})();
