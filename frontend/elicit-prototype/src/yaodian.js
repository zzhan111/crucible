/* ================= 场景 2：药点ERP 采购规则（药房补货，1,272 SKU，截至 2026-09-06） =================
   数据：window.__YAODIAN__ = data/yaodian_skus.json（由 data/build_yaodian.py 从 ysbang-data new_normalized 派生；
   只有商品级聚合，没有任何人员 / 顾客 / 单据级字段）。
   判定三档：该买 / 待确认 / 不该买。代码规则 = ysbang 仓库里已有的规则（标文件:行）；访谈规则 = 2026-09-28 老板访谈纪要。 */
const YD_DOC = 'docs/procurement-ai-owner-interview.md';
const YD_STORE = '药点ERP 示例药房';
// 纪要原文（逐字摘录；纪要第 5 行注明它是结构化记录，不是逐字转录）
const YD_Q = {
  18: '老板明确的信任损害排序：推荐不该买的品种最严重，数量不合理其次，漏补再次。漏补可能延迟暴露，但同样会累积不信任。已有商品或相近品种库存充足仍推荐增购，是最容易被识别的严重错误。',
  29: '默认集中采购。没有较大收益及老板明确指令，不执行拆单。',
  34: '店员提供反馈；老板作采购决定。AI 分析与执行授权不能混同。',
  35: '不自动创建/提交订单或付款。',
  54: '主供应商优先药中缘，理由是买得齐、整体便宜。',
  82: '普通商品偏好 5、10、15、20 等五的倍数；实际需要 2～3 盒时，通常凑到 5 盒。',
  83: '高价商品不强行凑五。老板举例每盒采购进价约 30 元以上；明确是采购进价，不是零售价。30 元是参考线，不是已批准的精确硬阈值。',
  84: '如果需补 5 盒但最低起购 20 盒，应列待确认，解释额外库存、支出及消化风险，不自动提高到 20 盒。',
  92: '对话中提到过 5% 价差，但没有确认它是提醒硬阈值，也未确定主比较基准。',
  98: '剩余效期一年以内需要老板单独确认；一年附近的精确天数/月数边界尚未定义。',
  99: '效期未知：待确认，核实前不加购。',
  104: '普通品种缺货时，如已有能承接需求的商品库存，老板倾向先卖现有库存。',
  105: '经营上的相近库存不能直接等同临床可替代；药学替代不由 AI 自行认定。',
  106: '必备流量品牌是例外：芬必得、999 感冒灵、江中健胃消食等，即使有同类品也需考虑保留，但数量不宜过多。',
  112: '现有心脑血管商品已经难销且库存多，再建议补某种苯磺酸氨氯地平，会让老板认为 AI 不理解经营。复方丹参滴丸、速效救心丸则可能接受补货，原因是常备价值和顾客点名需求。',
  114: '这是具体经营判断，不是将苯磺酸氨氯地平永久禁补，也不是给上述两款自动采购授权。它们自身库存足够时同样不能盲目增购；大类积压不能抹平具体需求差异。',
  140: '正心泰胶囊：老板表示已给过两次机会、现存很多，相比其他心脑血管商品走得慢，下次不再订。具体厂家规格仍需核对；本文不修改系统规则。',
  142: '老板允许 AI 在明确新需求出现后带证据申请重新考虑，但不得自动解除停补，也不能忽视现存库存。低价、凑券不是默认重启采购的理由。',
  148: '店员只是反馈入口，无权自行补货；采购决定由老板作出。',
};
// 纪要点名的必备流量品牌 → 本店 SKU（人工映射，推断；见 ⑤ 数据说明）
const YD_MUST = [
  { brand: '芬必得', name: '布洛芬缓释胶囊', mfr: '中美天津史克' },
  { brand: '999 感冒灵', name: '感冒灵颗粒', mfr: '华润三九' },
  { brand: '江中健胃消食', name: '健胃消食片', mfr: '江中药业' },
];
const YD_STOP = [{ name: '正心泰胶囊', line: 140 }];
const YD_CAT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4b5563', '#a16207', '#0d9488', '#7c3aed'];
const YD_SUP_TOP = 8;
let YD_SUPS = [], YD_CATS = [], YD_CATC = {};
const shortMfr = m => !m ? '' : m.replace(/[（(].*?[)）]/g, '').replace(/(股份)?有限(责任)?公司|集团|制药厂|制药|药业|医药/g, '').slice(0, 8);
const ydNum = v => v == null ? '—' : String(v);
const ydMust = it => YD_MUST.find(b => it.rawName === b.name && (it.mfr || '').includes(b.mfr));

function ydBuildItems() {
  const D = window.__YAODIAN__ || { cols: [], rows: [] };
  const items = D.rows.map(r => { const o = {}; D.cols.forEach((c, i) => o[c] = r[i]); return o; });
  items.forEach(it => {
    it.rawName = it.name; it.sku = it.code;
    it.name = `${it.rawName}｜${shortMfr(it.mfr) || '厂家未知'}`;
    const m = ydMust(it); it.must = m ? '是' : '否'; it.mustBrand = m ? m.brand : '';
    const st = YD_STOP.find(x => it.rawName === x.name); it.stop = st ? '是' : '否';
    it.expKnown = it.lastShelf != null ? '是' : '否';
  });
  const supN = {}; items.forEach(it => { if (it.sup) supN[it.sup] = (supN[it.sup] || 0) + 1; });
  YD_SUPS = Object.entries(supN).sort((a, b) => b[1] - a[1]).slice(0, YD_SUP_TOP).map(x => x[0]);
  items.forEach(it => { it.supG = !it.sup ? '无采购记录' : YD_SUPS.includes(it.sup) ? it.sup : '其他供应商'; });
  const catN = {}; items.forEach(it => catN[it.cat] = (catN[it.cat] || 0) + 1);
  YD_CATS = Object.entries(catN).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  YD_CATS.forEach((c, i) => YD_CATC[c] = YD_CAT_COLORS[i % YD_CAT_COLORS.length]);
  return items;
}
const ydVals = k => () => uniq(ITEMS.map(it => it[k]));
const YD_FIELDS = {
  sugQty: { label: '现有建议补货量', unit: '', type: 'num', get: it => it.sugQty, hint: '按代码规则算出的数量（单位随商品：盒/瓶/克…）' },
  stock: { label: '当前库存', unit: '', type: 'num', get: it => it.stock },
  s7: { label: '近7天销量', unit: '', type: 'num', get: it => it.s7 },
  s30: { label: '近30天销量', unit: '', type: 'num', get: it => it.s30 },
  s90: { label: '近90天销量', unit: '', type: 'num', get: it => it.s90 },
  rate: { label: '加权日均销量', unit: '/天', type: 'num', get: it => it.rate },
  wcover: { label: '加权覆盖天数', unit: '天', type: 'num', get: it => it.wcover, hint: '库存 ÷ 加权日均（suggestion-engine 口径）' },
  cover7: { label: '7日均覆盖天数', unit: '天', type: 'num', get: it => it.cover7, hint: '库存 ÷ 近 7 天日均（信号灯口径）' },
  idle: { label: '距上次销售', unit: '天', type: 'num', get: it => it.idle },
  nearExp: { label: '在库最近效期', unit: '天', type: 'num', get: it => it.nearExp },
  lastShelf: { label: '上次进货剩余效期', unit: '天', type: 'num', get: it => it.lastShelf },
  price: { label: '上次进价', unit: '元', type: 'num', get: it => it.price },
  gapPct: { label: 'D7 价差', unit: '%', type: 'num', get: it => it.gapPct },
  saving: { label: 'D7 每件可省', unit: '元', type: 'num', get: it => it.saving },
  famStock: { label: '同通用名其他SKU库存', unit: '', type: 'num', get: it => it.famStock },
  oos: { label: '断货天数', unit: '天', type: 'num', get: it => it.oos },
  cum: { label: 'ABC 累计销售额占比', unit: '%', type: 'num', get: it => it.cum },
  abc: { label: 'ABC', unit: '', type: 'enum', get: it => it.abc, values: () => ['A', 'B', 'C', '无'] },
  layer: { label: '补货分层', unit: '', type: 'enum', get: it => it.layer, values: () => ['A', 'B', 'C', 'D', 'NEW'] },
  rx: { label: '处方/OTC', unit: '', type: 'enum', get: it => it.rx, values: () => ['处方药', 'OTC', '其它'] },
  cat: { label: '品类', unit: '', type: 'enum', get: it => it.cat, values: () => YD_CATS },
  light: { label: '库存信号灯', unit: '', type: 'enum', get: it => it.light, values: ydVals('light') },
  prio: { label: '优先级 P0–P3', unit: '', type: 'enum', get: it => it.prio, values: () => ['P0', 'P1', 'P2', 'P3', 'none'] },
  sug: { label: '现有建议', unit: '', type: 'enum', get: it => it.sug, values: () => ['补', '不补'] },
  must: { label: '必备流量品', unit: '', type: 'bool', get: it => it.must, opts: ['是', '否'] },
  stop: { label: '停补名单', unit: '', type: 'bool', get: it => it.stop, opts: ['是', '否'] },
  expKnown: { label: '进货效期已知', unit: '', type: 'bool', get: it => it.expKnown, opts: ['是', '否'] },
  name: { label: '通用名', unit: '', type: 'text', get: it => it.rawName },
  mfr: { label: '厂家', unit: '', type: 'text', get: it => it.mfr || '' },
};

/* ---------- 种子规则 ---------- */
const YD_REPO_A = 'ysbang-adapters', YD_REF_A = 'feat/drug-stem-enrich@84f70d7', YD_REPO_D = 'ysbang-data';
function ydRules() {
  const t = nowIso();
  const sc = o => Object.assign({ abc: [], layer: [], rx: [], cats: [], sups: [] }, o || {});
  const C = (id, scope, conds, action, why, src, extra) => Object.assign({ id, origin: 'default', seed: false, active: true, scope: sc(scope), conds, action, exceptions: [], quote: '', why, src: Object.assign({ kind: 'code' }, src), createdFrom: { via: 'code' }, createdAt: t }, extra || {});
  const I = (id, scope, conds, action, line, pending, extra) => Object.assign({ id, origin: 'expert', seed: false, active: true, scope: sc(scope), conds, action, exceptions: [], quote: YD_Q[line], why: '', src: { kind: 'interview', doc: YD_DOC, line, ref: 'ysbang-data origin/docs/procurement-ai-owner-interview' }, pending, createdFrom: { via: 'interview' }, createdAt: t }, extra || {});
  const ENG = 'packages/core/suggestion-engine.js', PS = 'data/strategy/purchase-strategy.json';
  return [
    C('C1', { layer: ['D'] }, [], { type: 'veto' }, 'D 分层（近 90 天无销且有库存）→ 跳过，不补', { repo: YD_REPO_A, file: ENG, line: '210', ref: YD_REF_A }),
    C('C2', { layer: ['B', 'C', 'NEW'] }, [{ field: 'rate', op: '≤', value: 0 }], { type: 'veto' }, '加权日均销量为 0 且不是 A 层 → 无需求，不补', { repo: YD_REPO_A, file: ENG, line: '211', ref: YD_REF_A }),
    C('C3', { layer: ['A', 'NEW'] }, [{ field: 'wcover', op: '≥', value: 7 }], { type: 'veto' }, 'A / NEW 层目标覆盖 7 天：加权覆盖已够 → 不补（否则补到 日均×7 − 库存）', { repo: YD_REPO_A, file: PS, line: '5-10', ref: YD_REF_A, also: ENG + ':213-217' }),
    C('C4', { layer: ['B'] }, [{ field: 'wcover', op: '≥', value: 8 }], { type: 'veto' }, 'B 层目标覆盖 8 天（该分支 60c1360 由 15 改为 8；默认分支 feat/pi-production-ui 仍是 15）', { repo: YD_REPO_A, file: PS, line: '5-10', ref: YD_REF_A, also: ENG + ':213-217' }),
    C('C5', { layer: ['C'] }, [{ field: 'wcover', op: '≥', value: 30 }], { type: 'veto' }, 'C 层目标覆盖 30 天：加权覆盖已够 → 不补', { repo: YD_REPO_A, file: PS, line: '5-10', ref: YD_REF_A, also: ENG + ':213-217' }),
    C('C6', {}, [{ field: 'nearExp', op: '≤', value: 90 }], { type: 'veto' }, '在库批次 90 天内到期 → 临期禁补（参数在 JSON；仓库里没有代码读取它，设计文档 docs/plan/2026-04-24-design-v1.0-frozen.md:567）', { repo: YD_REPO_A, file: PS, line: '12', ref: YD_REF_A }),
    C('C7', { rx: ['处方药'] }, [], { type: 'flag', label: '处方药' }, '处方药无处方硬拦截——是收银合规规则，不是采购规则，这里只做标记', { repo: YD_REPO_A, file: 'packages/cashier-hub/lib/compliance.js', line: '77-84', ref: YD_REF_A }),
    C('C8', {}, [{ field: 'stock', op: '>', value: 0 }, { field: 'idle', op: '≥', value: 60 }], { type: 'flag', label: '滞销' }, '有库存且 60 天无销售 → 滞销（看板标签）', { repo: YD_REPO_D, file: 'build_frontend.py', line: '299-304' }),
    C('C9', {}, [{ field: 'stock', op: '≤', value: 0 }, { field: 's30', op: '>', value: 0 }], { type: 'flag', label: '缺货补货候选' }, '近 7/30 天有销且库存 0 → 补货候选，优先级 = 近期销量 ×（断货天数+1）', { repo: YD_REPO_D, file: 'analysis/dimension_c/c4_replenish.py', line: '38-79' }),
    C('C10', {}, [{ field: 'stock', op: '>', value: 0 }, { field: 'cover7', op: '<', value: 7 }], { type: 'flag', label: '将尽' }, '库存信号灯：覆盖 0 断货、<3 / <7 将尽、其余够卖（7 日均口径）', { repo: YD_REPO_D, file: 'analysis/signals/run_cluster_signals.py', line: '296-319' }),
    C('C11', {}, [{ field: 'prio', op: '=', value: 'P0' }], { type: 'flag', label: 'P0' }, 'P0：同通用名整族无库存，或该剂型断货 ≥7 天（原逻辑按 通用名×剂型 计算，这里按 SKU 近似）', { repo: YD_REPO_A, file: 'packages/platform-intelligence/compute-product-intelligence.js', line: '274-315', ref: YD_REF_A }),
    C('C12', {}, [{ field: 'prio', op: '=', value: 'P1' }], { type: 'flag', label: 'P1' }, 'P1：覆盖 ≤3 天（或断货 <7 天）；P2 ≤7、P3 ≤15', { repo: YD_REPO_A, file: 'packages/platform-intelligence/compute-product-intelligence.js', line: '274-315', ref: YD_REF_A }),
    C('C13', {}, [{ field: 'gapPct', op: '≥', value: 5 }, { field: 'saving', op: '≥', value: 1 }], { type: 'flag', label: '可换供应商' }, 'D7：同品别家价差 ≥5% 且每件省 ≥1 元 → 提示换供应商；价差 ≥100% 疑似录入错误', { repo: YD_REPO_D, file: 'analysis/dimension_d/d7_supplier_price.py', line: '25-32' },
      { exceptions: [{ field: 'gapPct', op: '≥', value: 100, quote: '' }], pending: ['纪要 L92：' + YD_Q[92]] }),
    C('C14', {}, [{ field: 'gapPct', op: '≥', value: 100 }], { type: 'flag', label: '疑似价格录入错误' }, 'D7：价差 ≥100% → 疑似数据错误，不据此换供应商', { repo: YD_REPO_D, file: 'analysis/dimension_d/d7_supplier_price.py', line: '25-32' }),
    I('I1', {}, [{ field: 'stop', op: '=', value: '是' }], { type: 'veto' }, 140, ['具体厂家规格仍需核对（纪要 L140）；停补名单为人工映射', '纪要 L142：不得自动解除停补']),
    I('I2', {}, [{ field: 'lastShelf', op: '<', value: 365 }], { type: 'confirm' }, 98, ['“一年”边界未定义（纪要 L98），365 天待确认', '用“上次进货批次的剩余效期”近似本次可买到的效期']),
    I('I3', {}, [{ field: 'expKnown', op: '=', value: '否' }], { type: 'confirm' }, 99, ['“效期未知”用“没有采购批次效期记录”近似']),
    I('I4', {}, [{ field: 'stock', op: '≤', value: 0 }, { field: 'famStock', op: '>', value: 0 }], { type: 'confirm' }, 104, ['“能承接需求的库存”用“同通用名其他 SKU 有库存”近似', '纪要 L105：' + YD_Q[105]]),
    I('I5', {}, [{ field: 'price', op: '<', value: 30 }], { type: 'round', step: 5 }, 82, ['纪要 L83：' + YD_Q[83]]),
  ];
}
const YD_SEED_LABELS = [
  ['80000805', 'bad', '【示例·依据纪要 L140】已确认停补案例'],
  ['10000906', 'good', '【示例·依据纪要 L106】必备流量品牌（江中健胃消食），有同类品也保留'],
  ['10136595', 'mid', '【示例·依据纪要 L104】缺货但同通用名还有其他库存，先问老板'],
  ['10012877', 'bad', '【示例·依据纪要 L112】心脑血管品难销且库存多时不该再补苯磺酸氨氯地平'],
  ['10002258', 'good', '【示例·依据纪要 L112】常备价值和顾客点名需求'],
  ['10002192', 'bad', '【示例·依据纪要 L114】自身库存足够时不能盲目增购'],
  ['10053676', 'bad', '【示例·依据纪要 L106】必备流量品也“数量不宜过多”，库存够卖'],
  ['80000247', 'bad', '【示例·依据纪要 L112】'],
  ['10004536', 'mid', '【示例·依据纪要 L98】上次进货剩余效期不足一年，需老板单独确认'],
];
const YD_PILE = ['10000906', '10136595', '10012877', '10002258', '10004536', '10209911', '10184258', '80002755', '10105587'];
function ydSeedSession() {
  const t = nowIso(); const labels = {};
  YD_SEED_LABELS.forEach(([code, v, reason]) => labels[code] = { v, reason, from: 'pile', ts: t, seed: true });
  const rules = ydRules();
  return {
    id: 'yaodian', scen: 'yaodian', name: '药点ERP 采购规则', empty: false, version: 1,
    scenario: { artifact: '单个 SKU 的补货建议（1,272 SKU，截至 2026-09-06）', purpose: `${YD_STORE}：老板审核“这次该补什么、补多少”。店员只反馈、老板决定，不下单、不付款（纪要 L34-35、L148）`, stakes: '纪要 L18：' + YD_Q[18] },
    catOverrides: {}, rules, dims: [], ratings: {},
    triad: { current: ['10136595', '10209911', '10053676'], mode: 'random', odd: null, lastDim: null },
    pile: { batch: YD_PILE.slice(), showContract: true, notes: {} },
    labels, accepted: {}, repair: { selected: null, drafts: {} },
    log: [{ ts: t, kind: 'init', text: `初始化：代码规则 ${rules.filter(r => r.origin === 'default').length} 条（已核对文件:行）+ 访谈纪要规则 ${rules.filter(r => r.origin === 'expert').length} 条 + 【示例】标注 ${YD_SEED_LABELS.length} 个`, seed: true }],
  };
}

/* ---------- 展示 ---------- */
const ydSugText = it => it.sug === '补' ? `补${ydNum(it.sugQty)}` : '不补';
function ydQty(it, e) {
  if (e.verdict === 'bad' || it.sug !== '补') return { q: 0, txt: '不补' };
  const r = (e.marks || []).find(m => m.action.type === 'round');
  const step = r ? (r.action.step || 5) : 0; const q = step ? Math.ceil(it.sugQty / step) * step : it.sugQty;
  return { q, txt: `补 ${ydNum(q)}${step && q !== it.sugQty ? `（原 ${ydNum(it.sugQty)}，凑整到 ${step} 的倍数）` : ''}` };
}
function ydDetailRows(it) {
  const R = (k, v, note) => `<tr><th>${k}</th><td>${v}${note ? ` <span class="muted tiny">${note}</span>` : ''}</td></tr>`;
  return [
    R('商品编码', esc(it.code)),
    R('通用名 / 规格', `${esc(it.rawName)} / ${esc(it.spec || '—')}`),
    R('厂家', esc(it.mfr || '—')),
    R('品类', `${esc(it.cat)} · ${esc(it.cat2 || '—')}`),
    R('处方类别', esc(it.rx), it.rxRaw ? '原值：' + esc(it.rxRaw) : ''),
    R('ABC / 补货分层', `${esc(it.abc)}${it.cum != null ? `（累计 ${it.cum}%）` : ''} / ${esc(it.layer)}`, 'ABC = 销售额 80/95%；分层 = 30 天销售天数（suggestion-engine）'),
    R('当前库存', `${ydNum(it.stock)} ${esc(it.unit || '')}`),
    R('近 7 / 30 / 90 天销量', `${ydNum(it.s7)} / ${ydNum(it.s30)} / ${ydNum(it.s90)}`, `30 天内销售天数 ${ydNum(it.sd30)}`),
    R('加权日均 / 覆盖', `${it.rate != null ? (+it.rate).toFixed(2) : '—'} / 加权 ${ydNum(it.wcover)} 天 · 7 日均 ${ydNum(it.cover7)} 天`),
    R('信号灯 / 优先级', `${esc(it.light || '—')} / ${esc(it.prio || '—')}`),
    R('上次销售', `${esc(it.lastSale || '—')}${it.idle != null ? `（${it.idle} 天前）` : ''}`),
    R('上次进价 / 主供应商', `${money(it.price)} / ${esc(it.sup || '无采购记录')}`, it.lastBuy ? '上次进货 ' + esc(it.lastBuy) : ''),
    R('D7 比价', it.gapPct != null ? `价差 ${it.gapPct}% · 每件可省 ${money(it.saving)}${it.cheap ? ' · 更便宜：' + esc(it.cheap) : ''}` : '—'),
    R('效期', `在库最近 ${ydNum(it.nearExp)} 天 · 上次进货剩余 ${ydNum(it.lastShelf)} 天`),
    R('同通用名', `${esc(it.stem || '—')}（${ydNum(it.famN)} 个 SKU，其他 SKU 库存 ${ydNum(it.famStock)}）`),
    R('现有补货建议', `<b>${ydSugText(it)}</b>`, esc(it.sugWhy || '')),
    it.must === '是' ? R('必备流量品', '是', `纪要 L106 点名「${esc(it.mustBrand)}」→ 人工映射（推断）`) : '',
    it.stop === '是' ? R('停补名单', '是', '纪要 L140') : '',
    R('数据出处', 'ysbang-data new_normalized，as_of 2026-09-06', '商品级聚合，经 data/build_yaodian.py 派生；不含任何人员 / 顾客 / 单据字段'),
  ].join('');
}
function ydRulesExtra() {
  const P = (lines, why) => `<div class="pend-row"><div class="quote small">${lines.map(l => `“${esc(YD_Q[l])}” <span class="muted tiny">L${l}</span>`).join('<br>')}</div><div class="muted small">${why}</div></div>`;
  return `<details class="card pend-card" ${ui.open.pending ? 'open' : ''} data-sec="pending"><summary><b>访谈里还写不成规则的偏好</b> <span class="muted small">6 条 · 数据里缺字段或属于权限边界，先记在这里</span></summary>
    ${P([84], '数据里没有“最低起购量”字段 → 无法检测“起购量高于需求”，只能人工列待确认。')}
    ${P([54, 29], 'ERP 供应商字段里没有出现「药中缘」（主供应商最多的是「一分」，疑似自采占位）→ 集中采购偏好暂无法落到 SKU。')}
    ${P([106], '已把 3 个 SKU 映射为「必备流量品=是」，但<b>没有</b>预置成例外——去 ④ 看「健胃消食片｜江中」这个分歧，试着加例外。')}
    ${P([142], '停补只能由老板解除；原型里停用 I1 会被回归拦下（正心泰胶囊是已标注案例）。')}
    ${P([34, 35, 148], '权限边界：原型只产出“该买 / 待确认 / 不该买”的契约草稿，不加购、不下单、不付款。')}
    ${P([92], '5% 价差未确认 → 已作为 C13（D7 换供应商）的待确认项。')}
  </details>`;
}
function ydMapSection() {
  const M = (window.__YAODIAN__ || {}).meta || {};
  const mustIt = ITEMS.filter(i => i.must === '是'), stopIt = ITEMS.filter(i => i.stop === '是');
  return `<details class="card" ${ui.open.map ? 'open' : ''} data-sec="map"><summary><b>数据来源与抽样（只读派生，不编造）</b></summary>
    <div class="two-col">
      <div><h4>数据</h4><table class="kv small">
        <tr><th>来源</th><td>zzhan111/ysbang-data · new_normalized（as_of ${esc(M.as_of || '2026-09-06')}）<div class="muted tiny">dim_product / fact_sales_ticket / fact_inventory_flow / dim_batch / agg_product_abc</div></td></tr>
        <tr><th>保留</th><td>${ydNum(M.kept)} / ${ydNum(M.products_total)} 个商品<div class="muted tiny">去掉 ${ydNum(M.dropped_no_sales_no_stock)} 个：无销售、无库存、也无补货建议</div></td></tr>
        <tr><th>有补货建议</th><td>${ydNum(M.with_suggestion)} 个 · 近 90 天有销 ${ydNum(M.with_sales_90d)} 个</td></tr>
        <tr><th>使用行数</th><td>销售 ${ydNum(M.sales_rows_used)} · 库存流水 ${ydNum(M.flow_rows_used)} · 批次 ${ydNum(M.batches_used)}<div class="muted tiny">只取商品编码 / 日期 / 数量 / 价格等字段聚合到 SKU；不含原始单据行</div></td></tr>
        <tr><th>隐私</th><td>不含任何人员、顾客、会员、电话、单据号；药房名称替换为「${YD_STORE}」</td></tr>
      </table></div>
      <div><h4>口径与人工映射</h4><table class="kv small">
        <tr><th>ABC</th><td>销售额累计 80% / 95%（ysbang-data build_new_normalized.py:733-746）；“无” = 不在 agg_product_abc</td></tr>
        <tr><th>补货分层</th><td>30 天销售天数 A≥20 / B≥5 / C≥1；D = 90 天无销且有库存；NEW = 首次入库 ≤14 天或销售记录 &lt;3（suggestion-engine.js:52-73）</td></tr>
        <tr><th>必备流量品</th><td>${mustIt.map(i => `${miniItem(i)}（${esc(i.mustBrand)}）`).join(' ') || '—'}<div class="muted tiny">纪要 L106 只点了品牌，SKU 是按 通用名+厂家 人工映射的推断</div></td></tr>
        <tr><th>停补名单</th><td>${stopIt.map(miniItem).join(' ') || '—'}<div class="muted tiny">纪要 L140；厂家规格待核对</div></td></tr>
        <tr><th>已知数据问题</th><td class="small">中药饮片按克计量，数量会很大；已过期批次仍有结存（在库效期为负 → 触发临期禁补）；rx_mode 缺失的商品用流水的处方类别补齐</td></tr>
      </table></div>
    </div></details>`;
}

SCN.yaodian = {
  id: 'yaodian', entity: 'SKU',
  buildItems: ydBuildItems, fields: YD_FIELDS,
  verdict: { good: '该买', mid: '待确认', bad: '不该买' },
  actions: ['veto', 'confirm', 'flag', 'round'], defaultAction: () => ({ type: 'confirm' }),
  scope: [
    { k: 'abc', label: 'ABC', all: '全部 ABC', prefix: true, get: it => it.abc, values: () => ['A', 'B', 'C', '无'], rowLabel: v => v === '无' ? '未分级' : v + ' 类' },
    { k: 'layer', label: '分层', all: '全部分层', prefix: true, get: it => it.layer, values: () => ['A', 'B', 'C', 'D', 'NEW'] },
    { k: 'rx', label: '处方/OTC', all: '全部', get: it => it.rx, values: () => ['处方药', 'OTC', '其它'] },
    { k: 'cats', label: '品类', all: '全部品类', get: it => it.cat, values: () => YD_CATS },
    { k: 'sups', label: '主供应商', all: '全部供应商', get: it => it.supG, values: () => [...YD_SUPS, '其他供应商', '无采购记录'] },
  ],
  scopeAll: '全部 SKU', scopeHint: '同一条偏好对处方药 / OTC、A 类 / C 类可能不成立',
  matrix: { row: 'abc', col: 'rx', corner: 'ABC \\ 处方类别' },
  groupOf: it => it.cat, sameGroup: (a, b) => a.cat === b.cat, distKey: it => it.cat2 || it.cat, barKey: it => it.cat + '·' + (it.cat2 || ''),
  triad: {
    pool: () => ITEMS.filter(i => i.s90 > 0 || i.sug === '补'),
    modes: [['random', '随机'], ['samecat', '同品类'], ['samesub', '同二级类'], ['crosssrc', '同二级类·有补有不补'], ['gap', '从“还没聊到”的格子抽']],
    keys: { samecat: it => it.cat, samesub: it => it.cat + '|' + it.cat2 }, cross: { group: it => it.cat + '|' + it.cat2, split: it => it.sug },
  },
  pile: {
    pool: () => ITEMS.filter(i => i.sug === '补'),
    group: it => it.cat + '|' + it.cat2, diverse: it => it.abc, diverseValues: () => ['A', 'B', 'C', '无'],
    similar: (a, b) => a.cat === b.cat && a.cat2 === b.cat2 && a.layer === b.layer && Math.abs((a.sugQty || 0) - (b.sugQty || 0)) <= 1,
    incText: (a, b) => `同为 ${esc(a.cat)}·${esc(a.cat2)}、${esc(a.layer)} 层，现有建议 ${ydSugText(a)} vs ${ydSugText(b)}`,
    incHead: '同二级类、同分层、现有建议数量相差 ≤1，却放进了不同堆',
  },
  dist: {
    nums: ['s30', 's90', 'stock', 'wcover', 'lastShelf', 'price', 'famStock', 'idle'],
    enums: [
      { field: 'must', cmp: it => it.must, val: it => it.must, text: it => `必备流量品：${it.must}，与其余不同` },
      { field: 'layer', cmp: it => it.layer, val: it => it.layer, text: it => `补货分层 ${it.layer}，与其余都不同` },
      { field: 'rx', cmp: it => it.rx, val: it => it.rx, text: it => `${it.rx}，与其余都不同` },
      { field: 'abc', cmp: it => it.abc, val: it => it.abc, text: it => `ABC ${it.abc}，与其余都不同` },
    ],
  },
  feat: ['s90', 'stock', 'wcover', 'famStock', 'lastShelf', 'price'], defaultField: 'wcover',
  excPrefer: ['must', 'layer', 'rx'], excFallback: it => ({ field: 'must', op: '=', value: it.must }),
  scopeOf: it => ({ abc: [], layer: [it.layer], rx: [it.rx], cats: [it.cat], sups: [] }),
  scopeOfPair: (a, b) => ({ abc: [], layer: uniq([a.layer, b.layer]), rx: uniq([a.rx, b.rx]), cats: [a.cat], sups: [] }),
  color: it => YD_CATC[it.cat] || '#94a3b8', thumbText: it => (it.cat || '?').slice(0, 2),
  meta: it => [`库存 <b>${ydNum(it.stock)}</b>`, `7/30/90天销 ${ydNum(it.s7)}/${ydNum(it.s30)}/${ydNum(it.s90)}`, `覆盖 ${it.wcover == null ? '—' : it.wcover + '天'}`, `进价 ${money(it.price)}`].join(' · '),
  chips: it => `<span class="chip c-src">${esc(it.abc === '无' ? 'ABC 无' : it.abc + ' 类')}</span><span class="chip c-cat" style="--c:${YD_CATC[it.cat] || '#94a3b8'}">${esc(it.cat)}·${esc(it.cat2 || '')}</span><span class="chip">${esc(it.rx)}</span><span class="chip">分层 ${esc(it.layer)}</span><span class="chip ${it.sug === '补' ? 'c-sug' : ''}">建议 ${ydSugText(it)}</span>${it.prio && it.prio !== 'none' ? `<span class="chip c-warn">${esc(it.prio)}</span>` : ''}${it.must === '是' ? '<span class="chip c-mark">必备</span>' : ''}${it.stop === '是' ? '<span class="chip c-warn">停补</span>' : ''}`,
  mini: it => ydSugText(it), detail: ydDetailRows,
  verdictExtra: (it, e) => `<div class="small yd-qty">按当前契约：<b>${ydQty(it, e).txt}</b> <span class="muted tiny">现有建议 ${ydSugText(it)}</span></div>`,
  catEditable: false, mapSection: () => ydMapSection(), rulesExtra: () => ydRulesExtra(), inlineThr: true,
  labels: { expert: '访谈规则', expertFilter: '访谈规则', expertShort: '访谈', expertTitle: '访谈纪要规则 + 你新建的规则', def: '代码规则', defFilter: '代码规则', defMock: false, defSub: 'ysbang 代码里已有的规则（已核对文件:行）', defOnly: '只用代码规则', defOnlyTitle: '只用代码规则（= 现有补货建议）时与你的标注一致', specific: '专属访谈规则', generic: '通用访谈', defShort: '代码' },
  text: {
    triadTitle: '哪两个更像？第三个哪里不同？',
    triadBody: `从 ${YD_STORE} 的真实 SKU（截至 2026-09-06）里抽 3 个，连同<b>现有补货建议</b>。哪两个在「该不该补 / 补多少」上更像？第三个哪里不同？你说出的区别会原样成为评价<b>维度</b>——用你的词，不由设计者预设。`,
    triadProbe: (like, diff) => [`你说那两个「${esc(like)}」。还有哪个品你也会这样看？`, `怎么一眼认出一个品是「${esc(diff)}」——看销量、库存、效期、厂家，还是别的？`, `「${esc(like)}」和「${esc(diff)}」跟“这次该不该补、补多少”有关系吗？`],
    triadLadder: (like, diff) => `「${esc(like)}」和「${esc(diff)}」跟“这次该不该补、补多少”有关系吗？`,
    pileTitle: '把这批补货建议拖进 该买 / 待确认 / 不该买',
    pileBody: '每张卡是系统按代码规则会给出的一条补货建议（数字全部来自数据，判断由你给）。只要判断，不用说规则；同二级类、同分层、建议数量接近却进了不同堆的，系统会问“区别在哪？”。<span class="muted">（训练样本；店员只反馈、老板决定，原型不加购、不下单）</span>',
    pileNew: '换一批（9 条未标注的补货建议）', pileNewToast: '已换一批（9 条未标注的补货建议，含同二级类）',
    rulesTitle: '代码里的规则 + 老板访谈里的偏好，都要说清“对谁适用”',
    rulesBody: '<b>代码规则</b>来自 ysbang 仓库（标文件:行，已对照只读克隆核对）；<b>访谈规则</b>来自 2026-09-28 老板访谈纪要（逐字摘录纪要原文，未确认的阈值标 <b>待确认</b>）。每张卡 = 适用范围（ABC / 分层 / 处方·OTC / 品类 / 主供应商）+ 条件 + 判定 + 例外 + 出处，并在 1,272 个真实 SKU 上实时显示命中。数值阈值可以直接改：先看命中数和回归，再点「应用阈值」。',
    matrixTitle: '哪些格子还没聊到？',
    matrixBody: '行 = ABC（销售额累计 80% / 95%），列 = 处方药 / OTC / 其它。格子里的数字 = <b>明确写了这个 ABC + 这个处方类别</b>的访谈规则数；代码规则和“全部 SKU”的通用规则不算聊到。浅黄格子 = 有 SKU 但还没有专属规则；点「去补样本 → ①」会带着这一格去 ① 出三元组。',
    matrixAsk: (r, c) => [`${esc(c)} 里的 ${esc(r)} 类品，补货时你一般先看什么？`, '先挑一个你这次不会补的，说说为什么。'],
    defNote: '（这是 ysbang 代码里已有的规则）',
    cellNote: '点 SKU 看详情（全部数字来自 new_normalized 派生，不编造）。', fillOther: '同一 ABC 行的其他处方类别',
    actHint: '否决 = 不该买；列为待确认 = 交老板确认；标记 / 凑整不改判定。纪要 L18：推荐不该买的品种最伤信任——升为否决前先看回归。',
  },
  seed: () => ydSeedSession(),
};
