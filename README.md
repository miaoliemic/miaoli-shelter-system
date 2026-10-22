# 苗栗救災收容所管理系統

數位發展部「公民協力場」專案：協助苗栗縣政府社會處，在災害發生時管理多個收容所的開設、人員、居民進出、物資與現場狀況。

- **現場人員只用 LINE**：按選單、掃 QR、打幾個字，不需要安裝 App，也不用學 Notion。
- **後台是 Notion**：以「災害事件」為單位，一場災害可以開設多個收容所，也可以同時有多場災害。
- **Make.com 負責串接**：收到 LINE 訊息後檢查身分和權限，再寫入 Notion。
- **社會處看總覽**：每場災害、每個收容所的燈號、人數、缺人、缺物資和待處理事項。

本專案以開源方式釋出，歡迎後續的人持續改進。想不清楚的地方都列在畫布的「待解問題」，沒有硬做決定。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `第一版範疇.md` | 第一版演練的範疇、流程和驗收標準 |
| `docs/部署說明.md` | **在自己的帳號架起這套系統**的步驟 |
| `docs/第一版LINE流程.md` | LINE 每一條路線的規格 |
| `docs/QR編碼規則.md` | 簽到 QR 和號碼牌 QR 的格式 |
| `docs/交接清單.md` | 帳號移交，以及 Notion 搬家後要更換的設定 |
| `make/example/` | Make.com 情境藍圖範例（用範例設定產生；實際藍圖在本機產生） |
| `tools/make_blueprints.py` | 產生 Make.com 藍圖，讀 `tools/config.local.json` |
| `tools/config.example.json` | 設定範本：複製成 `config.local.json` 後填入自己的 Notion／Make.com ID |
| `tools/make_richmenu.py` | 產生 LINE 加乘圖文選單圖片 |
| `assets/` | 選單圖片 |
| `系統功能架構.excalidraw` | 系統功能架構畫布（Excalidraw 格式，可用 excalidraw.com 開啟；即時編輯工具留在開發者本機，不在版本庫） |
| `qr-generator/` | QR Code 產生器（離線網頁，網路中斷時的備援） |

## 安全與個資

- 版本庫裡**沒有任何金鑰，也沒有實際的 Notion／Make.com ID**。這些都填在本機的 `tools/config.local.json`，不進版本庫。
- Make.com 只用連線編號呼叫 LINE 和 Notion，金鑰存在 Make.com 裡。
- 網頁寫入畫面一律經過 DOMPurify 過濾（`liff/supplies/purify.min.js`、`qr-generator/vendor/purify.min.js`，Apache 2.0／MPL 2.0）；隨機代碼用 `crypto.getRandomValues()`。
- 個資最小化：身分證只存後四碼；號碼牌只印隨機代號，不印姓名；照護需求只記類別。
- 帳號登入資訊另外交接，不放在這裡。

## 授權

待定。
