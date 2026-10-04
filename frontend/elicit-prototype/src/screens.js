/* ================= 五个主屏 ================= */
const TABS = [
  { id: 'triad', n: '①', label: '三元比较' }, { id: 'pile', n: '②', label: '分堆排序' }, { id: 'rules', n: '③', label: '规则卡片' },
  { id: 'repair', n: '④', label: '纠错循环' }, { id: 'matrix', n: '⑤', label: '覆盖矩阵' },
];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function distinctSku(list, n) { const seen = new Set(), out = []; for (const it of shuffle(list)) { if (seen.has(it.sku)) continue; seen.add(it.sku); out.push(it); if (out.length === n) break; } return out; }

function aiBubble(lines, title = 'AI 追问') { return `<div class="ai-bubble"><div class="ai-head"><span class="ai-dot">AI</span>${esc(title)} ${mockTag('模拟 · 模板生成')}</div>${lines.map(l => `<div class="ai-line">${l}</div>`).join('')}</div>`; }

/* ---------- ① 三元比较 ---------- */
function newTriad(s, mode, cell) {
  let pool = ITEMS, forced = null;
  if (mode === 'samecat') { const cats = CATS.filter(c => ITEMS.filter(i => i.cat === c).length >= 3); const c = cats[Math.floor(Math.random() * cats.length)]; pool = ITEMS.filter(i => i.cat === c); }
  else if (mode === 'samesub') { const subs = [...new Set(ITEMS.map(i => i.cat + '|' + i.sub))].filter(k => new Set(ITEMS.filter(i => i.cat + '|' + i.sub === k).map(i => i.sku)).size >= 3); const k = subs[Math.floor(Math.random() * subs.length)]; pool = ITEMS.filter(i => i.cat + '|' + i.sub === k); }
  else if (mode === 'crosssrc') { const cats = CATS.filter(c => new Set(ITEMS.filter(i => i.cat === c).map(i => i.source)).size >= 2); const c = cats[Math.floor(Math.random() * cats.length)]; const byS = {}; ITEMS.filter(i => i.cat === c).forEach(i => (byS[i.source] = byS[i.source] || []).push(i)); const picks = shuffle(Object.values(byS)).flatMap(l => distinctSku(l, 2)); pool = picks.length >= 3 ? picks : ITEMS.filter(i => i.cat === c); }
  else if (mode === 'gap' || mode === 'cell') {
    let c = cell; if (mode === 'gap') { const g = matrixData(s).cells.filter(x => x.items.length && !x.specific.length); const pick = g[Math.floor(Math.random() * g.length)]; c = pick ? { cat: pick.cat, src: pick.src } : null; }
    if (c) { pool = ITEMS.filter(i => i.cat === c.cat && i.source === c.src); if (new Set(pool.map(i => i.sku)).size < 3) { const own = distinctSku(pool, 3); forced = own.concat(distinctSku(ITEMS.filter(i => i.cat === c.cat && i.source !== c.src && !own.some(o => o.sku === i.sku)), 3 - own.length)); } } // v0.2：格子里的商品不足 3 个时先全部放进来，再用同品类其他来源补齐
  }
  const t = forced && forced.length === 3 ? forced : distinctSku(pool, 3); if (t.length < 3) return newTriad(s, 'random');
  s.triad = Object.assign(s.triad, { current: t.map(i => i.code), mode: mode === 'cell' ? 'gap' : mode, odd: null });
  ui.triadMsg = null;
}
function pearson(a, b) { const n = a.length; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? num / Math.sqrt(da * db) : 0; }
function triadScreen(s) {
  const tri = s.triad.current.map(c => ITEM[c]).filter(Boolean);
  const odd = s.triad.odd;
  const modes = [['random', '随机'], ['samecat', '同品类'], ['samesub', '同子类'], ['crosssrc', '同品类·跨来源'], ['gap', '从“还没聊到”的格子抽']];
  const dim = s.dims.find(d => d.id === (s.triad.lastDim || (s.dims[s.dims.length - 1] || {}).id));
  return `
  ${intro('哪两个更像？第三个哪里不同？', '从真实商品里抽 3 个。你说出的区别会原样成为评价<b>维度</b>（方格法 / repertory grid）——维度用你的词，不由设计者预设。然后用这个维度给几个商品快速打分。')}
  <div class="toolbar"><span class="muted small">抽样方式：</span>${modes.map(([k, l]) => `<button class="tchip ${s.triad.mode === k ? 'on' : ''}" data-act="triad-mode" data-mode="${k}">${l}</button>`).join('')}<span class="spacer"></span><button class="btn small" data-act="triad-new">换一组</button></div>
  <div class="triad-row">${tri.map(it => itemCard(it, { cls: 'triad-card ' + (odd ? (odd === it.code ? 'odd' : 'pair') : ''), act: 'triad-odd', big: true, extra: `<div class="triad-tag">${odd ? (odd === it.code ? '不一样的那个' : '相像的一对') : '点我＝“这个不一样”'}</div>` })).join('')}</div>
  ${odd ? `<div class="card triad-form">
      <div class="tf-row"><label>那两个像在哪？<span class="muted small">（用你自己的话，不用想“标准答案”）</span></label><input class="input" id="triad-like" placeholder="例如：…"></div>
      <div class="tf-row"><label>「${esc(ITEM[odd].name)}」不同在哪？</label><input class="input" id="triad-diff" placeholder="例如：…"></div>
      <div class="row gap"><button class="btn primary" data-act="triad-save">存为维度</button><button class="btn ghost small" data-act="triad-clear">重选</button><span class="muted tiny">原话会逐字保存，作为维度的溯源。</span></div>
    </div>` : '<div class="muted small center">先点一个你觉得“和另外两个不一样”的商品。</div>'}
  ${ui.triadMsg || ''}
  ${dim ? ratingPanel(s, dim) : ''}
  ${gridPanel(s)}`;
}
function ratingPanel(s, dim) {
  const r = s.ratings[dim.id] || {};
  const codes = [...new Set([...dim.triad, ...Object.keys(r), ...((ui.rateExtra || {})[dim.id] || [])])].filter(c => ITEM[c]);
  return `<div class="card">
    <div class="card-head"><b>快速打分</b>
      <select class="input sm" data-act-change="rate-dim">${s.dims.map(d => `<option value="${d.id}" ${d.id === dim.id ? 'selected' : ''}>${d.id} ${esc(d.left)} ↔ ${esc(d.right)}</option>`).join('')}</select>
      ${seedTag(dim.seed)}<span class="spacer"></span><button class="btn ghost small" data-act="rate-more" data-dim="${dim.id}">再抽 5 个来打分</button></div>
    <div class="rate-scale"><span>1 = ${esc(dim.left)}</span><span>5 = ${esc(dim.right)}</span></div>
    <div class="rate-list">${codes.map(c => { const it = ITEM[c]; return `<div class="rate-row"><span class="rate-name" data-act="item" data-code="${c}">${esc(it.name)} <em>${money(it.price)}</em></span><span class="rate-btns">${[1, 2, 3, 4, 5].map(v => `<button class="rb ${r[c] === v ? 'on' : ''}" data-act="rate" data-dim="${dim.id}" data-code="${c}" data-v="${v}">${v}</button>`).join('')}</span></div>`; }).join('')}</div>
  </div>`;
}
function gridPanel(s) {
  if (!s.dims.length) return '';
  const codes = [...new Set(s.dims.flatMap(d => Object.keys(s.ratings[d.id] || {})))].filter(c => ITEM[c]).slice(0, 14);
  const hints = [];
  for (let i = 0; i < s.dims.length; i++) for (let j = i + 1; j < s.dims.length; j++) {
    const a = s.ratings[s.dims[i].id] || {}, b = s.ratings[s.dims[j].id] || {};
    const common = Object.keys(a).filter(c => b[c] != null);
    if (common.length >= 4) { const r = pearson(common.map(c => a[c]), common.map(c => b[c])); if (Math.abs(r) >= 0.8) hints.push(`维度 <b>${esc(s.dims[i].left)}↔${esc(s.dims[i].right)}</b> 和 <b>${esc(s.dims[j].left)}↔${esc(s.dims[j].right)}</b> 在 ${common.length} 个商品上${r > 0 ? '同向' : '反向'}高度相关（r=${r.toFixed(2)}）：它们是同一回事吗？`); }
  }
  return `<div class="card"><div class="card-head"><b>维度方格</b><span class="muted small">行 = 你说出的维度，列 = 打过分的商品</span></div>
    <div class="grid-wrap"><table class="grid"><thead><tr><th>维度（1 ↔ 5）</th>${codes.map(c => `<th title="${esc(ITEM[c].name)}"><div class="gh">${esc(ITEM[c].name.slice(0, 8))}</div></th>`).join('')}</tr></thead>
    <tbody>${s.dims.map(d => `<tr><td class="gd"><span class="rid">${d.id}</span>${esc(d.left)} ↔ ${esc(d.right)} ${seedTag(d.seed)} <button class="icon-btn tiny" data-act="dim-del" data-id="${d.id}" title="删除维度">×</button></td>${codes.map(c => { const v = (s.ratings[d.id] || {})[c]; return `<td class="gv v${v || 0}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    ${hints.length ? hints.map(h => `<div class="hint-box">${h} <span class="muted tiny">（相关系数计算得出，不是 AI）</span></div>`).join('') : '<div class="muted tiny">两个维度在 ≥4 个共同商品上 |r|≥0.8 时，这里会提示“是不是同一回事”。</div>'}
  </div>`;
}

/* ---------- ② 分堆排序 ---------- */
function pileInconsistencies(s) {
  const placed = s.pile.batch.filter(c => s.labels[c] && ITEM[c]).map(c => ITEM[c]);
  const out = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.cat !== b.cat || a.sub !== b.sub || a.price == null || b.price == null) continue;
    const va = s.labels[a.code].v, vb = s.labels[b.code].v; if (va === vb) continue;
    if (Math.abs(a.price - b.price) > Math.max(0.5, 0.25 * Math.max(a.price, b.price))) continue;
    const [x, y] = VERDICT_ORDER[va] <= VERDICT_ORDER[vb] ? [a, b] : [b, a];
    out.push({ key: [a.code, b.code].sort().join('|'), a: x, b: y });
  }
  return out;
}
function newPileBatch(s) {
  const unl = ITEMS.filter(i => !s.labels[i.code]);
  const subKeys = shuffle([...new Set(unl.map(i => i.cat + '|' + i.sub))].filter(k => new Set(unl.filter(i => i.cat + '|' + i.sub === k).map(i => i.sku)).size >= 3));
  const pick = [];
  if (subKeys[0]) pick.push(...distinctSku(unl.filter(i => i.cat + '|' + i.sub === subKeys[0]), 3));
  if (subKeys[1]) pick.push(...distinctSku(unl.filter(i => i.cat + '|' + i.sub === subKeys[1]), 2));
  const rest = unl.filter(i => !pick.includes(i));
  for (const src of shuffle(SOURCES)) { const c = distinctSku(rest.filter(i => i.source === src && !pick.some(p => p.sku === i.sku)), 1); pick.push(...c); }
  pick.push(...distinctSku(rest.filter(i => !pick.some(p => p.sku === i.sku)), 9 - pick.length));
  s.pile.batch = shuffle(pick.slice(0, 9)).map(i => i.code);
}
function pileCard(s, it) {
  const L = s.labels[it.code]; const e = evaluate(it, s.rules);
  const show = s.pile.showContract && L;
  const btns = ['good', 'mid', 'bad'].map(v => `<button class="pb p-${v} ${L && L.v === v ? 'on' : ''}" data-act="pile-set" data-code="${it.code}" data-v="${v}">${VERDICT[v]}</button>`).join('') + (L ? `<button class="pb" data-act="pile-set" data-code="${it.code}" data-v="" title="移回待分">↩</button>` : '');
  const extra = `<div class="pile-ctl">${btns}<a class="link tiny in-pile" data-act="item" data-code="${it.code}">详情</a>${show ? `<span class="cbadge ${e.verdict === L.v ? 'ok' : 'bad'}">契约：${VERDICT[e.verdict]}${e.verdict === L.v ? ' ✓' : ' ✗'}</span>` : ''}</div>
    ${L ? `<input class="input sm reason" data-reason="${it.code}" value="${esc(L.reason || '')}" placeholder="一句理由（可选，会作为原话保存）">${seedTag(L.seed)}` : ''}`;
  return itemCard(it, { drag: true, cls: 'pile-card', extra });
}
function pileScreen(s) {
  const batch = s.pile.batch.map(c => ITEM[c]).filter(Boolean);
  const un = batch.filter(it => !s.labels[it.code]);
  const col = v => batch.filter(it => s.labels[it.code] && s.labels[it.code].v === v);
  const inc = pileInconsistencies(s);
  return `
  ${intro('把这批商品拖进 好 / 中 / 差', '只要判断，不用说规则；理由可写一句。同品类、价格接近却进了不同堆的，系统会问“区别在哪？”——这类区别最容易变成规则。<span class="muted">（这批只作训练样本；正式 holdout 排序时不显示契约判断——原型未实现 holdout）</span>')}
  <div class="toolbar"><span class="muted small">本批 ${batch.length} 个 · 已分 ${batch.length - un.length}</span><span class="spacer"></span>
    <label class="small"><input type="checkbox" data-act-change="pile-show" ${s.pile.showContract ? 'checked' : ''}> 显示契约判断（训练批）</label>
    <button class="btn small" data-act="pile-new">换一批（混入同类近价商品）</button></div>
  <div class="tray pile-col" data-pile="">
    <div class="pile-title">待分 <span class="muted">${un.length}</span></div>
    <div class="pile-items tray-items">${un.length ? un.map(it => pileCard(s, it)).join('') : '<div class="muted small">都分完了。可以“换一批”继续，或去 ④ 看契约和你哪里不一致。</div>'}</div>
  </div>
  <div class="piles">${['good', 'mid', 'bad'].map(v => `<div class="pile-col p-${v}" data-pile="${v}"><div class="pile-title">${VERDICT[v]} <span class="muted">${col(v).length}</span></div><div class="pile-items">${col(v).map(it => pileCard(s, it)).join('') || '<div class="drop-hint">拖到这里</div>'}</div></div>`).join('')}</div>
  <div class="card ${inc.length ? 'warn-card' : ''}"><div class="card-head"><b>不一致检测</b><span class="muted small">同品类同子类、单价相差 ≤25%（或 ≤0.5 元），却放进了不同堆</span></div>
    ${inc.length ? inc.map(p => { const n = s.pile.notes[p.key]; return `<div class="inc-row">
      <div>${miniItem(p.a)} 放进 ${vd(s.labels[p.a.code].v)}，${miniItem(p.b)} 放进 ${vd(s.labels[p.b.code].v)} —— 同为 ${esc(p.a.cat)}·${esc(p.a.sub)}，单价 ${money(p.a.price)} vs ${money(p.b.price)}。<b>区别在哪？</b></div>
      ${n ? `<div class="quote">“${esc(n.text)}”</div><div class="row gap"><button class="btn small" data-act="inc-rule" data-key="${p.key}">把这句话变成规则…</button><button class="btn ghost small" data-act="inc-reopen" data-key="${p.key}">改写</button></div>`
        : `<div class="row gap"><input class="input grow" id="inc-${p.key.replace(/\|/g, '_')}" placeholder="例如：…（会逐字保存）"><button class="btn small" data-act="inc-note" data-key="${p.key}">记下这个区别</button><button class="btn ghost small" data-act="inc-same" data-key="${p.key}">其实一样（放进同一堆）</button></div>`}
    </div>`; }).join('') : '<div class="muted small">目前没有发现不一致。</div>'}
  </div>`;
}

/* ---------- ③ 规则卡片 ---------- */
function scopeChips(r) {
  const c = (k, v) => `<span class="chip c-scope">${esc(v)}<button class="chip-x" data-act="rc-scope-del" data-id="${r.id}" data-k="${k}" data-v="${esc(v)}" title="从范围中移除">×</button></span>`;
  return `<span class="scope-k">来源</span>${r.scope.sources.length ? r.scope.sources.map(v => c('sources', v)).join('') : '<span class="chip c-all">全部</span>'}
    <span class="scope-k">品类</span>${r.scope.cats.length ? r.scope.cats.map(v => c('cats', v)).join('') : '<span class="chip c-all">全部</span>'}
    <span class="scope-k">子类</span>${r.scope.subs.length ? r.scope.subs.map(v => c('subs', v)).join('') : '<span class="chip c-all">全部</span>'}
    <button class="chip c-add" data-act="rule-edit" data-id="${r.id}">＋ 改范围</button>`;
}

/* ---------- ④ 纠错循环 ---------- */
function suggestAmount(score, target) {
  for (const a of [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6]) { const x = score - a; const v = x >= 0.8 ? 'good' : x >= 0.55 ? 'mid' : 'bad'; if (v === target) return { type: 'penalty', amount: a }; }
  return target === 'bad' ? { type: 'veto', amount: 0.3 } : { type: 'penalty', amount: 0.3 };
}

/* ---------- ⑤ 覆盖矩阵 ---------- */
function matrixData(s) {
  const cells = []; let gapCount = 0, withItems = 0;
  for (const cat of CATS) for (const src of SOURCES) {
    const items = ITEMS.filter(i => i.cat === cat && i.source === src);
    const applies = r => r.active && (!r.scope.sources.length || r.scope.sources.includes(src)) && (!r.scope.cats.length || r.scope.cats.includes(cat));
    const exp = s.rules.filter(r => r.origin === 'expert' && applies(r));
    const specific = exp.filter(r => r.scope.sources.length && r.scope.cats.length);
    const generic = exp.filter(r => !specific.includes(r));
    const def = s.rules.filter(r => r.origin === 'default' && applies(r));
    const labeled = items.filter(i => s.labels[i.code]).length;
    if (items.length) { withItems++; if (!specific.length) gapCount++; }
    cells.push({ cat, src, items, specific, generic, def, labeled });
  }
  return { cells, gapCount, withItems };
}

/* ---------- 空场景 ---------- */
