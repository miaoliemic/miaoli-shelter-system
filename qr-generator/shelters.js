// 苗栗市避難收容處所（21 所），來源：苗栗市公所公告的避難收容處所一覽表。
// 只放公開資訊；管理人姓名與電話不放進版本庫。
// 欄位：no 編號、name 名稱、li 里別、addr 地址、cap 容納人數、kinds 適用災害、weak 適合避難弱者安置
window.SHELTERS = [
  { no: 1, name: "高苗里活動中心", li: "高苗里", addr: "苗栗市22鄰松園1號", cap: 150, kinds: ["水災", "震災"], weak: true },
  { no: 2, name: "上苗里社區活動中心室外停車場", li: "北苗里", addr: "苗栗市中華路45號", cap: 200, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 3, name: "文山國小操場", li: "文山里", addr: "苗栗市4鄰41號", cap: 150, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 4, name: "南勢社區活動中心", li: "南勢里", addr: "苗栗市8鄰新勝8-1號", cap: 30, kinds: ["水災"], weak: false },
  { no: 5, name: "建功國小操場", li: "建功里", addr: "苗栗市中正路241號", cap: 300, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 6, name: "苗栗市老人文康中心室內空間", li: "大同里", addr: "苗栗市福星21號", cap: 100, kinds: ["水災", "土石流"], weak: false },
  { no: 7, name: "大同國小操場", li: "大同里", addr: "苗栗市大同路80號", cap: 200, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 8, name: "福星國小活動中心", li: "福星里", addr: "苗栗市中華東街62號", cap: 80, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 9, name: "上苗里社區活動中心室內空間", li: "北苗里", addr: "苗栗市中華路45號2樓", cap: 100, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 10, name: "維新社區活動中心", li: "維新里", addr: "苗栗市僑育北街62號1樓", cap: 30, kinds: ["水災"], weak: true },
  { no: 11, name: "苗栗市老人文康中心室外草皮", li: "大同里", addr: "苗栗市福星21號", cap: 150, kinds: ["水災", "震災", "土石流"], weak: true },
  { no: 12, name: "國立聯合大學操場", li: "恭敬里", addr: "苗栗市聯大一號", cap: 300, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 13, name: "恭敬里中山堂", li: "恭敬里", addr: "苗栗市7鄰恭敬路107號", cap: 35, kinds: ["水災"], weak: false },
  { no: 14, name: "國立聯合大學活動中心", li: "恭敬里", addr: "苗栗市聯大1號", cap: 100, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 15, name: "大同國小活動中心", li: "大同里", addr: "苗栗市大同路80號", cap: 100, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 16, name: "勝利社區活動中心", li: "勝利里", addr: "苗栗市復興路1段453號", cap: 40, kinds: ["水災"], weak: false },
  { no: 17, name: "福星國小操場", li: "福星里", addr: "苗栗市中華東街62號", cap: 150, kinds: ["水災", "震災", "土石流", "海嘯"], weak: false },
  { no: 18, name: "文山國小活動中心", li: "文山里", addr: "苗栗市4鄰41號", cap: 80, kinds: ["水災", "海嘯"], weak: false },
  { no: 19, name: "新英社區活動中心", li: "新英里", addr: "苗栗市15鄰新英108-2號", cap: 30, kinds: ["水災"], weak: false },
  { no: 20, name: "文聖社區活動中心", li: "文聖里", addr: "苗栗市1鄰橫車路352巷11號", cap: 120, kinds: ["風災", "震災", "其他"], weak: true },
  { no: 21, name: "清華里活動中心", li: "清華里", addr: "苗栗市啟賢街126巷23號", cap: 150, kinds: ["水災", "震災"], weak: true },
];
