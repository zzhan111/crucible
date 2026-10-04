#!/usr/bin/env python3
"""药点ERP 采购规则场景：从 ysbang-data/new_normalized 生成「每个 SKU 一行」的派生数据集（只含商品级聚合）。

用法：python3 data/build_yaodian.py --src /path/to/ysbang-data   （或设环境变量 YSBANG_DATA；源数据是私有仓库 zzhan111/ysbang-data 的本地只读克隆，不随本仓库发布）
输出：data/yaodian_skus.json   （build.py 会把它内联进 index.html）

隐私（crucible 仓库公开）：
  - 只读商品级字段与聚合；从不读取/输出 contact / saleMan / staffName / 会员 / 顾客 / 单据号 / orgName 等字段；
  - 不输出任何原始小票行；门店法定名称不进入输出（UI 里统一叫「药点ERP 示例药房」）。
口径（所有阈值都来自代码，见 RULE_SRC；文件:行号已对照只读克隆核对）：
  - 分层 / 加权日均 / 目标覆盖天数 / 建议量：ysbang-adapters packages/core/suggestion-engine.js（按 SKU 近似；原代码按 通用名×剂型 分组）
  - 临期禁补 90 天：ysbang-adapters data/strategy/purchase-strategy.json:12（设计文档 2026-04-24-design-v1.0-frozen.md:567；代码里没有读取它的地方）
  - 缺货候选 / 优先级分：ysbang-data analysis/dimension_c/c4_replenish.py:38-79
  - 库存信号灯：ysbang-data analysis/signals/run_cluster_signals.py:296-321
  - P0–P3：ysbang-adapters packages/platform-intelligence/compute-product-intelligence.js:274-315（按 SKU 近似）
  - 跨供应商价差：ysbang-data analysis/dimension_d/d7_supplier_price.py:25-32, 136-160（incl_self 口径，2026-04-01 起）
  - 滞销：ysbang-data build_frontend.py:299-304；ABC：build_new_normalized.py:733-746
"""
import argparse, json, math, os, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--src', default=os.environ.get('YSBANG_DATA'), help='私有仓库 ysbang-data 的本地只读克隆路径（也可用环境变量 YSBANG_DATA）')
ap.add_argument('--out', default=str(HERE / 'yaodian_skus.json'))
args = ap.parse_args()
if not args.src:
    ap.error('需要私有源数据：--src /path/to/ysbang-data 或环境变量 YSBANG_DATA')
SRC = Path(args.src)
NN = SRC / 'new_normalized'
sys.path.insert(0, str(SRC / 'analysis' / 'identity'))
from stem_extract import extract_one  # noqa: E402  纯函数：goodsName → 通用名词干 / 剂型

# ---- 参数：与 ysbang-adapters data/strategy/purchase-strategy.json（feat/drug-stem-enrich@84f70d7）一致 ----
TARGET_COVER = {'A': 7, 'B': 8, 'C': 30, 'NEW': 7}          # :5-10
EXPIRY_BLOCK_DAYS = 90                                       # :12
WEIGHTS = {7: 0.35, 14: 0.25, 30: 0.2, 60: 0.12, 90: 0.08}   # :14-20
LAYER = {'A': 20, 'B': 5, 'C': 1, 'D_zero': 90, 'NEW_days': 14, 'NEW_rec': 3}   # :21-28
NEW_CAP = {'factor': 10, 'abs': 5}                           # :33-37
P_DAYS = {'p0': 7, 'p1': 3, 'p2': 7, 'p3': 15}               # :39-44
D7 = {'auth': '2026-04-01', 'gap_pct': 5.0, 'saving': 1.0, 'extreme': 100.0}

# 只读这些字段（白名单）。个人字段从不进入内存结构以外的任何地方。
TICKET_KEEP = ('goodsCode', 'biz_kind', 'biz_date', 'num_f')
FLOW_KEEP = ('goodsCode', 'billType', 'biz_date', 'dates', 'num_f', 'batchPrice_f', 'businessName', 'goodsBalNum_f', 'valDate', 'recipeType')


def jl(p, keep=None):
    out = []
    with open(p, encoding='utf-8') as f:
        for line in f:
            r = json.loads(line)
            out.append({k: r.get(k) for k in keep} if keep else r)
    return out


man = json.load(open(NN / 'manifest.json', encoding='utf-8'))
AS_OF = date.fromisoformat(man.get('as_of') or man['data_as_of'])
prod = jl(NN / 'dim/dim_product.jsonl')
tick = jl(NN / 'fact/fact_sales_ticket.jsonl', TICKET_KEEP)
flow = jl(NN / 'fact/fact_inventory_flow.jsonl', FLOW_KEEP)
batch = jl(NN / 'dim/dim_batch.jsonl')
abc = {r['goodsCode']: r for r in jl(NN / 'agg/agg_product_abc.jsonl')}
sup_meta = {r['supplierName']: r for r in jl(NN / 'dim/dim_supplier.jsonl')}
d = lambda s: date.fromisoformat(s[:10])

# ---- 销售（只用 biz_kind=sales，与 c4 / suggestion-engine 一致）----
sales = defaultdict(list)          # goodsCode -> [(date, qty)]
for t in tick:
    if t['biz_kind'] == 'sales' and t['goodsCode']:
        sales[t['goodsCode']].append((d(t['biz_date']), float(t['num_f'] or 0)))
SALES_START = min(x for v in sales.values() for x, _ in v)


def win_qty(g, days):               # suggestion-engine salesInWindow：date >= asOf-days 且 <= asOf
    cut = AS_OF - timedelta(days=days)
    return sum(q for x, q in sales.get(g, []) if cut <= x <= AS_OF)


def sale_days(g, days):
    cut = AS_OF - timedelta(days=days)
    return len({x for x, q in sales.get(g, []) if cut <= x <= AS_OF and q > 0})


# ---- 库存流水：采购入库（billType=1）、最后一次结存变化、处方属性兜底 ----
purch = defaultdict(list)          # g -> [(date, datetime, price, qty, supplier, valDate)]
last_flow = {}                     # g -> (datetime, goodsBalNum_f, date)
first_in = {}
recipe = defaultdict(lambda: defaultdict(int))
for r in flow:
    g = r['goodsCode']
    dt = r['dates'] or r['biz_date']
    if r['recipeType']:
        recipe[g][r['recipeType']] += 1
    if g not in last_flow or dt > last_flow[g][0]:
        last_flow[g] = (dt, r['goodsBalNum_f'], d(r['biz_date']))
    if r['billType'] == 1 and (r['num_f'] or 0) > 0 and (r['batchPrice_f'] or 0) > 0:
        purch[g].append((d(r['biz_date']), dt, r['batchPrice_f'], r['num_f'], r['businessName'] or '', r['valDate']))
        first_in[g] = min(first_in.get(g, d(r['biz_date'])), d(r['biz_date']))

# 断货天数：当前结存为 0 时，距最后一笔流水（把结存打到 0 的那笔）的天数
# ---- 批次：在库批次最近效期（expiryGapDays = valDate - as_of）----
near_exp = {}
for b in batch:
    if (b.get('latest_batchBalNum') or 0) > 0 and b.get('expiryGapDays') is not None:
        g = b['goodsCode']
        near_exp[g] = min(near_exp.get(g, 10 ** 6), b['expiryGapDays'])

# ---- 通用名词干（族）----
ident = {p['goodsCode']: extract_one(p['goodsName'], p['goodsSpec'], p['goodsCode'], p['manufacturer']) for p in prod}
fam_stock = defaultdict(float); fam_n = defaultdict(int)
for p in prod:
    s = ident[p['goodsCode']]['drug_stem']
    fam_stock[s] += max(0.0, float(p['latest_goods_bal_num'] or 0)); fam_n[s] += 1


def rx_of(p):
    raw = p['rx_mode']
    if not raw:
        rc = recipe.get(p['goodsCode'])
        raw = max(rc, key=rc.get) if rc else None
    if not raw:
        return '未标注', ''
    if raw == '处方药':
        return '处方药', raw
    if '非处方' in raw or raw.startswith('非处方'):
        return 'OTC', raw if raw in ('甲类非处方药', '乙类非处方药') else '非处方药'
    return '其它', raw


def num(x, nd=1):
    if x is None:
        return None
    x = round(float(x), nd)
    return int(x) if x == int(x) else x


rows, mismatch = [], 0
for p in prod:
    g = p['goodsCode']
    stock = max(0.0, float(p['latest_goods_bal_num'] or 0))
    s7, s14, s30, s60, s90 = (win_qty(g, n) for n in (7, 14, 30, 60, 90))
    recs = len(sales.get(g, []))
    # 分层 classifyLayer（suggestion-engine.js:52-73）
    fi = first_in.get(g) or (d(p['first_flow_date']) if p.get('first_flow_date') else None)
    since_in = (AS_OF - fi).days if fi else math.inf
    sd30, sd90 = sale_days(g, 30), sale_days(g, 90)
    if since_in <= LAYER['NEW_days'] or recs < LAYER['NEW_rec']:
        layer = 'NEW'
    elif sd30 >= LAYER['A']:
        layer = 'A'
    elif sd30 >= LAYER['B']:
        layer = 'B'
    elif sd30 >= LAYER['C']:
        layer = 'C'
    elif sd90 == 0 and stock > 0:
        layer = 'D'
    else:
        layer = 'C'
    # 加权日均 weightedDailySales（:75-92）
    rate = sum(WEIGHTS[n] * (q / n) for n, q in zip((7, 14, 30, 60, 90), (s7, s14, s30, s60, s90))) / sum(WEIGHTS.values())
    wcover = 0.0 if stock <= 0 else (stock / rate if rate > 0 else None)
    cover7 = 0.0 if stock <= 0 else (stock / (s7 / 7) if s7 > 0 else None)   # 7 日均覆盖（信号灯口径）
    # 库存信号灯（run_cluster_signals.py:296-321）
    light = '断货' if stock <= 0 else ('近期无销' if s7 <= 0 else ('将尽' if cover7 < 7 else '够卖'))
    nexp = near_exp.get(g)
    # 现有补货建议（suggestion-engine.js:210-222 + 临期禁补 purchase-strategy.json:12）
    qty, why = 0, ''
    if layer == 'D':
        why = 'D 分层：近 90 天无销且有库存 → 跳过'
    elif rate <= 0 and layer != 'A':
        why = '近 90 天无销量 → 无需求，不补'
    elif nexp is not None and nexp <= EXPIRY_BLOCK_DAYS:
        why = f'在库批次 {nexp} 天内到期（≤{EXPIRY_BLOCK_DAYS}）→ 临期禁补'
    else:
        tgt = TARGET_COVER[layer]
        q = max(0, math.ceil(rate * tgt - stock))
        if layer == 'NEW' and q > 0:
            q = min(q, math.ceil(min((rate or 1) * NEW_CAP['factor'], NEW_CAP['abs'])))
        qty = q
        why = (f'{layer} 层目标覆盖 {tgt} 天：加权日均 {rate:.2f} × {tgt} − 库存 {num(stock)} → 补 {q}' if q > 0
               else f'{layer} 层目标覆盖 {tgt} 天，加权覆盖 {wcover:.1f} 天已够 → 不补')
    # 断货天数
    oos = None
    if stock <= 0 and g in last_flow:
        oos = (AS_OF - last_flow[g][2]).days
    # 族
    idn = ident[g]; stem = idn['drug_stem']
    fam_other = fam_stock[stem] - stock
    has_demand = s90 > 0
    # P0–P3（compute-product-intelligence.js:274-315，按 SKU 近似；只给近 90 天有销的 SKU 定级）
    prio = 'none'
    if has_demand:
        if fam_stock[stem] <= 0:
            prio = 'P0'
        elif stock <= 0 and (oos or 0) >= P_DAYS['p0']:
            prio = 'P0'
        elif stock <= 0:
            prio = 'P1'
        elif cover7 is not None and cover7 <= P_DAYS['p1']:
            prio = 'P1'
        elif cover7 is not None and cover7 <= P_DAYS['p2']:
            prio = 'P2'
        elif cover7 is not None and cover7 <= P_DAYS['p3']:
            prio = 'P3'
    # c4 缺货候选（c4_replenish.py:38-79）：近 7/30 天有销 & 零库存；优先级 = 近期销量 × (距上次销售天数 + 1)
    last_sale = max((x for x, _ in sales.get(g, [])), default=None)
    c4win, c4prio = 0, None
    if stock <= 0 and last_sale is not None:
        dsl = (AS_OF - last_sale).days
        if s7 > 0:
            c4win, c4prio = 7, round(s7 * (dsl + 1), 1)
        elif s30 > 0:
            c4win, c4prio = 30, round(s30 * (dsl + 1), 1)
    idle = (AS_OF - last_sale).days if last_sale else (AS_OF - SALES_START).days   # 从未销售：按销售数据起点计
    # 采购：最近进价、主供应商（采购量最多）、上次进货批次的剩余效期（入库时）
    pts = sorted(purch.get(g, []), key=lambda x: x[1])
    price = sup = last_buy = None; last_shelf = None
    if pts:
        lp = pts[-1]; price, last_buy = lp[2], lp[0].isoformat()
        by = defaultdict(float)
        for x in pts:
            by[x[4]] += x[3]
        sup = max(by, key=lambda k: (by[k], max(y[1] for y in pts if y[4] == k)))
        if lp[5]:
            last_shelf = (d(lp[5]) - lp[0]).days
    else:  # 没有采购入库流水 → 用批次表兜底
        bs = sorted([b for b in batch if b['goodsCode'] == g and b.get('firstInDate')], key=lambda b: b['firstInDate'])
        if bs:
            price = bs[-1].get('batchPrice'); sup = bs[-1].get('supplier'); last_buy = bs[-1]['firstInDate']
            if bs[-1].get('valDate'):
                last_shelf = (d(bs[-1]['valDate']) - d(bs[-1]['firstInDate'])).days
    # D7 跨供应商价差（incl_self 口径，4 月起权威窗口）
    gap_pct = saving = None; cheap = None
    view = defaultdict(lambda: [0.0, 0.0])
    for x in pts:
        if x[0].isoformat() >= D7['auth']:
            view[x[4]][0] += x[3]; view[x[4]][1] += x[2] * x[3]
    if len(view) >= 2:
        pr = {k: v[1] / v[0] for k, v in view.items() if v[0]}
        pmin, pmax = min(pr.values()), max(pr.values())
        gap_pct = round((pmax - pmin) / pmin * 100, 1) if pmin else None
        saving = round(sum((pr[k] - pmin) * view[k][0] for k in pr if pr[k] > pmin), 2)
        cheap = min(pr, key=pr.get)
    a = abc.get(g)
    rx, rx_raw = rx_of(p)
    rows.append({
        'code': g, 'name': p['goodsName'], 'spec': p['goodsSpec'] or '', 'unit': p['unit'] or '', 'mfr': p['manufacturer'] or '',
        'cat': p['cat_l1'] if p['cat_l1'] and p['cat_l1'] != '<missing>' else '未分类', 'cat2': p['cat_l2'] or '',
        'rx': rx, 'rxRaw': rx_raw, 'abc': a['abc'] if a else '无', 'cum': num(a['cumShare'] * 100, 2) if a else None,
        'layer': layer, 'stock': num(stock), 's7': num(s7), 's30': num(s30), 's90': num(s90), 'sd30': sd30, 'rate': num(rate, 3),
        'cover7': num(cover7), 'wcover': num(wcover), 'idle': idle, 'lastSale': last_sale.isoformat() if last_sale else None,
        'nearExp': nexp, 'lastShelf': last_shelf, 'price': num(price, 2), 'sup': sup, 'lastBuy': last_buy,
        'gapPct': gap_pct, 'saving': saving, 'cheap': cheap, 'stem': stem, 'form': idn['dosage_form'],
        'famN': fam_n[stem] - 1, 'famStock': num(fam_other), 'oos': oos, 'light': light, 'prio': prio,
        'c4': c4win, 'c4prio': c4prio, 'sugQty': qty, 'sug': '补' if qty > 0 else '不补', 'sugWhy': why,
    })

# ---- 取样：保留「有销售（近 8 个月）或有库存或有补货建议」的 SKU；从未销售且零库存的目录项不进原型 ----
keep = [r for r in rows if r['s90'] or r['lastSale'] or r['stock'] > 0 or r['sugQty'] > 0]
dropped = len(rows) - len(keep)
COLS = list(keep[0].keys())
meta = {
    'title': '药点ERP 示例药房 · 每 SKU 补货派生数据（商品级聚合，无个人信息）',
    'as_of': AS_OF.isoformat(), 'source': 'zzhan111/ysbang-data new_normalized（manifest as_of）+ ysbang-adapters 策略参数',
    'built_by': 'data/build_yaodian.py', 'products_total': len(rows), 'kept': len(keep), 'dropped_no_sales_no_stock': dropped,
    'with_suggestion': sum(1 for r in keep if r['sugQty'] > 0), 'with_sales_90d': sum(1 for r in keep if r['s90']),
    'sales_rows_used': sum(len(v) for v in sales.values()), 'flow_rows_used': len(flow), 'batches_used': len(batch),
    'params': {'targetCoverDays': TARGET_COVER, 'expiryBlockDays': EXPIRY_BLOCK_DAYS, 'weights': WEIGHTS, 'layer': LAYER, 'newCap': NEW_CAP, 'pDays': P_DAYS, 'd7': D7},
}
out = {'meta': meta, 'cols': COLS, 'rows': [[r[c] for c in COLS] for r in keep]}
Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps(meta, ensure_ascii=False, indent=1))
print('wrote', args.out, Path(args.out).stat().st_size, 'bytes')
