#!/usr/bin/env python3
"""隐私扫描：检查构建产物里有没有个人信息。只打印计数和打码后的命中，绝不打印原始个人信息。
用法：python3 data/privacy_scan.py [index.html ...] [--src /path/to/ysbang-data]   （或设环境变量 YSBANG_DATA；源数据是私有仓库，不随本仓库发布）
检查项：
  1. 手机号 1[3-9]\\d{9}、打码手机号（形如 1XX****XXXX，中间 4 位打码）、18 位身份证号、邮箱
  2. 药房法定名称及其字号（运行时从源数据 orgName 取，脚本里不写死）
  3. 源数据 fact_sales_ticket 的 contact / saleMan / staffName / orgName 里出现过的姓名、单位名、数字串
     （运行时从私有源数据读取，只在内存里比对；1 个字的值跳过，数字串排除商品编码）
     2 字姓名常是厂家/供应商名称的子串（如“××药业”里的两个字）：先把产物里出现的厂家名、供应商名、商品名整体抹掉再比对，
     抹掉后仍出现才算命中；被抹掉前出现、抹掉后消失的记为“误报（仅出现在企业/商品名称里）”，只报数量。
退出码：0 = 干净；1 = 有命中；2 = 源数据不可用（只做了正则部分）"""
import json, os, re, sys, pathlib

args = sys.argv[1:]
src = os.environ.get('YSBANG_DATA')
if '--src' in args:
    i = args.index('--src'); src = args[i + 1]; del args[i:i + 2]
root = pathlib.Path(__file__).resolve().parent.parent
files = [pathlib.Path(a) for a in args] or [root / 'index.html']

PATTERNS = {
    '手机号': re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)'),
    '打码手机号': re.compile(r'(?<!\d)1[3-9]\d[\*＊xX]{4}\d{4}(?!\d)'),
    '身份证号': re.compile(r'(?<![\dA-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])'),
    '邮箱': re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
}
mask = lambda s: (s[0] + '*' * (len(s) - 1)) if len(s) > 1 else '*'

def load_personal(src):
    if not src:
        return None, None, None
    p = pathlib.Path(src) / 'new_normalized/fact/fact_sales_ticket.jsonl'
    if not p.exists():
        return None, None, None
    names, nums, orgs = set(), set(), set()
    with open(p, encoding='utf-8') as fh:
        for line in fh:
            r = json.loads(line)
            for k in ('contact', 'saleMan', 'staffName', 'orgName'):
                v = r.get(k)
                if not v or not isinstance(v, str):
                    continue
                if k == 'orgName':
                    orgs.add(v.strip())
                for tok in re.split(r'[\s,，;；/|()（）:：\-]+', v.strip()):
                    if not tok:
                        continue
                    if re.fullmatch(r'\d{6,}', tok):
                        nums.add(tok)
                    elif re.search(r'[\u4e00-\u9fff]', tok) and len(tok) >= 2:
                        names.add(tok)
    return names, nums, org_terms(orgs)

def org_terms(orgs):
    """药房法定名称 → {全称, 字号}。字号 = 去掉开头的「××市/县/区」和结尾的「大药房/药房/药店…有限公司」后剩下的部分。"""
    out = set()
    for o in orgs:
        if len(o) >= 4:
            out.add(o)
        m = re.match(r'^(?:.{1,6}?[省市县区])?([\u4e00-\u9fff]{2,6}?)(?:大药房|药房|药店|医药|诊所|大)', o)
        if m:
            out.add(m.group(1))
    return out

COMMON = {'未知', '散客', '顾客', '会员', '个人', '客户'}  # contact 里的通用占位词，不是个人信息

def business_strings():
    """产物里合法出现的企业 / 商品名称（厂家、供应商、商品名、便利店商品名）"""
    out = set()
    yd = root / 'data/yaodian_skus.json'
    if yd.exists():
        d = json.loads(yd.read_text(encoding='utf-8')); C = d['cols']
        for r in d['rows']:
            o = dict(zip(C, r))
            for k in ('name', 'mfr', 'sup', 'cheap', 'stem'):
                if isinstance(o.get(k), str) and len(o[k]) >= 2:
                    out.add(o[k])
    return out

names, nums, orgterms = load_personal(src)
total = 0
for f in files:
    text = f.read_text(encoding='utf-8')
    print(f'== {f} ({len(text.encode())} bytes)')
    for label, rx in PATTERNS.items():
        hits = rx.findall(text)
        total += len(hits)
        print(f'  {label}: {len(hits)}' + (f'  e.g. {mask(hits[0])}' if hits else ''))
    if names is None:
        print('  药房法定名称 / 源数据个人字段: 跳过（未提供 --src / YSBANG_DATA，或找不到 fact_sales_ticket.jsonl）')
        continue
    oh = sorted(t for t in orgterms if t in text)
    total += len(oh)
    print(f'  药房法定名称或字号（{len(orgterms)} 个候选，运行时取自源数据 orgName）: {len(oh)}' + (f'  e.g. {mask(oh[0])}' if oh else ''))
    codes = set(re.findall(r'"(\d{6,})"', text))  # 商品编码等出现在数据里的编码不算
    runs = set(re.findall(r'\d{6,}', text))
    raw = sorted(n for n in names if n in text)
    stripped = text
    for b in sorted(business_strings(), key=len, reverse=True):
        stripped = stripped.replace(b, ' ')
    nh = [n for n in raw if n in stripped and n not in COMMON]
    fp = len(raw) - len(nh)
    dh = sorted(n for n in nums if n not in codes and n in runs)
    total += len(nh) + len(dh)
    print(f'  contact/saleMan/staffName/orgName 姓名或名称（{len(names)} 个候选）: {len(nh)}' + (f'  e.g. {", ".join(mask(x) for x in nh[:5])}' if nh else '') + (f'  （另有 {fp} 个误报：只出现在厂家/供应商/商品名称里或是通用词）' if fp else ''))
    print(f'  上述字段里的数字串（{len(nums)} 个候选，排除编码）: {len(dh)}')
print('RESULT:', 'CLEAN' if total == 0 else f'{total} HIT(S)')
sys.exit(2 if names is None and total == 0 else (1 if total else 0))
