#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_qr_poster.py — 云端链接 → 二维码海报（一键出图 + 自动解码自检）

用途：把 H5 成品的云端链接做成可转发的扫码海报。
设计原则：
  1. 出图后必须反解二维码校验（曾出现海报指向旧地址的低级事故）
  2. 二维码以「微信扫一扫 / 长按识别」为第一目标：
     静区 >= 4 模块、前景纯黑、模块整数倍、成品内 >= 300px
  3. 零 Playwright 依赖 —— 纯 PIL 绘制，任何环境都能跑
  4. 中文字体自动探测（Windows/macOS/Linux 常见路径兜底）

依赖：pip install qrcode[pillow]   （cv2 可选，仅用于解码自检）

用法：
  python make_qr_poster.py --url https://xxx.app.workbuddy.link \
      --title "小A · 知识闯关" --subtitle "AI 语音陪学 · 微信扫码即玩" \
      --stats "6|知识场景" "247|可玩关卡" "741|道题目" \
      --points "扫开即玩，无需下载" "AI 语音朗读，中英文自动切音色" \
      --out 扫码海报.png

  # 只出二维码（视频/PPT/印刷用）
  python make_qr_poster.py --url <link> --qr-only qr.png

出图后会自动跑两道校验，任一不过直接 exit 1：
  ① 原图反解 —— 确认指向的地址正确
  ② 微信压缩链路反解 —— 降分辨率 + JPEG 有损 + 模糊后仍可解
"""
import argparse
import os
import sys

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
except ImportError:
    sys.exit("缺少依赖，请先执行: pip install qrcode[pillow]")

from PIL import Image, ImageDraw, ImageFont


# ---------- 字体 ----------
def find_font(bold=False):
    """跨平台中文字体探测，找不到返回 None（由调用方降级到 PIL 默认字体）"""
    names = (["msyhbd.ttc", "msyh.ttc", "simhei.ttf"] if bold
             else ["msyh.ttc", "msyh.ttf", "simhei.ttf"])
    dirs = [
        "C:/Windows/Fonts", "C:/WINNT/Fonts",
        "/System/Library/Fonts", "/Library/Fonts",           # macOS
        "/usr/share/fonts/truetype/wqy",                      # Linux 文泉驿
        "/usr/share/fonts/opentype/noto",
        "/usr/share/fonts/truetype/noto",
    ]
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return p
    # Linux 再兜底找一遍 Noto CJK
    for root in ("/usr/share/fonts",):
        for cur, _, files in os.walk(root):
            for f in files:
                if f.lower().startswith(("notosanscjk", "wqy")) and f.endswith((".ttc", ".otf", ".ttf")):
                    return os.path.join(cur, f)
    return None


def font(size, bold=False):
    p = find_font(bold)
    if not p:
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()


# ---------- 二维码 ----------
# 微信可识别三要素（2026-09-10 加固，改之前先读这段）
#   ① 静区 border >= 4：微信「扫一扫 / 长按识别」按 ISO/IEC 18004 要求 4 模块静区。
#      旧版 border=3，海报里的码经常识别不出来 —— 这是最容易被忽略的硬伤。
#   ② 前景纯黑 (0,0,0)：品牌紫在屏幕反光 + 微信二次压缩下对比度不够。
#      底色必须纯白，不能是渐变/半透明，否则微信判定"二维码不清晰"。
#   ③ 模块整数倍：先按目标尺寸算整数 box 再出图，**不要 resize()**。
#      非整数缩放会让模块宽度忽 7px 忽 8px（混叠），扫描器解码率显著下降。
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
WECHAT_BORDER = 4          # 微信识别的标准静区，别调小


def make_qr(url, out_path, box=12, border=WECHAT_BORDER, fg=BLACK, bg=WHITE,
            target=None, min_module=6):
    """容错等级 H：可遮挡/蹭脏约 30% 仍可扫出。

    target:     期望边长(px)。给了就按「整数倍模块」出图，实际尺寸 <= target。
    min_module: 模块最小像素。微信扫描器对模块 <4px 的码识别率骤降；
                宁可让成品大一点，也不要靠缩放硬凑尺寸。
    """
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_H,
                       box_size=box, border=border)
    qr.add_data(url)
    qr.make(fit=True)
    total = qr.modules_count + 2 * border          # 含静区的总模块数
    if target:
        box = max(min_module, int(target) // total)  # 整数倍，宁大不小
    qr.box_size = box                               # make_image 读的就是这个值
    img = qr.make_image(fill_color=fg, back_color=bg).convert("RGB")
    img.qr_meta = {
        "modules_total": total,                     # 含静区的总模块数
        "module_px": box,                           # 每模块像素
        "border": border,                           # 静区（模块数）
        "size": img.size[0],
    }
    if out_path:
        img.save(out_path, "PNG", optimize=True)
    return img


# ---------- 绘图小工具 ----------
def text_w(draw, t, f):
    try:
        return draw.textbbox((0, 0), t, font=f)[2]
    except AttributeError:
        return draw.textsize(t, font=f)[0]


def wrap(draw, t, f, max_w):
    """按像素宽度断行，兼容无空格的中文"""
    lines, cur = [], ""
    for ch in t:
        if text_w(draw, cur + ch, f) <= max_w:
            cur += ch
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def draw_center(draw, y, t, f, fill, cx, max_w=None):
    ls = wrap(draw, t, f, max_w or (W - 2 * PAD)) if max_w or True else [t]
    for i, ln in enumerate(ls):
        w = text_w(draw, ln, f)
        draw.text((cx - w / 2, y + i * (f.size + 8)), ln, font=f, fill=fill)
    return y + len(ls) * (f.size + 8)


def round_rect(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def gradient(size, top, bottom):
    """竖向线性渐变背景"""
    w, h = size
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for i in range(h):
        k = i / max(h - 1, 1)
        d.point((0, i), tuple(int(top[c] + (bottom[c] - top[c]) * k) for c in range(3)))
    return img.resize((w, h))


# ---------- 海报 ----------
W, PAD = 750, 40
PURPLE_TOP = (108, 92, 231)
PURPLE_BOT = (58, 42, 140)
INK = (26, 35, 50)
SUB = (108, 118, 138)
GOLD = (245, 166, 35)


QR_TARGET = 440     # 海报内二维码目标边长(px)。微信长按识别要求成品里 >= 300px，
                    # 且模块 >= 4px（太小微信会把码当"装饰图"直接忽略）。
                    # 440 对 45 模块的码正好落 8px/模块，白卡宽 650 也放得下。
QR_STANDALONE = 840  # 单独导出的二维码边长(px)：够印刷、够视频、够 PPT 用


def make_poster(url, title, subtitle, stats, points, footer, out_path,
                qr_fg=BLACK, tip="微信扫一扫 / 长按识别 即玩",
                tip2="长按识别二维码，或转发给好友一起玩"):
    # 整数倍模块直接出图，不 resize（resize 会让模块宽度混叠，微信易解不出）
    qr = make_qr(url, None, fg=qr_fg, target=QR_TARGET)
    qr_size = qr.size[0]

    # 先算高度
    tmp = Image.new("RGB", (W, 100))
    td = ImageDraw.Draw(tmp)
    f_title = font(46, True)
    f_sub = font(24)
    f_lab = font(20, True)
    f_pt = font(21)
    f_num = font(40, True)
    f_foot = font(17)
    f_tip = font(21, True)
    f_tip2 = font(17)

    probe = ImageDraw.Draw(Image.new("RGB", (W, 100)))
    h = 60
    h += 70                                             # 品牌徽标
    h += (len(wrap(probe, title, f_title, W - 2 * PAD))) * (f_title.size + 10) + 16
    h += (len(wrap(probe, subtitle, f_sub, W - 2 * PAD - 60))) * (f_sub.size + 8) + 24
    if stats:
        h += 110                                        # 数据条
    if points:
        h += 40 + len(points) * 42                      # 卖点列表
    n_tip = len(wrap(probe, tip, f_tip, W - 2 * PAD - 40))
    n_tip2 = len(wrap(probe, tip2, f_tip2, W - 2 * PAD - 40))
    h += 18 + qr_size + 26 + n_tip * (f_tip.size + 6) + n_tip2 * (f_tip2.size + 4) + 20 + 22
    h += (len(wrap(probe, footer, f_foot, W - 2 * PAD - 40)) + 1) * (f_foot.size + 6) + 40
    H = max(h, 900)

    img = gradient((W, H), PURPLE_TOP, PURPLE_BOT)
    d = ImageDraw.Draw(img)
    cx = W // 2
    y = 56

    # 品牌徽标
    bw, bh = 132, 46
    round_rect(d, (cx - bw // 2, y, cx + bw // 2, y + bh), 23, (255, 255, 255, 255))
    lt = "· 小A 引擎 ·"
    f_brand = font(23, True)
    d.text((cx - text_w(d, lt, f_brand) / 2, y + 10), lt, font=f_brand, fill=PURPLE_TOP)
    y += bh + 34

    # 标题
    y = draw_center(d, y, title, f_title, (255, 255, 255), cx, W - 2 * PAD) + 12
    # 副标题
    y = draw_center(d, y, subtitle, f_sub, (226, 230, 255), cx, W - 2 * PAD - 60) + 20

    # 数据条（白卡）
    if stats:
        card_h = 92
        round_rect(d, (PAD, y, W - PAD, y + card_h), 18, (255, 255, 255))
        n = len(stats)
        for i, s in enumerate(stats):
            parts = s.split("|")
            num = parts[0].strip()
            lab = parts[1].strip() if len(parts) > 1 else ""
            col_w = (W - 2 * PAD) // n
            bcx = PAD + col_w * i + col_w // 2
            d.text((bcx - text_w(d, num, f_num) / 2, y + 16), num, font=f_num, fill=PURPLE_TOP)
            if lab:
                d.text((bcx - text_w(d, lab, f_lab) / 2, y + 62), lab, font=f_lab, fill=SUB)
            if i < n - 1:
                d.line((PAD + col_w * (i + 1), y + 20, PAD + col_w * (i + 1), y + card_h - 20),
                       fill=(232, 235, 242), width=2)
        y += card_h + 26

    # 卖点列表
    if points:
        for i, p in enumerate(points):
            bx, by = PAD + 6, y
            round_rect(d, (bx, by + 3, bx + 28, by + 31), 14, (255, 255, 255))
            d.text((bx + 9, by + 7), str(i + 1), font=font(19, True), fill=PURPLE_TOP)
            for j, ln in enumerate(wrap(d, p, f_pt, W - 2 * PAD - 50)):
                d.text((bx + 42, by + 4 + j * (f_pt.size + 6)), ln, font=f_pt, fill=(238, 240, 255))
            y += 42
        y += 8

    # 二维码区（纯白卡 + 码 + 微信提示）
    # 关键：二维码必须落在一整块纯白卡上，不能压在渐变背景上——
    # 微信扫一扫对「码周围不是纯白」的图识别率明显下降。
    card_t = y
    lines_tip = wrap(d, tip, f_tip, W - 2 * PAD - 40)
    lines_tip2 = wrap(d, tip2, f_tip2, W - 2 * PAD - 40)
    ch = (18 + qr_size + 26 + len(lines_tip) * (f_tip.size + 6)
          + len(lines_tip2) * (f_tip2.size + 4) + 20)
    round_rect(d, (PAD + 10, card_t, W - PAD - 10, card_t + ch), 22, (255, 255, 255))
    img.paste(qr, (cx - qr_size // 2, card_t + 18))
    ty = card_t + 18 + qr_size + 20
    for ln in lines_tip:
        d.text((cx - text_w(d, ln, f_tip) / 2, ty), ln, font=f_tip, fill=INK)
        ty += f_tip.size + 6
    for ln in lines_tip2:
        d.text((cx - text_w(d, ln, f_tip2) / 2, ty), ln, font=f_tip2, fill=SUB)
        ty += f_tip2.size + 4
    y = card_t + ch + 22

    # 页脚
    for ln in wrap(d, footer, f_foot, W - 2 * PAD - 40):
        d.text((cx - text_w(d, ln, f_foot) / 2, y), ln, font=f_foot, fill=(196, 200, 226))
        y += f_foot.size + 6

    img.save(out_path, "PNG", optimize=True)
    img.qr_meta = qr.qr_meta          # 带上二维码参数，供微信可识别性自检
    return img


# ---------- 解码自检 ----------
def verify(poster_path, expect_url, qr_meta=None):
    """反解海报二维码，确认指向预期地址 + 检查是否符合微信规范。

    ⚠️ 实测坑（2026-09-10）：cv2 在「1080x1620 的复杂海报全图」上经常检不出码，
    但同一张图裁出二维码区域后能正常解出。所以全图 + 放大都失败后，
    必须再降级为「找白底方形候选块、逐块裁剪再解」，否则会误报失败。"""
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("  ⚠️  未安装 opencv，跳过解码自检（pip install opencv-python-headless 可开启）")
        return None
    # cv2.imread 读不了中文路径 —— 必须走 PIL
    det = cv2.QRCodeDetector()
    arr = np.array(Image.open(poster_path).convert("RGB"))
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    data, pts, _ = det.detectAndDecode(bgr)
    if not data:
        big = cv2.resize(bgr, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        data, pts, _ = det.detectAndDecode(big)
    if not data:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        _, th = cv2.threshold(gray, 235, 255, cv2.THRESH_BINARY)
        cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for c in cnts:
            x, y, w, h = cv2.boundingRect(c)
            if 200 < w < 900 and abs(w - h) < 16:      # 近似正方形的白底块
                boxes.append((x, y, w, h))
        for x, y, w, h in sorted(boxes, key=lambda t: -t[2]):
            pad = 24
            sub = bgr[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad]
            d, p, _ = det.detectAndDecode(sub)
            if d:
                data, pts = d, p
                break
    if not data:
        print("  ❌ 解码失败：海报中未检出二维码")
        return False
    ok = data.strip() == expect_url.strip()
    print(("  ✅ 二维码校验通过：%s" % data) if ok
          else "  ❌ 二维码指向错误！\n     实际: %s\n     预期: %s" % (data, expect_url))

    # ---- 微信可识别性体检（这是"能扫出来"的硬指标，比解码成功更有意义）----
    if qr_meta:
        on_img = None
        if pts is not None:
            try:
                p = pts.reshape(-1, 2)
                on_img = float(max(p[:, 0].max() - p[:, 0].min(),
                                   p[:, 1].max() - p[:, 1].min()))
            except Exception:
                on_img = None
        side = on_img or qr_meta.get("size", 0)
        # cv2 检出的四边形是「码区」，不含静区 —— 算模块尺寸要减掉 2*border
        mod_px = side / max(qr_meta.get("modules_total", 1) - 2 * qr_meta.get("border", 0), 1)
        bar = qr_meta.get("border", 0)
        checks = [
            ("静区 >= 4 模块（ISO/IEC 18004）", bar >= 4, "%d 模块" % bar),
            ("成品内二维码 >= 300px", side >= 300, "%.0fpx" % side),
            ("单模块 >= 4px", mod_px >= 4, "%.1fpx" % mod_px),
        ]
        bad = [c for c in checks if not c[1]]
        for name, good, val in checks:
            print("     %s %-32s %s" % ("✅" if good else "❌", name, val))
        if bad:
            print("  ❌ 微信可识别性不达标（%s）—— 放大二维码或减小 --stats/--points 后重出图"
                  % "、".join(c[0] for c in bad))
            return False
        print("  ✅ 微信可识别性体检通过")
    return ok


def verify_wechat(poster_path, expect_url):
    """模拟「微信传输链路」后二维码还能不能扫出来。

    为什么单验原图不够：海报在微信里真正失效的场景不是自己解得开，而是
      ① 用户把海报当图片发给好友 → 微信二次有损压缩（降分辨率 + JPEG 量化）
      ② 聊天窗里以缩略图显示 → 二维码实际只占几十 px
      ③ 屏幕反光 / 亮度偏低 → 对比度进一步下降
    所以这里主动走一遍「降分辨率 → JPEG 有损 → 轻微模糊」，再解码。
    这一关过了，微信里长按识别 / 扫一扫基本就稳了。
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("  ⚠️  未安装 opencv，跳过微信压缩链路自检"
              "（pip install opencv-python-headless 可开启）")
        return None
    from PIL import ImageFilter

    src = Image.open(poster_path).convert("RGB")
    w0 = src.size[0]
    # 微信发图会把长边压到 ~1280，聊天窗预览更狠；这里按 720 宽 + JPEG q55 模拟
    if w0 > 720:
        ratio = 720.0 / w0
        src = src.resize((720, max(1, int(src.size[1] * ratio))), Image.LANCZOS)
    # 轻微模糊：真实截图/转发里必然存在
    src = src.filter(ImageFilter.GaussianBlur(0.8))
    import io
    buf = io.BytesIO()
    src.save(buf, "JPEG", quality=55)                    # 有损压缩
    buf.seek(0)
    arr = np.array(Image.open(buf).convert("RGB"))
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    det = cv2.QRCodeDetector()
    data, _, _ = det.detectAndDecode(bgr)
    if not data:
        big = cv2.resize(bgr, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        data, _, _ = det.detectAndDecode(big)
    if not data:
        print("  ❌ 微信压缩链路校验失败：海报经二次压缩后二维码已解不出。\n"
              "     多半是二维码在成品里太小（<300px）或静区不足，放大二维码后重出图。")
        return False
    ok = data.strip() == expect_url.strip()
    print(("  ✅ 微信压缩链路校验通过（720px 宽 + q55 + 模糊 0.8 仍可解）：%s" % data) if ok
          else "  ❌ 压缩后解出的地址不对！\n     实际: %s\n     预期: %s" % (data, expect_url))
    return ok


def main():
    ap = argparse.ArgumentParser(description="云端链接 → 二维码海报（含解码自检）")
    ap.add_argument("--url", required=True, help="H5 云端访问链接")
    ap.add_argument("--title", default="知识闯关 · 扫码即玩")
    ap.add_argument("--subtitle", default="AI 语音陪学 · 无需下载 · 扫码即玩")
    ap.add_argument("--stats", nargs="*", default=[],
                    help='数据条，格式 "数值|标签"，如 "247|可玩关卡"')
    ap.add_argument("--points", nargs="*", default=[], help="卖点列表（建议 3-4 条）")
    ap.add_argument("--footer", default="温馨提示：本内容仅供学习参考，不构成专业建议。")
    ap.add_argument("--tip", default="微信扫一扫 / 长按识别 即玩",
                    help="二维码下方主提示语。宿主不支持微信内打开时，"
                         "改成「扫码即玩 · 建议在浏览器打开」")
    ap.add_argument("--tip2", default="长按识别二维码，或转发给好友一起玩",
                    help="副提示语。宿主不支持微信内打开时，"
                         "改成「在微信内请点右上角 ··· → 在浏览器打开」")
    ap.add_argument("--qr-fg", default=None,
                    help="二维码前景色 r,g,b（默认纯黑；改彩色会明显降低微信识别率，慎用）")
    ap.add_argument("--out", default="扫码海报.png", help="海报输出路径")
    ap.add_argument("--qr-out", default=None,
                    help="单独导出大尺寸二维码 PNG（默认自动生成 <海报名>-二维码.png）")
    ap.add_argument("--no-qr-file", action="store_true", help="不额外导出单独的二维码文件")
    ap.add_argument("--qr-only", default=None, help="只生成二维码，不生成海报")
    args = ap.parse_args()

    qr_fg = BLACK
    if args.qr_fg:
        try:
            qr_fg = tuple(int(x) for x in args.qr_fg.split(","))
            assert len(qr_fg) == 3
        except Exception:
            sys.exit("--qr-fg 格式应为 r,g,b，例如 0,0,0")

    if args.qr_only:
        img = make_qr(args.url, args.qr_only, fg=qr_fg, target=QR_STANDALONE)
        print("✅ 二维码已生成: %s (%dx%d, 模块 %dpx, 静区 %d 模块)"
              % (args.qr_only, img.size[0], img.size[1],
                 img.qr_meta["module_px"], img.qr_meta["border"]))
        return

    # 单独的二维码大图：视频/PPT/印刷/无法长按的场景都要用，默认产出
    qr_out = args.qr_out
    if not qr_out and not args.no_qr_file:
        qr_out = os.path.splitext(args.out)[0] + "-二维码.png"
    if qr_out:
        img = make_qr(args.url, qr_out, fg=qr_fg, target=QR_STANDALONE)
        print("✅ 二维码大图: %s (%dx%d, 模块 %dpx)"
              % (qr_out, img.size[0], img.size[1], img.qr_meta["module_px"]))

    poster = make_poster(args.url, args.title, args.subtitle, args.stats,
                         args.points, args.footer, args.out,
                         qr_fg=qr_fg, tip=args.tip, tip2=args.tip2)
    size_kb = os.path.getsize(args.out) / 1024
    print("✅ 海报已生成: %s (%.0f KB)" % (args.out, size_kb))
    meta = getattr(poster, "qr_meta", None)
    if meta:
        print("   二维码: %dpx / 模块 %dpx / 静区 %d 模块"
              % (meta["size"], meta["module_px"], meta["border"]))
    print("🔍 反解二维码校验（原图）+ 微信可识别性体检…")
    if verify(args.out, args.url, meta) is False:
        sys.exit(1)
    print("🔍 反解二维码校验（模拟微信压缩链路）…")
    if verify_wechat(args.out, args.url) is False:
        sys.exit(1)
    print("✅ 二维码微信可识别性校验全部通过（下一步仍需确认宿主在微信内可打开）")


if __name__ == "__main__":
    main()
