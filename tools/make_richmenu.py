"""產生 LINE 圖文選單圖片與設計範本。兩張選單一樣大（2500x1686），上下兩列，上列完全相同。

- 一般選單（所有人）：上列 3 格（收容所資訊、我要反映、緊急聯絡）；下列整列一個「工作人員」入口
- 加乘選單（工作人員簽到後）：上列同一般選單；下列 3 格（掃 QR、本所狀況、簽退）

用法：
  python tools/make_richmenu.py             產生預設圖 assets/richmenu_public.png、richmenu_staff.png
  python tools/make_richmenu.py --template  產生設計範本 assets/richmenu_template_public.png、richmenu_template_staff.png

自訂設計時照範本的格子畫，按鈕的點擊範圍是固定的（定義在 tools/make_blueprints.py 的 build_menu）。
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
ROW_H = H // 2  # 843：上下兩列
FONT = "C:/Windows/Fonts/msjhbd.ttc"
OUT = Path(__file__).resolve().parent.parent / "assets"

# 上列（兩張選單共用）：(主標, 副標)
TOP = [("收容所資訊", "公告・用餐・規定"), ("我要反映", "需要協助・意見"), ("緊急聯絡", "電話・119")]
# 下列：一般選單是整列一個入口；加乘選單是 3 格
PUBLIC_BOTTOM = ("工作人員", "簽到・申請開通")
STAFF_BOTTOM = [("掃 QR", "報到・進出"), ("本所狀況", "查詢・回報"), ("簽退", "下班")]

BG_TOP = (255, 248, 235)
BG_PUBLIC_BOTTOM = (236, 228, 214)
BG_STAFF = (214, 240, 220)
LINE_C = (200, 200, 200)
TEXT_C = (40, 40, 40)
SUB_C = (120, 100, 70)
ACCENT = (34, 120, 60)
BOTTOM_C = (110, 90, 60)


def font(size):
    return ImageFont.truetype(FONT, size)


def center_text(draw, box, text, f, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    draw.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), text, font=f, fill=fill)


def two_line(d, box, title, sub, color, sub_color):
    x0, y0, x1, y1 = box
    center_text(d, (x0, y0, x1, y1 - 150), title, font(135), color)
    center_text(d, (x0, y0 + 190, x1, y1), sub, font(80), sub_color)


def top_row(d):
    cw = W / 3
    for i, (title, sub) in enumerate(TOP):
        two_line(d, (i * cw, 0, (i + 1) * cw, ROW_H), title, sub, TEXT_C, SUB_C)
    for c in (1, 2):
        d.line([(c * cw, 0), (c * cw, ROW_H)], fill=LINE_C, width=4)


def public_image():
    img = Image.new("RGB", (W, H), BG_TOP)
    d = ImageDraw.Draw(img)
    top_row(d)
    d.rectangle((0, ROW_H, W, H), fill=BG_PUBLIC_BOTTOM)
    d.line([(0, ROW_H), (W, ROW_H)], fill=BOTTOM_C, width=8)
    two_line(d, (0, ROW_H, W, H), PUBLIC_BOTTOM[0], PUBLIC_BOTTOM[1], BOTTOM_C, BOTTOM_C)
    return img


def staff_image():
    img = Image.new("RGB", (W, H), BG_TOP)
    d = ImageDraw.Draw(img)
    top_row(d)
    d.rectangle((0, ROW_H, W, H), fill=BG_STAFF)
    cw = W / 3
    for i, (title, sub) in enumerate(STAFF_BOTTOM):
        two_line(d, (i * cw, ROW_H, (i + 1) * cw, H), title, sub, ACCENT, ACCENT)
    for c in (1, 2):
        d.line([(c * cw, ROW_H), (c * cw, H)], fill=(160, 200, 170), width=4)
    d.line([(0, ROW_H), (W, ROW_H)], fill=ACCENT, width=8)
    return img


def template(kind):
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    f_big, f_small = font(90), font(48)
    cw = W / 3

    def cell(x0, y0, x1, y1, label, fill, outline, color):
        d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=fill, outline=outline, width=6)
        center_text(d, (x0, y0, x1, y1 - 90), label, f_big, color)
        center_text(d, (x0, y0 + 120, x1, y1), f"x {x0}–{x1}　y {y0}–{y1}", f_small, color)

    for i, (title, _) in enumerate(TOP):
        cell(int(i * cw), 0, int((i + 1) * cw), ROW_H, title, (255, 244, 222), (200, 160, 90), (150, 110, 60))
    if kind == "public":
        cell(0, ROW_H, W, H, "工作人員入口（整列一個按鈕）", (240, 234, 222), BOTTOM_C, BOTTOM_C)
        title = "一般選單設計範本"
    else:
        for i, (t, _) in enumerate(STAFF_BOTTOM):
            cell(int(i * cw), ROW_H, int((i + 1) * cw), H, t, (214, 240, 220), ACCENT, ACCENT)
        title = "加乘選單（工作人員）設計範本"
    d.text((30, 20), f"{title}　2500 × 1686 px　上列 3 格兩張共用", font=f_small, fill=(120, 120, 120))
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
