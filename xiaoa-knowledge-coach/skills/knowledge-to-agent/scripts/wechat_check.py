#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wechat_check.py — 微信生态交付体检（链接能不能在微信里打开 + 二维码能不能被微信识别）

为什么单独做这个脚本：
  交付出去的东西 90% 是在微信里被打开的——扫海报上的码、或者在微信群里点链接。
  「我在 Chrome 里打得开」完全不能证明「微信里打得开」：
    · 微信 iOS 是 WKWebView、安卓是腾讯 X5 内核，行为跟 Chrome 不一样
    · 域名若被举报过，微信会插一个拦截页（HTTP 依然 200，但内容变了）
    · 微信发图会对海报做有损压缩，二维码可能就"糊"到扫不出来
  这个脚本把上面这些全部机器化验证掉，避免交付完才发现扫不出来。

用法：
  # 全量体检（推荐）
  python wechat_check.py --url https://xxx.app.workbuddy.link \\
      --html index.html --poster 扫码海报.png

  # 只查链接
  python wechat_check.py --url https://xxx.app.workbuddy.link

  # 只查页面 meta 与二维码（没网也能跑）
  python wechat_check.py --html index.html --poster 扫码海报.png

退出码：0 = 全过；1 = 有 FAIL（不要在这种状态下把二维码烧出去）。
"""
import argparse
import os
import re
import sys
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- 真实微信 UA（2026-09 抓取）----
UA_WX_IOS = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 "
             "MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN")
UA_WX_AND = ("Mozilla/5.0 (Linux; Android 14; PJD110 Build/UKQ1.230924.001; wv) "
             "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 "
             "Mobile Safari/537.36 XWEB/1160117 MMWEBSDK/20231202 MMWEBID/1234 "
             "MicroMessenger/8.0.47.2560(0x28002F35) WeChat/arm64 Weixin "
             "NetType/WIFI Language/zh_CN ABI/arm64")

# ---- 微信拦截页特征串（命中任意一条 = 被拦）----
BLOCK_MARKERS = [
    "已停止访问该网页",
    "已停止访问",
    "网页包含违规内容",
    "该网页可能存在风险",
    "非微信官方网页",
    "如需浏览，请长按网址复制后使用浏览器访问",
    "请在微信客户端打开链接",
    "weixin110.qq.com",
    "jump.weixin.qq.com/cgi-bin/readtemplate",
]

# ---- 宿主平台自己拦微信（不是微信拦域名）----
# 实测（2026-09-10）：** WorkBuddy 静态托管 *.app.workbuddy.link 对含 MicroMessenger 的 UA
# 一律返回 HTTP 403，并给出平台自己的"请在浏览器中打开"页 **，文案为
# 「当前应用不支持在微信内打开，请复制链接后在浏览器（Safari / Chrome 等）中访问。」
# 这是平台策略，站点侧没有任何开关能改。命中它就必须换宿主，或改交付文案。
HOST_BLOCK_MARKERS = [
    "不支持在微信内打开",
    "请在浏览器中打开",
    "请复制链接后在浏览器",
]

# ---- 实测「不拦微信 UA」的静态托管（2026-09-10 curl 验证）----
# 注意：这是平台级行为验证，不是对用户站点的验证；换了宿主必须再用本脚本复验。
ALT_HOSTS = [
    ("Cloudflare Pages", "*.pages.dev", "实测 200"),
    ("GitHub Pages", "*.github.io", "实测 200"),
    ("Netlify", "*.netlify.app", "实测 200"),
    ("Vercel", "*.vercel.app", "本机未连通，待自测"),
]

# ---- 页面必需的 meta（微信内置浏览器 / 分享卡片）----
REQUIRED_META = [
    ("viewport", "响应式布局的前提"),
    ("format-detection", "防数字被识别成电话/日期链接"),
    ("theme-color", "微信顶栏配色"),
    ("x5-orientation", "安卓微信 X5 内核锁竖屏"),
]

# ---- 微信屏蔽的前端 API（源码里出现就是隐患）----
BANNED_API = [
    (r"(?<![\w.])confirm\s*\(", "confirm()：iOS 微信静默返回 false，改应用内弹层"),
    (r"(?<![\w.])alert\s*\(", "alert()：微信会拦截，改应用内 toast/弹层"),
    (r"(?<![\w.])prompt\s*\(", "prompt()：微信会拦截，改应用内输入弹层"),
    (r"window\.open\s*\(", "window.open()：微信会拦截，改 location.href"),
]

OK = "✅"
BAD = "❌"
SKIP = "⚠️ "


class Report:
    def __init__(self):
        self.fails = []

    def line(self, good, name, detail=""):
        print("  %s %-38s %s" % (OK if good else BAD, name, detail))
        if not good:
            self.fails.append(name)


def fetch(url, ua, timeout=15):
    """返回 (status, content_type, text)。失败抛异常。"""
    req = urllib.request.Request(url, headers={
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        ctype = (r.headers.get("Content-Type") or "").lower()
        # 微信内置浏览器对 BOM/gbk 也会渲染，这里稳一点按 utf-8 兜底解码
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("gbk", "ignore")
        return r.status, ctype, text


def check_url(rep, url, expect=None, timeout=15):
    print("\n【A】链接在微信里能不能打开")
    host_blocked = False
    for label, ua in (("iOS 微信 (WKWebView)", UA_WX_IOS),
                      ("安卓微信 (X5 内核)", UA_WX_AND)):
        try:
            status, ctype, text = fetch(url, ua, timeout)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "ignore")
            except Exception:
                pass
            if any(m in body for m in HOST_BLOCK_MARKERS):
                host_blocked = True
                rep.line(False, "%s 可达" % label,
                         "HTTP %s · 宿主平台拒绝微信 UA" % e.code)
            else:
                rep.line(False, "%s 可达" % label, "HTTP %s" % e.code)
            continue
        except Exception as e:
            rep.line(False, "%s 可达" % label, "%s" % type(e).__name__)
            continue
        rep.line(status == 200, "%s 可达" % label, "HTTP %s" % status)
        rep.line("text/html" in ctype, "%s 是网页而非下载" % label,
                 ctype.split(";")[0] or "(空)")
        # 平台级拒绝优先判定
        if any(m in text for m in HOST_BLOCK_MARKERS):
            host_blocked = True
            rep.line(False, "%s 未被拦截" % label, "命中的是**宿主平台**自己的拦截页")
            continue
        hit = [m for m in BLOCK_MARKERS if m in text]
        rep.line(not hit, "%s 未被微信拦截" % label,
                 ("命中拦截特征：%s" % hit[0]) if hit else "无拦截特征串")
        if expect:
            rep.line(expect in text, "%s 内容含特征串" % label,
                     repr(expect) if expect in text else "页面里找不到 %r" % expect)

    if host_blocked:
        print("""
  ── 诊断：宿主不允许微信内打开 ──────────────────────────────
  这不是微信拦你的域名，而是**托管平台自己在拦微信**：它认得 MicroMessenger
  这个 UA，直接返回 403 + 一张"请在浏览器中打开"的页面。
  站点侧没有开关能改（已确认平台按策略执行），只能二选一：

   ① 换宿主（推荐）：把同一份 index.html 发到不拦微信的静态托管，常见实测可用：
""")
        for name, pat, note in ALT_HOSTS:
            print("        · %-16s %-16s %s" % (name, pat, note))
        print("""      这些都需要你自己的账号；部署完**必须**用本脚本再验一遍，别直接发。
   ② 留在原宿主，但改交付文案：不要写"微信扫码即玩"，
      改成"扫码即玩 · 建议在浏览器打开"，并补一行
      "在微信内请点右上角 ··· → 在浏览器打开"。
  ──────────────────────────────────────────────────────────""")
    return host_blocked


def load_html(rep, html_path):
    if not html_path:
        return None
    if not os.path.exists(html_path):
        rep.line(False, "找到页面文件", html_path)
        return None
    with open(html_path, encoding="utf-8") as f:
        return f.read()


def check_meta(rep, html):
    print("\n【B】页面 meta（微信内置浏览器 / 分享卡片）")
    for name, why in REQUIRED_META:
        found = re.search(r'<meta[^>]+name=["\']%s["\']' % re.escape(name), html, re.I)
        rep.line(bool(found), "meta name=%s" % name, why)
    og = len(re.findall(r'<meta[^>]+property=["\']og:', html, re.I))
    rep.line(og >= 2, "og 分享卡片标签", "找到 %d 个（建议 >=2：og:title/og:description）" % og)
    # 分享卡片图片必须绝对地址，否则微信抓不到
    if re.search(r'property=["\']og:image["\'][^>]*content=["\']/', html, re.I):
        rep.line(False, "og:image 是绝对地址", "当前是相对路径，微信抓不到图")
    else:
        rep.line(True, "og:image 未用相对路径", "发布后可补绝对地址")


def check_banned_api(rep, html):
    print("\n【C】微信屏蔽的前端 API")
    # 去掉注释再扫，避免把说明文字当成真实调用
    code = re.sub(r"/\*.*?\*/", "", html, flags=re.S)
    code = re.sub(r"^\s*//.*$", "", code, flags=re.M)
    for pat, why in BANNED_API:
        hits = re.findall(pat, code)
        rep.line(not hits, "无 %s" % pat.replace("\\s*", "").replace("(?<![\\w.])", ""),
                 why if hits else "未发现")


def check_qr(rep, poster, url, border):
    print("\n【D】二维码：微信压缩链路 + 识别规范")
    if not poster:
        return
    if not os.path.exists(poster):
        rep.line(False, "找到海报文件", poster)
        return
    try:
        import qrcode
        from qrcode.constants import ERROR_CORRECT_H
    except ImportError:
        print("  %s未安装 qrcode，跳过（pip install qrcode[pillow]）" % SKIP)
        return
    q = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_H,
                      box_size=10, border=border)
    q.add_data(url or "")
    q.make(fit=True)
    meta = {"modules_total": q.modules_count + 2 * border, "border": border, "size": 0}
    try:
        sys.path.insert(0, HERE)
        from make_qr_poster import verify, verify_wechat
    except Exception as e:
        print("  %s无法加载 make_qr_poster（%s），跳过" % (SKIP, e))
        return
    r1 = verify(poster, url, meta)
    r2 = verify_wechat(poster, url)
    if r1 is False:
        rep.fails.append("二维码原图反解")
    if r2 is False:
        rep.fails.append("二维码微信压缩链路")


def main():
    ap = argparse.ArgumentParser(description="微信生态交付体检")
    ap.add_argument("--url", default=None, help="云端链接（不填则跳过链接检查）")
    ap.add_argument("--html", default=None, help="成品 index.html 路径（查 meta 与受限 API）")
    ap.add_argument("--poster", default=None, help="海报 PNG 路径（查二维码）")
    ap.add_argument("--qr-border", type=int, default=4, help="二维码静区模块数（默认 4）")
    ap.add_argument("--expect", default=None, help="内容一致性特征串，如 '我已知晓'")
    ap.add_argument("--timeout", type=int, default=15)
    args = ap.parse_args()

    print("=" * 62)
    print("微信生态交付体检")
    print("=" * 62)
    if args.url:
        print("链接:", args.url)
    if args.html:
        print("页面:", args.html)
    if args.poster:
        print("海报:", args.poster)

    rep = Report()
    if args.url:
        check_url(rep, args.url, args.expect, args.timeout)
    html = load_html(rep, args.html)
    if html:
        check_meta(rep, html)
        check_banned_api(rep, html)
    check_qr(rep, args.poster, args.url, args.qr_border)

    print("\n" + "=" * 62)
    if rep.fails:
        print("%s 体检未通过，共 %d 项不达标：" % (BAD, len(rep.fails)))
        for f in rep.fails:
            print("   · %s" % f)
        print("   修完再烧二维码/发链接 —— 微信里打不开等于没交付。")
        print("=" * 62)
        sys.exit(1)
    print("%s 微信生态体检全部通过 —— 可以放心在微信里发链接/发海报" % OK)
    print("=" * 62)


if __name__ == "__main__":
    main()
