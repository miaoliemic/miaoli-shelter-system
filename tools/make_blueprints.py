"""產生 Make.com 情境藍圖（第一版）。

用法：
  python tools/make_blueprints.py            讀 tools/config.local.json，輸出到 make/（不進版本庫）
  python tools/make_blueprints.py --example  讀 tools/config.example.json，輸出範例到 make/example/

第一次使用：複製 tools/config.example.json 成 tools/config.local.json，填入自己的
Notion data source ID、Make.com 連線編號和 webhook 編號（說明見 docs/部署說明.md）。

規格見 docs/第一版LINE流程.md。藍圖裡不含任何金鑰：
Make.com 只用連線編號呼叫 LINE 和 Notion，金鑰存在 Make.com 裡。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = "--example" in sys.argv
_cfg_path = ROOT / "tools" / ("config.example.json" if EXAMPLE else "config.local.json")
if not _cfg_path.exists():
    sys.exit(f"找不到 {_cfg_path.name}：請先複製 tools/config.example.json 成 tools/config.local.json 並填入設定。")
CFG = json.loads(_cfg_path.read_text(encoding="utf-8"))

# ---- 環境設定（來自 config） ----
HOOK = CFG["make"]["line_webhook_id"]
CONN_LINE = CFG["make"]["line_connection_id"]
CONN_NOTION = CFG["make"]["notion_connection_id"]
MENU_ALIAS = CFG["line"]["staff_menu_alias"]
MENU_IMAGE_BLOCK = CFG["notion"]["richmenu_image_block_id"]

_ds = CFG["notion"]["data_sources"]
DS_STAFF = _ds["工作人員名冊"]
DS_OPEN = _ds["收容所開設"]
DS_ATT = _ds["出勤紀錄"]
DS_LOG = _ds["現場日誌"]
DS_TAG = _ds["號碼牌"]
DS_RES = _ds["收容登記"]
DS_IO = _ds["進出紀錄"]

MGR = "管理者（收容所負責人）"
ROLES_CHECKIN = f"{MGR},門禁組"
ROLES_GATE = f"{MGR},門禁組,志工"

# ---- 常用運算式 ----
T = "{{1.events[1].message.text}}"
U = "{{1.events[1].source.userId}}"
RT = "{{1.events[1].replyToken}}"
S = 2  # 查身分模組


def sp(mod, prop, suffix=""):
    return "{{" + f"{mod}.properties_value.`{prop}`{suffix}" + "}}"


NAME = sp(S, "姓名", "[].plain_text")
ROLE = sp(S, "角色", ".name")
DUTY_V = sp(S, "簽到狀態", ".name")
EN_V = sp(S, "啟用中")
TMP = sp(S, "對話暫存", "[].plain_text")
MY_OPEN = sp(S, "派駐開設", "[].id")


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
            mapper["body"] = json.dumps(body, ensure_ascii=False)
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

    def quick(self, name, text, items, f=None):
        """items: [(按鈕文字, 送出的文字)]"""
        qr = [{"type": "action", "action": {"type": "message", "label": lb[:20], "text": tx}} for lb, tx in items]
        body = {"replyToken": RT, "messages": [{"type": "text", "text": text, "quickReply": {"items": qr}}]}
        return self.line_api(name, "/v2/bot/message/reply", body=body, f=f)

    def router(self, name, routes):
        """routes: [(filter, [modules...])]；filter 放在每條路線的第一個模組上。"""
        mid = self.nid()
        rs = []
        for f, mods in routes:
            mods = [dict(m) for m in mods]
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


def build_main():
    b = B()
    routes = []

    # ---------- R1 簽到 ----------
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
                f_text("對話暫存", "")]),
            b.reply("回覆簽到成功", f"✅ {NAME} 已在【{o_name}】簽到。\n開設狀態：{o_stat}\n工作人員功能在下方選單最後一列。"),
            b.line_api("取得加乘選單 ID", f"/v2/bot/richmenu/alias/{MENU_ALIAS}", method="GET",
                       f=flt("工作人員才換選單", [[c(sp(S, "身分類別", ".name"), "text:equal", "工作人員")]])),
        ]),
        (flt("已在班", [[EXIST, EN, DUTY, o_ok]]), [
            b.reply("回覆已在班", f"{NAME} 您已在班中，不用重複簽到。要下班請按「我要簽退」。")]),
        (flt("簽到碼無效", [[EXIST, EN, c(f"{{{{{O}.id}}}}", "notexist")], [EXIST, EN, NDUTY, c(o_stat, "text:equal", "已撤收")]]), [
            b.reply("回覆簽到碼無效", "⚠ 此簽到碼無效，或該收容所已撤收。請洽現場負責人。")]),
        (flt("不是工作人員", [[NOTEXIST], [NEN]]), [
            b.reply("回覆請先開通", "您還不是已開通的工作人員。請按選單「工作人員專區」申請開通，由管理者審核後才能簽到。")]),
    ])
    # 換選單需要上一步取得的 ID：接在簽到成功路線最後
    link = b.line_api("切換成加乘選單", "/v2/bot/user/" + U + "/richmenu/{{" + str(r1["routes"][0]["flow"][-1]["id"]) + ".body.richMenuId}}")
    r1["routes"][0]["flow"].append(link)
    routes.append((flt("R1 簽到", [[c(T, "text:contain", "SIGN-")]]), [op, r1]))

    # ---------- R2 簽退 ----------
    att = b.search("找未簽退的出勤", DS_ATT, [
        c("人員 |&*^%$#@| relation", "relation:contains", f"{{{{{S}.id}}}}"),
        c("簽退時間 |&*^%$#@| date", "date:is_empty", "true")], sort_created=True)
    r2 = b.router("簽退分流", [
        (flt("可以簽退", [ON]), [
            b.update("名冊改已簽退", DS_STAFF, f"{{{{{S}.id}}}}", [
                f_sel("簽到狀態", "已簽退"), f_sel("選單狀態", "一般"), f_text("對話暫存", "")]),
            b.reply("回覆簽退", f"👋 {NAME} 已簽退，辛苦了！"),
            b.line_api("解除加乘選單", "/v2/bot/user/" + U + "/richmenu", method="DELETE"),
            att,
            b.update("出勤補簽退時間", DS_ATT, f"{{{{{att['id']}.id}}}}", [
                f_now("簽退時間"), f_sel("簽退方式", "自行簽退")],
                f=flt("有找到出勤", [[c(f"{{{{{att['id']}.id}}}}", "exist")]])),
        ]),
        (flt("不在班", DENIED), [b.reply("回覆不在班", "您目前不在班，不需要簽退。")]),
    ])
    routes.append((flt("R2 簽退", [[c(T, "text:equal", "簽退")], [c(T, "text:equal", "我要簽退")]]), [r2]))

    # ---------- R3 整備回報 ----------
    items = ["場地清潔", "水電設備", "安全檢查", "寢具", "醫療物資", "其他"]
    r3a = b.router("整備選單分流", [
        (flt("在班", [ON]), [b.quick("選整備項目", "要回報哪一項整備？", [(i, f"整備：{i}") for i in items])]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到", "請先掃服務台的簽到 QR，簽到後才能回報。")]),
    ])
    routes.append((flt("R3a 整備回報", [[c(T, "text:equal", "整備回報")]]), [r3a]))

    r3b = b.router("整備項目分流", [
        (flt("在班", [ON]), [b.quick("選完成或有問題", f"{T}：狀況如何？", [("✅ 已完成", f"{T}｜已完成"), ("⚠ 有問題", f"{T}｜有問題")])]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到", "請先簽到後再回報。")]),
    ])
    routes.append((flt("R3b 整備項目", [[c(T, "text:contain", "整備："), c(T, "text:notcontain", "｜")]]), [r3b]))

    item = '{{replace(first(split(1.events[1].message.text; "｜")); "整備："; "")}}'
    st = '{{last(split(1.events[1].message.text; "｜"))}}'
    done = 'last(split(1.events[1].message.text; "｜")) = "已完成"'
    r3c = b.router("整備結果分流", [
        (flt("在班", [ON]), [
            b.create("新增整備日誌", DS_LOG, [
                f_title("日誌標題", f"整備回報：{item}{st}"),
                f_sel("日誌類別", "整備回報"), f_sel("整備項目", item),
                f_sel("處理進度", '{{if(' + done + '; "已解決"; "待處理")}}'),
                f_sel("嚴重程度", '{{if(' + done + '; "低"; "中")}}'),
                f_rel("收容所開設", MY_OPEN), f_rel("回報人", f"{{{{{S}.id}}}}"),
                f_now("發生時間"), f_sel("來源", "LINE 回報")]),
            b.quick("回覆已記錄", f"已記錄：{T}。還有其他項目嗎？", [(i, f"整備：{i}") for i in items]),
        ]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到", "請先簽到後再回報。")]),
    ])
    routes.append((flt("R3c 整備結果", [[c(T, "text:contain", "整備："), c(T, "text:contain", "｜")]]), [r3c]))

    # ---------- R4 整備完成 ----------
    g = b.get("讀所在開設", MY_OPEN)
    G = g["id"]
    g_stat = sp(G, "開設狀態", ".name")
    r4in = b.router("開設狀態分流", [
        (flt("整備中", [[c(g_stat, "text:equal", "整備中")]]), [
            b.update("開設改待核准", DS_OPEN, f"{{{{{G}.id}}}}", [f_sel("開設狀態", "待核准")]),
            b.create("新增申請日誌", DS_LOG, [
                f_title("日誌標題", "整備完成，申請開放進駐"), f_sel("日誌類別", "整備回報"),
                f_sel("處理進度", "待處理"), f_sel("嚴重程度", "中"), f_chk("需回報社會處", True),
                f_rel("收容所開設", f"{{{{{G}.id}}}}"), f_rel("回報人", f"{{{{{S}.id}}}}"),
                f_now("發生時間"), f_sel("來源", "LINE 回報")]),
            b.reply("回覆已送出", "📨 已送出「整備完成」，等社會處核准後就可以開始報到。\n可以按「查詢狀況」確認是否已核准。"),
        ]),
        (flt("不是整備中", [[c(g_stat, "text:notequal", "整備中")]]), [
            b.reply("回覆狀態", f"目前狀態是「{g_stat}」，不需要再送出整備完成。")]),
    ])
    r4 = b.router("整備完成權限", [
        (flt("負責人在班", [ON + [c(ROLE, "text:contain", "管理者")]]), [g, r4in]),
        (flt("沒有權限", DENIED + [[c(ROLE, "text:notcontain", "管理者")]]), [
            b.reply("回覆沒有權限", "只有在班中的收容所負責人可以送出「整備完成」。")]),
    ])
    routes.append((flt("R4 整備完成", [[c(T, "text:equal", "整備完成")]]), [r4]))

    # ---------- R5 掃號碼牌 ----------
    # 不用引號：這個值會放進 quickReply 的 JSON 字串裡
    tcode = '{{substring(1.events[1].message.text; 3)}}'
    tag = b.search("找號碼牌", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", tcode)])
    TG = tag["id"]
    t_stat = sp(TG, "狀態", ".name")
    t_ok = c(f"{{{{{TG}.id}}}}", "exist")
    g5 = b.get("讀所在開設（報到）", MY_OPEN)
    G5 = g5["id"]
    g5_stat = sp(G5, "開設狀態", ".name")
    r5_checkin = b.router("可否報到", [
        (flt("開設中", [[c(g5_stat, "text:equal", "開設中")]]), [
            b.update("暫存報到", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", f"報到|{tcode}")]),
            b.reply("請輸入姓名", f"🆕 號碼牌 {tcode} 開始報到。\n請輸入居民姓名（打「取消」可中斷）："),
        ]),
        (flt("尚未開放", [[c(g5_stat, "text:notequal", "開設中")]]), [
            b.reply("回覆尚未開放", f"本所目前是「{g5_stat}」，社會處核准開放後才能報到。")]),
    ])
    res = b.get("讀綁定的居民", sp(TG, "綁定居民", "[].id"))
    R = res["id"]
    r_stat = sp(R, "在所狀態", ".name")
    r5_move = b.router("依在所狀態給按鈕", [
        (flt("在所", [[c(r_stat, "text:equal", "在所")]]), [
            b.quick("按鈕：外出或離所", f"號碼牌 {tcode}：目前在所", [("外出", f"外出 {tcode}"), ("離所", f"離所 {tcode}")])]),
        (flt("外出或未返", [[c(r_stat, "text:equal", "外出")], [c(r_stat, "text:equal", "未返")]]), [
            b.quick("按鈕：返回或離所", f"號碼牌 {tcode}：目前{r_stat}", [("返回", f"返回 {tcode}"), ("離所", f"離所 {tcode}")])]),
        (flt("已離所", [[c(r_stat, "text:equal", "已離所")]]), [
            b.reply("回覆已離所", f"號碼牌 {tcode} 的居民已離所。")]),
    ])
    r5 = b.router("號碼牌分流", [
        (flt("失效", [[t_ok, c(t_stat, "text:equal", "失效")]]), [
            b.reply("回覆失效", f"⚠ 號碼牌 {tcode} 已失效，請勿放行，並通知現場負責人。")]),
        (flt("空白牌：報到", [[t_ok, c(t_stat, "text:equal", "可用")] + ON + [c(ROLES_CHECKIN, "text:contain", ROLE)]]), [g5, r5_checkin]),
        (flt("使用中：進出", [[t_ok, c(t_stat, "text:equal", "使用中")] + ON + [c(ROLES_GATE, "text:contain", ROLE)]]), [res, r5_move]),
        (flt("查無此牌", [[c(f"{{{{{TG}.id}}}}", "notexist")]]), [b.reply("回覆查無此牌", f"查無號碼牌 {tcode}，請確認後再試。")]),
        (flt("沒有權限", [
            [t_ok, c(t_stat, "text:notequal", "失效"), NOTEXIST],
            [t_ok, c(t_stat, "text:notequal", "失效"), NEN],
            [t_ok, c(t_stat, "text:notequal", "失效"), NDUTY],
            [t_ok, c(t_stat, "text:equal", "可用"), c(ROLES_CHECKIN, "text:notcontain", ROLE)],
            [t_ok, c(t_stat, "text:equal", "使用中"), c(ROLES_GATE, "text:notcontain", ROLE)]]), [
            b.reply("回覆請洽工作人員", "請洽現場工作人員協助。")]),
    ])
    routes.append((flt("R5 掃號碼牌", [[c(T, "text:contain", "QR MLS-")]]), [tag, r5]))

    # ---------- R6 外出／返回／離所 ----------
    act = '{{first(split(1.events[1].message.text; " "))}}'
    mcode = '{{last(split(1.events[1].message.text; " "))}}'
    tag6 = b.search("找號碼牌（進出）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", mcode)])
    T6 = tag6["id"]
    res6 = b.get("讀居民（進出）", sp(T6, "綁定居民", "[].id"))
    R6 = res6["id"]
    r6_stat = sp(R6, "在所狀態", ".name")
    r6_open = sp(R6, "收容所開設", "[].id")
    r6_name = sp(R6, "姓名", "[].plain_text")
    actv = 'first(split(1.events[1].message.text; " "))'

    def io(kind, extra=()):
        return b.create(f"新增進出紀錄：{kind}", DS_IO, [
            f_title("摘要", f"{mcode} {kind}"), f_sel("類型", kind),
            f_rel("居民", f"{{{{{R6}.id}}}}"), f_rel("號碼牌", f"{{{{{T6}.id}}}}"), f_rel("收容所開設", r6_open),
            f_rel("經手人", f"{{{{{S}.id}}}}"), f_now("時間"), f_sel("來源", "工作人員掃描"), *extra])

    r6in = b.router("進出動作", [
        (flt("外出", [[c("{{" + actv + "}}", "text:equal", "外出"), c(r6_stat, "text:equal", "在所")]]), [
            b.update("居民改外出", DS_RES, f"{{{{{R6}.id}}}}", [
                f_sel("在所狀態", "外出"), f_date("預計返回時間", "{{addHours(now; 3)}}")]),
            io("外出", [f_date("預計返回時間", "{{addHours(now; 3)}}")]),
            b.reply("回覆外出", f"🚶 {mcode} 已登記外出，預計 3 小時內返回。"),
        ]),
        (flt("返回", [[c("{{" + actv + "}}", "text:equal", "返回"), c(r6_stat, "text:equal", "外出")],
                      [c("{{" + actv + "}}", "text:equal", "返回"), c(r6_stat, "text:equal", "未返")]]), [
            b.update("居民改在所", DS_RES, f"{{{{{R6}.id}}}}", [f_sel("在所狀態", "在所")]),
            io("返所"),
            b.reply("回覆返回", f"🏠 {mcode} 已返回。"),
        ]),
        (flt("離所", [[c("{{" + actv + "}}", "text:equal", "離所"), c(r6_stat, "text:notequal", "已離所")]]), [
            b.update("居民改已離所", DS_RES, f"{{{{{R6}.id}}}}", [f_sel("在所狀態", "已離所"), f_now("離所時間")]),
            b.update("號碼牌回收失效", DS_TAG, f"{{{{{T6}.id}}}}", [
                f_sel("狀態", "失效"), f_sel("失效原因", "離所回收"), f_now("失效時間")]),
            io("離所"),
            b.reply("回覆離所", f"✅ {mcode} 已辦理離所，號碼牌已回收。祝平安！"),
        ]),
    ])
    r6 = b.router("進出權限", [
        (flt("可以登記", [ON + [c(ROLES_GATE, "text:contain", ROLE)]]), [tag6, res6, r6in]),
        (flt("沒有權限", DENIED + [[c(ROLES_GATE, "text:notcontain", ROLE)]]), [b.reply("回覆請先簽到", "請先簽到後再登記進出。")]),
    ])
    routes.append((flt("R6 外出返回離所", [[c(T, "text:contain", "MLS-"), c(T, "text:notcontain", "QR MLS-")]]), [r6]))

    # ---------- R5b/c/d 報到的多步驟 ----------
    parts = 'length(split(' + TMP[2:-2] + '; "|"))'
    cmds = ["簽退", "我要簽退", "我要簽到", "整備完成", "查詢狀況", "申請開通", "工作人員專區", "取消"]
    not_cmd = [c(T, "text:notcontain", x) for x in ("SIGN-", "MLS-", "整備", "：")] + [c(T, "text:notequal", x) for x in cmds]
    ages = ["成人", "長者", "兒童", "嬰幼兒"]
    routes.append((flt("R5b 報到：輸入姓名", [[EXIST, EN, c(TMP, "text:contain", "報到|"), c("{{" + parts + "}}", "number:equal", "2"),
                                           c(T, "exist")] + not_cmd]), [
        b.update("暫存加姓名", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", f"{TMP}|{T}")]),
        b.quick("選年齡層", f"{T} 的年齡層？", [(a, f"年齡層：{a}") for a in ages]),
    ]))
    cares = ["無", "高齡者", "身心障礙", "孕婦", "幼童", "特殊醫療需求"]
    routes.append((flt("R5c 報到：年齡層", [[EXIST, EN, c(T, "text:contain", "年齡層："), c("{{" + parts + "}}", "number:equal", "3")]]), [
        b.update("暫存加年齡層", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", f"{TMP}|{T}")]),
        b.quick("選特殊關懷", "需要特殊關懷嗎？", [(x, f"關懷：{x}") for x in cares]),
    ]))
    rc = 'get(split(' + TMP[2:-2] + '; "|"); {n})'
    r_code = "{{" + rc.format(n=2) + "}}"
    r_name = "{{" + rc.format(n=3) + "}}"
    r_age = '{{replace(' + rc.format(n=4) + '; "年齡層："; "")}}'
    care = '{{replace(1.events[1].message.text; "關懷："; "")}}'
    tag7 = b.search("找號碼牌（報到）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", r_code)])
    T7 = tag7["id"]
    newres = b.create("新增收容登記", DS_RES, [
        f_title("姓名", r_name), f_sel("年齡層", r_age), f_sel("在所狀態", "在所"), f_now("報到時間"),
        f_rel("收容所開設", MY_OPEN), f_rel("號碼牌", f"{{{{{T7}.id}}}}"),
        f_chk("是否在名冊", False), f_sel("查核狀態", "不需查核")])
    NR = newres["id"]
    routes.append((flt("R5d 報到：特殊關懷→完成", [[EXIST, EN, c(T, "text:contain", "關懷："), c("{{" + parts + "}}", "number:equal", "4")]]), [
        tag7, newres,
        b.update("號碼牌改使用中", DS_TAG, f"{{{{{T7}.id}}}}", [f_sel("狀態", "使用中"), f_rel("綁定居民", f"{{{{{NR}.id}}}}")]),
        b.create("新增進出紀錄：報到", DS_IO, [
            f_title("摘要", f"{r_name} 報到"), f_sel("類型", "報到"), f_rel("居民", f"{{{{{NR}.id}}}}"),
            f_rel("號碼牌", f"{{{{{T7}.id}}}}"), f_rel("收容所開設", MY_OPEN), f_rel("經手人", f"{{{{{S}.id}}}}"),
            f_now("時間"), f_sel("來源", "工作人員掃描")]),
        b.update("清空暫存", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", "")]),
        b.reply("回覆報到完成", f"✅ {r_name}（{r_age}）報到完成，號碼牌 {r_code}。\n特殊關懷：{care}\n請掃下一個號碼牌繼續報到。"),
        b.update("寫入特殊關懷", DS_RES, f"{{{{{NR}.id}}}}", [f_multi("特殊關懷", care)],
                 f=flt("有特殊關懷", [[c(care, "text:notequal", "無")]])),
    ]))

    # ---------- R7 查詢狀況 ----------
    g7 = b.get("讀所在開設（查詢）", MY_OPEN)
    G7 = g7["id"]

    def num(p):
        return sp(G7, p, ".number")
    r7 = b.router("查詢權限", [
        (flt("在班", [ON]), [g7, b.reply("回覆狀況", (
            f"📊 {sp(G7, '開設名稱', '[].plain_text')}\n"
            f"狀態：{sp(G7, '開設狀態', '.name')}　燈號：{sp(G7, '狀況燈號', '.string')}\n"
            f"在所 {num('在所人數')}／容量 {num('容納人數')}\n"
            f"外出 {num('外出人數')}　未返 {num('未返人數')}\n"
            f"需關懷 {num('需關懷人數')}\n"
            f"未結日誌 {num('未結日誌數')}（緊急 {num('緊急未結數')}）\n"
            f"缺工作人員 {sp(G7, '缺工作人員', '.number')}　缺志工 {sp(G7, '缺志工', '.number')}"))]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到", "請先簽到後再查詢本所狀況。")]),
    ])
    routes.append((flt("R7 查詢狀況", [[c(T, "text:equal", "查詢狀況")]]), [r7]))

    # ---------- R8 申請開通 ----------
    prof = b.line_api("取得 LINE 名稱", "/v2/bot/profile/" + U, method="GET")
    P = prof["id"]
    r8 = b.router("申請分流", [
        (flt("新申請", [[NOTEXIST]]), [
            prof,
            b.create("新增名冊（待審）", DS_STAFF, [
                f_title("姓名", f"（待審）{{{{{P}.body.displayName}}}}"), f_text("LINE User ID", U),
                f_text("LINE 顯示名稱", f"{{{{{P}.body.displayName}}}}"), f_now("申請時間"),
                f_chk("啟用中", False), f_sel("簽到狀態", "已簽退"), f_sel("選單狀態", "一般")]),
            b.reply("回覆已申請", "📝 已送出工作人員開通申請，請等候管理者審核。"),
        ]),
        (flt("已在名冊", [[EXIST]]), [b.reply("回覆已申請過", f"{NAME} 您已在名冊中。{{{{if({EN_V[2:-2]}; \"已開通，可以直接簽到。\"; \"申請審核中，請稍候。\")}}}}")]),
    ])
    routes.append((flt("R8 申請開通", [[c(T, "text:equal", "申請開通")]]), [r8]))

    # ---------- R9 工作人員專區：依在班狀態顯示「我要簽到」或「我要簽退」 ----------
    r9 = b.router("專區分流", [
        (flt("在班", [[EXIST, EN, DUTY]]), [b.quick("專區按鈕（在班）", f"{NAME}（{ROLE}）您好，目前上班中。", [
            ("整備回報", "整備回報"), ("整備完成", "整備完成"), ("查詢狀況", "查詢狀況"), ("我要簽退", "我要簽退")])]),
        (flt("未在班", [[EXIST, EN, NDUTY]]), [b.quick("專區按鈕（未在班）", f"{NAME}（{ROLE}）您好，目前未上班。到現場後請先簽到。", [
            ("我要簽到", "我要簽到")])]),
        (flt("審核中", [[EXIST, NEN]]), [b.reply("回覆審核中", "您的開通申請審核中，請稍候。")]),
        (flt("未申請", [[NOTEXIST]]), [b.quick("申請按鈕", "工作人員專區：開通後才能使用工作人員功能。", [("申請開通", "申請開通")])]),
    ])
    routes.append((flt("R9 工作人員專區", [[c(T, "text:equal", "工作人員專區")]]), [r9]))

    # ---------- R11 我要簽到：引導掃服務台 QR ----------
    r11 = b.router("我要簽到分流", [
        (flt("未在班", [[EXIST, EN, NDUTY]]), [b.reply("回覆掃碼方式",
            "請掃服務台張貼的「工作人員簽到」QR Code。\n點下面的連結會直接打開 LINE 掃描器：\nhttps://line.me/R/nv/QRCode")]),
        (flt("已在班", [[EXIST, EN, DUTY]]), [b.reply("回覆已在班（我要簽到）", f"{NAME} 您已在班中。要下班請按「我要簽退」。")]),
        (flt("不是工作人員", [[NOTEXIST], [NEN]]), [b.reply("回覆請先開通（我要簽到）", "請先按「工作人員專區」申請開通，審核通過後才能簽到。")]),
    ])
    routes.append((flt("R11 我要簽到", [[c(T, "text:equal", "我要簽到")]]), [r11]))

    # ---------- R10 取消 ----------
    routes.append((flt("R10 取消", [[c(T, "text:equal", "取消"), EXIST]]), [
        b.update("清空暫存（取消）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", "")]),
        b.reply("回覆已取消", "已取消。"),
    ]))

    # ---------- R99 其他 ----------
    base_not = [c(T, "text:notcontain", x) for x in ("SIGN-", "MLS-", "整備", "年齡層：", "關懷：")] + \
               [c(T, "text:notequal", x) for x in ("簽退", "我要簽退", "我要簽到", "查詢狀況", "申請開通", "工作人員專區", "取消")]
    routes.append((flt("R99 其他訊息", [base_not + [c(TMP, "text:notcontain", "報到|")],
                                       base_not + [c("{{" + parts + "}}", "number:notequal", "2")]]), [
        b.reply("回覆引導", "您好，這裡是苗栗避難收容所系統。\n請點下方選單使用功能；工作人員請按「工作人員專區」。")]))

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
    """一次性：建立加乘選單並設定別名。
    圖片放在 Notion「系統素材：LINE 圖文選單」頁（圖片區塊 MENU_IMAGE_BLOCK），
    每次執行都向 Notion 取得新的下載網址（Notion 檔案網址幾分鐘就過期）。"""
    W, ROW = 2500, 562
    cw = [0, 833, 1667, 2500]
    areas = []
    public = ["常見問題", "最新公告", "物資領取", "我需要協助", "緊急聯絡", "工作人員專區"]
    for i, t in enumerate(public):
        r, col = divmod(i, 3)
        areas.append({"bounds": {"x": cw[col], "y": r * ROW, "width": cw[col + 1] - cw[col], "height": ROW},
                      "action": {"type": "message", "text": t}})
    sw = 625
    staff = [("uri", "https://line.me/R/nv/QRCode"), ("message", "整備回報"), ("message", "查詢狀況"), ("message", "簽退")]
    for i, (typ, v) in enumerate(staff):
        a = {"type": typ}
        a["uri" if typ == "uri" else "text"] = v
        areas.append({"bounds": {"x": i * sw, "y": 2 * ROW, "width": sw, "height": 1686 - 2 * ROW}, "action": a})
    line_meta = [{"name": "__IMTCONN__", "type": "account:line2", "label": "Connection", "required": True}]
    flow = [
        {"id": 4, "module": "notion:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_NOTION},
         "mapper": {"url": f"/v1/blocks/{MENU_IMAGE_BLOCK}", "method": "GET", "version": "2022-06-28", "headers": []},
         "metadata": {"designer": {"x": -300, "y": 0, "name": "取得圖片網址（Notion 系統素材頁）"},
                      "parameters": [{"name": "__IMTCONN__", "type": "account:notion2,notion3", "label": "Connection", "required": True}]}},
        {"id": 1, "module": "http:ActionGetFile", "version": 3, "parameters": {"handleErrors": False},
         "mapper": {"url": "{{4.body.image.file.url}}", "method": "get", "serializeUrl": False, "shareCookies": False},
         "metadata": {"designer": {"x": 0, "y": 0, "name": "下載選單圖片"}}},
        {"id": 2, "module": "line:createARichMenu", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
         "mapper": {"name": "staff-plus", "chatBarText": "選單", "selected": False, "height": 1686,
                    "areas": areas, "data": "{{1.data}}", "filename": "staff_plus.png"},
         "metadata": {"designer": {"x": 300, "y": 0, "name": "建立加乘選單"}, "parameters": line_meta}},
        # 別名：路由同時試「更新」和「新建」，各自出錯就略過。
        # 已有別名時更新成功、新建失敗；第一次部署時相反。
        {"id": 8, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
         "metadata": {"designer": {"x": 600, "y": 0, "name": "設定別名"}},
         "routes": [
             {"flow": [{"id": 3, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                        "mapper": {"url": f"/v2/bot/richmenu/alias/{MENU_ALIAS}", "method": "POST",
                                   "body": json.dumps({"richMenuId": "{{2.richMenuId}}"}),
                                   "headers": [{"key": "Content-Type", "value": "application/json"}]},
                        "metadata": {"designer": {"x": 900, "y": -150, "name": f"更新別名 {MENU_ALIAS}"}, "parameters": line_meta},
                        "onerror": [{"id": 6, "module": "builtin:Ignore", "version": 1, "mapper": None,
                                     "metadata": {"designer": {"x": 1200, "y": -150}}}]}]},
             {"flow": [{"id": 5, "module": "line:makeApiCall", "version": 1, "parameters": {"__IMTCONN__": CONN_LINE},
                        "mapper": {"url": "/v2/bot/richmenu/alias", "method": "POST",
                                   "body": json.dumps({"richMenuAliasId": MENU_ALIAS, "richMenuId": "{{2.richMenuId}}"}),
                                   "headers": [{"key": "Content-Type", "value": "application/json"}]},
                        "metadata": {"designer": {"x": 900, "y": 150, "name": f"新建別名 {MENU_ALIAS}"}, "parameters": line_meta},
                        "onerror": [{"id": 7, "module": "builtin:Ignore", "version": 1, "mapper": None,
                                     "metadata": {"designer": {"x": 1200, "y": 150}}}]}]},
         ]},
    ]
    return blueprint("12 建立加乘選單（一次性）", flow, instant=False)


def blueprint(name, flow, instant):
    return {"name": name, "flow": flow, "metadata": {
        "instant": instant, "version": 1, "designer": {"orphans": []},
        "scenario": {"dlq": True, "slots": None, "dataloss": False, "maxErrors": 3, "autoCommit": True,
                     "roundtrips": 1, "sequential": False, "confidential": False,
                     "freshVariables": False, "autoCommitTriggerLast": True}}}


def main():
    out = ROOT / "make" / ("example" if EXAMPLE else "")
    out.mkdir(parents=True, exist_ok=True)
    for fname, bp in (("11_LINE訊息_第一版.blueprint.json", build_main()),
                      ("12_建立加乘選單.blueprint.json", build_menu())):
        p = out / fname
        p.write_text(json.dumps(bp, ensure_ascii=False, indent=1), encoding="utf-8")
        print(fname, p.stat().st_size)


if __name__ == "__main__":
    main()
