"""產生可列印的 QR 圖片：工作人員簽到 QR、居民號碼牌 QR、加入官方帳號 QR。

QR 內容的格式見 docs/QR編碼規則.md：LINE 預填訊息連結，掃了會打開官方帳號對話框並填好文字，
使用者按「傳送」後由 Make.com 處理。

用法：
    python tools/make_qr.py --sign SIGN-XXXXX --shelter "清華里活動中心" --tags MLS-AAAAA MLS-BBBBB ...

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


def center(draw, y, text, f, fill, width):
    w = draw.textlength(text, font=f)
    draw.text(((width - w) / 2, y), text, font=f, fill=fill)


def card(title, subtitle, url, code, lines, color, w=1240, h=1754):
    """A4 直式（150 dpi）一張：上方色帶標題、中間大 QR、下方代碼與步驟。"""
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 300], fill=color)
    center(d, 70, title, font(96, True), "white", w)
    center(d, 200, subtitle, font(44), "white", w)
    qr = qr_image(url, 820)
    img.paste(qr, ((w - 820) // 2, 360))
    center(d, 1200, code, font(64, True), "#1f2933", w)
    y = 1320
    for ln in lines:
        center(d, y, ln, font(40), "#323f4b", w)
        y += 66
    center(d, h - 80, "苗栗縣避難收容所管理系統｜LINE 官方帳號 " + OA_ID, font(30), "#7b8794", w)
    return img


def tag_sheet(tags, shelter):
    """號碼牌：一張 A4 排 6 格（2 × 3），每格一張可剪下的卡片。"""
    w, h = 1240, 1754
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    center(d, 25, f"居民號碼牌｜{shelter}（由工作人員掃描）", font(40, True), "#1f2933", w)
    cw, ch = 560, 530
    for i, t in enumerate(tags[:6]):
        x = 40 + (i % 2) * (cw + 40)
        y = 95 + (i // 2) * (ch + 20)
        d.rounded_rectangle([x, y, x + cw, y + ch], radius=24, outline="#e8590c", width=6)
        img.paste(qr_image(oa_message_url(f"QR {t}"), 380), (x + (cw - 380) // 2, y + 30))
        tw = d.textlength(t, font=font(48, True))
        d.text((x + (cw - tw) / 2, y + 425), t, font=font(48, True), fill="#1f2933")
        sub = "工作人員掃描：報到・外出・領物資・離所"
        sw = d.textlength(sub, font=font(24))
        d.text((x + (cw - sw) / 2, y + 490), sub, font=font(24), fill="#52606d")
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sign", required=True, help="簽到代碼，例：SIGN-7K3Q9")
    ap.add_argument("--shelter", required=True, help="收容所名稱，印在簽到 QR 上")
    ap.add_argument("--tags", nargs="*", default=[], help="號碼牌編號，例：MLS-8YC5K")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    card("工作人員簽到", a.shelter, oa_message_url(f"簽到 {a.sign}"), a.sign,
         ["用 LINE 掃描 → 按「傳送」", "沒在班：直接簽到；已在班：選要做的事"], "#2f9e44"
         ).save(os.path.join(OUT, "01_工作人員簽到QR.png"))
    card("加入官方帳號", "苗栗避難所系統", f"https://line.me/R/ti/p/{OA_ID}", OA_ID,
         ["用手機相機或 LINE 掃描，加入好友", "工作人員加入後，按選單「工作人員」申請開通"], "#06c755"
         ).save(os.path.join(OUT, "00_加入官方帳號QR.png"))
    if a.tags:
        tag_sheet(a.tags, a.shelter).save(os.path.join(OUT, "02_居民號碼牌QR.png"))
    for f in sorted(os.listdir(OUT)):
        print(os.path.join("output", "qr", f))


if __name__ == "__main__":
    main()
