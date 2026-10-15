"""產生可列印的 QR 圖片：工作人員簽到 QR、居民號碼牌 QR、加入官方帳號 QR。

QR 內容的格式見 docs/QR編碼規則.md：LINE 預填訊息連結，掃了會打開官方帳號對話框並填好文字，
使用者按「傳送」後由 Make.com 處理。

用法：
    python tools/make_qr.py --sign SIGN-XXXXX --event "2026-10 ○○颱風" --place "清華里活動中心" --tags MLS-AAAAA MLS-BBBBB ...

輸出到 output/qr/（已列在 .gitignore：簽到碼外流的話，人不在現場也能簽到）。
需要套件：qrcode、Pillow。
"""
import argparse
import os
import sys
import urllib.parse

import qrcode
from PIL import Image, ImageDraw, ImageFont

OA_ID = "@796juukk"  # 官方帳號 Basic ID；換帳號時要改這裡並重印所有 QR
OUT = os.path.join(os.path.dirname(__file__), "..", "output", "qr")

LOGO = os.path.join(os.path.dirname(__file__), "..", "assets", "logo.png")  # 苗栗縣徽，與官方帳號頭像相同
FONT = "C:/Windows/Fonts/msjh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msjhbd.ttc"


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT_BOLD if bold else FONT, size)
    except OSError:
        sys.exit("找不到微軟正黑體，請修改 make_qr.py 的 FONT 路徑")


def oa_message_url(text):
    return f"https://line.me/R/oaMessage/{OA_ID}/?" + urllib.parse.quote(text)


def qr_image(data, box):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=10)
    q.add_data(data)
    q.make(fit=True)
    return q.make_image(fill_color="black", back_color="white").convert("RGB").resize((box, box), Image.NEAREST)


def paste_logo(img, x, y, size):
    """在 (x, y) 貼縣徽，底下墊白色圓形，避免和色帶顏色糊在一起。"""
    if not os.path.exists(LOGO):
        return
    pad = max(4, size // 14)
    ImageDraw.Draw(img).ellipse([x - pad, y - pad, x + size + pad, y + size + pad], fill="white")
    logo = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    # 原圖四角是白底，用圓形遮罩只取縣徽本身
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    img.paste(logo, (x, y), mask)


def center(draw, y, text, f, fill, width):
    w = draw.textlength(text, font=f)
    draw.text(((width - w) / 2, y), text, font=f, fill=fill)


def pill(d, y, text, f, bg, fg, width):
    """置中的圓角標籤（用來放災害事件）。"""
    tw = d.textlength(text, font=f)
    pad_x, h = 34, f.size + 26
    x0 = (width - tw) / 2 - pad_x
    d.rounded_rectangle([x0, y, x0 + tw + 2 * pad_x, y + h], radius=h // 2, fill=bg)
    d.text((x0 + pad_x, y + 9), text, font=f, fill=fg)


def card(title, event, place, url, code, lines, color, w=1240, h=1754):
    """A4 直式（150 dpi）一張：上方色帶放標題、災害事件、地點，中間大 QR，下方說明。
    event 為 None 時（例如加入好友 QR）只放標題和地點。"""
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 470], fill=color)
    paste_logo(img, 44, 40, 130)
    if event:
        center(d, 36, title, font(92, True), "white", w)
        pill(d, 168, event, font(44, True), "white", color, w)
        center(d, 280, place, font(88, True), "white", w)
    else:
        center(d, 110, title, font(92, True), "white", w)
        center(d, 270, place, font(64, True), "white", w)
    img.paste(qr_image(url, 720), ((w - 720) // 2, 520))
    center(d, 1275, code, font(60, True), "#1f2933", w)
    y = 1385
    for ln in lines:
        center(d, y, ln, font(40), "#323f4b", w)
        y += 66
    center(d, h - 80, "苗栗縣避難收容所管理系統｜LINE 官方帳號 " + OA_ID, font(30), "#7b8794", w)
    return img


def tag_sheet(tags, event, place):
    """號碼牌：一張 A4 排 6 格（2 × 3），每格一張可剪下的卡片；每張卡片都印災害事件和地點。"""
    w, h = 1240, 1754
    color, light = "#e8590c", "#fff4e6"
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 165], fill=color)
    paste_logo(img, 34, 22, 120)
    center(d, 18, "居民號碼牌（由工作人員掃描）", font(46, True), "white", w)
    center(d, 92, f"{event}｜{place}", font(40), "white", w)
    cw, ch = 560, 505
    for i, t in enumerate(tags[:6]):
        x = 40 + (i % 2) * (cw + 40)
        y = 185 + (i // 2) * (ch + 15)
        d.rounded_rectangle([x, y, x + cw, y + ch], radius=24, fill="white", outline=color, width=6)
        d.rounded_rectangle([x + 6, y + 6, x + cw - 6, y + 82], radius=18, fill=light)
        paste_logo(img, x + 22, y + 15, 58)
        for txt, f, fill, yy in ((event, font(24, True), color, y + 12), (place, font(30, True), "#1f2933", y + 42)):
            tw = d.textlength(txt, font=f)
            d.text((x + (cw - tw) / 2, yy), txt, font=f, fill=fill)
        img.paste(qr_image(oa_message_url(f"QR {t}"), 320), (x + (cw - 320) // 2, y + 92))
        tw = d.textlength(t, font=font(46, True))
        d.text((x + (cw - tw) / 2, y + 412), t, font=font(46, True), fill="#1f2933")
        sub = "工作人員掃描：報到・外出・領物資・離所"
        sw = d.textlength(sub, font=font(22))
        d.text((x + (cw - sw) / 2, y + 468), sub, font=font(22), fill="#52606d")
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sign", required=True, help="簽到代碼，例：SIGN-7K3Q9")
    ap.add_argument("--event", required=True, help="災害事件，印在簽到 QR 和號碼牌上，例：【模擬】2026-10 風災")
    ap.add_argument("--place", required=True, help="收容所名稱，例：清華里活動中心")
    ap.add_argument("--tags", nargs="*", default=[], help="號碼牌編號，例：MLS-8YC5K")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    # 簽到 QR 是整個收容所共用的（系統用 LINE 帳號認人），不印代碼，避免被誤認為個人專用
    card("工作人員簽到", a.event, a.place, oa_message_url(f"簽到 {a.sign}"), "本所工作人員共用",
         ["用 LINE 掃描 → 按「傳送」", "沒在班：直接簽到；已在班：選要做的事"], "#2f9e44"
         ).save(os.path.join(OUT, "01_工作人員簽到QR.png"))
    card("加入官方帳號", None, "苗栗避難所系統", f"https://line.me/R/ti/p/{OA_ID}", OA_ID,
         ["用手機相機或 LINE 掃描，加入好友", "工作人員加入後，按選單「工作人員」申請開通"], "#06c755"
         ).save(os.path.join(OUT, "00_加入官方帳號QR.png"))
    if a.tags:
        tag_sheet(a.tags, a.event, a.place).save(os.path.join(OUT, "02_居民號碼牌QR.png"))
    for f in sorted(os.listdir(OUT)):
        print(os.path.join("output", "qr", f))


if __name__ == "__main__":
    main()
