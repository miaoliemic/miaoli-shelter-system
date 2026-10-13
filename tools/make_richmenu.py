"""產生 LINE 加乘圖文選單圖片（2500x1686）。

上兩列：一般選單的 6 格（與一般選單相同順序）
下一列：工作人員管理功能 4 格

用法：python tools/make_richmenu.py
輸出：assets/richmenu_staff.png（LINE 限制 1MB 以內）
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
ROW_H = H // 3  # 562
FONT = "C:/Windows/Fonts/msjhbd.ttc"

PUBLIC = [
    ("❓", "常見問題"), ("📢", "最新公告"), ("📦", "物資領取"),
    ("🙋", "我需要協助"), ("📞", "緊急聯絡"), ("🦺", "工作人員專區"),
]
STAFF = [("掃 QR", "報到・進出"), ("整備回報", ""), ("查詢狀況", ""), ("簽退", "")]

BG_PUBLIC = (255, 248, 235)
BG_STAFF = (214, 240, 220)
LINE_C = (200, 200, 200)
TEXT_C = (40, 40, 40)
ACCENT = (34, 120, 60)


def center_text(draw, box, text, font, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    draw.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), text, font=font, fill=fill)


def main():
    img = Image.new("RGB", (W, H), BG_PUBLIC)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(FONT, 110)
    mid = ImageFont.truetype(FONT, 72)
    small = ImageFont.truetype(FONT, 56)

    # 上兩列：一般選單
    cw = W / 3
    for i, (_, label) in enumerate(PUBLIC):
        r, c = divmod(i, 3)
        box = (c * cw, r * ROW_H, (c + 1) * cw, (r + 1) * ROW_H)
        center_text(d, box, label, big, TEXT_C)

    # 下一列：工作人員
    d.rectangle((0, 2 * ROW_H, W, H), fill=BG_STAFF)
    sw = W / 4
    for i, (label, sub) in enumerate(STAFF):
        x0, x1 = i * sw, (i + 1) * sw
        y0, y1 = 2 * ROW_H, H
        if sub:
            center_text(d, (x0, y0, x1, y1 - 70), label, mid, ACCENT)
            center_text(d, (x0, y0 + 90, x1, y1), sub, small, ACCENT)
        else:
            center_text(d, (x0, y0, x1, y1), label, mid, ACCENT)

    # 格線
    for c in (1, 2):
        d.line([(c * cw, 0), (c * cw, 2 * ROW_H)], fill=LINE_C, width=4)
    for c in (1, 2, 3):
        d.line([(c * sw, 2 * ROW_H), (c * sw, H)], fill=(160, 200, 170), width=4)
    d.line([(0, ROW_H), (W, ROW_H)], fill=LINE_C, width=4)
    d.line([(0, 2 * ROW_H), (W, 2 * ROW_H)], fill=ACCENT, width=8)

    out = Path(__file__).resolve().parent.parent / "assets" / "richmenu_staff.png"
    out.parent.mkdir(exist_ok=True)
    img.save(out, optimize=True)
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
