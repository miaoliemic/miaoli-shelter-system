# 用法：python tools/manual_figs.py <截圖資料夾> <輸出資料夾>
# 截圖資料夾需有 manual_shots.mjs 產生的畫面，以及 menu/public.jpg、menu/staff.jpg（Notion「系統素材：LINE 圖文選單」的 LINE 用圖）。字型用 Windows 的微軟正黑體。
"""把手機截圖與 LINE 選單圖排成使用說明用的說明圖（白底、手機外框、步驟說明、箭頭）"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

D = sys.argv[1]            # shots 資料夾
OUT = sys.argv[2]          # 輸出資料夾
FONT_B = "C:/Windows/Fonts/msjhbd.ttc"
FONT_R = "C:/Windows/Fonts/msjh.ttc"
f_cap = ImageFont.truetype(FONT_B, 34)
f_sub = ImageFont.truetype(FONT_R, 27)
f_title = ImageFont.truetype(FONT_B, 40)
f_arrow = ImageFont.truetype(FONT_B, 64)

PW, PH = 380, 822          # 手機畫面寬高（截圖 780×1688 縮小）
PAD = 50
GAP = 110                  # 手機之間（放箭頭）
CAP_H = 120
INK = (30, 42, 54)
SOFT = (91, 101, 115)
LINE = (210, 208, 200)
BLUE = (31, 95, 168)


def rounded(im, r):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], r, fill=255)
    out = Image.new("RGBA", im.size)
    out.paste(im.convert("RGBA"), (0, 0), mask)
    return out


# 內容較短的畫面只保留上方有內容的部分（單位：手機畫面的 CSS 像素，全高 844）
CROP = {"apply": 330, "apply_done": 330, "signout": 350, "signout_done": 310}


def phone(name):
    im = Image.open(f"{D}/{name}.png").convert("RGB")
    if name in CROP:
        im = im.crop((0, 0, im.size[0], round(im.size[1] * CROP[name] / 844)))
    h = round(im.size[1] * PW / im.size[0])
    return rounded(im.resize((PW, h), Image.LANCZOS), 34)


def menu_cell(box, w):
    """從選單圖裁一格，縮成寬 w"""
    src, (x0, y0, x1, y1) = box
    im = Image.open(f"{D}/menu/{src}.jpg").convert("RGB").crop((x0, y0, x1, y1))
    h = round(im.size[1] * w / im.size[0])
    return rounded(im.resize((w, h), Image.LANCZOS), 28)


def paste_card(canvas, im, x, y, ring=False):
    # 淡陰影＋外框
    sh = Image.new("RGBA", (im.size[0] + 40, im.size[1] + 40), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([20, 24, im.size[0] + 20, im.size[1] + 24], 36, fill=(0, 0, 0, 40))
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    canvas.alpha_composite(sh, (x - 20, y - 20))
    canvas.alpha_composite(im, (x, y))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([x, y, x + im.size[0] - 1, y + im.size[1] - 1], 34, outline=LINE, width=2)
    if ring:   # 標示要點的那一格
        d.rounded_rectangle([x - 8, y - 8, x + im.size[0] + 7, y + im.size[1] + 7], 40, outline=BLUE, width=6)


def caption(canvas, x, w, y, cap, sub=""):
    d = ImageDraw.Draw(canvas)
    tw = d.textlength(cap, font=f_cap)
    d.text((x + (w - tw) / 2, y), cap, font=f_cap, fill=INK)
    if sub:
        for i, line in enumerate(sub.split("\n")):
            sw = d.textlength(line, font=f_sub)
            d.text((x + (w - sw) / 2, y + 48 + i * 36), line, font=f_sub, fill=SOFT)


def strip(fname, items, title=""):
    """items: [(kind, src, 標題, 說明)]；kind＝phone 或 menu（src＝(圖, 裁切框)）。項目之間畫箭頭"""
    top = PAD + (70 if title else 0)
    imgs = [phone(src) if kind == "phone" else menu_cell(src, PW) for kind, src, _, _ in items]
    ph = max(im.size[1] for im in imgs)
    W = PAD * 2 + PW * len(items) + GAP * (len(items) - 1)
    H = top + ph + 30 + CAP_H + PAD
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(canvas)
    if title:
        d.text((PAD, PAD - 6), title, font=f_title, fill=INK)
    for i, (kind, src, cap, sub) in enumerate(items):
        x = PAD + i * (PW + GAP)
        im = imgs[i]
        if kind == "phone":
            paste_card(canvas, im, x, top)
        else:
            paste_card(canvas, im, x, top + (ph - im.size[1]) // 2, ring=True)
        caption(canvas, x, PW, top + ph + 30, cap, sub)
        if i < len(items) - 1:
            ax = x + PW + (GAP - d.textlength("→", font=f_arrow)) / 2
            d.text((ax, top + ph / 2 - 44), "→", font=f_arrow, fill=(150, 160, 172))
    canvas.convert("RGB").save(f"{OUT}/{fname}.png", optimize=True)
    print(fname, canvas.size)


def menu_with_phones(fname, menu, menu_cap, phones):
    """上方：整張選單；下方：點了之後打開的畫面"""
    MW = PAD * 2 + PW * len(phones) + GAP * (len(phones) - 1) - PAD * 2
    m = Image.open(f"{D}/menu/{menu}.jpg").convert("RGB")
    mh = round(m.size[1] * MW / m.size[0])
    m = rounded(m.resize((MW, mh), Image.LANCZOS), 30)
    W = MW + PAD * 2
    y_ph = PAD + 70 + mh + 90
    H = y_ph + PH + 30 + CAP_H + PAD
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(canvas)
    d.text((PAD, PAD - 6), menu_cap, font=f_title, fill=INK)
    paste_card(canvas, m, PAD, PAD + 70)
    d.text((PAD, PAD + 70 + mh + 26), "點選單後打開的畫面 ↓", font=f_sub, fill=SOFT)
    for i, (src, cap, sub) in enumerate(phones):
        x = PAD + i * (PW + GAP)
        paste_card(canvas, phone(src), x, y_ph)
        caption(canvas, x, PW, y_ph + PH + 30, cap, sub)
    canvas.convert("RGB").save(f"{OUT}/{fname}.png", optimize=True)
    print(fname, canvas.size)


def menu_only(fname, menu, title, sub):
    m = Image.open(f"{D}/menu/{menu}.jpg").convert("RGB")
    MW = 1200
    mh = round(m.size[1] * MW / m.size[0])
    m = rounded(m.resize((MW, mh), Image.LANCZOS), 30)
    W, H = MW + PAD * 2, PAD + 70 + mh + 40 + 50 + PAD
    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(canvas)
    d.text((PAD, PAD - 6), title, font=f_title, fill=INK)
    paste_card(canvas, m, PAD, PAD + 70)
    d.text((PAD, PAD + 70 + mh + 30), sub, font=f_sub, fill=SOFT)
    canvas.convert("RGB").save(f"{OUT}/{fname}.png", optimize=True)
    print(fname, canvas.size)


PUB_BOTTOM = ("public", (0, 905, 2500, 1686))
STAFF_SIGNOUT = ("staff", (1690, 905, 2500, 1686))

menu_with_phones("u1_一般選單", "public", "一般選單（所有人都看得到）", [
    ("info", "收容所資訊", "公告、用餐、生活規定\n開設中的收容所"),
    ("report", "我要反映", "選類別和所在收容所\n就能送出"),
    ("sos", "緊急聯絡", "119、110 一按就撥")])
strip("u2_申請開通", [
    ("menu", PUB_BOTTOM, "1 點選單「工作人員」", "一般選單的最下列"),
    ("phone", "apply", "2 按「申請開通」", "以 LINE 名稱送出申請"),
    ("phone", "apply_done", "3 等候管理者核准", "核准後即可簽到上班")])
menu_only("u3_工作人員選單", "staff", "簽到後：工作人員選單",
          "上列不變；下列換成「掃 QR｜本所狀況｜簽退」。簽退後自動恢復一般選單。")
strip("u4_號碼牌", [
    ("phone", "register", "空白牌 → 報到表單", "姓名、年齡層必填\n其餘選填"),
    ("phone", "resident", "使用中 → 居民資料", "領物資、外出、返回、離所\n都在這一頁")])
strip("u5_物資", [
    ("phone", "item", "掃物資標籤", "直接跳到該品項\n選入庫或發放"),
    ("phone", "supply", "物資分頁", "全部品項與庫存\n一次可填多項")])
strip("u6_本所狀況", [
    ("phone", "ops", "本所狀況", "數字、在班人員\n待處理事項"),
    ("phone", "ops_event", "點開事件", "我來處理、追加紀錄\n已解決")])
strip("u7_簽退", [
    ("menu", STAFF_SIGNOUT, "1 點選單「簽退」", "工作人員選單右下角"),
    ("phone", "signout", "2 按「確定簽退」", "避免誤觸，先確認一次"),
    ("phone", "signout_done", "3 完成", "選單恢復一般版")])
