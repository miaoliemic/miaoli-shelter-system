// 文字放大：每一頁左下角都有「字 大／字 小」按鈕；字級都用 rem，切換 html.big 就整頁一起放大（styles.css）。
// 選擇記在這支手機的瀏覽器裡，下次打開維持一樣；讀不到儲存空間時就用一般字級
(function () {
  const KEY = "fontBig";
  const root = document.documentElement;
  const saved = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  root.classList.toggle("big", saved());   // 在畫面出現前就套用，不會先閃一下小字

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fontbtn";
    const label = () => {
      const big = root.classList.contains("big");
      btn.textContent = big ? "字 小" : "字 大";
      btn.setAttribute("aria-label", big ? "文字恢復一般大小" : "把文字放大");
      btn.setAttribute("aria-pressed", String(big));
    };
    btn.addEventListener("click", () => {
      const big = root.classList.toggle("big");
      try { localStorage.setItem(KEY, big ? "1" : "0"); } catch (e) {}
      label();
    });
    label();
    document.body.appendChild(btn);

    // 頁面底部有操作列時，按鈕往上移，不擋住操作列
    const bar = document.getElementById("bar");
    if (bar && window.ResizeObserver) {
      new ResizeObserver(() => root.style.setProperty("--barh", (bar.hidden ? 0 : bar.offsetHeight) + "px")).observe(bar);
    }
  });
})();
