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
import re
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
MENU_PAGE = CFG["notion"]["richmenu_page_id"]

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

    def quick(self, name, text, items, f=None):
        """items: [(按鈕文字, 送出的文字)]"""
        # LINE 按鈕文字上限 20 字；含運算式的按鈕不能截斷，由內容本身保持夠短（例：單位）
        qr = [{"type": "action", "action": {"type": "message", "label": lb if "{{" in lb else lb[:20], "text": tx}}
              for lb, tx in items]
        body = {"replyToken": RT, "messages": [{"type": "text", "text": text, "quickReply": {"items": qr}}]}
        return self.line_api(name, "/v2/bot/message/reply", body=body, f=f)

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
    # 掃簽到 QR：沒在班就直接簽到（少一步），在班就問要做什麼；兩種都附同一組常用功能按鈕
    DUTY_BTNS = [("本所狀況", "本所狀況"), ("現場回報", "現場回報"), ("物資", "物資"), ("簽退", "簽退")]
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
            b.quick("回覆簽到成功", f"✅ {NAME} 已在【{o_name}】簽到。\n開設狀態：{o_stat}\n要做什麼？也可以用下方選單最後一列。", DUTY_BTNS),
            b.line_api("取得加乘選單 ID", f"/v2/bot/richmenu/alias/{MENU_ALIAS}", method="GET",
                       f=flt("工作人員才換選單", [[c(sp(S, "身分類別", ".name"), "text:equal", "工作人員")]])),
        ]),
        (flt("已在班", [[EXIST, EN, DUTY, o_ok]]), [
            b.quick("回覆已在班", f"{NAME} 您目前在班中，要做什麼？", DUTY_BTNS)]),
        (flt("簽到碼無效", [[EXIST, EN, c(f"{{{{{O}.id}}}}", "notexist")], [EXIST, EN, NDUTY, c(o_stat, "text:equal", "已撤收")]]), [
            b.reply("回覆簽到碼無效", "⚠ 此簽到碼無效，或該收容所已撤收。請洽現場負責人。")]),
        (flt("不是工作人員", [[NOTEXIST], [NEN]]), [
            b.reply("回覆請先開通", "您還不是已開通的工作人員。請按選單最下列的「工作人員」申請開通，由管理者審核後才能簽到。")]),
    ])
    # 換選單需要上一步取得的 ID：接在簽到成功路線最後
    link = b.line_api("切換成加乘選單", "/v2/bot/user/" + U + "/richmenu/{{" + str(r1["routes"][0]["flow"][-1]["id"]) + ".body.richMenuId}}")
    r1["routes"][0]["flow"].append(link)
    routes.append((flt("R1 簽到", [[c(T, "text:contain", "SIGN-")]]), [op, r1]))

    # ---------- R2 簽退 ----------
    # 不在班卻按到簽退：代表名冊和 LINE 選單狀態對不上（例如後台直接改了簽到狀態），順手解除加乘選單讓它自己恢復。
    # 用固定編號接在最後，避免後面所有模組的編號位移；沒有綁選單時 LINE 可能回錯誤，用 Ignore 吃掉。
    NOT_ON_DUTY = "您目前不在班，不需要簽退。下方選單已恢復成一般版。"

    def unlink_menu(mid):
        return {"id": mid, "module": "line:makeApiCall", "version": 1,
                "mapper": {"url": "/v2/bot/user/" + U + "/richmenu", "method": "DELETE", "headers": []},
                "metadata": {"designer": {"x": 1200, "y": 2400 if mid == 203 else 2850, "name": "解除加乘選單（不在班）"}},
                "parameters": {"__IMTCONN__": CONN_LINE},
                "onerror": [{"id": mid + 1, "module": "builtin:Ignore", "version": 1, "mapper": None,
                             "metadata": {"designer": {"x": 1500, "y": 2400 if mid == 203 else 2850}}}]}
    att = b.search("找未簽退的出勤", DS_ATT, [
        c("人員 |&*^%$#@| relation", "relation:contains", f"{{{{{S}.id}}}}"),
        c("簽退時間 |&*^%$#@| date", "date:is_empty", "true")], sort_created=True)
    r2 = b.router("簽退分流", [
        (flt("可以簽退", [ON]), [
            b.update("名冊改已簽退", DS_STAFF, f"{{{{{S}.id}}}}", [
                f_sel("簽到狀態", "已簽退"), f_sel("選單狀態", "一般"), f_text("對話暫存", TMP_CLEAR)]),
            b.reply("回覆簽退", f"👋 {NAME} 已簽退，辛苦了！"),
            b.line_api("解除加乘選單", "/v2/bot/user/" + U + "/richmenu", method="DELETE"),
            att,
            b.update("出勤補簽退時間", DS_ATT, f"{{{{{att['id']}.id}}}}", [
                f_now("簽退時間"), f_sel("簽退方式", "自行簽退")],
                f=flt("有找到出勤", [[c(f"{{{{{att['id']}.id}}}}", "exist")]])),
        ]),
        (flt("不在班", DENIED), [b.reply("回覆不在班", NOT_ON_DUTY), unlink_menu(203)]),
    ])
    routes.append((flt("R2 確定簽退", [[c(T, "text:equal", "確定簽退")]]), [r2]))
    r2c = b.router("簽退確認", [
        (flt("在班", [ON]), [b.quick("問是否簽退", f"{NAME} 確定要簽退（下班）嗎？", [("確定簽退", "確定簽退"), ("取消", "取消")])]),
        (flt("不在班", DENIED), [b.reply("回覆不在班（確認）", NOT_ON_DUTY), unlink_menu(205)]),
    ])
    routes.append((flt("R2c 簽退前確認", [[c(T, "text:equal", "簽退")], [c(T, "text:equal", "我要簽退")]]), [r2c]))

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
    # 「領物資」按鈕只帶號碼牌的後半段：文字含「MLS-」會被 R6 外出返回離所接走
    tcode_short = '{{replace(substring(1.events[1].message.text; 3); "MLS-"; "")}}'
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
            b.quick("按鈕：外出或離所", f"號碼牌 {tcode}：{sp(R, '姓名', '[].plain_text')} 目前在所", [
                ("外出", f"外出 {tcode}"), ("領物資", f"領物資：{tcode_short}"), ("離所", f"離所 {tcode}")])]),
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
    cmds = ["簽退", "確定簽退", "我要簽退", "我要簽到", "整備完成", "查詢狀況", "本所狀況", "未結反映", "申請開通", "工作人員",
            "工作人員專區", "取消", "收容所資訊", "常見問題", "最新公告", "物資領取", "我要反映", "我需要協助", "緊急聯絡",
            "物資", "現場回報", "物資入庫", "物資發放"]
    not_cmd = [c(T, "text:notcontain", x) for x in ("SIGN-", "MLS-", "整備", "：")] + [c(T, "text:notequal", x) for x in cmds] + \
              [c(T, "text:notpattern", SUPPLY_RE)]
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
        b.update("清空暫存", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)]),
        b.reply("回覆報到完成", f"✅ {r_name}（{r_age}）報到完成，號碼牌 {r_code}。\n特殊關懷：{care}\n請掃下一個號碼牌繼續報到。"),
        b.update("寫入特殊關懷", DS_RES, f"{{{{{NR}.id}}}}", [f_multi("特殊關懷", care)],
                 f=flt("有特殊關懷", [[c(care, "text:notequal", "無")]])),
    ]))

    # ---------- R7 本所狀況：先看狀況，再依開設階段跳出該做的事 ----------
    g7 = b.get("讀所在開設（本所狀況）", MY_OPEN)
    G7 = g7["id"]
    g7_stat = sp(G7, "開設狀態", ".name")

    def num(p):
        return sp(G7, p, ".number")
    status_text = (
        f"📊 {sp(G7, '開設名稱', '[].plain_text')}\n"
        f"狀態：{g7_stat}　燈號：{sp(G7, '狀況燈號', '.string')}\n"
        f"在所 {num('在所人數')}／容量 {num('容納人數')}\n"
        f"外出 {num('外出人數')}　未返 {num('未返人數')}\n"
        f"需關懷 {num('需關懷人數')}\n"
        f"未結日誌 {num('未結日誌數')}（緊急 {num('緊急未結數')}）\n"
        f"缺工作人員 {sp(G7, '缺工作人員', '.number')}　缺志工 {sp(G7, '缺志工', '.number')}")
    refresh = ("重新整理", "本所狀況")
    r7in = b.router("依開設階段", [
        (flt("整備中", [[c(g7_stat, "text:equal", "整備中")]]), [
            b.quick("狀況＋整備按鈕", status_text + "\n\n整備階段：請回報整備項目，全部完成後按「整備完成」。",
                    [("整備回報", "整備回報"), ("整備完成", "整備完成"), ("物資", "物資"), refresh])]),
        (flt("待核准", [[c(g7_stat, "text:equal", "待核准")]]), [
            b.quick("狀況（待核准）", status_text + "\n\n已送出整備完成，等社會處核准。", [refresh])]),
        (flt("開設中", [[c(g7_stat, "text:equal", "開設中")]]), [
            b.quick("狀況＋營運按鈕", status_text, [("現場回報", "現場回報"), ("物資", "物資"), ("未結反映", "未結反映"), refresh])]),
        (flt("撤收", [[c(g7_stat, "text:equal", "撤收中")], [c(g7_stat, "text:equal", "已撤收")]]), [
            b.quick("狀況（撤收）", status_text, [refresh])]),
    ])
    r7 = b.router("本所狀況權限", [
        (flt("在班", [ON]), [g7, r7in]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到", "請先簽到後再查看本所狀況。")]),
    ])
    routes.append((flt("R7 本所狀況", [[c(T, "text:equal", "本所狀況")], [c(T, "text:equal", "查詢狀況")]]), [r7]))

    # ---------- R12 未結反映（工作人員）----------
    unres = b.search("找本所未結反映", DS_LOG, [
        c("收容所開設 |&*^%$#@| relation", "relation:contains", MY_OPEN),
        c("日誌類別 |&*^%$#@| select", "select:equals", "居民反映"),
        c("處理進度 |&*^%$#@| select", "select:does_not_equal", "已結案"),
        c("處理進度 |&*^%$#@| select", "select:does_not_equal", "已解決")], sort_created=True)
    unres["mapper"]["limit"] = "10"
    UR = unres["id"]
    unres_agg = b.aggregate("彙整未結反映", UR,
        "・" + sp(UR, "日誌標題", "[].plain_text") + "（" + sp(UR, "嚴重程度", ".name") + "）" + sp(UR, "內容說明", "[].plain_text"))
    r12 = b.router("未結反映權限", [
        (flt("在班", [ON]), [unres, unres_agg, b.reply("回覆未結反映",
            "📝 本所未結的居民反映（最新 10 筆）：\n" + f"{{{{{unres_agg['id']}.text}}}}" + "\n\n處理完請到 Notion 把處理進度改成「已解決」。")]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到（反映）", "請先簽到後再查看。")]),
    ])
    routes.append((flt("R12 未結反映", [[c(T, "text:equal", "未結反映")]]), [r12]))

    # ---------- R30 物資：列出本所品項和目前庫存 ----------
    # 物資品項掛在「收容所」底下（庫存跟著實體倉庫走），所以先讀開設，取得它的收容所。
    # 庫存一律用最小單位（單位欄）計算；有包裝單位的，另外換算成約幾箱。
    def stock_text(mod, stock):
        per = sp(mod, "每包裝數量")[2:-2]
        cond = per + " > 1"
        return (stock + sp(mod, "單位", "[].plain_text")
                + "{{if(" + cond + '; "（約 "; "")}}'
                + "{{if(" + cond + "; floor(" + stock[2:-2] + " / " + per + '); "")}}'
                + "{{if(" + cond + "; " + sp(mod, "包裝單位", "[].plain_text")[2:-2] + '; "")}}'
                + "{{if(" + cond + '; "）"; "")}}')

    usage = "按「入庫」「發放」依序選品項、單位、輸入數量；熟手也可以直接打「品名+數量」入庫、「品名-數量」發放（數量用最小單位）。"
    g30 = b.get("讀所在開設（物資）", MY_OPEN)
    shelter30 = sp(g30["id"], "收容所", "[].id")
    items = b.search("找本所物資品項", DS_ITEM, [c("收容所 |&*^%$#@| relation", "relation:contains", shelter30)])
    items["mapper"]["limit"] = "20"
    I = items["id"]
    i_stock = sp(I, "目前庫存", ".number")
    i_safe = sp(I, "安全庫存")
    items_agg = b.aggregate("彙整物資", I,
        "・" + sp(I, "品名", "[].plain_text") + " " + stock_text(I, i_stock)
        + "{{if(" + i_stock[2:-2] + " <= " + i_safe[2:-2] + '; "　⚠ 低於安全庫存"; "")}}')
    supply_btns = [("入庫", "物資入庫"), ("發放", "物資發放"), ("＋新增品項", "物資：新增品項"), refresh]
    r30 = b.router("物資權限", [
        (flt("在班", [ON]), [g30, items, items_agg, b.quick("回覆物資清單",
            # 彙整結果的分行是真正的換行字元，放進 JSON 字串會不合法（LINE 拒收），要換成 \n 兩個字元
            "📦 本所物資（目前庫存）\n" + f"{{{{replace({items_agg['id']}.text; newline; \"\\n\")}}}}" + "\n\n" + usage,
            supply_btns)]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到（物資）", "請先簽到後再登記物資。")]),
    ])
    routes.append((flt("R30 物資", [[c(T, "text:equal", "物資")]]), [r30]))

    # ---------- R36～R40 選單式物資登記 ----------
    # 按鈕文字一路帶著選好的內容：物資：<入庫|發放>｜<品名>｜<領取人號碼牌或－>｜<單位>
    # 只有「輸入數量」要打字，才把進度存在對話暫存（物資|…）。
    BAR = "｜"
    parts_t = 'length(split(1.events[1].message.text; "｜"))'
    on_duty = ON

    # R36 選品項：物資入庫、物資發放、領物資：<號碼牌後半段>
    kind_a = '{{if(contains(1.events[1].message.text; "入庫"); "入庫"; "發放")}}'
    recip_a = '{{if(contains(1.events[1].message.text; "領物資："); replace(1.events[1].message.text; "領物資："; ""); "－")}}'
    g36 = b.get("讀所在開設（選品項）", MY_OPEN)
    its36 = b.search("找本所品項（選品項）", DS_ITEM, [c("收容所 |&*^%$#@| relation", "relation:contains", sp(g36["id"], "收容所", "[].id"))])
    its36["mapper"]["limit"] = "12"
    I36 = its36["id"]
    nm36 = sp(I36, "品名", "[].plain_text")
    agg36 = b.aggregate("組品項按鈕", I36,
        '{"type": "action", "action": {"type": "message", "label": "{{substring(' + nm36[2:-2] + '; 0; 20)}}", "text": "物資：'
        + kind_a + BAR + nm36 + BAR + recip_a + '"}},')
    newbtn = json.dumps({"type": "action", "action": {"type": "message", "label": "＋新增品項", "text": "物資：新增品項"}}, ensure_ascii=False)
    body36 = ('{"replyToken": "' + RT + '", "messages": [{"type": "text", "text": "要' + kind_a
              + '哪一項？", "quickReply": {"items": [' + f"{{{{{agg36['id']}.text}}}} " + newbtn + ']}}]}')
    routes.append((flt("R36 物資：選品項", [[c(T, "text:equal", "物資入庫")] + on_duty, [c(T, "text:equal", "物資發放")] + on_duty,
                                         [c(T, "text:contain", "領物資：")] + on_duty]), [
        g36, its36, agg36, b.line_api("問哪一項物資", "/v2/bot/message/reply", body=body36)]))

    # R37 選單位：物資：入庫｜飲用水｜－
    nm37 = '{{get(split(1.events[1].message.text; "｜"); 2)}}'
    g37 = b.get("讀所在開設（選單位）", MY_OPEN)
    it37 = b.search("找品項（選單位）", DS_ITEM, [c("品名 |&*^%$#@| title", "text:equals", nm37),
                                             c("收容所 |&*^%$#@| relation", "relation:contains", sp(g37["id"], "收容所", "[].id"))])
    I37 = it37["id"]
    u37 = sp(I37, "單位", "[].plain_text")
    pk37 = sp(I37, "包裝單位", "[].plain_text")
    per37 = sp(I37, "每包裝數量")
    r37 = b.router("有沒有包裝單位", [
        (flt("有包裝單位", [[c(f"{{{{{I37}.id}}}}", "exist"), c(per37, "number:greater", "1")]]), [
            b.quick("問單位（兩種）", f"{nm37}：要用哪個單位？", [
                (u37, T + BAR + u37), (f"{pk37}（{per37}{u37}）", T + BAR + pk37)])]),
        (flt("只有一種單位", [[c(f"{{{{{I37}.id}}}}", "exist"), c(per37, "number:lessorequal", "1")]]), [
            b.quick("問單位（一種）", f"{nm37}：單位是？", [(u37, T + BAR + u37)])]),
        (flt("查無品項", [[c(f"{{{{{I37}.id}}}}", "notexist")]]), [
            b.quick("回覆查無品項（選單位）", f"本所沒有「{nm37}」這個品項。", [("物資", "物資")])]),
    ])
    routes.append((flt("R37 物資：選單位", [[c(T, "text:contain", "物資："), c("{{" + parts_t + "}}", "number:equal", "3")] + on_duty]), [
        g37, it37, r37]))

    # R38 輸入數量：物資：入庫｜飲用水｜－｜箱 → 暫存進度，請對方打數字
    u38 = '{{get(split(1.events[1].message.text; "｜"); 4)}}'
    routes.append((flt("R38 物資：問數量", [[c(T, "text:contain", "物資："), c("{{" + parts_t + "}}", "number:equal", "4")] + on_duty]), [
        b.update("暫存物資進度", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", '物資|{{replace(1.events[1].message.text; "物資："; "")}}')]),
        b.reply("請輸入數量", f"{nm37}要{{{{replace(get(split(1.events[1].message.text; \"｜\"); 1); \"物資：\"; \"\")}}}}多少{u38}？\n請直接打數字，例如 20（打「取消」可中斷）。")]))

    # R39 確認：在「物資|」進度中打了數字 → 列出內容請對方確認
    tmp_s = 'replace(' + TMP[2:-2] + '; "物資|"; "")'
    def tp(n):
        return "{{get(split(" + tmp_s + '; "｜"); ' + str(n) + ")}}"
    recip_note = ("{{if(" + tp(3)[2:-2] + ' = "－"; ""; "，領取人號碼牌 MLS-")}}'
                  "{{if(" + tp(3)[2:-2] + ' = "－"; ""; ' + tp(3)[2:-2] + ")}}")
    routes.append((flt("R39 物資：確認", [[EXIST, EN, c(TMP, "text:contain", "物資|"), c(T, "text:pattern", "^[0-9]+$")]]), [
        b.quick("請確認物資", f"請確認：{tp(1)} {tp(2)} {T}{tp(4)}{recip_note}",
                [("✅ 正確", "物資確認：{{" + tmp_s + "}}" + BAR + T), ("✏️ 取消", "取消")])]))
    routes.append((flt("R39b 物資：數量不是數字", [[EXIST, EN, c(TMP, "text:contain", "物資|"), c(T, "text:notpattern", "^[0-9]+$"),
                                                 c(T, "exist")] + not_cmd]), [
        b.reply("請輸入數字", "請輸入數字，例如 20（打「取消」可中斷）。")]))

    # R40 寫入：物資確認：入庫｜飲用水｜－｜箱｜20
    cs = 'replace(1.events[1].message.text; "物資確認："; "")'
    def cp(n):
        return "{{get(split(" + cs + '; "｜"); ' + str(n) + ")}}"
    k40, n40, rc40, u40 = cp(1), cp(2), cp(3), cp(4)
    q40 = "{{parseNumber(get(split(" + cs + '; "｜"); 5))}}'
    g40 = b.get("讀所在開設（物資寫入）", MY_OPEN)
    it40 = b.search("找品項（物資寫入）", DS_ITEM, [c("品名 |&*^%$#@| title", "text:equals", n40),
                                               c("收容所 |&*^%$#@| relation", "relation:contains", sp(g40["id"], "收容所", "[].id"))])
    I40 = it40["id"]
    bu40 = sp(I40, "單位", "[].plain_text")
    base40 = ("{{if(" + u40[2:-2] + " = " + bu40[2:-2] + "; " + q40[2:-2] + "; " + q40[2:-2] + " * "
              + sp(I40, "每包裝數量")[2:-2] + ")}}")
    conv40 = "{{if(" + u40[2:-2] + " = " + bu40[2:-2] + '; ""; "（＝")}}' + "{{if(" + u40[2:-2] + " = " + bu40[2:-2] + '; ""; ' \
             + base40[2:-2] + ")}}" + "{{if(" + u40[2:-2] + " = " + bu40[2:-2] + '; ""; ' + bu40[2:-2] + ")}}" \
             + "{{if(" + u40[2:-2] + " = " + bu40[2:-2] + '; ""; "）")}}'

    def move_fields(extra=()):
        return [f_title("摘要", f"{n40} {k40} {base40}{bu40}"), f_rel("品項", f"{{{{{I40}.id}}}}"),
                f_rel("收容所開設", MY_OPEN), f_sel("異動類型", k40), {"key": "數量", "type": "number", "value": base40},
                f_rel("經手人", f"{{{{{S}.id}}}}"), f_now("時間"), f_sel("來源", "LINE 表單"),
                f_text("備註", f"LINE 選單：{q40}{u40}")] + list(extra)

    def finish(name, who=""):
        af = b.get(f"讀最新庫存（{name}）", f"{{{{{I40}.id}}}}")
        A = af["id"]
        a_stock = sp(A, "目前庫存", ".number")
        msg = (f"✅ 已登記：{n40} {k40} {q40}{u40}{conv40}{who}\n目前庫存：{stock_text(A, a_stock)}"
               + "{{if(" + a_stock[2:-2] + " <= " + sp(A, "安全庫存")[2:-2] + '; "\n⚠ 已低於安全庫存，請盡快補貨"; "")}}')
        again = '{{if(' + k40[2:-2] + ' = "入庫"; "物資入庫"; "物資發放")}}'
        return [af, b.update(f"清空暫存（{name}）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)]),
                b.quick(f"回覆已登記（{name}）", msg, [("再登記一筆", again), ("物資", "物資")])]

    tag40 = b.search("找領取人號碼牌", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "MLS-" + rc40)])
    TG40 = tag40["id"]
    who40 = b.get("讀領取人", sp(TG40, "綁定居民", "[].id"))
    WH = who40["id"]
    r40 = b.router("有沒有指定領取人", [
        (flt("沒有指定", [[c(rc40, "text:equal", "－")]]), [
            b.create("新增物資異動（無領取人）", DS_MOVE, move_fields())] + finish("無領取人")),
        (flt("指定居民", [[c(rc40, "text:notequal", "－")]]), [
            tag40, who40,
            b.create("新增物資異動（發給居民）", DS_MOVE, move_fields([f_rel("領取人", f"{{{{{WH}.id}}}}"),
                                                              f_text("發放區域", sp(WH, "姓名", "[].plain_text"))]))]
            + finish("發給居民", "\n領取人：" + sp(WH, "姓名", "[].plain_text"))),
    ])
    routes.append((flt("R40 物資：寫入", [[c(T, "text:contain", "物資確認：")] + on_duty]), [g40, it40, r40]))

    # ---------- R41～R43 管理者在 LINE 新增品項 ----------
    units = ["個", "包", "瓶", "盒", "條", "件", "箱", "雙", "片"]
    routes.append((flt("R41 新增品項", [[c(T, "text:equal", "物資：新增品項")]]), [
        b.router("新增品項權限", [
            (flt("在班管理者", [ON + [c(ROLE, "text:contain", "管理者")]]), [
                b.update("暫存新品", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", "新品|")]),
                b.reply("請輸入新品名", "請輸入新品項的名稱，例如：暖暖包（打「取消」可中斷）。")]),
            (flt("不是在班管理者", [[NOTEXIST], [NEN], [NDUTY], [c(ROLE, "text:notcontain", "管理者")]]), [
                b.reply("回覆只有管理者能新增", "只有在班的收容所管理者可以新增品項，請洽管理者。")]),
        ])]))
    routes.append((flt("R42 新增品項：名稱", [[EXIST, EN, c(TMP, "text:equal", "新品|"), c(T, "exist")] + not_cmd]), [
        b.update("暫存新品名稱", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", f"新品|{T}")]),
        b.quick("問新品單位", f"「{T}」的單位是？（庫存用這個單位計算）", [(u, f"新品單位：{u}") for u in units])]))
    nm43 = '{{replace(' + TMP[2:-2] + '; "新品|"; "")}}'
    u43 = '{{replace(1.events[1].message.text; "新品單位："; "")}}'
    g43 = b.get("讀所在開設（新增品項）", MY_OPEN)
    routes.append((flt("R43 新增品項：建立", [[c(T, "text:contain", "新品單位："), c(TMP, "text:contain", "新品|")] + on_duty]), [
        g43,
        b.create("新增物資品項", DS_ITEM, [
            f_title("品名", nm43), f_text("單位", u43), f_text("包裝單位", u43),
            # 數字欄位寫固定值要包成運算式，否則 Make 送出文字 "1"，Notion 會拒收
            {"key": "每包裝數量", "type": "number", "value": "{{1}}"}, {"key": "期初庫存", "type": "number", "value": "{{0}}"},
            {"key": "安全庫存", "type": "number", "value": "{{0}}"}, f_sel("類別", "其他"),
            f_rel("收容所", sp(g43["id"], "收容所", "[].id")), f_text("備註", f"LINE 新增：{NAME}")]),
        b.update("清空暫存（新增品項）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)]),
        b.quick("回覆已新增品項", f"✅ 已新增品項「{nm43}」（單位：{u43}）。要現在入庫嗎？",
                [("現在入庫", f"物資：入庫{BAR}{nm43}{BAR}－"), ("物資", "物資")])]))

    # ---------- R31 物資登記：飲用水+20 → 入庫；飲用水-5 → 發放 ----------
    # 數量一律填正數，增減由異動類型決定（物資異動紀錄的「庫存增減」公式），目前庫存由 Notion 自動算
    # Make 運算式不接受正則字面值（/…/），整個情境會初始化失敗；改用 split 依「+」或「-」切開
    it_sign = "if(contains(" + T[2:-2] + '; "+"); "+"; "-")'
    it_name = "{{trim(get(split(" + T[2:-2] + "; " + it_sign + "); 1))}}"
    it_qty = "{{parseNumber(trim(get(split(" + T[2:-2] + "; " + it_sign + "); 2)))}}"
    it_kind = "{{if(contains(" + T[2:-2] + '; "+"); "入庫"; "發放")}}'
    g31 = b.get("讀所在開設（物資登記）", MY_OPEN)
    shelter31 = sp(g31["id"], "收容所", "[].id")
    item = b.search("找物資品項（登記）", DS_ITEM, [])
    item["mapper"]["filter"] = [   # 品名相符，或別名包含（例：杯麵 → 泡麵）
        [c("品名 |&*^%$#@| title", "text:equals", it_name), c("收容所 |&*^%$#@| relation", "relation:contains", shelter31)],
        [c("別名 |&*^%$#@| rich_text", "text:contains", it_name), c("收容所 |&*^%$#@| relation", "relation:contains", shelter31)]]
    IT = item["id"]
    it_real = sp(IT, "品名", "[].plain_text")
    it_unit = sp(IT, "單位", "[].plain_text")
    move = b.create("新增物資異動紀錄", DS_MOVE, [
        f_title("摘要", f"{it_real} {it_kind} {it_qty}{it_unit}"), f_rel("品項", f"{{{{{IT}.id}}}}"),
        f_rel("收容所開設", MY_OPEN), f_sel("異動類型", it_kind), {"key": "數量", "type": "number", "value": it_qty},
        f_rel("經手人", f"{{{{{S}.id}}}}"), f_now("時間"), f_sel("來源", "LINE 表單")])
    after = b.get("讀物資最新庫存", f"{{{{{IT}.id}}}}")
    AF = after["id"]
    af_stock = sp(AF, "目前庫存", ".number")
    af_safe = sp(AF, "安全庫存")
    r31in = b.router("有沒有這個品項", [
        (flt("找到品項", [[c(f"{{{{{IT}.id}}}}", "exist")]]), [
            move, after,
            b.reply("回覆已登記物資", f"✅ 已登記：{it_real} {it_kind} {it_qty}{it_unit}\n目前庫存：{af_stock}{it_unit}"
                    + "{{if(" + af_stock[2:-2] + " <= " + af_safe[2:-2] + '; "\n⚠ 已低於安全庫存，請盡快補貨"; "")}}')]),
        (flt("沒有這個品項", [[c(f"{{{{{IT}.id}}}}", "notexist")]]), [
            b.quick("回覆查無品項", f"本所沒有「{it_name}」這個品項。請按「物資」看品名，或請社會處在 Notion 新增。", [("物資", "物資")])]),
    ])
    r31 = b.router("物資登記權限", [
        (flt("在班", [ON]), [g31, item, r31in]),
        (flt("不在班", DENIED), [b.reply("回覆請先簽到（物資登記）", "請先簽到後再登記物資。")]),
    ])
    routes.append((flt("R31 物資登記", [[c(T, "text:pattern", SUPPLY_RE), c(T, "text:notcontain", "MLS-"),
                                       c(T, "text:notcontain", "SIGN-")]]), [r31]))

    # ---------- R32～R34 現場回報：選類別 → 選嚴重程度 → 記成現場日誌 ----------
    field_cats = ["緊急事件", "重大事件", "人員相關", "物資相關", "設施環境"]
    levels = ["緊急", "高", "中", "低"]
    routes.append((flt("R32 現場回報", [[c(T, "text:equal", "現場回報")] + ON]), [
        b.quick("現場回報類別", "要回報哪一類事情？", [(x, f"回報：{x}") for x in field_cats])]))
    routes.append((flt("R33 回報：嚴重程度", [[c(T, "text:contain", "回報："), c(T, "text:notcontain", "｜")] + ON]), [
        b.quick("現場回報嚴重程度", f"{T}：嚴重程度？\n（緊急：需要立即處理，總覽燈號會變紅）",
                [(x, f"{T}｜{x}") for x in levels])]))
    f_cat = '{{replace(first(split(1.events[1].message.text; "｜")); "回報："; "")}}'
    f_lv = '{{last(split(1.events[1].message.text; "｜"))}}'
    f_urgent = 'last(split(1.events[1].message.text; "｜")) = "緊急"'
    new_log = b.create("新增現場日誌", DS_LOG, [
        f_title("日誌標題", f"現場回報：{f_cat}（{f_lv}）"), f_sel("日誌類別", f_cat), f_sel("嚴重程度", f_lv),
        f_sel("處理進度", "待處理"), f_rel("收容所開設", MY_OPEN), f_rel("回報人", f"{{{{{S}.id}}}}"),
        f_text("反映者 LINE ID", U), f_now("發生時間"), f_sel("來源", "LINE 回報"),
        f_chk("需回報社會處", '{{if(' + f_urgent + '; true; if(' + f'{f_lv[2:-2]} = "高"' + '; true; false))}}')])
    # 記住剛建立的日誌，下一句一般文字直接當補充說明（不用打「補充：」），見 R34b
    routes.append((flt("R34 回報：送出", [[c(T, "text:contain", "回報："), c(T, "text:contain", "｜")] + ON]), [
        new_log,
        b.update("暫存待補充的日誌", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", f"補充|{{{{{new_log['id']}.id}}}}")]),
        b.reply("回覆已記錄現場回報", f"📋 已記錄現場回報：{f_cat}（{f_lv}）。\n請直接輸入狀況說明，例如：2 樓廁所漏水（打「取消」可略過）。"
                + '{{if(' + f_urgent + '; "\n🔴 已列為緊急，總覽燈號會變紅。請同時電話通報社會處。"; "")}}')]))

    # ---------- R34b 現場回報後的下一句文字 → 寫進那筆日誌的內容說明 ----------
    # 不能沿用 not_cmd：它排除含「：」的文字，但說明裡常有冒號（例如「時間：下午三點」）
    free_text = [c(T, "exist")] + [c(T, "text:notcontain", x) for x in (
        "SIGN-", "MLS-", "回報：", "反映：", "補充：", "資訊：", "物資：", "物資確認：", "新品單位：", "年齡層：", "關懷：", "整備：")] + \
        [c(T, "text:notequal", x) for x in cmds] + [c(T, "text:notpattern", SUPPLY_RE)]
    log34 = b.get("讀待補充的日誌", '{{replace(' + TMP[2:-2] + '; "補充|"; "")}}')
    L34 = log34["id"]
    routes.append((flt("R34b 回報：補充說明", [[EXIST, EN, c(TMP, "text:contain", "補充|")] + free_text]), [
        log34,
        b.update("寫入現場回報說明", DS_LOG, f"{{{{{L34}.id}}}}", [f_text("內容說明", sp(L34, "內容說明", "[].plain_text") + f"\n{T}")]),
        b.update("清空暫存（補充完成）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)]),
        b.reply("回覆已補充現場回報", "✅ 已補充到「" + sp(L34, "日誌標題", "[].plain_text") + "」。\n還要補充的話，請輸入「補充：」加上內容。")]))
    is_report = [c(T, "text:equal", "現場回報")], [c(T, "text:contain", "回報：")]
    routes.append((flt("R35 現場回報：不在班", [t + d for t in is_report for d in DENIED]), [
        b.reply("回覆請先簽到（現場回報）", "請先簽到後再做現場回報。居民要反映事情，請按「我要反映」。")]))

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
        (flt("在班", [[EXIST, EN, DUTY]]), [b.quick("專區按鈕（在班）", f"{NAME}（{ROLE}）您好，目前上班中。工作功能在下方選單最下列。", [
            ("本所狀況", "本所狀況"), ("我要簽退", "我要簽退")])]),
        (flt("未在班", [[EXIST, EN, NDUTY]]), [b.quick("專區按鈕（未在班）", f"{NAME}（{ROLE}）您好，目前未上班。到現場後請先簽到。", [
            ("我要簽到", "我要簽到")])]),
        (flt("審核中", [[EXIST, NEN]]), [b.reply("回覆審核中", "您的開通申請審核中，請稍候。")]),
        (flt("未申請", [[NOTEXIST]]), [b.quick("申請按鈕", "工作人員專區：開通後才能使用工作人員功能。", [("申請開通", "申請開通")])]),
    ])
    routes.append((flt("R9 工作人員入口", [[c(T, "text:equal", "工作人員")], [c(T, "text:equal", "工作人員專區")]]), [r9]))

    # ---------- R11 我要簽到：引導掃服務台 QR ----------
    r11 = b.router("我要簽到分流", [
        (flt("未在班", [[EXIST, EN, NDUTY]]), [b.reply("回覆掃碼方式",
            "請掃服務台張貼的「工作人員簽到」QR Code。\n點下面的連結會直接打開 LINE 掃描器：\nhttps://line.me/R/nv/QRCode")]),
        (flt("已在班", [[EXIST, EN, DUTY]]), [b.reply("回覆已在班（我要簽到）", f"{NAME} 您已在班中。要下班請按「我要簽退」。")]),
        (flt("不是工作人員", [[NOTEXIST], [NEN]]), [b.reply("回覆請先開通（我要簽到）", "請先按選單最下列的「工作人員」申請開通，審核通過後才能簽到。")]),
    ])
    routes.append((flt("R11 我要簽到", [[c(T, "text:equal", "我要簽到")]]), [r11]))

    # ---------- R20 收容所資訊 ----------
    routes.append((flt("R20 收容所資訊", [[c(T, "text:equal", x)] for x in ("收容所資訊", "常見問題", "最新公告", "物資領取")]), [
        b.quick("資訊選單", "想知道哪一類資訊？", [
            ("最新公告", "資訊：最新公告"), ("用餐與物資", "資訊：用餐與物資"),
            ("生活規定", "資訊：生活規定"), ("開設中的收容所", "資訊：開設中的收容所")])]))

    opens = b.search("找開設中的收容所", DS_OPEN, [c("開設狀態 |&*^%$#@| select", "select:equals", "開設中")])
    opens["mapper"]["limit"] = "20"
    OP = opens["id"]
    opens_agg = b.aggregate("彙整收容所", OP, "・" + sp(OP, "開設名稱", "[].plain_text"))
    routes.append((flt("R21 開設中的收容所", [[c(T, "text:equal", "資訊：開設中的收容所")]]), [
        opens, opens_agg,
        b.reply("回覆收容所清單", "🏠 目前開設中的收容所：\n" + f"{{{{{opens_agg['id']}.text}}}}" + "\n\n地址與交通請洽現場工作人員或縣府服務專線。")]))

    kw = '{{replace(1.events[1].message.text; "資訊："; "")}}'
    qa = b.search("找問答與公告", DS_QA, [
        c("關鍵字 |&*^%$#@| rich_text", "text:contains", kw),
        c("啟用 |&*^%$#@| checkbox", "checkbox:equals", "true")], sort_created=True)
    qa["mapper"]["limit"] = "3"
    QA = qa["id"]
    qa_agg = b.aggregate("彙整問答", QA, "【" + sp(QA, "標題", "[].plain_text") + "】\n" + sp(QA, "內容", "[].plain_text") + "\n")
    routes.append((flt("R22 資訊內容", [[c(T, "text:contain", "資訊："), c(T, "text:notequal", "資訊：開設中的收容所")]]), [
        qa, qa_agg, b.reply("回覆資訊", f"{{{{{qa_agg['id']}.text}}}}")]))

    emerg = b.search("找緊急聯絡資料", DS_QA, [
        c("關鍵字 |&*^%$#@| rich_text", "text:contains", "緊急聯絡"),
        c("啟用 |&*^%$#@| checkbox", "checkbox:equals", "true")], sort_created=True)
    EM = emerg["id"]
    routes.append((flt("R23 緊急聯絡", [[c(T, "text:equal", "緊急聯絡")]]), [
        emerg, b.reply("回覆緊急聯絡", "📞 " + sp(EM, "內容", "[].plain_text"))]))

    # ---------- R24 我要反映：選類別 → 選收容所 → 記成居民反映日誌 ----------
    report_cats = ["身體不適", "缺物資", "環境問題", "其他"]
    routes.append((flt("R24 我要反映", [[c(T, "text:equal", "我要反映")], [c(T, "text:equal", "我需要協助")]]), [
        b.quick("反映類別", "請選擇要反映的事情：", [(x, f"反映：{x}") for x in report_cats])]))

    rop = b.search("找開設中的收容所（反映）", DS_OPEN, [c("開設狀態 |&*^%$#@| select", "select:equals", "開設中")])
    rop["mapper"]["limit"] = "12"
    RO = rop["id"]
    ro_name = sp(RO, "開設名稱", "[].plain_text")
    rop_agg = b.aggregate("組收容所按鈕", RO,
        '{"type": "action", "action": {"type": "message", "label": "{{substring(' + ro_name[2:-2] + '; 0; 20)}}", "text": "'
        + T + ' @ ' + ro_name + '"}},')
    other = json.dumps({"type": "action", "action": {"type": "message", "label": "不在收容所", "text": T + " @ 不在收容所"}}, ensure_ascii=False)
    body = ('{"replyToken": "' + RT + '", "messages": [{"type": "text", "text": "您在哪一個收容所？", "quickReply": {"items": ['
            + f"{{{{{rop_agg['id']}.text}}}} " + other + ']}}]}')
    routes.append((flt("R25 反映：選收容所", [[c(T, "text:contain", "反映："), c(T, "text:notcontain", " @ ")]]), [
        rop, rop_agg, b.line_api("問在哪一所", "/v2/bot/message/reply", body=body)]))

    cat = '{{replace(first(split(1.events[1].message.text; " @ ")); "反映："; "")}}'
    where = '{{last(split(1.events[1].message.text; " @ "))}}'
    sick = 'replace(first(split(1.events[1].message.text; " @ ")); "反映："; "") = "身體不適"'
    rpo = b.search("找反映的收容所", DS_OPEN, [c("開設名稱 |&*^%$#@| title", "text:equals", where)])
    RP = rpo["id"]
    rlog = b.create("新增居民反映日誌", DS_LOG, [
        f_title("日誌標題", f"居民反映：{cat}"), f_sel("日誌類別", "居民反映"), f_sel("協助類別", cat),
        f_sel("嚴重程度", '{{if(' + sick + '; "高"; "中")}}'), f_sel("處理進度", "待處理"),
        f_text("反映者 LINE ID", U), f_now("發生時間"), f_sel("來源", "LINE 回報"),
        f_text("內容說明", f"反映地點：{where}")])
    rlog_open = b.update("反映掛到收容所", DS_LOG, f"{{{{{rlog['id']}.id}}}}", [f_rel("收容所開設", f"{{{{{RP}.id}}}}")],
                         f=flt("有對應的收容所", [[c(f"{{{{{RP}.id}}}}", "exist")]]))
    routes.append((flt("R26 反映：送出", [[c(T, "text:contain", "反映："), c(T, "text:contain", " @ ")]]), [
        rpo, rlog,
        b.reply("回覆已收到反映", f"🙋 已收到您的反映（{cat}），現場工作人員會盡快處理。\n"
                "想補充說明，請輸入「補充：」加上內容，例如：補充：我在 A 區，頭很暈。\n緊急狀況請直接找現場工作人員或撥 119。"),
        rlog_open]))

    # 補充接在這個 LINE 帳號最近一筆日誌：居民反映或工作人員的現場回報都適用
    sup = b.search("找最近一筆反映", DS_LOG, [
        c("反映者 LINE ID |&*^%$#@| rich_text", "text:equals", U)], sort_created=True)
    SU = sup["id"]
    routes.append((flt("R27 反映：補充", [[c(T, "text:contain", "補充：")]]), [
        sup,
        b.update("寫入補充說明", DS_LOG, f"{{{{{SU}.id}}}}", [f_text("內容說明",
            sp(SU, "內容說明", "[].plain_text") + '\n補充：{{replace(1.events[1].message.text; "補充："; "")}}')]),
        b.reply("回覆已補充", "✅ 已補充，謝謝您。"),
        # 工作人員現場回報後若仍打「補充：」，也要清掉 R34 的暫存，免得下一句又被當成補充（放最後：篩選不過會擋住後面的模組）
        b.update("清空暫存（補充：）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)],
                 f=flt("待補充中", [[EXIST, c(TMP, "text:contain", "補充|")]]))]))

    # ---------- R10 取消 ----------
    routes.append((flt("R10 取消", [[c(T, "text:equal", "取消"), EXIST]]), [
        b.update("清空暫存（取消）", DS_STAFF, f"{{{{{S}.id}}}}", [f_text("對話暫存", TMP_CLEAR)]),
        b.reply("回覆已取消", "已取消。"),
    ]))

    # ---------- R99 其他 ----------
    base_not = [c(T, "text:notcontain", x) for x in ("SIGN-", "MLS-", "整備", "年齡層：", "關懷：", "資訊：", "反映：", "補充：", "回報：",
                                                 "物資：", "物資確認：", "新品單位：")] + \
               [c(T, "text:notequal", x) for x in cmds] + [c(T, "text:notpattern", SUPPLY_RE)] + \
               [c(TMP, "text:notcontain", "物資|"), c(TMP, "text:notcontain", "新品|"),
                c(TMP, "text:notcontain", "補充|")]  # 物資、新增品項、現場回報補充進行中由 R39b、R42、R34b 回覆
    routes.append((flt("R99 其他訊息", [base_not + [c(TMP, "text:notcontain", "報到|")],
                                       base_not + [c("{{" + parts + "}}", "number:notequal", "2")]]), [
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

    def msg(t):
        return {"type": "message", "text": t}
    top = [cell(i, 0, msg(t)) for i, t in enumerate(["收容所資訊", "我要反映", "緊急聯絡"])]
    public_bottom = [{"bounds": {"x": 0, "y": ROW, "width": 2500, "height": ROW}, "action": msg("工作人員")}]
    staff_row = [cell(0, 1, {"type": "uri", "uri": "https://line.me/R/nv/QRCode"}), cell(1, 1, msg("本所狀況")), cell(2, 1, msg("簽退"))]

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
         ]},
    ]
    return blueprint("12 建立圖文選單（一般＋加乘）", flow, instant=False)


def build_supply_api():
    """13 物資 API：給 LIFF 物資頁面（liff/supplies/）呼叫的 webhook。
    頁面用 application/x-www-form-urlencoded 送出（瀏覽器不會先送 CORS 預檢），欄位：
      a＝動作（load 讀庫存｜submit 送出登記｜resident 查號碼牌）、t＝LINE ID Token、
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

    verify = {"id": 2, "module": "http:ActionSendData", "version": 3, "parameters": {"handleErrors": True},
              "mapper": {"url": "https://api.line.me/oauth2/v2.1/verify", "method": "post", "serializeUrl": False,
                         "shareCookies": False, "bodyType": "x_www_form_urlencoded", "parseResponse": True,
                         "fields": [{"key": "id_token", "value": "{{1.t}}"}, {"key": "client_id", "value": channel}],
                         "headers": [], "qs": []},
              "metadata": {"designer": {"x": 0, "y": 0, "name": "向 LINE 驗證 ID Token"}}}
    W = 3  # 名冊
    staff = {"id": W, "module": "notion:searchObjects1", "version": 1,
             "mapper": {"limit": "1", "select": "data_source_item", "data_source": DS_STAFF,
                        "filter": [[c("LINE User ID |&*^%$#@| rich_text", "text:equals", "{{2.data.sub}}")]]},
             "metadata": {"designer": {"x": 300, "y": 0, "name": "查名冊"},
                          "parameters": [{"name": "__IMTCONN__", "type": "account:notion2,notion3", "label": "Connection", "required": True}]},
             "parameters": {"__IMTCONN__": CONN_NOTION}}

    auth_ok = c("{{2.statusCode}}", "number:equal", "200")
    w_exist = c(f"{{{{{W}.id}}}}", "exist")
    w_en = c(sp(W, "啟用中"), "boolean:equal", "true")
    w_duty = c(sp(W, "簽到狀態", ".name"), "text:equal", "上班中")
    on = [auth_ok, w_exist, w_en, w_duty]
    act = lambda a: c("{{1.a}}", "text:equal", a)
    w_open = sp(W, "派駐開設", "[].id")
    w_name = sp(W, "姓名", "[].plain_text")
    w_role = sp(W, "角色", ".name")

    # ---- load：本所品項與目前庫存 ----
    g_open = b.get("讀派駐開設", w_open)
    O = g_open["id"]
    items = b.search("找本所物資品項", DS_ITEM, [c("收容所 |&*^%$#@| relation", "relation:contains", sp(O, "收容所", "[].id"))])
    items["mapper"]["limit"] = "100"
    IT = items["id"]
    agg_id = b.nid()
    agg = {"id": agg_id, "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": IT},
           "mapper": {"id": f"{{{{{IT}.id}}}}", "properties_value": f"{{{{{IT}.properties_value}}}}"},
           "metadata": b.meta("彙整品項")}
    js_id = b.nid()
    js = {"id": js_id, "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""},
          "mapper": {"object": f"{{{{{agg_id}.array}}}}"}, "metadata": b.meta("品項轉成 JSON")}
    load_body = ('{"ok":true,"me":{"name":"' + w_name + '","role":"' + w_role + '","opening":"'
                 + sp(O, "開設名稱", "[].plain_text") + '","openingId":"' + f"{{{{{O}.id}}}}" + '"},"items":'
                 + f"{{{{{js_id}.json}}}}" + "}")
    load_flow = [g_open, items, agg, js, respond("回傳庫存", load_body)]

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
        f_rel("領取人", "{{1.g}}")])
    after = b.get("讀最新庫存", f"{{{{{F}.itemId}}}}")
    A = after["id"]
    rows = b.aggregate("彙整結果", F, '{"itemId":"' + f"{{{{{F}.itemId}}}}" + '","stock":'
                       + "{{ifempty(" + sp(A, "目前庫存", ".number")[2:-2] + "; 0)}}}", sep=",")
    submit_flow = [dup, b.router("是否重複送出", [
        (flt("已登記過", [[c(f"{{{{{D}.id}}}}", "exist")]]), [respond("回傳重複", '{"ok":true,"duplicate":true}')]),
        (flt("新的登記", [[c(f"{{{{{D}.id}}}}", "notexist")]]), [
            parse, feed, move, after, rows, respond("回傳登記結果", '{"ok":true,"results":[' + f"{{{{{rows['id']}.text}}}}" + "]}")]),
    ])]

    # ---- resident：號碼牌 → 居民（領物資用） ----
    tg = b.search("找號碼牌（領物資）", DS_TAG, [c("編號 |&*^%$#@| title", "text:equals", "{{1.tag}}")])
    TG = tg["id"]
    who = b.get("讀居民（領物資）", sp(TG, "綁定居民", "[].id"))
    WHO = who["id"]
    resident_body = ('{"ok":true,"found":"{{if(' + f"{TG}.id" + '; "yes"; "no")}}","tagStatus":"' + sp(TG, "狀態", ".name")
                     + '","residentId":"' + f"{{{{{WHO}.id}}}}" + '","name":"' + sp(WHO, "姓名", "[].plain_text")
                     + '","status":"' + sp(WHO, "在所狀態", ".name") + '"}')
    resident_flow = [tg, who, respond("回傳居民", resident_body)]

    flow = [
        {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "parameters": {"hook": hook, "maxResults": 1},
         "mapper": {}, "metadata": {"designer": {"x": -300, "y": 0, "name": "物資頁面送來的請求"}, "parameters": [
             {"name": "hook", "type": "hook:gateway-webhook", "label": "Webhook", "required": True},
             {"name": "maxResults", "type": "number", "label": "Maximum number of results"}]}},
        verify, staff,
        b.router("依身分與動作分流", [
            (flt("身分驗證失敗", [[c("{{2.statusCode}}", "number:notequal", "200")]]), [
                respond("回傳驗證失敗", '{"ok":false,"error":"auth"}', "401")]),
            (flt("不是在班工作人員", [[auth_ok, c(f"{{{{{W}.id}}}}", "notexist")],
                                     [auth_ok, c(sp(W, "啟用中"), "boolean:notequal", "true")],
                                     [auth_ok, c(sp(W, "簽到狀態", ".name"), "text:notequal", "上班中")]]), [
                respond("回傳不在班", '{"ok":false,"error":"not_on_duty"}', "403")]),
            (flt("讀庫存", [on + [act("load")]]), load_flow),
            (flt("送出登記", [on + [act("submit")]]), submit_flow),
            (flt("查號碼牌", [on + [act("resident")]]), resident_flow),
        ]),
    ]
    return blueprint("13 物資 API（LIFF）", flow, instant=True)


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
        {"id": 4, "module": "builtin:BasicFeeder", "version": 1, "mapper": {"array": "{{1.body.richmenus}}"},
         "metadata": {"designer": {"x": 900, "y": 0, "name": "逐張檢查"}}},
        call(5, "/v2/bot/richmenu/{{4.richMenuId}}", "DELETE", "刪除舊選單", 1200,
             filter=flt("不是目前使用中的兩張", [[c("{{4.richMenuId}}", "text:notequal", "{{2.body.richMenuId}}"),
                                              c("{{4.richMenuId}}", "text:notequal", "{{3.body.richMenuId}}")]]),
             onerror=[{"id": 6, "module": "builtin:Ignore", "version": 1, "mapper": None,
                       "metadata": {"designer": {"x": 1500, "y": 0}}}]),
    ]
    return blueprint("90 清理舊圖文選單（保留使用中的兩張）", flow, instant=False)


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
                      ("12_建立圖文選單.blueprint.json", build_menu()),
                      ("13_物資API.blueprint.json", build_supply_api()),
                      ("90_清理舊圖文選單.blueprint.json", build_cleanup())):
        p = out / fname
        p.write_text(json.dumps(bp, ensure_ascii=False, indent=1), encoding="utf-8")
        print(fname, p.stat().st_size)


if __name__ == "__main__":
    main()
