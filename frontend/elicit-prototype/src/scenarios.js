/* ================= 场景注册表（v0.3：场景数据驱动） =================
   一个场景 = 一份配置：被评对象、字段、适用范围维度（scope chips）、矩阵两轴、抽样方式、文案、种子会话。
   引擎代码（求值 / 回归 / 五个屏 / 契约面板）只读当前场景配置 SC() 和下面 4 个“当前场景”全局量：
   ITEMS / ITEM / FIELDS / VERDICT —— 由 useScenario(id) 在每次渲染前切换。 */
const SCN = {};
let ITEMS = [], ITEM = {}, FIELDS = {}, VERDICT = { good: '好', mid: '中', bad: '差' };
let CUR_SCN = null;
function useScenario(id) {
  const c = SCN[id] || SCN.sparrow; if (CUR_SCN === c.id) return c;
  if (!c._built) { c.items = c.buildItems(); c.item = {}; c.items.forEach(it => c.item[it.code] = it); c._built = true; }
  ITEMS = c.items; ITEM = c.item; FIELDS = c.fields; VERDICT = c.verdict; CUR_SCN = c.id; return c;
}
const SC = () => SCN[CUR_SCN] || SCN.sparrow;
function withScenario(id, fn) { const prev = CUR_SCN; useScenario(id); try { return fn(); } finally { if (prev) useScenario(prev); } }
const scopeDim = k => SC().scope.find(d => d.k === k);
const emptyScope = () => Object.fromEntries(SC().scope.map(d => [d.k, []]));
const uniq = a => [...new Set(a)];

/* ---------- 场景 1：小小云雀选品（便利店，599 个包装）——配置与 v0.2 行为完全一致 ---------- */
SCN.sparrow = {
  id: 'sparrow', entity: '商品',
  buildItems: () => STORE_ITEMS, fields: STORE_FIELDS,
  verdict: { good: '好', mid: '中', bad: '差' },
  actions: ['penalty', 'veto'], defaultAction: () => ({ type: 'penalty', amount: 0.3 }),
  scope: [
    { k: 'sources', label: '来源', all: '全部来源', always: true, get: it => it.source, values: () => SOURCES },
    { k: 'cats', label: '品类', all: '全部品类', always: true, get: it => it.cat, values: () => CATS },
    { k: 'subs', label: '子类', all: '', parent: 'cats', get: it => it.sub, values: sc => (sc.cats || []).flatMap(c => SUBS_BY_CAT[c]), emptyHint: '先选品类，再细分到子类' },
  ],
  scopeAll: '全部',
  matrix: { row: 'cats', col: 'sources', corner: '品类 \\ 来源' },
  groupOf: it => it.cat, sameGroup: (a, b) => a.cat === b.cat, distKey: it => it.sub,
  triad: {
    modes: [['random', '随机'], ['samecat', '同品类'], ['samesub', '同子类'], ['crosssrc', '同品类·跨来源'], ['gap', '从“还没聊到”的格子抽']],
    keys: { samecat: it => it.cat, samesub: it => it.cat + '|' + it.sub }, cross: { group: it => it.cat, split: it => it.source },
  },
  pile: {
    group: it => it.cat + '|' + it.sub, diverse: it => it.source, diverseValues: () => SOURCES,
    similar: (a, b) => a.cat === b.cat && a.sub === b.sub && a.price != null && b.price != null && Math.abs(a.price - b.price) <= Math.max(0.5, 0.25 * Math.max(a.price, b.price)),
    incText: (a, b) => `同为 ${esc(a.cat)}·${esc(a.sub)}，单价 ${money(a.price)} vs ${money(b.price)}`,
    incHead: '同品类同子类、单价相差 ≤25%（或 ≤0.5 元），却放进了不同堆',
  },
  dist: { nums: ['price', 'spec', 'unit', 'shelf'], enums: [{ field: 'sub', cmp: it => it.sub, val: it => it.sub, text: it => `子类“${it.sub}”与其余都不同` }, { field: 'photo', cmp: it => it.photo, val: it => it.photo ? '有' : '无', text: it => `正面照：${it.photo ? '有' : '无'}，与其余不同` }] },
  feat: ['price', 'spec', 'unit', 'shelf'], defaultField: 'price',
  excPrefer: ['spec', 'sub'], excFallback: it => it.spec != null ? { field: 'spec', op: '≥', value: it.spec } : { field: 'sub', op: '=', value: it.sub },
  scopeOf: it => ({ sources: [it.source], cats: [it.cat], subs: [it.sub] }),
  scopeOfPair: (a, b) => ({ sources: uniq([a.source, b.source]), cats: [a.cat], subs: [a.sub] }),
  color: it => CAT_COLORS[it.cat] || '#94a3b8', thumbText: it => it.cat === '未分类' ? '?' : it.cat.slice(0, 2),
  meta: it => {
    const p = [`<b>${money(it.price)}</b>`];
    if (it.spec != null) p.push(`${it.spec}${/毫升|ml|升|L/i.test(it.pkgName + it.rawName) ? 'ml' : 'g'}`);
    if (it.shelf != null) p.push(`保质 ${it.shelf} 天`);
    return p.join(' · ');
  },
  chips: it => `<span class="chip c-src">${esc(it.source)}</span><span class="chip c-cat" style="--c:${CAT_COLORS[it.cat]}">${esc(it.cat)}·${esc(it.sub)}</span>${it.photo ? '' : '<span class="chip c-warn">无正面照</span>'}`,
  mini: it => money(it.price), detail: it => storeDetailRows(it), barKey: it => it.cat + '·' + it.sub,
  catEditable: true, mapSection: s => storeMapSection(s),
  labels: { expert: '专家规则', expertFilter: '专家规则', def: '常识契约', defFilter: '常识契约（模拟）', defMock: true, defSub: '模拟 AI 新手生成', defOnly: '只用常识', specific: '专属专家规则', generic: '通用专家', defShort: '常识' },
  text: {
    triadTitle: '哪两个更像？第三个哪里不同？',
    triadBody: '从真实商品里抽 3 个。你说出的区别会原样成为评价<b>维度</b>（方格法 / repertory grid）——维度用你的词，不由设计者预设。然后用这个维度给几个商品快速打分。',
    triadProbe: (like, diff) => [`你说那两个「${esc(like)}」。能再举一个最「${esc(like)}」的商品吗？`, `怎么一眼认出一个商品是「${esc(diff)}」——看包装、价格，还是别的？`, `「${esc(like)}」和「${esc(diff)}」跟“该不该留在货架上”有关系吗？`],
    triadLadder: (like, diff) => `「${esc(like)}」和「${esc(diff)}」跟“该不该留在货架上”有关系吗？`,
    pileTitle: '把这批商品拖进 好 / 中 / 差',
    pileBody: '只要判断，不用说规则；理由可写一句。同品类、价格接近却进了不同堆的，系统会问“区别在哪？”——这类区别最容易变成规则。<span class="muted">（这批只作训练样本；正式 holdout 排序时不显示契约判断——原型未实现 holdout）</span>',
    pileNew: '换一批（混入同类近价商品）', pileNewToast: '已换一批（9 个未标注商品，含同子类商品）',
    rulesTitle: '每条规则都要先说清“对谁适用”',
    rulesBody: '同一句“5 元的面包太贵”，换个子类（汉堡、蛋糕）或换个来源（喜美福 / ZS / 1688 / 店内自建）可能就不成立。所以每张卡 = <b>适用范围</b> + <b>条件</b> + <b>判定</b> + <b>例外</b> + <b>来源原话</b>，并实时显示命中哪些商品。点范围标签上的 × 可直接收窄；会翻转判对案例时会转入编辑器确认。左侧列表每行显示原话前几个字，保留出处。',
    matrixTitle: '哪些格子还没聊到？',
    matrixBody: '行 = 品类，列 = 来源。格子里的数字 = <b>明确写了这个来源 + 这个品类</b>的专家规则数；只有“全部来源/全部品类”的通用规则不算聊到。浅黄格子 = 有商品但还没有专属规则；点格子里的「去补样本 → ①」会带着这一格去 ① 出三元组。',
    matrixAsk: (r, c) => [`${esc(c)} 的${esc(r)}，你一般怎么判断留不留？`, '先挑一个你会撤下货架的，说说为什么。'],
    defNote: '（这是常识契约，模拟 AI 新手的想法）',
    cellNote: '点商品可看详情、改品类归属。', fillOther: '同品类其他来源',
    actHint: '新规则默认扣分；升为否决需确认在已标注的“好”样本上不误杀（见右侧回归）。',
  },
  seed: () => seedSession(),
};
/* 出处：代码规则 = 仓库/文件:行；访谈 = 纪要文件:L 行 */
const srcRef = r => !r.src ? '' : r.src.kind === 'code' ? `${r.src.repo}/${r.src.file}:${r.src.line}` : `${r.src.doc}:L${r.src.line}`;
const srcShort = r => !r.src ? '' : r.src.kind === 'code' ? `${r.src.file.split('/').pop()}:${r.src.line}` : `纪要 L${r.src.line}`;
