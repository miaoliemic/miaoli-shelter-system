// 防止被其他網站用框架嵌入（點擊劫持）：GitHub Pages 無法設定 X-Frame-Options／frame-ancestors，改由網頁自己偵測。
// 被嵌入時先隱藏整頁（styles.css 的 html.framed），再嘗試把最外層換成本頁；換不了也不會顯示內容
if (window.top !== window.self) {
  document.documentElement.classList.add("framed");
  try { window.top.location.replace(window.self.location.href); } catch (e) {}
}
