"""產生 LINE 圖文選單圖片與設計範本。兩張選單一樣大（2500x1686），上兩列完全相同。

- 一般選單（所有人）：上兩列 6 個按鈕；最下列是橫幅，不是按鈕（放標誌、緊急電話）
- 加乘選單（工作人員簽到後）：上兩列同一般選單；最下列換成 4 個工作人員按鈕

用法：
  python tools/make_richmenu.py             產生預設圖 assets/richmenu_public.png、richmenu_staff.png
  python tools/make_richmenu.py --template  產生設計範本 assets/richmenu_template_public.png、richmenu_template_staff.png

自訂設計時照範本的格子畫，按鈕的點擊範圍是固定的（定義在 tools/make_blueprints.py 的 build_menu）。
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
ROW_H = H // 3  # 562
FONT = "C:/Windows/Fonts/msjhbd.ttc"
OUT = Path(__file__).resolve().parent.parent / "assets"

PUBLIC = ["常見問題", "最新公告", "物資領取", "我需要協助", "緊急聯絡", "工作人員專區"]
STAFF = [("掃 QR", "報到・進出"), ("整備回報", ""), ("查詢狀況", ""), ("簽退", "")]
BANNER = ("苗栗縣避難收容所", "緊急狀況請撥 119")

BG_PUBLIC = (255, 248, 235)
BG_STAFF = (214, 240, 220)
BG_BANNER = (236, 228, 214)
LINE_C = (200, 200, 200)
TEXT_C = (40, 40, 40)
ACCENT = (34, 120, 60)
BANNER_C = (110, 90, 60)


def font(size):
    return ImageFont.truetype(FONT, size)


def center_text(draw, box, text, f, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    draw.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), text, font=f, fill=fill)


def top_six(d):
    cw = W / 3
    for i, label in enumerate(PUBLIC):
        r, c = divmod(i, 3)
        center_text(d, (c * cw, r * ROW_H, (c + 1) * cw, (r + 1) * ROW_H), label, font(110), TEXT_C)
    for c in (1, 2):
        d.line([(c * cw, 0), (c * cw, 2 * ROW_H)], fill=LINE_C, width=4)
    d.line([(0, ROW_H), (W, ROW_H)], fill=LINE_C, width=4)


def public_image():
    img = Image.new("RGB", (W, H), BG_PUBLIC)
    d = ImageDraw.Draw(img)
    top_six(d)
    d.rectangle((0, 2 * ROW_H, W, H), fill=BG_BANNER)
    d.line([(0, 2 * ROW_H), (W, 2 * ROW_H)], fill=BANNER_C, width=8)
    center_text(d, (0, 2 * ROW_H, W, H - 120), BANNER[0], font(110), BANNER_C)
    center_text(d, (0, 2 * ROW_H + 150, W, H), BANNER[1], font(80), BANNER_C)
    return img


def staff_image():
    img = Image.new("RGB", (W, H), BG_PUBLIC)
    d = ImageDraw.Draw(img)
    top_six(d)
    d.rectangle((0, 2 * ROW_H, W, H), fill=BG_STAFF)
    sw = W / 4
    for i, (label, sub) in enumerate(STAFF):
        x0, x1, y0, y1 = i * sw, (i + 1) * sw, 2 * ROW_H, H
        if sub:
            center_text(d, (x0, y0, x1, y1 - 110), label, font(120), ACCENT)
            center_text(d, (x0, y0 + 130, x1, y1), sub, font(76), ACCENT)
        else:
            center_text(d, (x0, y0, x1, y1), label, font(120), ACCENT)
    for c in (1, 2, 3):
        d.line([(c * sw, 2 * ROW_H), (c * sw, H)], fill=(160, 200, 170), width=4)
    d.line([(0, 2 * ROW_H), (W, 2 * ROW_H)], fill=ACCENT, width=8)
    return img


def template(kind):
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f_big, f_small = font(80), font(44)
    cw = W / 3
    for i, label in enumerate(PUBLIC):
        r, c = divmod(i, 3)
        x0, y0, x1, y1 = int(c * cw), r * ROW_H, int((c + 1) * cw), (r + 1) * ROW_H
        d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=(255, 244, 222), outline=(200, 160, 90), width=6)
        center_text(d, (x0, y0, x1, y1 - 80), label, f_big, TEXT_C)
        center_text(d, (x0, y0 + 110, x1, y1), f"x {x0}–{x1}　y {y0}–{y1}", f_small, (150, 110, 60))
    y0, y1 = 2 * ROW_H, H
    if kind == "public":
        d.rectangle((0, y0, W - 1, y1 - 1), fill=(240, 240, 240), outline=(150, 150, 150), width=6)
        center_text(d, (0, y0, W, y1 - 80), "橫幅區（不是按鈕）：可放標誌、單位名稱、緊急電話", f_big, (100, 100, 100))
        center_text(d, (0, y0 + 110, W, y1), f"x 0–2500　y {y0}–{y1}　加乘選單在這一列換成 4 個工作人員按鈕", f_small, (100, 100, 100))
        title = "一般選單設計範本"
    else:
        sw = W / 4
        for i, label in enumerate(["掃 QR（開掃描器）", "整備回報", "查詢狀況", "簽退"]):
            x0, x1 = int(i * sw), int((i + 1) * sw)
            d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=(214, 240, 220), outline=ACCENT, width=6)
            center_text(d, (x0, y0, x1, y1 - 80), label, f_small if len(label) > 5 else f_big, ACCENT)
            center_text(d, (x0, y0 + 110, x1, y1), f"x {x0}–{x1}　y {y0}–{y1}", f_small, ACCENT)
        title = "加乘選單（工作人員）設計範本"
    d.text((30, 20), f"{title}　2500 × 1686 px　PNG／JPG，1MB 以內　上兩列與另一張選單相同", font=f_small, fill=(120, 120, 120))
    return img


def save(img, name):
    OUT.mkdir(exist_ok=True)
    p = OUT / name
    img.save(p, optimize=True)
    print(name, p.stat().st_size, "bytes")


if __name__ == "__main__":
    if "--template" in sys.argv:
        save(template("public"), "richmenu_template_public.png")
        save(template("staff"), "richmenu_template_staff.png")
    else:
        save(public_image(), "richmenu_public.png")
        save(staff_image(), "richmenu_staff.png")
