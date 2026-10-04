/* ================= v0.2 外壳：顶栏（场景下拉）+ 步骤页签 + 底部契约条 + 可停靠契约面板 =================
   布局：#app = 网格（头部 94px / 主区 / [底部停靠面板] / 契约条 56px；右侧停靠时主区右边多一列）。
   契约面板是“停靠”而不是“浮层”：打开后主区被挤窄（右侧）或变矮（底部，≤50vh），③/④ 始终可读、可操作。 */
const LAYOUT_KEY = 'elicit-proto-v2-layout';
const CP_TABS = [['rules', '规则'], ['dims', '维度'], ['cases', '样本'], ['conflicts', '待办'], ['log', '记录']];
function LY() {
  if (!ui.layout) { let saved = {}; try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { /* ignore */ } ui.layout = Object.assign({ dock: 'right', w: 440, h: 42, tab: 'rules' }, saved); }
  return ui.layout;
}
function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(LY())); } catch (e) { /* ignore */ } }
const clampW = w => Math.round(Math.max(320, Math.min(w, Math.min(720, window.innerWidth * 0.55))));
const clampH = h => Math.round(Math.max(22, Math.min(h, 50))); // 底部停靠：占视口高度的百分比，最多 50%
function applyLayout() {
  const l = LY(), b = document.body, app = $('#app');
  b.classList.toggle('cp-open', !!state.rightOpen && !S().empty);
  b.classList.toggle('dock-right', l.dock === 'right'); b.classList.toggle('dock-bottom', l.dock === 'bottom');
  app.style.setProperty('--cpw', clampW(l.w) + 'px'); app.style.setProperty('--cph', clampH(l.h) + 'vh');
}
function render() { renderHead(); renderMain(); renderContract(); }
function renderSidebar() { renderHead(); }           // 兼容旧调用：左栏已并入顶栏
function renderRight() { renderContract(); renderSteps(); } // 兼容旧调用：契约变化时同步步骤状态

/* ---------- 步骤状态：全部由真实数据推出 ---------- */
function stepStatus(s) {
  const lab = labeledCodes(s).length;
  const batch = s.pile.batch.filter(c => ITEM[c]); const un = batch.filter(c => !s.labels[c]).length;
  const incons = pileInconsistencies(s).filter(p => !s.pile.notes[p.key]).length;
  const expert = s.rules.filter(r => r.origin === 'expert');
  const zero = s.rules.filter(r => r.active && hitSplit(r).hit.length === 0).length;
  const untraced = expert.filter(r => !r.quote).length;
  const dis = disagreements(s).length; const gaps = matrixData(s).gapCount;
  const st = {};
  st.triad = s.dims.length ? { k: 'done', sub: `维度 ${s.dims.length}` } : s.triad.odd ? { k: 'prog', sub: '进行中' } : { k: 'todo', sub: '未开始' };
  const pend = un + incons;
  st.pile = !lab && !pend ? { k: 'todo', sub: '未开始' } : pend ? { k: 'prog', sub: '进行中', n: pend, tip: [un ? `待分 ${un}` : '', incons ? `不一致 ${incons}` : ''].filter(Boolean).join(' · ') } : { k: 'done', sub: `已标注 ${lab}` };
  st.rules = !expert.length ? { k: 'todo', sub: '还没有专家规则' } : (zero + untraced) ? { k: 'prog', sub: `专家 ${expert.length}`, n: zero + untraced, tip: [zero ? `0 命中 ${zero}` : '', untraced ? `未溯源 ${untraced}` : ''].filter(Boolean).join(' · ') } : { k: 'done', sub: `专家规则 ${expert.length}` };
  st.repair = !lab ? { k: 'todo', sub: '还没有标注' } : dis ? { k: 'alert', sub: '分歧', n: dis, tip: `${dis} 个案例契约与你不一致` } : { k: 'done', sub: '全部一致' };
  st.matrix = gaps ? { k: 'prog', sub: '未聊到', n: gaps, tip: `${gaps} 个有商品的格子还没有专属规则` } : { k: 'done', sub: '全部聊到' };
  return st;
}
function stepsHtml(s) {
  if (s.empty) return `<nav class="steps-v2 disabled" aria-label="步骤（空场景不可用）">${TABS.map((t, i) => `<span class="st st-todo"><span class="st-ico">${i + 1}</span><span class="st-l">${t.label}</span></span>`).join('')}</nav>`;
  const st = stepStatus(s);
  return `<nav class="steps-v2" role="tablist" aria-label="五个步骤（可任意顺序进入）">${TABS.map((t, i) => {
    const x = st[t.id], on = state.tab === t.id;
    const label = { done: '已完成', prog: '进行中', alert: '有待处理', todo: '未开始' }[x.k];
    return `<button class="st st-${x.k} ${on ? 'on' : ''}" role="tab" id="st-${t.id}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-act="tab" data-tab="${t.id}" title="${label}${x.tip ? '：' + x.tip : ''}" data-status="${x.k}">
      <span class="st-ico" aria-hidden="true">${x.k === 'done' ? '✓' : i + 1}</span><span class="st-l">${t.label}</span>
      <span class="st-s">${x.sub}${x.n ? `<b class="st-n">${x.n}</b>` : ''}</span></button>`;
  }).join('')}</nav>`;
}
function renderSteps() { const n = $('#steps-slot'); if (n) n.innerHTML = stepsHtml(S()); }

/* ---------- 顶栏（94px = 48 场景行 + 46 步骤行） ---------- */
function renderHead() {
  const s = S();
  const hasSeed = !s.empty && (s.rules.some(r => r.seed) || s.dims.some(d => d.seed) || Object.values(s.labels).some(l => l.seed));
  const sess = state.order.map(id => {
    const x = state.sessions[id];
    const sub = x.empty ? '空 · 占位' : `规则 ${x.rules.filter(r => r.origin === 'expert').length} · 标注 ${labeledCodes(x).length} · 分歧 ${disagreements(x).length}`;
    return `<button class="sess ${id === state.active ? 'active' : ''}" data-act="switch-session" data-id="${id}" role="menuitemradio" aria-checked="${id === state.active}"><span class="sess-icon">${esc(x.name.slice(0, 1))}</span><span><span class="sess-name">${esc(x.name)}</span><span class="sess-sub">${sub}</span></span>${id === state.active ? '<span class="sess-on">当前</span>' : ''}</button>`;
  }).join('');
  $('#head').innerHTML = `<div class="hd-row">
      <span class="brand-v2"><span class="logo" aria-hidden="true">C</span><b>Crucible</b></span>
      <details class="pop sess-pop"><summary aria-label="切换场景"><h1>${esc(s.name)}</h1><span class="pop-caret">▾</span></summary>
        <div class="pop-body" role="menu"><div class="pop-label">场景（一个会话 = 一个场景 = 一份契约）</div>${sess}
          <div class="pop-actions"><button class="btn small" data-act="new-session">＋ 新场景</button><button class="btn ghost small" data-act="reset">↺ 重置演示数据</button></div>
          <div class="muted tiny pop-note">原型 · 非生产 · 数据内嵌在本文件，状态存浏览器 localStorage，不联网</div></div></details>
      ${s.empty ? '<span class="badge b-off">空场景 · 占位</span>' : `<span class="badge b-ver">契约草稿 v${s.version}</span>
      <details class="pop scen-pop"><summary title="场景槽位"><i>被评对象</i>${esc(s.scenario.artifact)}<span class="pop-caret">▾</span></summary>
        <div class="pop-body"><table class="kv"><tr><th>被评对象</th><td>${esc(s.scenario.artifact)}</td></tr><tr><th>用途</th><td>${esc(s.scenario.purpose)}</td></tr><tr><th>代价</th><td>${esc(s.scenario.stakes)}</td></tr></table></div></details>`}
      ${hasSeed ? `<details class="pop seed-pop"><summary title="本页含预置示例与模拟内容"><span class="seed-tag">含示例</span><span class="mock-tag">模拟</span></summary>
        <div class="pop-body"><div class="small"><b>【示例】</b>= 预置的虚构内容，不代表任何人的真实判断；<b>模拟</b> = 脚本，不是真 AI。</div><div class="row gap" style="margin-top:8px"><button class="btn small" data-act="clear-seed">清除示例</button></div></div></details>` : ''}
      <span class="spacer"></span><span class="muted tiny hd-note">UI 原型 · 非生产</span>
    </div>
    <div class="hd-steps" id="steps-slot">${stepsHtml(s)}</div>`;
}

/* ---------- 契约：底部 56px 条 + 停靠面板（规则 | 维度 | 样本 | 待办 | 记录） ---------- */
function contractParts(s) {
  const cs = caseStatus(s);
  const defaultOnly = s.rules.filter(r => r.origin === 'default').map(r => Object.assign({}, r, { exceptions: [], active: true }));
  const agreeDefault = cs.filter(c => evaluate(c.it, defaultOnly).verdict === c.label).length;
  const expert = s.rules.filter(r => r.origin === 'expert'), def = s.rules.filter(r => r.origin === 'default');
  const ruleRow = r => `<div class="rp-rule ${r.active ? '' : 'off'} ${r.origin} ${state.tab === 'rules' && V().ruleSel === r.id ? 'on' : ''}" data-act="goto-rule" data-id="${r.id}" role="button" tabindex="0">
      <div class="rp-rule-top"><span class="rid">${r.id}</span>${originBadge(r)}${r.active ? '' : '<span class="badge b-off">已停用</span>'}<span class="hitc">命中 ${hitSplit(r).hit.length}</span></div>
      <div class="rp-rule-text">${esc(ruleOneLine(r))}</div>
      ${r.origin === 'expert' ? (r.quote ? `<div class="quote">“${esc(r.quote)}”</div>` : '<div class="quote missing">（没有原话，无法溯源）</div>') : `<div class="why">常识理由${mockTag('模拟 AI')}：${esc(r.why)}</div>`}
      ${r.exceptions.map(e => `<div class="quote small">例外「${esc(condText(e))}」${e.quote ? '：“' + esc(e.quote) + '”' : '<span class="missing">（无原话）</span>'}</div>`).join('')}
    </div>`;
  const dis = cs.filter(c => !c.agree && !c.accepted), acc = cs.filter(c => c.accepted);
  const incons = pileInconsistencies(s).filter(p => !s.pile.notes[p.key]);
  const zeroRules = s.rules.filter(r => r.active && hitSplit(r).hit.length === 0);
  const nConf = dis.length + incons.length + zeroRules.length;
  return {
    agree: cs.filter(c => c.agree).length, total: cs.length, agreeDefault, nExpert: expert.length, nConf,
    sec: {
      rules: { title: '规则', count: s.rules.length, body: `<div class="sub-head">专家规则 ${expert.length}</div>` + (expert.length ? expert.map(ruleRow).join('') : '<div class="empty-note">还没有专家规则</div>') + `<div class="sub-head">常识契约 ${def.length} ${mockTag('模拟 AI 新手生成')}</div>` + def.map(ruleRow).join('') },
      dims: { title: '维度（专家自己的词）', count: s.dims.length, body: s.dims.length ? s.dims.map(d => `<div class="rp-dim"><div><span class="rid">${d.id}</span> <b>${esc(d.left)}</b> ↔ <b>${esc(d.right)}</b> ${seedTag(d.seed)}<span class="hitc">已打分 ${Object.keys(s.ratings[d.id] || {}).length}</span></div><div class="quote small">像：“${esc(d.quoteL)}”</div><div class="quote small">不同：“${esc(d.quoteR)}”</div>${(d.notes || []).map(n => `<div class="quote small">补充：“${esc(n.text)}”</div>`).join('')}</div>`).join('') : '<div class="empty-note">去 <a class="link" data-act="goto-tab" data-tab="triad">① 三元比较</a> 生成维度</div>' },
      cases: { title: '已标注案例（回归集）', count: cs.length, body: cs.length ? cs.map(c => `<div class="rp-case ${c.agree ? 'ok' : c.accepted ? 'acc' : 'bad'}" data-act="goto-case" data-code="${c.code}" role="button" tabindex="0"><span class="case-name">${esc(c.it.name)}</span>${seedTag(c.L.seed)}<span class="case-v">你 ${vd(c.label)} 契约 ${vd(c.e.verdict)} ${c.agree ? '✓' : c.accepted ? '≈' : '✗'}</span></div>`).join('') : '<div class="empty-note">去 <a class="link" data-act="goto-tab" data-tab="pile">② 分堆排序</a> 标注</div>' },
      conflicts: { title: '冲突与待办', count: nConf, body: (dis.length ? `<div class="sub-head">契约 vs 你的标注</div>` + dis.map(c => `<div class="rp-conf" data-act="goto-case" data-code="${c.code}" role="button" tabindex="0">✗ ${esc(c.it.name)}：契约判 ${vd(c.e.verdict)}，你判 ${vd(c.label)}</div>`).join('') : '') +
        (incons.length ? `<div class="sub-head">分堆不一致（区别在哪？）</div>` + incons.map(p => `<div class="rp-conf" data-act="goto-tab" data-tab="pile" role="button" tabindex="0">≠ ${esc(p.a.name)} vs ${esc(p.b.name)}</div>`).join('') : '') +
        (zeroRules.length ? `<div class="sub-head">区分度：一个都不命中的规则</div>` + zeroRules.map(r => `<div class="rp-conf" data-act="goto-rule" data-id="${r.id}" role="button" tabindex="0">∅ ${r.id} ${esc(ruleOneLine(r))}</div>`).join('') : '') +
        (acc.length ? `<div class="sub-head">已接受的分歧</div>` + acc.map(c => `<div class="rp-conf muted" data-act="goto-case" data-code="${c.code}" role="button" tabindex="0">≈ ${esc(c.it.name)}${s.accepted[c.code].note ? '：' + esc(s.accepted[c.code].note) : ''}</div>`).join('') : '') ||
        '<div class="empty-note">没有未处理的冲突</div>' },
      log: { title: '变更与回归记录', count: s.log.length, body: s.log.map(l => `<div class="rp-log"><span class="muted">${fmtTime(l.ts)}</span> ${esc(l.text)}${l.seed ? seedTag(true) : ''}${l.reg ? `<div class="muted tiny">回归 ${l.reg.total} 例：一致 ${l.reg.before} → ${l.reg.after}${l.reg.flipped.length ? `，翻转 ${l.reg.flipped.length}` : ''}${l.reg.fixed.length ? `，修好 ${l.reg.fixed.length}` : ''}</div>` : ''}</div>`).join('') || '<div class="empty-note">还没有记录</div>' },
    },
  };
}
function renderContract() {
  const s = S(), l = LY(), bar = $('#cbar'), panel = $('#contract');
  applyLayout();
  if (s.empty) {
    bar.innerHTML = `<button class="cb-title" data-act="toggle-right" aria-expanded="false" disabled><b>契约预览</b></button><span class="muted small">这个场景还没有任何内容。</span>`;
    panel.innerHTML = ''; return;
  }
  const P = contractParts(s); const open = !!state.rightOpen; const rate = P.total ? P.agree / P.total : 1;
  bar.innerHTML = `<button class="cb-title" data-act="toggle-right" aria-expanded="${open}" aria-controls="contract" title="${open ? '收起契约面板（Esc）' : '展开契约面板'}"><b>契约预览</b><span class="muted small">草稿 v${s.version} · 实时</span><span class="cb-caret" aria-hidden="true">${open ? (l.dock === 'right' ? '⟩' : '⌄') : (l.dock === 'right' ? '⟨' : '⌃')}</span></button>
    <span class="cb-m" title="当前契约与你的标注一致"><b class="${rate >= .9 ? 'ok' : 'warn'}">${P.agree}/${P.total}</b> 一致</span>
    <span class="cb-m" title="只用常识契约（模拟）时一致"><b>${P.agreeDefault}/${P.total}</b> 只用常识${mockTag()}</span>
    <span class="cb-m" title="专家独有规则"><b>${P.nExpert}</b> 专家规则</span>
    <span class="cb-sep"></span>
    ${CP_TABS.map(([k, t]) => `<button class="cb-sec ${open && l.tab === k ? 'on' : ''} ${k === 'conflicts' && P.nConf ? 'alert' : ''}" data-act="cp-tab" data-k="${k}" data-from="bar">${t} <b>${P.sec[k].count}</b></button>`).join('')}
    <span class="spacer"></span>
    <button class="btn small" data-act="export-json">导出 JSON</button><button class="btn small" data-act="export-yaml">导出 YAML</button><button class="btn ghost small" data-act="view-yaml">预览</button>`;
  if (!open) { panel.innerHTML = ''; panel.hidden = true; return; }
  panel.hidden = false;
  const k = P.sec[l.tab] ? l.tab : 'rules';
  panel.innerHTML = `<div class="cp-resize" data-resize role="separator" tabindex="0" aria-orientation="${l.dock === 'right' ? 'vertical' : 'horizontal'}" aria-label="拖动调整契约面板${l.dock === 'right' ? '宽度' : '高度'}（双击恢复默认）" title="拖动调整大小 · 双击恢复默认"></div>
    <div class="cp-head">
      <div class="cp-tabs" role="tablist" aria-label="契约内容">${CP_TABS.map(([kk, t]) => `<button class="cp-tab ${k === kk ? 'on' : ''}" role="tab" aria-selected="${k === kk}" data-act="cp-tab" data-k="${kk}">${t}<span class="count ${kk === 'conflicts' && P.nConf ? 'bad' : ''}">${P.sec[kk].count}</span></button>`).join('')}</div>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="cp-dock" aria-label="${l.dock === 'right' ? '改为停靠到底部' : '改为停靠到右侧'}" title="${l.dock === 'right' ? '停靠到底部（≤50% 高）' : '停靠到右侧'}">${l.dock === 'right' ? '⬓' : '◨'}</button>
      <button class="icon-btn" data-act="cp-close" aria-label="关闭契约面板（Esc）" title="关闭（Esc）">✕</button>
    </div>
    <div class="cp-title"><b>${P.sec[k].title}</b><span class="muted small">${P.agree}/${P.total} 一致 · 点条目可跳到对应屏，面板保持打开</span></div>
    <div class="cp-body cp-${k}" role="tabpanel">${P.sec[k].body}</div>`;
}

/* 拖动调整面板大小（右侧 = 宽度；底部 = 高度，最多 50vh） */
document.addEventListener('pointerdown', e => {
  const h = e.target.closest && e.target.closest('[data-resize]'); if (!h) return;
  e.preventDefault(); const l = LY(); document.body.classList.add('resizing');
  const move = ev => { if (l.dock === 'right') l.w = clampW(window.innerWidth - ev.clientX); else l.h = clampH((window.innerHeight - 56 - ev.clientY) / window.innerHeight * 100); applyLayout(); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); saveLayout(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => { if (e.target.closest && e.target.closest('[data-resize]')) { const l = LY(); if (l.dock === 'right') l.w = 440; else l.h = 42; applyLayout(); saveLayout(); } });
document.addEventListener('keydown', e => {
  const t = e.target;
  if (t.matches && t.matches('[data-resize]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const l = LY(); e.preventDefault();
    if (l.dock === 'right') l.w = clampW(l.w + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 24 : -24)); else l.h = clampH(l.h + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? 2 : -2));
    applyLayout(); saveLayout(); return;
  }
  // 步骤页签：左右方向键切换焦点（roving tabindex）
  if (t.matches && t.matches('.steps-v2 .st') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const all = [...document.querySelectorAll('.steps-v2 .st')]; const i = all.indexOf(t);
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]; n && n.focus(); e.preventDefault(); return;
  }
  // 可点击的 div（契约条目）支持回车
  if (e.key === 'Enter' && t.matches && t.matches('[role="button"][data-act]')) { t.click(); return; }
  if (e.key !== 'Escape' || ui.modal) return;
  const pop = document.querySelector('details.pop[open]');
  if (pop) { pop.open = false; const sm = pop.querySelector('summary'); sm && sm.focus(); return; }
  if (state.rightOpen) { state.rightOpen = false; save(); renderContract(); const b = $('.cb-title'); b && b.focus(); }
});
// 点击弹出层外部时关闭（details 弹出层）
document.addEventListener('click', e => { document.querySelectorAll('details.pop[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); }, true);
window.addEventListener('resize', () => applyLayout());
