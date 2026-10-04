/* ================= 模型层：状态、契约求值、回归、区分特征、导出 ================= */
const STORE_KEY = 'elicit-proto-v1';
const VERDICT_ORDER = { good: 0, mid: 1, bad: 2 };
// 本地时区的 ISO 时间（带偏移，如 +08:00），避免导出里出现 UTC 的 Z 时间
const nowIso = () => { const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.floor(Math.abs(n))).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${o >= 0 ? '+' : '-'}${p(o / 60)}:${p(o % 60)}`; };
const fmtTime = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const clone = o => JSON.parse(JSON.stringify(o));

// 常识契约：模拟“LLM 新手”在没访谈之前给出的默认规则（脚本写死，不是真 LLM 输出）
function defaultRules() {
  const R = (id, scope, conds, action, why) => ({ id, origin: 'default', seed: false, active: true, scope: Object.assign({ sources: [], cats: [], subs: [] }, scope), conds, action, exceptions: [], quote: '', why, createdFrom: { via: 'default' }, createdAt: nowIso() });
  return [
    R('D1', {}, [{ field: 'shelf', op: '<', value: 120 }], { type: 'penalty', amount: 0.2 }, '保质期太短，便利店损耗风险高'),
    R('D2', {}, [{ field: 'price', op: '>', value: 30 }], { type: 'penalty', amount: 0.3 }, '便利店客单价低，30 元以上的东西不好卖'),
    R('D3', { cats: ['烘焙'] }, [{ field: 'price', op: '>', value: 6 }], { type: 'penalty', amount: 0.3 }, '面包蛋糕一般卖 3–6 元'),
    R('D4', { cats: ['休闲零食'] }, [{ field: 'price', op: '≤', value: 0.5 }], { type: 'penalty', amount: 0.2 }, '5 毛钱的小零食利润薄、品质存疑'),
    R('D5', {}, [{ field: 'photo', op: '=', value: '无' }], { type: 'penalty', amount: 0.1 }, '没有正面照，线上无法展示'),
    R('D6', { cats: ['药品', '医疗护理'] }, [], { type: 'penalty', amount: 0.2 }, '药品/器械不是便利店核心品类，谨慎上架'),
    R('D7', { cats: ['饮品'] }, [{ field: 'price', op: '>', value: 5 }], { type: 'penalty', amount: 0.2 }, '便利店饮料主流价位 2–5 元'),
  ];
}

const SEED_PILE = ['XM-0001-P01', 'XM-0079-P01', 'XM-0080-P01', 'XM-0129-P01', 'XM-0070-P01', 'XM-0008-P01', 'ZS-0010-P04', 'ZS-0098-P01', 'KL-0002-P01', '1688-0016-P02'];

function seedSession() {
  const t = nowIso();
  const rules = defaultRules();
  rules.push({
    id: 'R1', origin: 'expert', seed: true, active: true,
    scope: { sources: ['喜美福'], cats: ['烘焙'], subs: [] },
    conds: [{ field: 'price', op: '>', value: 4 }],
    action: { type: 'penalty', amount: 0.3 },
    exceptions: [{ field: 'spec', op: '≥', value: 200, quote: '【示例·虚构】大袋的（200 克以上）不算' }],
    quote: '【示例·虚构原话】小包装的面包点心卖到 4 块以上就偏贵了',
    why: '', createdFrom: { via: 'seed' }, createdAt: t,
  });
  const labels = {};
  const L = (code, v, reason) => labels[code] = { v, reason, from: 'pile', ts: t, seed: true };
  L('XM-0001-P01', 'good', '【示例】个头大，5 块能吃饱');
  L('XM-0079-P01', 'good', '【示例】');
  L('XM-0080-P01', 'mid', '');
  L('XM-0129-P01', 'good', '【示例】家庭装，按克算不贵');
  L('XM-0070-P01', 'good', '');
  L('XM-0008-P01', 'good', '【示例】常备款');
  L('ZS-0010-P04', 'good', '【示例】这类东西在店里本来就卖得贵');
  return {
    id: 'sparrow', scen: 'sparrow', name: '小小云雀选品', empty: false, version: 1,
    scenario: { artifact: '单个包装 SKU（599 个包装 / 337 SKU）', purpose: '【示例】决定一个包装是否值得留在货架上', stakes: '【示例·待填】错杀好品 vs 放过差品，哪个代价大？' },
    catOverrides: {},
    rules,
    dims: [{ id: 'V1', left: '能当一顿', right: '嘴馋零食', quoteL: '【示例·虚构】这两个是能顶饿的', quoteR: '【示例·虚构】海苔就是嘴馋', triad: ['XM-0001-P01', 'XM-0129-P01', 'XM-0008-P01'], odd: 'XM-0008-P01', seed: true, createdAt: t }],
    ratings: { V1: { 'XM-0001-P01': 1, 'XM-0129-P01': 2, 'XM-0008-P01': 5, 'XM-0070-P01': 5, 'XM-0079-P01': 2 } },
    triad: { current: ['XM-0080-P01', 'XM-0040-P03', 'XM-0094-P01'], mode: 'random', odd: null, lastDim: null },
    pile: { batch: SEED_PILE.slice(), showContract: true, notes: {} },
    labels,
    accepted: {},
    repair: { selected: null, drafts: {} },
    log: [{ ts: t, kind: 'init', text: '初始化：常识契约（模拟 AI 新手）7 条 + 【示例】专家规则 1 条 + 【示例】标注 7 个', seed: true }],
  };
}
function emptySession(id, name) {
  return { id, scen: null, name, empty: true, version: 0, scenario: { artifact: '', purpose: '', stakes: '' }, catOverrides: {}, rules: [], dims: [], ratings: {}, triad: { current: [], mode: 'random', odd: null }, pile: { batch: [], showContract: true, notes: {} }, labels: {}, accepted: {}, repair: { selected: null, drafts: {} }, log: [] };
}
function freshState() {
  return { v: 1, active: 'sparrow', order: ['sparrow', 'yaodian'], tab: 'triad', rightOpen: false, sessions: { sparrow: seedSession(), yaodian: SCN.yaodian.seed() } };
}
let state;
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 1 && s.sessions && s.sessions.sparrow) {
      // v0.3 迁移：旧版里的「药点ERP采购」是空占位 → 换成接入真实数据的场景
      const y = s.sessions.yaodian;
      if (!y || (y.empty && !y.scen)) { s.sessions.yaodian = SCN.yaodian.seed(); if (!s.order.includes('yaodian')) s.order.splice(1, 0, 'yaodian'); }
      s.sessions.sparrow.scen = 'sparrow';
      return s;
    }
  } catch (e) { /* ignore */ }
  return freshState();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn('保存失败', e); } }
const S = () => state.sessions[state.active];
const scenOf = s => (s && s.scen) || 'sparrow';
function syncScenario() { useScenario(scenOf(S())); }

function applyOverrides() {
  const ov = state.sessions.sparrow.catOverrides || {};
  STORE_ITEMS.forEach(it => { const o = ov[it.code]; it.cat = o ? o.cat : it.autoCat; it.sub = o ? o.sub : it.autoSub; });
}

/* ---------- 契约求值 ---------- */
function inScope(it, sc) {
  for (const d of SC().scope) { const v = sc[d.k]; if (v && v.length && !v.includes(d.get(it))) return false; }
  return true;
}
function evalCond(it, c) {
  const f = FIELDS[c.field]; if (!f) return false;
  const v = f.get(it);
  if (f.type === 'num') {
    if (v == null || c.value === '' || c.value == null || isNaN(+c.value)) return false;
    const x = +c.value;
    switch (c.op) { case '>': return v > x; case '≥': return v >= x; case '<': return v < x; case '≤': return v <= x; case '=': return v === x; }
    return false;
  }
  if (f.type === 'text') { if (!c.value) return false; return c.op === '不包含' ? !v.includes(c.value) : v.includes(c.value); }
  if (f.type === 'enum') return c.op === '≠' ? v !== c.value : v === c.value;
  if (f.type === 'bool') return v === c.value;
  return false;
}
// 判定类型：penalty 扣分 / veto 否决 / confirm 列为“中间档”（药点：待确认）；flag 标记、round 数量凑整 不改判定（记在 marks）
const isMark = r => r.action.type === 'flag' || r.action.type === 'round';
function evaluate(it, rules) {
  let score = 1, veto = false, confirm = false; const fired = [], excepted = [], marks = [];
  for (const r of rules) {
    if (!r.active || !inScope(it, r.scope)) continue;
    if (!r.conds.every(c => evalCond(it, c))) continue;
    const ex = r.exceptions.find(e => evalCond(it, e));
    if (ex) { excepted.push({ r, ex }); continue; }
    if (isMark(r)) { marks.push(r); continue; }
    fired.push(r);
    if (r.action.type === 'veto') veto = true; else if (r.action.type === 'confirm') confirm = true; else score -= r.action.amount;
  }
  score = Math.max(0, Math.round(score * 100) / 100);
  if (veto) score = 0;
  let verdict = veto ? 'bad' : score >= 0.8 ? 'good' : score >= 0.55 ? 'mid' : 'bad';
  if (confirm && verdict === 'good') { verdict = 'mid'; score = Math.min(score, 0.7); }
  return { score, verdict, fired, excepted, veto, marks };
}
function hits(rule) { return ITEMS.filter(it => rule.active !== false && inScope(it, rule.scope) && rule.conds.every(c => evalCond(it, c))); }
function hitSplit(rule) {
  const inCond = ITEMS.filter(it => inScope(it, rule.scope) && rule.conds.every(c => evalCond(it, c)));
  const exc = inCond.filter(it => rule.exceptions.some(e => evalCond(it, e)));
  return { hit: inCond.filter(it => !exc.includes(it)), exc, inScope: ITEMS.filter(it => inScope(it, rule.scope)).length };
}
function labeledCodes(s = S()) { return Object.keys(s.labels).filter(c => ITEM[c]); }
function caseStatus(s = S(), rules = s.rules) {
  return labeledCodes(s).map(code => { const it = ITEM[code]; const e = evaluate(it, rules); const L = s.labels[code]; return { code, it, e, label: L.v, agree: e.verdict === L.v, accepted: !!s.accepted[code], L }; });
}
function disagreements(s = S()) { return caseStatus(s).filter(c => !c.agree && !c.accepted); }
// RDR：改动前后，对所有已标注案例重跑
function regression(before, after, s = S()) {
  const out = { flipped: [], fixed: [], changed: [], total: 0, agreeBefore: 0, agreeAfter: 0 };
  for (const code of labeledCodes(s)) {
    const it = ITEM[code], L = s.labels[code].v;
    const b = evaluate(it, before).verdict, a = evaluate(it, after).verdict;
    out.total++; if (b === L) out.agreeBefore++; if (a === L) out.agreeAfter++;
    if (b === L && a !== L) out.flipped.push({ it, b, a, L });
    else if (b !== L && a === L) out.fixed.push({ it, b, a, L });
    else if (b !== a) out.changed.push({ it, b, a, L });
  }
  return out;
}
function bump(s, kind, text, reg) { s.version++; s.log.unshift({ ts: nowIso(), kind, text, reg: reg ? { total: reg.total, before: reg.agreeBefore, after: reg.agreeAfter, flipped: reg.flipped.map(x => x.it.code), fixed: reg.fixed.map(x => x.it.code) } : null }); }

/* ---------- 区分特征（RDR 的 difference list，确定性计算，不是 AI） ---------- */
const niceNum = x => { if (x >= 100) return Math.round(x / 10) * 10; if (x >= 10) return Math.round(x); return Math.round(x * 2) / 2; };
function distinguish(it, others) {
  const out = [];
  const D = SC().dist;
  for (const key of D.nums) {
    const f = FIELDS[key], v = f.get(it); if (v == null) continue;
    const vals = others.map(o => f.get(o)).filter(x => x != null); if (!vals.length) continue;
    const mx = Math.max(...vals), mn = Math.min(...vals);
    if (v > mx) { let t = niceNum((v + mx) / 2); if (!(t > mx && t <= v)) t = v; out.push({ field: key, op: t === v ? '≥' : '>', value: t, text: `${f.label} ${v}${f.unit}，高于其余（最高 ${mx}）` }); }
    else if (v < mn) { let t = niceNum((v + mn) / 2); if (!(t < mn && t >= v)) t = v; out.push({ field: key, op: t === v ? '≤' : '<', value: t, text: `${f.label} ${v}${f.unit}，低于其余（最低 ${mn}）` }); }
  }
  for (const g of D.enums) if (others.length && others.every(o => g.cmp(o) !== g.cmp(it))) out.push({ field: g.field, op: '=', value: g.val(it), text: g.text(it) });
  return out;
}

/* ---------- 文本化 ---------- */
function condText(c) {
  const f = FIELDS[c.field]; if (!f) return '?';
  if (f.type === 'text') return `${f.label}${c.op}“${c.value || '…'}”`;
  if (f.type === 'enum') return `${f.label} ${c.op} ${c.value}`;
  if (f.type === 'bool') return `${f.label}：${c.value}`;
  return `${f.label} ${c.op} ${c.value === '' || c.value == null ? '…' : c.value}${f.unit}`;
}
function scopeText(sc) {
  const p = SC().scope.filter(d => d.always || (sc[d.k] || []).length).map(d => (sc[d.k] || []).length ? (d.prefix ? d.label + ' ' : '') + sc[d.k].join('/') : d.all);
  return p.join(' · ') || SC().scopeAll;
}
function actionText(a) {
  if (a.type === 'veto') return `否决（直接判${VERDICT.bad}）`;
  if (a.type === 'confirm') return `列为「${VERDICT.mid}」`;
  if (a.type === 'flag') return `标记「${a.label || '…'}」（不改判定）`;
  if (a.type === 'round') return `数量凑整到 ${a.step || 5} 的倍数（不改判定）`;
  return `扣 ${a.amount} 分`;
}
function ruleOneLine(r) { return `[${scopeText(r.scope)}] ${r.conds.length ? r.conds.map(condText).join(' 且 ') : '范围内全部'} → ${actionText(r.action)}${r.exceptions.length ? '；例外：' + r.exceptions.map(condText).join('、') : ''}`; }

/* ---------- 导出 ---------- */
function contractSpec(s = S()) {
  const cs = caseStatus(s);
  const defaultOnly = s.rules.filter(r => r.origin === 'default').map(r => Object.assign({}, r, { exceptions: [], active: true }));
  return {
    schema: 'elicit-proto/contract-spec@0（原型导出，不是引擎可加载的 Crucible YAML）',
    exported_at: nowIso(), scenario_id: s.id, scenario_name: s.name, draft_version: s.version, expert_id: 'expert_1',
    scenario: s.scenario,
    scoring: { base: 1.0, verdict_bands: { [VERDICT.good]: '≥ 0.8', [VERDICT.mid]: '0.55–0.8（或命中 confirm 规则）', [VERDICT.bad]: '< 0.55 或被否决' } },
    rules: s.rules.map(r => ({
      id: r.id, origin: r.src && r.src.kind === 'code' ? 'coded_rule（' + srcRef(r) + '）' : r.origin === 'default' ? 'common_sense_default（模拟 AI 新手）' : r.src && r.src.kind === 'interview' ? 'owner_interview（' + srcRef(r) + '）' : 'expert', example_seed: !!r.seed, active: r.active,
      scope: Object.fromEntries(SC().scope.map(d => [d.k, r.scope[d.k] || []])),
      when: r.conds.map(condText), conds: r.conds,
      enforcement: { veto: 'gate', confirm: 'confirm', flag: 'flag', round: 'qty_round' }[r.action.type] || 'penalty', penalty: r.action.type === 'penalty' ? r.action.amount : null,
      pending_confirmation: r.pending || [],
      unless: r.exceptions.map(e => ({ cond: condText(e), raw: { field: e.field, op: e.op, value: e.value }, quote: e.quote || '' })),
      quote: r.quote || null, common_sense_reason: r.why || null, created_via: r.createdFrom.via, created_from_item: r.createdFrom.item || null,
      hit_count: hitSplit(r).hit.length,
    })),
    dimensions: s.dims.map(d => ({ id: d.id, construct: `${d.left} ↔ ${d.right}`, quote_like: d.quoteL, quote_contrast: d.quoteR, triad: d.triad, odd_one: d.odd, example_seed: !!d.seed, ratings: s.ratings[d.id] || {} })),
    labeled_cases: cs.map(c => ({ code: c.code, name: c.it.name, expert: VERDICT[c.label], reason: c.L.reason || '', contract: VERDICT[c.e.verdict], score: c.e.score, agree: c.agree, accepted_divergence: c.accepted ? (s.accepted[c.code].note || true) : false, example_seed: !!c.L.seed, fired: c.e.fired.map(r => r.id) })),
    metrics: { labeled: cs.length, agree_current: cs.filter(c => c.agree).length, agree_common_sense_only: cs.filter(c => evaluate(c.it, defaultOnly).verdict === c.label).length, expert_rules: s.rules.filter(r => r.origin === 'expert').length },
    category_overrides: s.catOverrides,
    change_log: s.log,
  };
}
function yamlStr(v) { if (v == null) return '~'; if (typeof v === 'number' || typeof v === 'boolean') return String(v); return JSON.stringify(String(v)); }
function contractYaml(s = S()) {
  const spec = contractSpec(s);
  const L = [];
  L.push('# Crucible 契约草稿（原型导出，YAML 风格文本，非引擎可加载格式）');
  L.push(`# 场景：${spec.scenario_name}  草稿 v${spec.draft_version}  导出于 ${spec.exported_at}`);
  L.push('# origin=common_sense_default 的规则是“模拟 AI 新手”的脚本，不是专家意见；example_seed=true 为演示示例');
  L.push(`scenario_id: ${yamlStr(spec.scenario_id)}`);
  L.push(`draft_version: ${spec.draft_version}`);
  L.push('scoring: { base: 1.0, good: ">= 0.8", mid: "0.55-0.8", bad: "< 0.55 or gate" }');
  L.push('rules:');
  spec.rules.forEach(r => {
    L.push(`  - id: ${r.id}`);
    L.push(`    origin: ${yamlStr(r.origin)}${r.example_seed ? '   # 示例' : ''}`);
    L.push(`    active: ${r.active}`);
    L.push(`    scope: { ${Object.entries(r.scope).map(([k, v]) => `${k}: [${v.join(', ')}]`).join(', ')} }`);
    L.push(`    when: [${r.when.map(yamlStr).join(', ')}]`);
    L.push(`    enforcement: ${r.enforcement}`);
    if (r.penalty != null) L.push(`    penalty: ${r.penalty}`);
    if (r.pending_confirmation.length) L.push(`    pending_confirmation: [${r.pending_confirmation.map(yamlStr).join(', ')}]`);
    if (r.unless.length) { L.push('    unless:'); r.unless.forEach(u => { L.push(`      - cond: ${yamlStr(u.cond)}`); L.push(`        quote: ${yamlStr(u.quote)}`); }); }
    if (r.quote) L.push(`    quote: ${yamlStr(r.quote)}`);
    if (r.common_sense_reason) L.push(`    common_sense_reason: ${yamlStr(r.common_sense_reason)}`);
    L.push(`    hit_count: ${r.hit_count}`);
  });
  L.push('dimensions:');
  spec.dimensions.forEach(d => { L.push(`  - id: ${d.id}`); L.push(`    construct: ${yamlStr(d.construct)}`); L.push(`    quote_like: ${yamlStr(d.quote_like)}`); L.push(`    quote_contrast: ${yamlStr(d.quote_contrast)}`); L.push(`    rated_items: ${Object.keys(d.ratings).length}`); });
  L.push('labeled_cases:');
  spec.labeled_cases.forEach(c => L.push(`  - { code: ${c.code}, expert: ${c.expert}, contract: ${c.contract}, agree: ${c.agree}${c.accepted_divergence ? ', accepted_divergence: true' : ''} }   # ${c.name}`));
  L.push(`metrics: { labeled: ${spec.metrics.labeled}, agree_current: ${spec.metrics.agree_current}, agree_common_sense_only: ${spec.metrics.agree_common_sense_only}, expert_rules: ${spec.metrics.expert_rules} }`);
  return L.join('\n') + '\n';
}
