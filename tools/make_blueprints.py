"""產生 Make.com 情境藍圖（第一版）。

用法：
  python tools/make_blueprints.py            讀 tools/config.local.json，輸出到 make/（不進版本庫）
  python tools/make_blueprints.py --example  讀 tools/config.example.json，輸出範例到 make/example/
  python tools/make_blueprints.py --account emic  改用 config 裡 make_accounts.emic 的連線編號，輸出到 make/emic/

第一次使用：複製 tools/config.example.json 成 tools/config.local.json，填入自己的
Notion data source ID、Make.com 連線編號和 webhook 編號（說明見 docs/部署說明.md）。

規格見 docs/第一版LINE流程.md。藍圖裡不含任何金鑰：
Make.com 只用連線編號呼叫 LINE 和 Notion，金鑰存在 Make.com 裡。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = "--example" in sys.argv
_cfg_path = ROOT / "tools" / ("config.example.json" if EXAMPLE else "config.local.json")
if not _cfg_path.exists():
    sys.exit(f"找不到 {_cfg_path.name}：請先複製 tools/config.example.json 成 tools/config.local.json 並填入設定。")
CFG = json.loads(_cfg_path.read_text(encoding="utf-8"))
# --account <名稱>：改用 config 的 make_accounts.<名稱>（同一套流程部署到不同的 Make 帳號，連線編號不同），輸出到 make/<名稱>/
ACCOUNT = sys.argv[sys.argv.index("--account") + 1] if "--account" in sys.argv else ""
if ACCOUNT:
    CFG["make"] = CFG["make_accounts"][ACCOUNT]

# ---- 環境設定（來自 config） ----
HOOK = CFG["make"]["line_webhook_id"]
CONN_LINE = CFG["make"]["line_connection_id"]
CONN_NOTION = CFG["make"]["notion_connection_id"]
MENU_ALIAS = CFG["line"]["staff_menu_alias"]
HQ_ALIAS = CFG["line"].get("hq_menu_alias", "hq-plus")   # 社會處選單（一般選單＋指揮列）
MENU_PAGE = CFG["notion"]["richmenu_page_id"]
# 現場頁面（LIFF）：圖文選單每一格都打開這個 LIFF 的不同畫面，必須設定
LIFF_ID = CFG["line"]["liff_id"]

_ds = CFG["notion"]["data_sources"]
DS_STAFF = _ds["工作人員名冊"]
DS_OPEN = _ds["收容所開設"]
DS_ATT = _ds["出勤紀錄"]
DS_LOG = _ds["現場日誌"]
DS_TAG = _ds["號碼牌"]
DS_RES = _ds["收容登記"]
DS_IO = _ds["進出紀錄"]
DS_QA = _ds["問答與公告"]
DS_ITEM = _ds["物資品項"]
DS_MOVE = _ds["物資異動紀錄"]
DS_EVENT = _ds["災害事件"]
DS_SHELTER = _ds["收容所"]

MGR = "管理者（收容所負責人）"
ROLES_CHECKIN = f"{MGR},門禁組"
ROLES_GATE = f"{MGR},門禁組,志工"

# ---- 常用運算式 ----
T = "{{1.events[1].message.text}}"
U = "{{1.events[1].source.userId}}"
RT = "{{1.events[1].replyToken}}"
S = 2  # 查身分模組



# HTTP「Make a request」模組的必填設定。在 Make 介面建立時會自動帶入預設值，用 API 建立時不會，
# 少了這些，模組會直接報 BundleValidationError（Missing value of required parameter），請求根本沒送出。
HTTP_DEFAULTS = {"rejectUnauthorized": True, "followRedirect": True, "followAllRedirects": False, "useQuerystring": False,
                 "gzip": True, "useMtls": False}

def sp(mod, prop, suffix=""):
    return "{{" + f"{mod}.properties_value.`{prop}`{suffix}" + "}}"


NAME = sp(S, "姓名", "[].plain_text")
ROLE = sp(S, "角色", ".name")
DUTY_V = sp(S, "簽到狀態", ".name")
EN_V = sp(S, "啟用中")
TMP = sp(S, "對話暫存", "[].plain_text")
# Make 的 Notion 更新模組遇到空字串會略過不寫，所以清空暫存改寫成這個佔位符號
TMP_CLEAR = "－"
MY_OPEN = sp(S, "派駐開設", "[].id")
# 物資登記：「品名+數量」入庫、「品名-數量」發放，例如 飲用水+20、飲用水-5
SUPPLY_RE = r"^[^+\-\s：:]+\s*[+\-]\s*[0-9]+\s*$"


def c(a, o, b=None):
    d = {"a": a, "o": o}
    if b is not None:
        d["b"] = b
    return d


EXIST = c(f"{{{{{S}.id}}}}", "exist")
NOTEXIST = c(f"{{{{{S}.id}}}}", "notexist")
EN = c(EN_V, "boolean:equal", "true")
NEN = c(EN_V, "boolean:notequal", "true")
DUTY = c(DUTY_V, "text:equal", "上班中")
NDUTY = c(DUTY_V, "text:notequal", "上班中")
ON = [EXIST, EN, DUTY]                       # 在班的工作人員
DENIED = [[NOTEXIST], [NEN], [NDUTY]]        # 不在班或不是工作人員


def flt(name, groups):
    return {"name": name, "conditions": groups}


class B:
    """藍圖組裝器：依序配發模組編號和畫布座標。"""

    def __init__(self):
        self.next_id = 10
        self.y = 0

    def nid(self):
        self.next_id += 1
        return self.next_id

    def meta(self, name, conn_type=None):
        self.y += 150
        m = {"designer": {"x": 900, "y": self.y, "name": name}}
        if conn_type:
            m["parameters"] = [{"name": "__IMTCONN__", "type": conn_type, "label": "Connection", "required": True}]
        return m

    def notion(self, module, name, mapper, f=None):
        mid = self.nid()
        d = {"id": mid, "module": f"notion:{module}", "version": 1, "mapper": mapper,
             "metadata": self.meta(name, "account:notion2,notion3"),
             "parameters": {"__IMTCONN__": CONN_NOTION}}
        if f:
            d["filter"] = f
        return d

    def search(self, name, ds, filters, f=None, sort_created=False):
        m = {"limit": "1", "filter": [filters], "select": "data_source_item", "data_source": ds}
        if sort_created:
            m["sorts"] = [{"select": "timestamp", "direction": "descending", "timestamp": "created_time"}]
        return self.notion("searchObjects1", name, m, f)

    def get(self, name, page, f=None):
        return self.notion("getADatabaseItem", name, {"page": page, "getBy": "data_source", "select": "map"}, f)

    def create(self, name, ds, fields, f=None):
        return self.notion("createDataSourceItem", name, {"fields": fields, "select": "map", "data_source": ds}, f)

    def update(self, name, ds, page, fields, f=None):
        return self.notion("updateADatabaseItem", name,
                           {"page": page, "fields": fields, "select": "map", "updateBy": "data_source", "data_source": ds}, f)

    def line_api(self, name, url, method="POST", body=None, f=None):
        mid = self.nid()
        mapper = {"url": url, "method": method, "headers": []}
        if body is not None:
            if not isinstance(body, str):
                body = json.dumps(body, ensure_ascii=False)
            # {{ }} 裡是 Make 運算式，要還原 JSON 跳脫的引號和反斜線（Make 先代入運算式才送出）
            mapper["body"] = re.sub(r"\{\{.*?\}\}", lambda m: m.group(0).replace('\\"', '"').replace('\\\\', '\\'), body)
            mapper["headers"] = [{"key": "Content-Type", "value": "application/json"}]
        d = {"id": mid, "module": "line:makeApiCall", "version": 1, "mapper": mapper,
             "metadata": self.meta(name, "account:line2"), "parameters": {"__IMTCONN__": CONN_LINE}}
        if f:
            d["filter"] = f
        return d

    def reply(self, name, text, f=None):
        mid = self.nid()
        d = {"id": mid, "module": "line:sendAReplyMessage", "version": 1,
             "mapper": {"messages": [{"type": "text", "text": text}], "replyToken": RT, "notificationDisabled": False},
             "metadata": self.meta(name, "account:line2"), "parameters": {"__IMTCONN__": CONN_LINE}}
        if f:
            d["filter"] = f
        return d

    def aggregate(self, name, feeder, value, sep="\n"):
        """把搜尋結果的每一筆組成一段文字，輸出 {{N.text}}。"""
        mid = self.nid()
        self.y += 150
        return {"id": mid, "module": "util:TextAggregator", "version": 1,
                "parameters": {"feeder": feeder, "rowSeparator": sep}, "mapper": {"value": value},
                "metadata": {"designer": {"x": 900, "y": self.y, "name": name}}}

    def router(self, name, routes):
        """routes: [(filter, [modules...])]；filter 放在每條路線的第一個模組上。"""
        mid = self.nid()
        rs = []
        for f, mods in routes:
            mods = [dict(m) for m in mods]
            if f:   # None＝這條路線不設篩選，一律執行
                mods[0]["filter"] = f
            rs.append({"flow": mods})
        self.y += 150
        return {"id": mid, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
                "metadata": {"designer": {"x": 600, "y": self.y, "name": name}}, "routes": rs}


# ---- Notion 欄位寫法 ----
def f_title(k, v): return {"key": k, "type": "title", "value": v}
def f_text(k, v): return {"key": k, "type": "rich_text", "value": v}
def f_sel(k, v): return {"key": k, "type": "select", "value": v}
def f_rel(k, v): return {"key": k, "type": "relation", "value": [v]}
def f_multi(k, v): return {"key": k, "type": "multi_select", "value": [v]}
def f_chk(k, v): return {"key": k, "type": "checkbox", "value": v}
def f_now(k): return {"key": k, "type": "date", "date": {"start": "{{now}}", "includeTime": True}}
def f_date(k, expr): return {"key": k, "type": "date", "date": {"start": expr, "includeTime": True}}


# ---- 回應與輸入的安全處理（情境 13） ----
def enc(expr):
    """自由文字放進回應 JSON 前先 URL 編碼：姓名裡有引號、反斜線也不會弄壞 JSON 或插入欄位。頁面收到後解碼。"""
    return "{{encodeURL(" + expr[2:-2] + ")}}"


def cut(field, n):
    """頁面送來的文字限制長度（Notion 文字欄位上限 2000 字，也避免被灌大量內容）"""
    return "{{substring(" + field + "; 0; " + str(n) + ")}}"


def pick(field, options, default):
    """選項欄位只接受固定值，其他一律改成預設值（不讓外部請求在 Notion 新增奇怪的選項）"""
    pairs = "; ".join(f'"{o}"; "{o}"' for o in options)
    return "{{switch(" + field + "; " + pairs + '; "' + default + '")}}'


FIELD_CATS = ["緊急事件", "重大事件", "人員相關", "物資相關", "設施環境", "交班紀錄"]
SEVS = ["緊急", "高", "中", "低"]
REPORT_CATS = ["身體不適", "缺物資", "環境問題", "其他"]
AGES = ["成人", "長者", "兒童", "嬰幼兒"]
KINDS = ["風災", "水災", "震災", "土石流", "海嘯", "其他"]
HQ = "社會處"
HQ_GRANT_ROLES = [MGR, "門禁組", "物資組", "醫療組", "志工"]   # 社會處核准時能給的角色（不含社會處本身）
HQ_ACTS = ["hqInit", "hqOpen", "hqApps", "hqApprove", "hqReject", "hqSites"]


def build_main():
    b = B()
    routes = []

    # ---------- R1 簽到 ----------
    # 掃簽到 QR：沒在班就直接簽到。回覆只有文字（不放泡泡按鈕），工作人員的功能都在換好的加乘選單上；
    # 志工沿用一般選單，用 LINE 掃描器掃物資標籤或號碼牌打開現場頁面。
    is_staff = sp(S, "身分類別", ".name")[2:-2] + ' = "工作人員"'
    duty_hint = ('{{if(' + is_staff + '; "下方選單已換成工作人員版：掃描、本所、簽退。"; '
                 '"請用 LINE 的 QR 掃描器掃物資標籤或號碼牌登記；要簽退請按選單的「工作人員」。")}}')
    code = '{{trim(replace(1.events[1].message.text; "簽到"; ""))}}'
    op = b.search("找簽到碼對應的開設", DS_OPEN, [c("簽到代碼 |&*^%$#@| rich_text", "text:equals", code)])
    O = op["id"]
    o_name = sp(O, "開設名稱", "[].plain_text")
    o_stat = sp(O, "開設狀態", ".name")
    o_ok = c(f"{{{{{O}.id}}}}", "exist")
    r1 = b.router("簽到分流", [
        (flt("簽到成功", [[EXIST, EN, NDUTY, o_ok, c(o_stat, "text:notequal", "已撤收")]]), [
            b.create("新增出勤紀錄", DS_ATT, [
                f_title("紀錄", f'{NAME} {{{{formatDate(now; "MM/DD HH:mm")}}}} 簽到'),
                f_rel("人員", f"{{{{{S}.id}}}}"), f_rel("收容所開設", f"{{{{{O}.id}}}}"),
                f_now("簽到時間"), f_sel("簽到方式", "掃現場 QR")]),
            b.update("名冊改上班中", DS_STAFF, f"{{{{{S}.id}}}}", [
                f_sel("簽到狀態", "上班中"), f_rel("派駐開設", f"{{{{{O}.id}}}}"),
                f_sel("選單狀態", '{{if(' + sp(S, "身分類別", ".name")[2:-2] + ' = "工作人員"; "工作人員加乘"; "一般")}}'),
                f_text("對話暫存", TMP_CLEAR)]),
            b.reply("回覆簽到成功", f"✅ {NAME} 已在【{o_name}】簽到。\n開設狀態：{o_stat}\n{duty_hint}"),
            b.line_api("取得加乘選單 ID", f"/v2/bot/richmenu/alias/{MENU_ALIAS}", method="GET",
                       f=flt("工作人員才換選單", [[c(sp(S, "身分類別", ".name"), "text:equal", "工作人員")]])),
        ]),
        # 已在班再掃一次：重新綁一次加乘選單（重建選單、清掉舊選單後，在班的人掃一次就能換回來）
        (flt("已在班", [[EXIST, EN, DUTY, o_ok]]), [
            b.reply("回覆已在班", f"{NAME} 您目前已在班中。\n{duty_hint}"),
            b.line_api("取得加乘選單 ID（已在班）", f"/v2/bot/richmenu/alias/{MENU_ALIAS}", method="GET",
                       f=flt("工作人員才換選單（已在班）", [[c(sp(S, "身分類別", ".name"), "text:equal", "工作人員")]]))]),
        (flt("簽到碼無效", [[EXIST, EN, c(f"{{{{{O}.id}}}}", "notexist")], [EXIST, EN, NDUTY, c(o_stat, "text:equal", "已撤收")]]), [
            b.reply("回覆簽到碼無效", "⚠ 此簽到碼無效，或該收容所已撤收。請洽現場負責人。")]),
        (flt("不是工作人員", [[NOTEXIST], [NEN]]), [
            b.reply("回覆請先開通", "您還不是已開通的工作人員。請按選單最下列的「工作人員」申請開通，由管理者審核後才能簽到。")]),
    ])
    # 換選單需要上一步取得的 ID：接在簽到成功、已在班兩條路線最後
    for i, label in ((0, ""), (1, "（已在班）")):
        alias_id = r1["routes"][i]["flow"][-1]["id"]
        r1["routes"][i]["flow"].append(
            b.line_api("切換成加乘選單" + label, "/v2/bot/user/" + U + "/richmenu/{{" + str(alias_id) + ".body.richMenuId}}"))
    routes.append((flt("R1 簽到", [[c(T, "text:contain", "SIGN-")]]), [op, r1]))

    # ---------- R99 其他：聊天室不再有對話流程，所有功能都從圖文選單打開 LIFF 頁面 ----------
    routes.append((flt("R99 其他訊息", [[c(T, "text:notcontain", "SIGN-")]]), [
        b.reply("回覆引導", "您好，這裡是苗栗避難收容所系統。\n請點下方選單：收容所資訊、我要反映、緊急聯絡。\n工作人員請按最下列的「工作人員」。")]))

    main_router = {"id": 3, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
                   "metadata": {"designer": {"x": 300, "y": 0, "name": "依訊息分流"}}, "routes": []}
    for f, mods in routes:
        mods = [dict(m) for m in mods]
        mods[0]["filter"] = f
        main_router["routes"].append({"flow": mods})

    flow = [
        {"id": 1, "module": "line:watchMessages", "version": 1, "mapper": {},
         "metadata": {"designer": {"x": -300, "y": 0}, "parameters": [
             {"name": "__IMTHOOK__", "type": "hook:line", "label": "Webhook", "required": True}]},
         "parameters": {"__IMTHOOK__": HOOK}},
        {"id": S, "module": "notion:searchObjects1", "version": 1,
         "mapper": {"limit": "1", "select": "data_source_item", "data_source": DS_STAFF,
                    "filter": [[c("LINE User ID |&*^%$#@| rich_text", "text:equals", U)]]},
         "metadata": {"designer": {"x": 0, "y": 0, "name": "查身分：工作人員名冊"},
                      "parameters": [{"name": "__IMTCONN__", "type": "account:notion2,notion3", "label": "Connection", "required": True}]},
         "parameters": {"__IMTCONN__": CONN_NOTION}},
        main_router,
    ]
    return blueprint("11 LINE 訊息（第一版）", flow, instant=True)


def build_menu():
    """建立兩張圖文選單（一次性；換圖時再執行）。
    - 一般選單：上列 3 格（收容所資訊、我要反映、緊急聯絡），下列整列「工作人員」入口；設為所有人的預設選單。
    - 加乘選單：上列同一般選單，下列 3 格（掃 QR、本所狀況、簽退）；設定別名 MENU_ALIAS，簽到時依別名綁定給個人。
    圖片放在 Notion 頁面 MENU_PAGE 的第一組左右兩欄：左欄是一般選單、右欄是加乘選單，各取欄裡「最後一張」圖片。
    每次執行都向 Notion 取得新的下載網址（Notion 檔案網址幾分鐘就過期）。"""
    # 上下兩列，每列高 843；上列 3 格兩張共用
    ROW = 843
    cw = [0, 833, 1667, 2500]

    def cell(col, row, action):
        return {"bounds": {"x": cw[col], "y": row * ROW, "width": cw[col + 1] - cw[col], "height": ROW}, "action": action}

    # 每一格都直接打開 LIFF 頁面的對應畫面（情境 13 提供資料）；聊天室不再有泡泡按鈕的對話流程
    def liff(v):
        return {"type": "uri", "uri": f"https://liff.line.me/{LIFF_ID}?v={v}"}
    top = [cell(i, 0, liff(v)) for i, v in enumerate(["info", "report", "sos"])]
    public_bottom = [{"bounds": {"x": 0, "y": ROW, "width": 2500, "height": ROW}, "action": liff("staff")}]
    staff_row = [cell(0, 1, {"type": "uri", "uri": "https://line.me/R/nv/QRCode"}), cell(1, 1, liff("ops")), cell(2, 1, liff("signout"))]
    hq_row = [cell(i, 1, liff(v)) for i, v in enumerate(["hq", "inbox", "sites"])]   # 社會處：指揮台｜待我處理｜各所現況

    notion_meta = [{"name": "__IMTCONN__", "type": "account:notion2,notion3", "label": "Connection", "required": True}]
    line_meta = [{"name": "__IMTCONN__", "type": "account:line2", "label": "Connection", "required": True}]

    def last_image_url(mid):
        li = f'last(map({mid}.body.results; "image"; "type"; "image"))'
        return '{{ifempty(get(' + li + '; "file.url"); get(' + li + '; "external.url"))}}'

    def children(mid, block_expr, name, x, y):
        return {"id": mid, "module": "notion:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_NOTION},
                "mapper": {"url": f"/v1/blocks/{block_expr}/children", "method": "GET", "version": "2022-06-28", "headers": [],
                           "qs": [{"key": "page_size", "value": "100"}]},
                "metadata": {"designer": {"x": x, "y": y, "name": name}, "parameters": notion_meta}}

    def menu_steps(ids, column_expr, name, areas, label, y):
        n, h, m = ids
        return [
            children(n, column_expr, f"讀{label}欄", 0, y),
            {"id": h, "module": "http:ActionGetFile", "version": 3, "parameters": {"handleErrors": False},
             "mapper": {"url": last_image_url(n), "method": "get", "serializeUrl": False, "shareCookies": False},
             "metadata": {"designer": {"x": 300, "y": y, "name": f"下載{label}圖片"}}},
            {"id": m, "module": "line:createARichMenu", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
             "mapper": {"name": name, "chatBarText": "選單", "selected": False, "height": 1686,
                        "areas": areas, "data": f"{{{{{h}.data}}}}", "filename": f"{name}.png"},
             "metadata": {"designer": {"x": 600, "y": y, "name": f"建立{label}"}, "parameters": line_meta}},
        ]

    # 頁面 → 第一組左右兩欄 → 左欄、右欄
    flow = [
        children(20, MENU_PAGE, "讀系統素材頁", -900, 150),
        children(21, '{{first(map(20.body.results; "id"; "type"; "column_list"))}}', "讀左右兩欄", -600, 150),
    ] + menu_steps((10, 11, 12), '{{get(map(21.body.results; "id"); 1)}}', "public", top + public_bottom, "一般選單", 0) + [
        {"id": 13, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
         "mapper": {"url": "/v2/bot/user/all/richmenu/{{12.richMenuId}}", "method": "POST", "headers": []},
         "metadata": {"designer": {"x": 900, "y": 0, "name": "設為所有人的預設選單"}, "parameters": line_meta}},
    ] + menu_steps((4, 1, 2), '{{get(map(21.body.results; "id"); 2)}}', "staff-plus", top + staff_row, "加乘選單", 300) + [
        # 別名：路由同時試「更新」和「新建」，各自出錯就略過。
        # 已有別名時更新成功、新建失敗；第一次部署時相反。
        {"id": 8, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
         "metadata": {"designer": {"x": 900, "y": 300, "name": "設定別名"}},
         "routes": [
             {"flow": [{"id": 3, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                        "mapper": {"url": f"/v2/bot/richmenu/alias/{MENU_ALIAS}", "method": "POST",
                                   "body": json.dumps({"richMenuId": "{{2.richMenuId}}"}),
                                   "headers": [{"key": "Content-Type", "value": "application/json"}]},
                        "metadata": {"designer": {"x": 1200, "y": 150, "name": f"更新別名 {MENU_ALIAS}"}, "parameters": line_meta},
                        "onerror": [{"id": 6, "module": "builtin:Ignore", "version": 1, "mapper": None,
                                     "metadata": {"designer": {"x": 1500, "y": 150}}}]}]},
             {"flow": [{"id": 5, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                        "mapper": {"url": "/v2/bot/richmenu/alias", "method": "POST",
                                   "body": json.dumps({"richMenuAliasId": MENU_ALIAS, "richMenuId": "{{2.richMenuId}}"}),
                                   "headers": [{"key": "Content-Type", "value": "application/json"}]},
                        "metadata": {"designer": {"x": 1200, "y": 450, "name": f"新建別名 {MENU_ALIAS}"}, "parameters": line_meta},
                        "onerror": [{"id": 7, "module": "builtin:Ignore", "version": 1, "mapper": None,
                                     "metadata": {"designer": {"x": 1500, "y": 450}}}]}]},
             # 第三條路線：社會處選單（讀第三欄的圖 → 建立 → 設定別名）。路由後面不能再接模組，所以放在這裡
             {"flow": menu_steps((30, 31, 32), '{{get(map(21.body.results; "id"); 3)}}', "hq-plus", top + hq_row, "社會處選單", 600)
              + [alias_router(40, "{{32.richMenuId}}", HQ_ALIAS, 600)]},
         ]},
    ]
    return blueprint("12 建立圖文選單（一般＋加乘＋社會處）", flow, instant=False)


def alias_router(base, menu_id_expr, alias, y):
    """別名：同時試「更新」和「新建」，各自出錯就略過（已有別名時更新成功；第一次部署時新建成功）"""
    line_meta = [{"name": "__IMTCONN__", "type": "account:line2", "label": "Connection", "required": True}]

    def call(mid, url, body, name, yy):
        return {"id": mid, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                "mapper": {"url": url, "method": "POST", "body": json.dumps(body),
                           "headers": [{"key": "Content-Type", "value": "application/json"}]},
                "metadata": {"designer": {"x": 1200, "y": yy, "name": name}, "parameters": line_meta},
                "onerror": [{"id": mid + 1, "module": "builtin:Ignore", "version": 1, "mapper": None,
                             "metadata": {"designer": {"x": 1500, "y": yy}}}]}
    return {"id": base, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
            "metadata": {"designer": {"x": 900, "y": y, "name": f"設定別名 {alias}"}},
            "routes": [{"flow": [call(base + 1, f"/v2/bot/richmenu/alias/{alias}", {"richMenuId": menu_id_expr}, f"更新別名 {alias}", y)]},
                       {"flow": [call(base + 3, "/v2/bot/richmenu/alias", {"richMenuAliasId": alias, "richMenuId": menu_id_expr},
                                      f"新建別名 {alias}", y + 150)]}]}


def build_supply_api():
    """13 現場頁面 API（物資・居民・本所）：給 LIFF 現場頁面（liff/supplies/）呼叫的 webhook。
    頁面用 application/x-www-form-urlencoded 送出（瀏覽器不會先送 CORS 預檢），欄位：
      a＝動作（load 讀庫存｜submit 送出登記｜resident 查號碼牌｜addItem 新增品項｜
              tagInfo 號碼牌與居民｜register 報到｜move 外出・返回・離所）、t＝LINE Access Token、
      r＝請求編號（submit）、l＝{"lines":[{itemId,name,type,qty,note}]}（submit）、g＝領取人收容登記 ID（submit，可空白）、tag＝號碼牌（resident）
    每次都先向 LINE 驗證 ID Token，再查名冊：啟用中、在班；資料一律以名冊的派駐開設為準。
    回應一律是 JSON：{"ok":true,…} 或 {"ok":false,"error":"auth|not_on_duty"}。"""
    hook = CFG["make"].get("supply_api_hook_id", 0)
    channel = CFG["line"].get("login_channel_id", "")
    origin = "https://miaoliemic.github.io"
    b = B()
    b.next_id = 100

    def respond(name, body, status="200"):
        mid = b.nid()
        return {"id": mid, "module": "gateway:WebhookRespond", "version": 1, "parameters": {},
                "mapper": {"status": status, "body": body, "headers": [
                    {"key": "Content-Type", "value": "application/json; charset=utf-8"},
                    {"key": "Access-Control-Allow-Origin", "value": origin}]},
                "metadata": b.meta(name)}

    # 頁面送來 LIFF 的 Access Token（每次開啟都會更新，有效 12 小時；ID Token 在 LINE 裡可能拿到過期的舊憑證）。
    # 1) 驗證這張 Access Token 是發給本系統的 LINE Login channel；2) 用它向 LINE 取得使用者編號。
    def line_get(mid, url, name, headers=()):
        return {"id": mid, "module": "http:ActionSendData", "version": 3, "parameters": {"handleErrors": False},
                "mapper": {"url": url, "method": "get", "serializeUrl": False, "shareCookies": False,
                           "parseResponse": True, "headers": list(headers), "qs": [], **HTTP_DEFAULTS},
                "metadata": {"designer": {"x": 0 if mid == 2 else 150, "y": 0 if mid == 2 else 150, "name": name}},
                # 憑證無效時 LINE 回 400／401，Make 會當成錯誤中斷；在錯誤處理路線回傳 401，頁面才知道身分有問題
                "onerror": [respond(f"回傳驗證失敗（{name}）", '{"ok":false,"error":"auth"}', "401"),
                            {"id": b.nid(), "module": "builtin:Ignore", "version": 1, "mapper": None,
                             "metadata": {"designer": {"x": 300, "y": 300}}}]}
    verify = line_get(2, "https://api.line.me/oauth2/v2.1/verify?access_token={{encodeURL(1.t)}}", "向 LINE 驗證 Access Token")
    profile = line_get(4, "https://api.line.me/v2/profile", "向 LINE 取得使用者編號",
                       [{"name": "Authorization", "value": "Bearer {{1.t}}"}])
    W = 3  # 名冊
    staff = {"id": W, "module": "notion:searchObjects1", "version": 1,
             "mapper": {"limit": "1", "select": "data_source_item", "data_source": DS_STAFF,
                        "filter": [[c("LINE User ID |&*^%$#@| rich_text", "text:equals", "{{4.data.userId}}")]]},
             "metadata": {"designer": {"x": 300, "y": 0, "name": "查名冊"},
                          "parameters": [{"name": "__IMTCONN__", "type": "account:notion2,notion3", "label": "Connection", "required": True}]},
             "parameters": {"__IMTCONN__": CONN_NOTION}}

    auth_ok = c("{{2.data.client_id}}", "text:equal", channel)
    w_exist = c(f"{{{{{W}.id}}}}", "exist")
    w_en = c(sp(W, "啟用中"), "boolean:equal", "true")
    w_duty = c(sp(W, "簽到狀態", ".name"), "text:equal", "上班中")
    on = [auth_ok, w_exist, w_en, w_duty]
    act = lambda a: c("{{1.a}}", "text:equal", a)
    w_open = sp(W, "派駐開設", "[].id")
    w_name = sp(W, "姓名", "[].plain_text")
    w_role = sp(W, "角色", ".name")
    # 民眾畫面的動作（不需要在班）：從「不是在班工作人員」的擋下條件排除
    not_pub = [c("{{1.a}}", "text:notequal", a) for a in PUBLIC_ACTS]

    # ---- load：本所品項與目前庫存（社會處看某一所時，開設改用頁面送來的 1.o） ----
    def load_flow_for(open_expr, sfx=""):
        g_open = b.get("讀派駐開設" + sfx, open_expr)
        O = g_open["id"]
        items = b.search("找本所物資品項" + sfx, DS_ITEM, [c("收容所 |&*^%$#@| relation", "relation:contains", sp(O, "收容所", "[].id"))])
        items["mapper"]["limit"] = "100"
        IT = items["id"]
        agg_id = b.nid()
        agg = {"id": agg_id, "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": IT},
               "mapper": {"id": f"{{{{{IT}.id}}}}", "properties_value": f"{{{{{IT}.properties_value}}}}"},
               "metadata": b.meta("彙整品項" + sfx)}
        js_id = b.nid()
        js = {"id": js_id, "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
              "mapper": {"object": f"{{{{{agg_id}.array}}}}"}, "metadata": b.meta("品項轉成 JSON" + sfx)}
        load_body = ('{"ok":true,"me":{"name":"' + enc(w_name) + '","role":"' + w_role + '","opening":"'
                     + enc(sp(O, "開設名稱", "[].plain_text")) + '","openingId":"' + f"{{{{{O}.id}}}}" + '"},"items":'
                     + f"{{{{{js_id}.json}}}}" + "}")
        return [g_open, items, agg, js, respond("回傳庫存" + sfx, load_body)]
    load_flow = load_flow_for(w_open)
    no_o = c("{{1.o}}", "notexist")

    # ---- submit：每一行新增一筆物資異動紀錄（請求編號重複就不再寫） ----
    dup = b.search("請求編號是否已登記", DS_MOVE, [c("請求編號 |&*^%$#@| rich_text", "text:equals", "{{1.r}}")])
    D = dup["id"]
    parse = {"id": b.nid(), "module": "json:ParseJSON", "version": 1, "parameters": {"type": ""},
             "mapper": {"json": "{{1.l}}"}, "metadata": b.meta("解析登記內容")}
    P = parse["id"]
    feed = {"id": b.nid(), "module": "builtin:BasicFeeder", "version": 1, "mapper": {"array": f"{{{{{P}.lines}}}}"},
            "metadata": b.meta("逐項登記")}
    F = feed["id"]
    move = b.create("新增物資異動紀錄", DS_MOVE, [
        f_title("摘要", f"{{{{{F}.name}}}} {{{{{F}.type}}}} {{{{{F}.note}}}}"), f_rel("品項", f"{{{{{F}.itemId}}}}"),
        f_rel("收容所開設", w_open), f_sel("異動類型", f"{{{{{F}.type}}}}"),
        {"key": "數量", "type": "number", "value": f"{{{{{F}.qty}}}}"},
        f_rel("經手人", f"{{{{{W}.id}}}}"), f_now("時間"), f_sel("來源", "LINE 表單"),
        f_text("備註", f"物資頁面：{{{{{F}.note}}}}"), f_text("請求編號", "{{1.r}}"),
        # 一般入庫／發放沒有領取人（g 是空字串）。["{{1.g}}"] 會變成 [""]，Notion 會拒收，
        # 所以整個陣列用運算式產生：沒有領取人時給空陣列。
        {"key": "領取人", "type": "relation", "value": '{{if(1.g; split(1.g; ","); emptyarray)}}'},
        f_text("發放區域", "{{1.w}}")])   # 領取人姓名，或「公共用途」
    after = b.get("讀最新庫存", f"{{{{{F}.itemId}}}}")
    A = after["id"]
    rows = b.aggregate("彙整結果", F, '{"itemId":"' + f"{{{{{F}.itemId}}}}" + '","stock":'
                       + "{{ifempty(" + sp(A, "目前庫存", ".number")[2:-2] + "; 0)}}}", sep=",")
    # 發放一定要有對象：居民（g）或公共用途（u=public）。頁面會先擋，這裡再擋一次
    is_out = c("{{1.l}}", "text:contain", '"type":"發放"')
    new_req = c(f"{{{{{D}.id}}}}", "notexist")
    submit_flow = [dup, b.router("是否重複送出", [
        (flt("已登記過", [[c(f"{{{{{D}.id}}}}", "exist")]]), [respond("回傳重複", '{"ok":true,"duplicate":true}')]),
        (flt("發放缺領取人", [[new_req, is_out, c("{{1.g}}", "notexist"), c("{{1.u}}", "text:notequal", "public")]]),
         [respond("回傳缺領取人", '{"ok":false,"error":"no_recipient"}', "400")]),
        (flt("新的登記", [[new_req, c("{{1.l}}", "text:notcontain", '"type":"發放"')],
                         [new_req, c("{{1.g}}", "exist")], [new_req, c("{{1.u}}", "text:equal", "public")]]), [
            parse, feed, move, after, rows, respond("回傳登記結果", '{"ok":true,"results":[' + f"{{{{{rows['id']}.text}}}}" + "]}")]),
    ])]

    # ---- resident：號碼牌 → 居民（領物資用） ----
    tg = b.search("找號碼牌（領物資）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "{{1.tag}}")])
    TG = tg["id"]
    who = b.get("讀居民（領物資）", sp(TG, "綁定居民", "[].id"))
    WHO = who["id"]
    resident_body = ('{"ok":true,"found":"{{if(' + f"{TG}.id" + '; "yes"; "no")}}","tagStatus":"' + sp(TG, "狀態", ".name")
                     + '","residentId":"' + f"{{{{{WHO}.id}}}}" + '","name":"' + enc(sp(WHO, "姓名", "[].plain_text"))
                     + '","status":"' + sp(WHO, "在所狀態", ".name") + '"}')
    resident_flow = [tg, who, respond("回傳居民", resident_body)]

    # ---- addItem：管理者在物資頁面新增品項（物資代碼由頁面產生，期初庫存 0，之後用入庫加上數量） ----
    g_open3 = b.get("讀派駐開設（新增品項）", w_open)
    new_item = b.create("新增物資品項（物資頁面）", DS_ITEM, [
        f_title("品名", cut("1.name", 40)), f_text("單位", cut("1.unit", 10)), f_text("包裝單位", cut("1.pack", 10)),
        {"key": "每包裝數量", "type": "number", "value": "{{ifempty(1.per; 1)}}"},
        {"key": "期初庫存", "type": "number", "value": "{{0}}"},
        {"key": "安全庫存", "type": "number", "value": "{{ifempty(1.safety; 0)}}"},
        f_sel("類別", "{{ifempty(1.cat; \"其他\")}}"), f_text("物資代碼", cut("1.code", 12)),
        f_rel("收容所", sp(g_open3["id"], "收容所", "[].id")), f_text("備註", f"物資頁面新增：{w_name}")])
    add_flow = [g_open3, new_item, respond("回傳新品項", '{"ok":true,"itemId":"' + f"{{{{{new_item['id']}.id}}}}" + '"}')]
    is_mgr = c(w_role, "text:contain", "管理者")

    # ==== 居民：掃號碼牌（liff/supplies/?r=MLS-xxxxx）後的查詢、報到、進出 ====
    # 權限和聊天室一樣：報到限管理者、門禁組；進出（外出・返回・離所）再加志工。號碼牌必須是本所的（存放收容所）
    role_ok = lambda roles: [c(w_role, "exist"), c(roles, "text:contain", w_role)]
    role_no = lambda roles: [c(roles, "text:notcontain", w_role)]

    def tag_checks(T, O):
        """號碼牌存在、而且是本所的"""
        return [c(f"{{{{{T}.id}}}}", "exist"), c(sp(T, "存放收容所", "[].id"), "text:contain", sp(O, "收容所", "[].id"))]

    def not_ours(T, O):
        return [[c(f"{{{{{T}.id}}}}", "notexist")],
                [c(f"{{{{{T}.id}}}}", "exist"), c(sp(T, "存放收容所", "[].id"), "text:notcontain", sp(O, "收容所", "[].id"))]]

    # ---- tagInfo：號碼牌狀態；使用中時附上居民（不回傳電話、證號、照護說明等敏感欄位） ----
    oi = b.get("讀派駐開設（號碼牌）", w_open)
    OI = oi["id"]
    ti = b.search("找號碼牌（居民頁面）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "{{1.tag}}")])
    TI = ti["id"]
    ri = b.get("讀居民（居民頁面）", sp(TI, "綁定居民", "[].id"))
    RI = ri["id"]
    common = ('"tag":"{{encodeURL(1.tag)}}","role":"' + w_role + '","staff":"' + enc(w_name) + '","opening":"' + enc(sp(OI, "開設名稱", "[].plain_text"))
              + '","openStatus":"' + sp(OI, "開設狀態", ".name") + '"')
    res_body = ('{"ok":true,"state":"used",' + common + ',"resident":{"id":"' + f"{{{{{RI}.id}}}}"
                # 志工只看得到號碼牌編號，不回傳姓名和特殊關懷（docs/QR編碼規則.md）
                + '","name":"{{encodeURL(if(' + w_role[2:-2] + ' = "志工"; ""; ' + sp(RI, "姓名", "[].plain_text")[2:-2] + '))}}'
                + '","age":"' + sp(RI, "年齡層", ".name")
                + '","care":"{{if(' + w_role[2:-2] + ' = "志工"; ""; join(map(' + f"{RI}.properties_value.`特殊關懷`" + '; "name"); "、"))}}'
                + '","status":"' + sp(RI, "在所狀態", ".name") + '","back":"' + sp(RI, "預計返回時間", ".start")
                + '","area":"' + enc(sp(RI, "分配區域", "[].plain_text")) + '"}}')
    t_stat = sp(TI, "狀態", ".name")
    taginfo_flow = [oi, ti, b.router("號碼牌狀態", [
        (flt("不是本所的號碼牌", not_ours(TI, OI)), [respond("回傳不是本所", '{"ok":true,"state":"none",' + common + '}')]),
        (flt("空白牌", [tag_checks(TI, OI) + [c(t_stat, "text:equal", "可用")]]), [
            respond("回傳空白牌", '{"ok":true,"state":"blank",' + common + '}')]),
        (flt("已失效", [tag_checks(TI, OI) + [c(t_stat, "text:equal", "失效")]]), [
            respond("回傳已失效", '{"ok":true,"state":"void",' + common + '}')]),
        (flt("使用中", [tag_checks(TI, OI) + [c(t_stat, "text:equal", "使用中")]]), [ri, respond("回傳居民", res_body)]),
    ])]

    # ---- register：一次填完報到資料 → 新增收容登記、號碼牌改使用中、新增進出紀錄（報到） ----
    og = b.get("讀派駐開設（報到）", w_open)
    OG = og["id"]
    tg2 = b.search("找號碼牌（報到）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "{{1.tag}}")])
    TG2 = tg2["id"]
    new_res = b.create("新增收容登記（居民頁面）", DS_RES, [
        f_title("姓名", cut("1.name", 40)), f_sel("年齡層", pick("1.age", AGES, "成人")), f_sel("在所狀態", "在所"), f_now("報到時間"),
        f_rel("收容所開設", w_open), f_rel("號碼牌", f"{{{{{TG2}.id}}}}"), f_chk("是否在名冊", False),
        f_sel("查核狀態", '{{ifempty(1.verify; "不需查核")}}'),
        {"key": "特殊關懷", "type": "multi_select", "value": '{{if(1.care; split(1.care; ","); emptyarray)}}'},
        {"key": "聯絡電話", "type": "phone_number", "value": "{{1.phone}}"},
        f_text("緊急聯絡人", cut("1.contact", 60)), f_text("身分證後四碼", cut("1.id4", 4)),
        f_text("照護需求說明", cut("1.note", 500)), f_text("分配區域", cut("1.area", 40))])
    NR2 = new_res["id"]
    reg_ok = tag_checks(TG2, OG) + [c(sp(TG2, "狀態", ".name"), "text:equal", "可用"),
                                     c(sp(OG, "開設狀態", ".name"), "text:equal", "開設中")]
    register_flow = [og, tg2, b.router("可否報到（居民頁面）", [
        (flt("可以報到", [reg_ok]), [
            new_res,
            b.update("號碼牌改使用中（居民頁面）", DS_TAG, f"{{{{{TG2}.id}}}}", [f_sel("狀態", "使用中"), f_rel("綁定居民", f"{{{{{NR2}.id}}}}")]),
            b.create("新增進出紀錄：報到（居民頁面）", DS_IO, [
                f_title("摘要", cut("1.name", 40) + " 報到"), f_sel("類型", "報到"), f_rel("居民", f"{{{{{NR2}.id}}}}"),
                f_rel("號碼牌", f"{{{{{TG2}.id}}}}"), f_rel("收容所開設", w_open), f_rel("經手人", f"{{{{{W}.id}}}}"),
                f_now("時間"), f_sel("來源", "工作人員掃描")]),
            respond("回傳報到完成", '{"ok":true,"residentId":"' + f"{{{{{NR2}.id}}}}" + '"}')]),
        (flt("本所尚未開放", [tag_checks(TG2, OG) + [c(sp(TG2, "狀態", ".name"), "text:equal", "可用"),
                                                   c(sp(OG, "開設狀態", ".name"), "text:notequal", "開設中")]]), [
            respond("回傳尚未開放", '{"ok":false,"error":"not_open"}', "409")]),
        (flt("號碼牌不能報到", not_ours(TG2, OG) + [tag_checks(TG2, OG) + [c(sp(TG2, "狀態", ".name"), "text:notequal", "可用")]]), [
            respond("回傳號碼牌不能報到", '{"ok":false,"error":"tag_unusable"}', "409")]),
    ])]

    # ---- move：外出（預計 h 小時後返回）・返回・離所（號碼牌回收失效） ----
    om = b.get("讀派駐開設（進出）", w_open)
    OM = om["id"]
    tm = b.search("找號碼牌（進出）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "{{1.tag}}")])
    TM = tm["id"]
    rm = b.get("讀居民（進出）", sp(TM, "綁定居民", "[].id"))
    RM = rm["id"]
    r_stat = sp(RM, "在所狀態", ".name")
    kind = lambda k: c("{{1.kind}}", "text:equal", k)
    back = '{{addHours(now; ifempty(1.hours; 3))}}'

    def io(k, extra=()):
        return b.create(f"新增進出紀錄：{k}（居民頁面）", DS_IO, [
            f_title("摘要", "{{1.tag}} " + k), f_sel("類型", k), f_rel("居民", f"{{{{{RM}.id}}}}"),
            f_rel("號碼牌", f"{{{{{TM}.id}}}}"), f_rel("收容所開設", sp(RM, "收容所開設", "[].id")),
            f_rel("經手人", f"{{{{{W}.id}}}}"), f_now("時間"), f_sel("來源", "工作人員掃描"), *extra])

    def done(k, st):
        return respond(f"回傳{k}完成", '{"ok":true,"status":"' + st + '"}')
    move_flow = [om, tm, b.router("號碼牌可否進出", [
        (flt("號碼牌不能進出", not_ours(TM, OM) + [tag_checks(TM, OM) + [c(sp(TM, "狀態", ".name"), "text:notequal", "使用中")]]), [
            respond("回傳號碼牌不能進出", '{"ok":false,"error":"tag_unusable"}', "409")]),
        (flt("使用中的本所號碼牌", [tag_checks(TM, OM) + [c(sp(TM, "狀態", ".name"), "text:equal", "使用中")]]), [
            rm, b.router("進出動作（居民頁面）", [
                (flt("外出", [[kind("外出"), c(r_stat, "text:equal", "在所")]]), [
                    b.update("居民改外出（居民頁面）", DS_RES, f"{{{{{RM}.id}}}}", [f_sel("在所狀態", "外出"), f_date("預計返回時間", back)]),
                    io("外出", [f_date("預計返回時間", back)]), done("外出", "外出")]),
                (flt("返回", [[kind("返回"), c(r_stat, "text:equal", "外出")], [kind("返回"), c(r_stat, "text:equal", "未返")]]), [
                    b.update("居民改在所（居民頁面）", DS_RES, f"{{{{{RM}.id}}}}", [f_sel("在所狀態", "在所")]),
                    io("返回"), done("返回", "在所")]),
                (flt("離所", [[kind("離所"), c(r_stat, "text:notequal", "已離所")]]), [
                    b.update("居民改已離所（居民頁面）", DS_RES, f"{{{{{RM}.id}}}}", [f_sel("在所狀態", "已離所"), f_now("離所時間")]),
                    b.update("號碼牌回收失效（居民頁面）", DS_TAG, f"{{{{{TM}.id}}}}", [
                        f_sel("狀態", "失效"), f_sel("失效原因", "離所回收"), f_now("失效時間")]),
                    io("離所"), done("離所", "已離所")]),
                (flt("目前狀態不能這樣做", [[kind("外出"), c(r_stat, "text:notequal", "在所")],
                                         [kind("返回"), c(r_stat, "text:notequal", "外出"), c(r_stat, "text:notequal", "未返")],
                                         [kind("離所"), c(r_stat, "text:equal", "已離所")]]), [
                    respond("回傳狀態不符", '{"ok":false,"error":"bad_state","status":"' + r_stat + '"}', "409")]),
            ])]),
    ])]

    all_acts = ["load", "submit", "resident", "addItem", "tagInfo", "register", "move",
                "status", "report", "update", "prep", "prepDone"] + PUBLIC_ACTS + HQ_ACTS
    # 社會處的動作與「看某一所」：不需要在班，從「不是在班工作人員」排除
    not_hq = [c("{{1.a}}", "text:notequal", a) for a in HQ_ACTS]
    off_groups = [[auth_ok, c(f"{{{{{W}.id}}}}", "notexist")],
                  [auth_ok, c(sp(W, "啟用中"), "boolean:notequal", "true")],
                  [auth_ok, c(sp(W, "簽到狀態", ".name"), "text:notequal", "上班中")]]
    off_duty = [g + not_pub + not_hq + extra for g in off_groups
                for extra in ([no_o], [c(w_role, "text:notequal", HQ)])]
    flow = [
        {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "parameters": {"hook": hook, "maxResults": 1},
         "mapper": {}, "metadata": {"designer": {"x": -300, "y": 0, "name": "現場頁面送來的請求"}, "parameters": [
             {"name": "hook", "type": "hook:gateway-webhook", "label": "Webhook", "required": True},
             {"name": "maxResults", "type": "number", "label": "Maximum number of results"}]}},
        b.router("請求格式", [
        (flt("格式不對", [[c("{{1.t}}", "notexist")], [c("{{1.a}}", "text:notequal", a) for a in all_acts]]), [
            respond("回傳格式不對", '{"ok":false,"error":"bad_request"}', "400")]),
        (flt("格式正確", [[c("{{1.t}}", "exist"), act(a)] for a in all_acts]), [
        verify,
        # 憑證不對時使用者編號是空的，不能拿去查名冊（Notion 會報錯、執行中斷），所以先分流再查
        b.router("身分驗證", [
            (flt("不是本系統的憑證", [[c("{{2.data.client_id}}", "text:notequal", channel)]]), [
                respond("回傳驗證失敗", '{"ok":false,"error":"auth"}', "401")]),
            (flt("身分驗證成功", [[auth_ok]]), [profile, staff, b.router("依身分與動作分流", [
            (flt("不是在班工作人員", off_duty), [
                respond("回傳不在班", '{"ok":false,"error":"not_on_duty"}', "403")]),
            (flt("讀庫存", [on + [act("load"), no_o]]), load_flow),
            (flt("送出登記", [on + [act("submit")]]), submit_flow),
            (flt("查號碼牌", [on + [act("resident")]]), resident_flow),
            (flt("新增品項", [on + [act("addItem"), is_mgr]]), add_flow),
            (flt("不是管理者（新增品項）", [on + [act("addItem"), c(w_role, "text:notcontain", "管理者")]]), [
                respond("回傳不是管理者", '{"ok":false,"error":"not_manager"}', "403")]),
            (flt("查號碼牌與居民", [on + [act("tagInfo")]]), taginfo_flow),
            (flt("報到", [on + [act("register")] + role_ok(ROLES_CHECKIN)]), register_flow),
            (flt("進出", [on + [act("move")] + role_ok(ROLES_GATE)]), move_flow),
            (flt("沒有權限（居民）", [on + [act("register")] + role_no(ROLES_CHECKIN),
                                     on + [act("move")] + role_no(ROLES_GATE)]), [
                respond("回傳沒有權限", '{"ok":false,"error":"no_permission"}', "403")]),
            *ops_routes(b, respond, W, on, act),
            *public_routes(b, respond, W, auth_ok, on, act),
            *hq_routes(b, respond, W, auth_ok, on, act, load_flow_for),
        ])]),
        ])]),
        ]),
    ]
    return blueprint("13 現場頁面 API（物資・居民・本所）", flow, instant=True)


def status_flow_for(b, respond, W, open_expr, all_res=False, sfx=""):
    """本所狀況（數字、在班人員、居民名單、未結事件與整備回報）。open_expr 是開設 ID：
    工作人員用名冊的派駐開設；社會處從「各所現況」看某一所時用頁面送來的 1.o（all_res＝列出全部在所居民）。"""
    w_name = sp(W, "姓名", "[].plain_text")
    w_role = sp(W, "角色", ".name")
    w_open = open_expr
    open_rel = lambda: c("收容所開設 |&*^%$#@| relation", "relation:contains", w_open)

    def agg_json(name, feeder, fields):
        a = {"id": b.nid(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder},
             "mapper": fields, "metadata": b.meta(f"彙整{name}{sfx}")}
        j = {"id": b.nid(), "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
             "mapper": {"object": f"{{{{{a['id']}.array}}}}"}, "metadata": b.meta(f"{name}轉成 JSON{sfx}")}
        return [a, j], j["id"]

    og = b.get("讀派駐開設（本所）" + sfx, w_open)
    O = og["id"]
    duty = b.search("找本所在班人員" + sfx, DS_STAFF, [c("派駐開設 |&*^%$#@| relation", "relation:contains", w_open),
                                            c("簽到狀態 |&*^%$#@| select", "select:equals", "上班中")])
    duty["mapper"]["limit"] = "50"
    D = duty["id"]
    duty_mods, DJ = agg_json("在班人員", D, {"id": f"{{{{{D}.id}}}}", "name": sp(D, "姓名", "[].plain_text"),
                                          "role": sp(D, "角色", ".name"), "kind": sp(D, "身分類別", ".name")})
    # 居民：外出、未返，或在所且有特殊關懷
    res_filter = ([[open_rel(), c("在所狀態 |&*^%$#@| select", "select:does_not_equal", "已離所")]] if all_res else [
            [open_rel(), c("在所狀態 |&*^%$#@| select", "select:equals", "外出")],
            [open_rel(), c("在所狀態 |&*^%$#@| select", "select:equals", "未返")],
            [open_rel(), c("在所狀態 |&*^%$#@| select", "select:equals", "在所"),
             c("特殊關懷 |&*^%$#@| multi_select", "multi_select:is_not_empty", "true")]])
    res = b.notion("searchObjects1", "找本所居民" + sfx, {
        "limit": "100", "select": "data_source_item", "data_source": DS_RES, "filter": res_filter})
    R = res["id"]
    res_mods, RJ = agg_json("居民名單", R, {"id": f"{{{{{R}.id}}}}", "name": sp(R, "姓名", "[].plain_text"),
                                         "status": sp(R, "在所狀態", ".name"), "back": sp(R, "預計返回時間", ".start"),
                                         "care": "{{join(map(" + f"{R}.properties_value.`特殊關懷`" + '; "name"); "、")}}'})
    # 事件：未結的（居民反映除外），加上所有整備回報（整備清單要看已完成的項目）
    logs = b.notion("searchObjects1", "找本所未結事件與整備回報" + sfx, {
        "limit": "60", "select": "data_source_item", "data_source": DS_LOG,
        "sorts": [{"select": "timestamp", "direction": "descending", "timestamp": "created_time"}], "filter": [
            [open_rel(), c("處理進度 |&*^%$#@| select", "select:does_not_equal", "已解決"),
             c("處理進度 |&*^%$#@| select", "select:does_not_equal", "已結案"),
             c("日誌類別 |&*^%$#@| select", "select:does_not_equal", "居民反映")],
            [open_rel(), c("日誌類別 |&*^%$#@| select", "select:equals", "整備回報")]]})
    L = logs["id"]
    log_mods, LJ = agg_json("事件", L, {
        "id": f"{{{{{L}.id}}}}",
        "title": sp(L, "日誌標題", "[].plain_text"), "cat": sp(L, "日誌類別", ".name"), "sev": sp(L, "嚴重程度", ".name"),
        "status": sp(L, "處理進度", ".name"), "text": sp(L, "內容說明", "[].plain_text"), "log": sp(L, "處理紀錄", "[].plain_text"),
        "owner": sp(L, "負責人", "[].id"), "by": sp(L, "回報人", "[].id"), "item": sp(L, "整備項目", ".name"),
        "at": f"{{{{{L}.created_time}}}}"})
    num = lambda p: "{{ifempty(" + sp(O, p, ".number")[2:-2] + "; 0)}}"
    status_body = ('{"ok":true,"me":{"id":"' + f"{{{{{W}.id}}}}" + '","name":"' + enc(w_name) + '","role":"' + w_role + '"},'
                   '"opening":{"name":"' + enc(sp(O, "開設名稱", "[].plain_text")) + '","stage":"' + sp(O, "開設狀態", ".name")
                   + '","light":"' + sp(O, "狀況燈號", ".string") + '","inside":' + num("在所人數") + ',"capacity":' + num("容納人數")
                   + ',"out":' + num("外出人數") + ',"late":' + num("未返人數") + ',"care":' + num("需關懷人數")
                   + ',"open":' + num("未結日誌數") + ',"urgent":' + num("緊急未結數")
                   + ',"needStaff":' + num("缺工作人員") + ',"needVol":' + num("缺志工") + '},'
                   '"duty":' + f"{{{{{DJ}.json}}}}" + ',"residents":' + f"{{{{{RJ}.json}}}}" + ',"events":' + f"{{{{{LJ}.json}}}}" + '}')
    return [og, duty, *duty_mods, res, *res_mods, logs, *log_mods, respond("回傳本所狀況" + sfx, status_body)]


def ops_routes(b, respond, W, on, act):
    """本所畫面（liff/supplies/?v=ops）的動作，掛在情境 13 的「依身分與動作分流」底下（免費方案只能啟用兩個情境）。
    限在班的工作人員（身分類別＝工作人員）；志工屬勞務型，用一般介面，不使用本所畫面。
      a＝status 本所狀況｜report 記錄事件｜update 認領・追加紀錄・解決｜prep 整備回報｜prepDone 送出整備完成
    事件就是「現場日誌」的一筆；本版不處理居民反映（日誌類別＝居民反映的不列入）。"""
    w_kind = sp(W, "身分類別", ".name")
    staff_on = on + [c(w_kind, "text:equal", "工作人員")]
    w_open = sp(W, "派駐開設", "[].id")
    w_name = sp(W, "姓名", "[].plain_text")
    w_role = sp(W, "角色", ".name")
    open_rel = lambda: c("收容所開設 |&*^%$#@| relation", "relation:contains", w_open)

    def agg_json(name, feeder, fields):
        """把搜尋結果彙整成 JSON 陣列（文字裡有引號、換行也不會壞掉），輸出 {{N.json}}"""
        a = {"id": b.nid(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder},
             "mapper": fields, "metadata": b.meta(f"彙整{name}")}
        j = {"id": b.nid(), "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
             "mapper": {"object": f"{{{{{a['id']}.array}}}}"}, "metadata": b.meta(f"{name}轉成 JSON")}
        return [a, j], j["id"]

    status_flow = status_flow_for(b, respond, W, w_open)
    no_o = c("{{1.o}}", "notexist")
    # （status 的內容在 status_flow_for）


    # ---- report：記錄事件（cat 類別、sev 嚴重程度、text 說明、g 相關居民 ID 可空白） ----
    urgent = '{{if(contains("緊急,高"; 1.sev); true; false)}}'
    new_log = b.create("新增事件（本所頁面）", DS_LOG, [
        f_title("日誌標題", pick("1.cat", FIELD_CATS, "交班紀錄") + "：{{substring(1.text; 0; 24)}}"),
        f_sel("日誌類別", pick("1.cat", FIELD_CATS, "交班紀錄")),
        f_sel("嚴重程度", pick("1.sev", SEVS, "中")), f_sel("處理進度", "待處理"), f_text("內容說明", cut("1.text", 1000)),
        f_rel("回報人", f"{{{{{W}.id}}}}"), f_rel("收容所開設", w_open), f_now("發生時間"), f_sel("來源", "LINE 回報"),
        f_chk("需回報社會處", urgent),
        {"key": "相關居民", "type": "relation", "value": '{{if(1.g; split(1.g; ","); emptyarray)}}'}])
    report_flow = [new_log, respond("回傳已記錄", '{"ok":true,"id":"' + f"{{{{{new_log['id']}.id}}}}" + '"}')]

    # ---- update：id 事件、kind＝claim 我來處理｜note 追加紀錄｜resolve 已解決、text 紀錄內容 ----
    gl = b.get("讀事件", "{{1.id}}")
    G = gl["id"]
    ours = c(sp(G, "收容所開設", "[].id"), "text:contain", w_open)
    stamp = '{{formatDate(now; "MM/DD HH:mm")}} ' + w_name
    # Make 的運算式不能用 + 串字，舊紀錄後面直接接換行（第一筆前面會多一個空行，不影響閱讀）
    old_log = sp(G, "處理紀錄", "[].plain_text") + "\n"
    kind = lambda k: c("{{1.kind}}", "text:equal", k)
    upd = lambda name, fields: b.update(name, DS_LOG, f"{{{{{G}.id}}}}", fields)
    ok_body = '{"ok":true}'
    update_flow = [gl, b.router("事件動作", [
        (flt("不是本所的事件", [[c(sp(G, "收容所開設", "[].id"), "text:notcontain", w_open)]]), [
            respond("回傳不是本所事件", '{"ok":false,"error":"not_ours"}', "403")]),
        (flt("我來處理", [[ours, kind("claim")]]), [
            upd("認領事件", [f_rel("負責人", f"{{{{{W}.id}}}}"), f_sel("處理進度", "處理中"),
                         f_text("處理紀錄", old_log + stamp + " 認領處理{{if(1.text; \"：\"; \"\")}}" + cut("1.text", 500))]),
            respond("回傳已認領", ok_body)]),
        (flt("追加紀錄", [[ours, kind("note")]]), [
            upd("追加處理紀錄", [f_text("處理紀錄", old_log + stamp + "：" + cut("1.text", 500))]),
            respond("回傳已追加", ok_body)]),
        (flt("已解決", [[ours, kind("resolve")]]), [
            upd("事件已解決", [f_sel("處理進度", "已解決"),
                          f_text("處理紀錄", old_log + stamp + " 標記已解決{{if(1.text; \"：\"; \"\")}}" + cut("1.text", 500))]),
            respond("回傳已解決", ok_body)]),
    ])]

    # ---- prep：整備回報（item 整備項目、result＝已完成｜有問題、text 說明） ----
    done = 'if(1.result = "已完成"'
    prep_log = b.create("新增整備回報（本所頁面）", DS_LOG, [
        f_title("日誌標題", "整備回報：{{1.item}}{{1.result}}"), f_sel("日誌類別", "整備回報"), f_sel("整備項目", "{{1.item}}"),
        f_sel("處理進度", "{{" + done + '; "已解決"; "待處理")}}'), f_sel("嚴重程度", "{{" + done + '; "低"; "中")}}'),
        f_text("內容說明", cut("1.text", 1000)), f_rel("收容所開設", w_open), f_rel("回報人", f"{{{{{W}.id}}}}"),
        f_now("發生時間"), f_sel("來源", "LINE 回報")])
    prep_flow = [prep_log, respond("回傳整備已記錄", ok_body)]

    # ---- prepDone：管理者送出整備完成（開設狀態 整備中 → 待核准，和聊天室 R4 相同） ----
    op2 = b.get("讀派駐開設（整備完成）", w_open)
    O2 = op2["id"]
    prepdone_flow = [op2, b.router("可否送出整備完成", [
        (flt("整備中", [[c(sp(O2, "開設狀態", ".name"), "text:equal", "整備中")]]), [
            b.update("開設改待核准（本所頁面）", DS_OPEN, f"{{{{{O2}.id}}}}", [f_sel("開設狀態", "待核准")]),
            b.create("新增申請日誌（本所頁面）", DS_LOG, [
                f_title("日誌標題", "整備完成，申請開放進駐"), f_sel("日誌類別", "整備回報"), f_sel("處理進度", "待處理"),
                f_sel("嚴重程度", "中"), f_chk("需回報社會處", True), f_rel("收容所開設", f"{{{{{O2}.id}}}}"),
                f_rel("回報人", f"{{{{{W}.id}}}}"), f_now("發生時間"), f_sel("來源", "LINE 回報")]),
            respond("回傳已送出整備完成", ok_body)]),
        (flt("不是整備中", [[c(sp(O2, "開設狀態", ".name"), "text:notequal", "整備中")]]), [
            respond("回傳不是整備中", '{"ok":false,"error":"bad_stage"}', "409")]),
    ])]
    is_mgr = c(w_role, "text:contain", "管理者")
    ops_acts = ["status", "report", "update", "prep", "prepDone"]
    return [
        (flt("不是工作人員（本所）", [on + [act(a), c(w_kind, "text:notequal", "工作人員"), no_o] for a in ops_acts]), [
            respond("回傳不是工作人員", '{"ok":false,"error":"not_staff"}', "403")]),
        (flt("本所狀況", [staff_on + [act("status"), no_o]]), status_flow),
        (flt("記錄事件", [staff_on + [act("report")]]), report_flow),
        (flt("事件處理", [staff_on + [act("update")]]), update_flow),
        (flt("整備回報", [staff_on + [act("prep")]]), prep_flow),
        (flt("送出整備完成", [staff_on + [act("prepDone"), is_mgr]]), prepdone_flow),
        (flt("不是管理者（整備完成）", [staff_on + [act("prepDone"), c(w_role, "text:notcontain", "管理者")]]), [
            respond("回傳不是管理者（整備完成）", '{"ok":false,"error":"not_manager"}', "403")]),
    ]


PUBLIC_ACTS = ["info", "me", "apply", "feedback", "signout"]


def public_routes(b, respond, W, auth_ok, on, act):
    """一般畫面（liff/supplies/?v=info｜report｜sos｜staff｜signout）的動作，掛在情境 13 的「依身分與動作分流」底下。
    只要通過 LINE 身分驗證就能用，不需要在名冊或在班；聊天室已不再用泡泡按鈕，圖文選單每一格都直接打開這些畫面。
      a＝info 開設中的收容所與問答公告｜me 我的工作人員狀態｜apply 申請開通｜feedback 我要反映｜signout 簽退"""
    uid = "{{4.data.userId}}"
    w_exist = c(f"{{{{{W}.id}}}}", "exist")
    w_none = c(f"{{{{{W}.id}}}}", "notexist")

    def agg_json(name, feeder, fields):
        a = {"id": b.nid(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder},
             "mapper": fields, "metadata": b.meta(f"彙整{name}")}
        j = {"id": b.nid(), "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
             "mapper": {"object": f"{{{{{a['id']}.array}}}}"}, "metadata": b.meta(f"{name}轉成 JSON")}
        return [a, j], j["id"]

    # ---- info：開設中的收容所、啟用中的問答與公告（緊急聯絡也在裡面，由頁面挑出來） ----
    opens = b.search("找開設中的收容所（民眾）", DS_OPEN, [c("開設狀態 |&*^%$#@| select", "select:equals", "開設中")])
    opens["mapper"]["limit"] = "30"
    OP = opens["id"]
    o_mods, OJ = agg_json("開設中的收容所", OP, {"id": f"{{{{{OP}.id}}}}", "name": sp(OP, "開設名稱", "[].plain_text")})
    qa = b.search("找問答與公告（民眾）", DS_QA, [c("啟用 |&*^%$#@| checkbox", "checkbox:equals", "true")], sort_created=True)
    qa["mapper"]["limit"] = "30"
    QA = qa["id"]
    q_mods, QJ = agg_json("問答與公告", QA, {"title": sp(QA, "標題", "[].plain_text"), "text": sp(QA, "內容", "[].plain_text"),
                                          "kw": sp(QA, "關鍵字", "[].plain_text"), "type": sp(QA, "類型", ".name")})
    info_flow = [opens, *o_mods, qa, *q_mods,
                 respond("回傳收容所資訊", '{"ok":true,"shelters":' + f"{{{{{OJ}.json}}}}" + ',"qa":' + f"{{{{{QJ}.json}}}}" + "}")]

    # ---- me：名冊狀態（none 未申請｜pending 審核中｜off 未上班｜on 上班中） ----
    state = ('{{if(' + f"{W}.id" + '; if(' + sp(W, "啟用中")[2:-2] + '; if(' + sp(W, "簽到狀態", ".name")[2:-2]
             + ' = "上班中"; "on"; "off"); "pending"); "none")}}')
    me_body = ('{"ok":true,"state":"' + state + '","name":"' + enc(sp(W, "姓名", "[].plain_text")) + '","role":"'
               + sp(W, "角色", ".name") + '","kind":"' + sp(W, "身分類別", ".name") + '","line":"{{encodeURL(4.data.displayName)}}"}')

    # ---- apply：申請開通（新增一筆待審名冊；已在名冊就回目前狀態） ----
    hqs = b.search("找社會處（通知申請）", DS_STAFF, [c("角色 |&*^%$#@| select", "select:equals", HQ),
                                                     c("啟用中 |&*^%$#@| checkbox", "checkbox:equals", "true")])
    hqs["mapper"]["limit"] = "5"
    apply_flow = [b.router("申請開通分流", [
        (flt("新申請（頁面）", [[auth_ok, w_none]]), [
            b.create("新增名冊（待審，頁面）", DS_STAFF, [
                f_title("姓名", "{{ifempty(substring(1.name; 0; 40); 4.data.displayName)}}"), f_text("單位", cut("1.unit", 40)),
                {"key": "聯絡電話", "type": "phone_number", "value": cut("1.phone", 20)},
                f_text("LINE User ID", uid), f_text("LINE 顯示名稱", "{{4.data.displayName}}"), f_now("申請時間"),
                f_chk("啟用中", False), f_sel("簽到狀態", "已簽退"), f_sel("選單狀態", "一般")]),
            respond("回傳已申請", '{"ok":true,"state":"pending"}'),
            # 回應之後才通知兩位社會處（每位一則推播）；訊息不放申請者填的文字，避免被插入內容
            hqs,
            b.line_api("推播新申請給社會處", "/v2/bot/message/push", body={
                "to": sp(hqs["id"], "LINE User ID", "[].plain_text"),
                "messages": [{"type": "text", "text": "📥 有新的工作人員申請，請到「待我處理」核准：\n"
                                                      f"https://liff.line.me/{LIFF_ID}?v=inbox"}]})]),
        (flt("已在名冊（頁面）", [[auth_ok, w_exist]]), [respond("回傳名冊狀態（申請）", me_body)]),
    ])]

    # ---- feedback：我要反映（cat 類別、o 收容所開設 ID 可空白、where 地點名稱、text 說明） ----
    rlog = b.create("新增居民反映（頁面）", DS_LOG, [
        f_title("日誌標題", "居民反映：" + pick("1.cat", REPORT_CATS, "其他")), f_sel("日誌類別", "居民反映"),
        f_sel("協助類別", pick("1.cat", REPORT_CATS, "其他")),
        f_sel("嚴重程度", '{{if(1.cat = "身體不適"; "高"; "中")}}'), f_sel("處理進度", "待處理"),
        f_text("反映者 LINE ID", uid), f_now("發生時間"), f_sel("來源", "LINE 回報"),
        f_text("內容說明", "反映地點：" + cut("1.where", 40) + "\n" + cut("1.text", 500)),
        {"key": "收容所開設", "type": "relation", "value": '{{if(1.o; split(1.o; ","); emptyarray)}}'}])
    feedback_flow = [rlog, respond("回傳已收到反映", '{"ok":true}')]

    # ---- signout：簽退（名冊改已簽退、解除加乘選單、補出勤簽退時間）。不在班時也解除選單，讓選單恢復一般版 ----
    def unlink(name):
        return {"id": b.nid(), "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                "mapper": {"url": f"/v2/bot/user/{uid}/richmenu", "method": "DELETE", "headers": []},
                "metadata": b.meta(name, "account:line2"),
                # 沒有綁加乘選單時 LINE 會回錯誤，略過
                "onerror": [{"id": b.nid(), "module": "builtin:Ignore", "version": 1, "mapper": None,
                             "metadata": b.meta("略過")}]}
    att = b.search("找未簽退的出勤（頁面）", DS_ATT, [
        c("人員 |&*^%$#@| relation", "relation:contains", f"{{{{{W}.id}}}}"),
        c("簽退時間 |&*^%$#@| date", "date:is_empty", "true")], sort_created=True)
    signout_on = [
        b.update("名冊改已簽退（頁面）", DS_STAFF, f"{{{{{W}.id}}}}", [
            f_sel("簽到狀態", "已簽退"), f_sel("選單狀態", "一般"), f_text("對話暫存", TMP_CLEAR)]),
        unlink("解除加乘選單（頁面）"),
        b.router("簽退後", [
            (None, [
                respond("回傳已簽退", '{"ok":true,"name":"' + enc(sp(W, "姓名", "[].plain_text")) + '"}'),
                # 找不到出勤時後面不會執行，所以放在回應之後
                att,
                b.update("出勤補簽退時間（頁面）", DS_ATT, f"{{{{{att['id']}.id}}}}", [f_now("簽退時間"), f_sel("簽退方式", "自行簽退")])]),
            (flt("社會處（簽退）", [[c(sp(W, "角色", ".name"), "text:equal", HQ)]]), hq_menu_link(b, W, "（簽退）", check=False)),
        ])]
    w_off = [[auth_ok, w_none], [auth_ok, c(sp(W, "啟用中"), "boolean:notequal", "true")],
             [auth_ok, c(sp(W, "簽到狀態", ".name"), "text:notequal", "上班中")]]
    return [
        (flt("收容所資訊", [[auth_ok, act("info")]]), info_flow),
        (flt("我的狀態", [[auth_ok, act("me")]]), [respond("回傳我的狀態", me_body), *hq_menu_link(b, W, "（我的狀態）")]),
        (flt("申請開通", [[auth_ok, act("apply")]]), apply_flow),
        (flt("我要反映", [[auth_ok, act("feedback")]]), feedback_flow),
        (flt("簽退", [on + [act("signout")]]), signout_on),
        (flt("簽退（不在班）", [g + [act("signout")] for g in w_off]), [
            unlink("解除加乘選單（不在班，頁面）"), respond("回傳不在班（簽退）", '{"ok":true,"already":true}'),
            *hq_menu_link(b, W, "（不在班簽退）")]),
    ]


def hq_menu_link(b, W, label, check=True):
    """把社會處選單（一般選單＋指揮列）綁給這位使用者。check＝只對啟用中、不在班的社會處執行（第一個模組上的篩選）"""
    get_alias = b.line_api("取得社會處選單 ID" + label, f"/v2/bot/richmenu/alias/{HQ_ALIAS}", method="GET")
    if check:
        get_alias["filter"] = flt("啟用中、不在班的社會處" + label, [[
            c(sp(W, "角色", ".name"), "text:equal", HQ), c(sp(W, "啟用中"), "boolean:equal", "true"),
            c(sp(W, "簽到狀態", ".name"), "text:notequal", "上班中")]])
    link = b.line_api("綁定社會處選單" + label,
                      "/v2/bot/user/{{4.data.userId}}/richmenu/{{" + str(get_alias["id"]) + ".body.richMenuId}}")
    return [get_alias, link]


def hq_routes(b, respond, W, auth_ok, on, act, load_flow_for):
    """社會處（liff/supplies/?v=hq｜inbox｜sites）的動作，掛在情境 13 的「依身分與動作分流」底下。
    權限跟著身分走：角色＝社會處、啟用中，不需要在班。社會處由系統管理者在 Notion 名冊指定，不能自己申請。
      a＝hqInit 指揮台資料｜hqOpen 開設（ev 災害 ID 或空白＋evName/evKind 建新災害、sh＝收容所ID:簽到代碼,…）｜
         hqApps 待核准的申請｜hqApprove 核准（id、kind、role）｜hqReject 不核准（id）｜hqSites 開設中各所的數字
      另外 status、load 帶 o（開設 ID）時，是社會處看某一所（只能看，寫入的動作都不接受 o）。"""
    w_name = sp(W, "姓名", "[].plain_text")
    w_role = sp(W, "角色", ".name")
    is_hq = [auth_ok, c(f"{{{{{W}.id}}}}", "exist"), c(sp(W, "啟用中"), "boolean:equal", "true"), c(w_role, "text:equal", HQ)]
    not_hq_groups = [[auth_ok, c(f"{{{{{W}.id}}}}", "notexist")], [auth_ok, c(sp(W, "啟用中"), "boolean:notequal", "true")],
                     [auth_ok, c(w_role, "text:notequal", HQ)]]
    has_o = c("{{1.o}}", "exist")
    ok_body = '{"ok":true}'

    def agg_json(name, feeder, fields):
        a = {"id": b.nid(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder},
             "mapper": fields, "metadata": b.meta(f"彙整{name}")}
        j = {"id": b.nid(), "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
             "mapper": {"object": f"{{{{{a['id']}.array}}}}"}, "metadata": b.meta(f"{name}轉成 JSON")}
        return [a, j], j["id"]

    num = lambda X, p: "{{ifempty(" + sp(X, p, ".number")[2:-2] + "; 0)}}"

    def search_all(name, ds, filters, limit, sort_created=False):
        m = b.search(name, ds, filters, sort_created=sort_created)
        m["mapper"]["limit"] = str(limit)
        return m

    # ---- hqInit：進行中的災害、收容所主檔、未撤收的開設 ----
    ev = search_all("找進行中的災害", DS_EVENT, [c("狀態 |&*^%$#@| select", "select:does_not_equal", "已結束")], 20, True)
    EV = ev["id"]
    ev_mods, EJ = agg_json("災害", EV, {"id": f"{{{{{EV}.id}}}}", "name": sp(EV, "災害名稱", "[].plain_text"),
                                       "kind": sp(EV, "災害類型", ".name"), "status": sp(EV, "狀態", ".name")})
    sh = search_all("找收容所主檔", DS_SHELTER, [c("收容所名稱 |&*^%$#@| title", "text:is_not_empty", "true")], 100)
    SH = sh["id"]
    sh_mods, SJ = agg_json("收容所", SH, {
        "id": f"{{{{{SH}.id}}}}", "no": sp(SH, "原表編號"), "name": sp(SH, "收容所名稱", "[].plain_text"),
        "addr": sp(SH, "鄉鎮市", ".name") + sp(SH, "地址", "[].plain_text"), "cap": sp(SH, "容納人數"),
        "kinds": "{{join(map(" + f"{SH}.properties_value.`適用災害`" + '; "name"); ",")}}',
        "weak": sp(SH, "適合避難弱者安置", ".name")})
    op = search_all("找未撤收的開設", DS_OPEN, [c("開設狀態 |&*^%$#@| select", "select:does_not_equal", "已撤收")], 100)
    OP = op["id"]
    op_mods, OJ = agg_json("開設", OP, {
        "id": f"{{{{{OP}.id}}}}", "eventId": "{{first(" + f"{OP}.properties_value.`災害事件`" + "[].id)}}",
        "shelterId": "{{first(" + f"{OP}.properties_value.`收容所`" + "[].id)}}",
        "name": sp(OP, "開設名稱", "[].plain_text"), "code": sp(OP, "簽到代碼", "[].plain_text"), "status": sp(OP, "開設狀態", ".name")})
    init_flow = [ev, *ev_mods, sh, *sh_mods, op, *op_mods, respond("回傳指揮台資料", (
        '{"ok":true,"me":{"name":"' + enc(w_name) + '"},"events":' + f"{{{{{EJ}.json}}}}" + ',"shelters":' + f"{{{{{SJ}.json}}}}"
        + ',"openings":' + f"{{{{{OJ}.json}}}}" + "}"))]

    # ---- hqOpen：新災害或既有災害 → 每一所新增一筆開設（開設中）。同一場災害同一所已開設就略過 ----
    def open_chain(E, EN, sfx):
        feed = {"id": b.nid(), "module": "builtin:BasicFeeder", "version": 1, "mapper": {"array": '{{split(1.sh; ",")}}'},
                "metadata": b.meta("逐所開設" + sfx)}
        F = feed["id"]
        sid = '{{first(split(' + f"{F}.value" + '; ":"))}}'
        code = '{{substring(last(split(' + f"{F}.value" + '; ":")); 0; 10)}}'
        dup = b.search("這一所是否已開設" + sfx, DS_OPEN, [c("災害事件 |&*^%$#@| relation", "relation:contains", E),
                                                      c("收容所 |&*^%$#@| relation", "relation:contains", sid)])
        shg = b.get("讀收容所" + sfx, sid, f=flt("還沒開設" + sfx, [[c(f"{{{{{dup['id']}.id}}}}", "notexist"),
                                                                  c(code, "text:startwith", "SIGN-")]]))
        new = b.create("新增收容所開設" + sfx, DS_OPEN, [
            f_title("開設名稱", EN + "｜" + sp(shg["id"], "收容所名稱", "[].plain_text")),
            f_rel("災害事件", E), f_rel("收容所", f"{{{{{shg['id']}.id}}}}"), f_now("開設時間"),
            f_sel("開設狀態", "開設中"), f_text("簽到代碼", code), f_text("備註", "社會處指揮台開設：" + w_name)])
        done = b.aggregate("彙整開設結果" + sfx, F, f"{{{{{F}.value}}}}", sep=",")
        return [feed, dup, shg, new, done, respond("回傳開設完成" + sfx, '{"ok":true,"eventId":"' + E + '"}')]
    new_ev = b.create("新增災害事件（指揮台）", DS_EVENT, [
        f_title("災害名稱", cut("1.evName", 40)), f_sel("災害類型", pick("1.evKind", KINDS, "其他")),
        f_sel("狀態", "應變中"), f_now("開始時間"), f_text("說明", "社會處指揮台建立：" + w_name)])
    old_ev = b.get("讀既有災害（指揮台）", "{{1.ev}}")
    open_flow = [b.router("新災害或既有災害", [
        (flt("建立新災害", [[c("{{1.ev}}", "notexist"), c("{{1.evName}}", "exist")]]),
         [new_ev, *open_chain(f"{{{{{new_ev['id']}.id}}}}", cut("1.evName", 40), "（新災害）")]),
        (flt("既有災害", [[c("{{1.ev}}", "exist")]]),
         [old_ev, *open_chain(f"{{{{{old_ev['id']}.id}}}}", sp(old_ev["id"], "災害名稱", "[].plain_text"), "（既有災害）")]),
        (flt("缺災害名稱", [[c("{{1.ev}}", "notexist"), c("{{1.evName}}", "notexist")]]),
         [respond("回傳缺災害名稱", '{"ok":false,"error":"bad_request"}', "400")]),
    ])]

    # ---- hqApps：待核准的申請（未啟用、有申請時間） ----
    ap = search_all("找待核准的申請", DS_STAFF, [c("啟用中 |&*^%$#@| checkbox", "checkbox:equals", "false"),
                                             c("申請時間 |&*^%$#@| date", "date:is_not_empty", "true")], 50, True)
    AP = ap["id"]
    ap_mods, AJ = agg_json("申請", AP, {"id": f"{{{{{AP}.id}}}}", "name": sp(AP, "姓名", "[].plain_text"),
                                       "unit": sp(AP, "單位", "[].plain_text"), "phone": sp(AP, "聯絡電話"),
                                       "line": sp(AP, "LINE 顯示名稱", "[].plain_text"), "at": sp(AP, "申請時間", ".start")})
    apps_flow = [ap, *ap_mods, respond("回傳申請清單", '{"ok":true,"apps":' + f"{{{{{AJ}.json}}}}" + "}")]

    # ---- hqApprove／hqReject：只處理「未啟用、不是社會處」的名冊（不能用來改別的社會處） ----
    def target(sfx):
        t = b.get("讀申請者" + sfx, "{{1.id}}")
        T = t["id"]
        ok = [c(f"{{{{{T}.id}}}}", "exist"), c(sp(T, "角色", ".name"), "text:notequal", HQ), c(sp(T, "LINE User ID", "[].plain_text"), "exist")]
        bad = [[c(f"{{{{{T}.id}}}}", "notexist")], [c(sp(T, "角色", ".name"), "text:equal", HQ)]]
        return t, T, ok, bad

    def push(name, T, text):
        return b.line_api(name, "/v2/bot/message/push", body={"to": sp(T, "LINE User ID", "[].plain_text"),
                                                             "messages": [{"type": "text", "text": text}]})
    t1, T1, ok1, bad1 = target("（核准）")
    role = pick("1.role", HQ_GRANT_ROLES, "門禁組")
    approve_flow = [t1, b.router("可否核准", [
        (flt("可以核准", [ok1]), [
            b.update("核准：啟用並設定角色", DS_STAFF, f"{{{{{T1}.id}}}}", [
                f_chk("啟用中", True), f_sel("身分類別", pick("1.kind", ["工作人員", "志工"], "工作人員")), f_sel("角色", role)]),
            respond("回傳已核准", ok_body),
            push("通知申請者已核准", T1, "✅ 您的工作人員申請已核准（" + role + "）。\n到收容所後，用 LINE 掃服務台的「工作人員簽到」QR，按「傳送」就能開始上班。")]),
        (flt("不能核准", bad1), [respond("回傳不能核准", '{"ok":false,"error":"bad_target"}', "409")]),
    ])]
    t2, T2, ok2, bad2 = target("（不核准）")
    archive = {"id": b.nid(), "module": "notion:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_NOTION},
               "mapper": {"url": f"/v1/pages/{{{{{T2}.id}}}}", "method": "PATCH", "version": "2022-06-28",
                          "headers": [{"key": "Content-Type", "value": "application/json"}], "body": '{"archived":true}'},
               "metadata": b.meta("不核准：申請移到垃圾桶", "account:notion2,notion3")}
    reject_flow = [t2, b.router("可否不核准", [
        (flt("可以不核准", [ok2 + [c(sp(T2, "啟用中"), "boolean:notequal", "true")]]), [
            push("通知申請者未通過", T2, "您的工作人員申請這次沒有通過。如有疑問，請洽苗栗縣政府社會處。之後可以重新申請。"),
            archive, respond("回傳已不核准", ok_body)]),
        (flt("不能不核准", bad2 + [[c(sp(T2, "啟用中"), "boolean:equal", "true")]]), [
            respond("回傳不能不核准", '{"ok":false,"error":"bad_target"}', "409")]),
    ])]

    # ---- hqSites：開設中的各所數字＋進行中的災害名稱（頁面依災害分組） ----
    st = search_all("找開設中的收容所（社會處）", DS_OPEN, [c("開設狀態 |&*^%$#@| select", "select:equals", "開設中")], 50)
    ST = st["id"]
    st_mods, STJ = agg_json("各所現況", ST, {
        "id": f"{{{{{ST}.id}}}}", "eventId": "{{first(" + f"{ST}.properties_value.`災害事件`" + "[].id)}}",
        "name": sp(ST, "開設名稱", "[].plain_text"), "light": sp(ST, "狀況燈號", ".string"),
        "inside": num(ST, "在所人數"), "capacity": num(ST, "容納人數"), "out": num(ST, "外出人數"), "late": num(ST, "未返人數"),
        "care": num(ST, "需關懷人數"), "open": num(ST, "未結日誌數"), "urgent": num(ST, "緊急未結數"),
        "needStaff": num(ST, "缺工作人員"), "needVol": num(ST, "缺志工"), "low": num(ST, "低庫存品項數")})
    ev2 = search_all("找進行中的災害（各所現況）", DS_EVENT, [c("狀態 |&*^%$#@| select", "select:does_not_equal", "已結束")], 20)
    EV2 = ev2["id"]
    ev2_mods, EJ2 = agg_json("災害（各所現況）", EV2, {"id": f"{{{{{EV2}.id}}}}", "name": sp(EV2, "災害名稱", "[].plain_text")})
    sites_flow = [st, *st_mods, ev2, *ev2_mods,
                  respond("回傳各所現況", '{"ok":true,"sites":' + f"{{{{{STJ}.json}}}}" + ',"events":' + f"{{{{{EJ2}.json}}}}" + "}")]

    hq = lambda a: [is_hq + [act(a)]]
    return [
        (flt("不是社會處", [g + [act(a)] for g in not_hq_groups for a in HQ_ACTS]), [
            respond("回傳不是社會處", '{"ok":false,"error":"not_hq"}', "403")]),
        (flt("指揮台資料", hq("hqInit")), init_flow),
        (flt("開設收容所", hq("hqOpen")), open_flow),
        (flt("待核准的申請", hq("hqApps")), apps_flow),
        (flt("核准申請", hq("hqApprove")), approve_flow),
        (flt("不核准申請", hq("hqReject")), reject_flow),
        (flt("各所現況", hq("hqSites")), sites_flow),
        # 社會處看某一所（只能看）：status、load 帶 o
        (flt("社會處看某一所的狀況", [is_hq + [act("status"), has_o]]), status_flow_for(b, respond, W, "{{1.o}}", True, "（社會處）")),
        (flt("社會處看某一所的物資", [is_hq + [act("load"), has_o]]), load_flow_for("{{1.o}}", "（社會處）")),
        (flt("不是社會處（指定收容所）", [on + [act(a), has_o, c(w_role, "text:notequal", HQ)] for a in ("status", "load")]), [
            respond("回傳不是社會處（指定收容所）", '{"ok":false,"error":"not_hq"}', "403")]),
    ]


def build_cleanup():
    """刪除 LINE 上已經不用的圖文選單（維護用；每次執行情境 12 都會多出兩張新選單，舊的不會自動刪除）。
    目前使用中的兩張（預設的一般選單、別名指到的加乘選單）會保留，其餘逐張刪除；刪除選單時 LINE 會自動解除綁定。"""
    line_meta = [{"name": "__IMTCONN__", "type": "account:line2", "label": "Connection", "required": True}]

    def call(mid, url, method, name, x, **extra):
        return {"id": mid, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                "mapper": {"url": url, "method": method, "headers": []},
                "metadata": {"designer": {"x": x, "y": 0, "name": name}, "parameters": line_meta}, **extra}
    flow = [
        call(1, "/v2/bot/richmenu/list", "GET", "列出所有圖文選單", 0),
        call(2, f"/v2/bot/richmenu/alias/{MENU_ALIAS}", "GET", "目前的加乘選單（保留）", 300),
        call(3, "/v2/bot/user/all/richmenu", "GET", "目前的一般選單（保留）", 600),
        call(7, f"/v2/bot/richmenu/alias/{HQ_ALIAS}", "GET", "目前的社會處選單（保留）", 750),
        {"id": 4, "module": "builtin:BasicFeeder", "version": 1, "mapper": {"array": "{{1.body.richmenus}}"},
         "metadata": {"designer": {"x": 900, "y": 0, "name": "逐張檢查"}}},
        call(5, "/v2/bot/richmenu/{{4.richMenuId}}", "DELETE", "刪除舊選單", 1200,
             filter=flt("不是目前使用中的三張", [[c("{{4.richMenuId}}", "text:notequal", "{{2.body.richMenuId}}"),
                                              c("{{4.richMenuId}}", "text:notequal", "{{3.body.richMenuId}}"),
                                              c("{{4.richMenuId}}", "text:notequal", "{{7.body.richMenuId}}")]]),
             onerror=[{"id": 6, "module": "builtin:Ignore", "version": 1, "mapper": None,
                       "metadata": {"designer": {"x": 1500, "y": 0}}}]),
    ]
    return blueprint("90 清理舊圖文選單（保留使用中的三張）", flow, instant=False)


def blueprint(name, flow, instant):
    return {"name": name, "flow": flow, "metadata": {
        "instant": instant, "version": 1, "designer": {"orphans": []},
        "scenario": {"dlq": True, "slots": None, "dataloss": False, "maxErrors": 3, "autoCommit": True,
                     "roundtrips": 1, "sequential": False, "confidential": False,
                     "freshVariables": False, "autoCommitTriggerLast": True}}}


def main():
    out = ROOT / "make" / ("example" if EXAMPLE else ACCOUNT)
    out.mkdir(parents=True, exist_ok=True)
    for fname, bp in (("11_LINE訊息_第一版.blueprint.json", build_main()),
                      ("12_建立圖文選單.blueprint.json", build_menu()),
                      ("13_物資API.blueprint.json", build_supply_api()),
                      ("90_清理舊圖文選單.blueprint.json", build_cleanup())):
        p = out / fname
        p.write_text(json.dumps(bp, ensure_ascii=False, indent=1), encoding="utf-8")
        print(fname, p.stat().st_size)


if __name__ == "__main__":
    main()
