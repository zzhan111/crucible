/* ================= v0.2 主屏：步骤页签版（基于方向 B） =================
   - 每屏说明卡折叠成一行；③ 主从布局（列表行带原话前几个字）；④ 一次一个分歧 + 「去改规则 → ③」；
   - ⑤ 空格子「去补样本 → ①」并把这一格带到 ①；跨屏跳转后显示“← 回到”条。 */
function V() { return ui.v2 || (ui.v2 = { ruleSel: null, back: null, fill: null, flash: null }); }
const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

function intro(title, body) {
  return `<details class="intro2"><summary><span class="intro2-title">${title}</span><span class="intro2-more">说明</span></summary><div class="intro2-body">${body}</div></details>`;
}
/* 跨屏跳转后的“回到”条：只在目标屏显示 */
function backBar(on) {
  const b = V().back; if (!b || b.on !== on) return '';
  return `<div class="backbar" role="status"><button class="link-btn" data-act="go-back">← 回到 ${esc(b.label)}</button><span class="muted small">${esc(b.hint || '')}</span><span class="spacer"></span><button class="icon-btn" data-act="back-dismiss" aria-label="关闭回到条" title="关闭">×</button></div>`;
}

/* ---------- ① 三元比较：从 ⑤ 带来的格子上下文 ---------- */
function triadScreenV2(s) {
  const f = V().fill; let ctx = '';
  if (f && s.triad.mode === 'gap') {
    const c = matrixData(s).cells.find(x => x.cat === f.cat && x.src === f.src);
    const R = scopeDim(SC().matrix.row), C = scopeDim(SC().matrix.col);
    const inCell = s.triad.current.filter(code => ITEM[code] && R.get(ITEM[code]) === f.cat && C.get(ITEM[code]) === f.src).length;
    ctx = `<div class="ctxbar" id="fill-ctx"><span class="ctx-k">正在补样本</span><b>${esc(f.src)} × ${esc(f.cat)}</b>
      <span class="muted small" title="这一格有商品 ${c ? c.items.length : 0} 个、${SC().labels.specific} ${c ? c.specific.length : 0} 条；格子里不足 3 个商品时用${SC().text.fillOther}补齐">来自 ⑤ · 这一格 ${c ? c.items.length : 0} 个商品、专属规则 ${c ? c.specific.length : 0} 条 · 本组 ${inCell}/3 来自这一格${inCell < 3 ? `（其余为${SC().text.fillOther}）` : ''}</span>
      <span class="spacer"></span><button class="btn small" data-act="triad-new">同一格再抽一组</button><button class="link-btn" data-act="go-back">← 回到 ⑤</button><button class="icon-btn" data-act="fill-clear" aria-label="结束补样本" title="结束补样本">×</button></div>`;
  }
  return ctx + triadScreen(s);
}

/* ---------- ③ 规则：主从 ---------- */
function ruleFlags(r) {
  const sp = hitSplit(r); const f = [];
  if (r.origin === 'expert' && !r.quote) f.push('<span class="badge b-warn">未溯源</span>');
  if (sp.hit.length === 0 && r.active) f.push('<span class="badge b-warn">0 命中</span>');
  return f.join('');
}
function ruleSummaryHtml(r) {
  const sc = r.scope; const part = (d, a) => a.length ? (d.prefix ? esc(d.label) + ' ' : '') + a.map(esc).join('/') : '全部';
  const scope = SC().scope.filter(d => d.always || (sc[d.k] || []).length).map(d => part(d, sc[d.k] || [])).join(' · ') || SC().scopeAll;
  return `<span class="rs-scope">${scope}</span>
    <span class="rs-cond">${r.conds.length ? r.conds.map(c => esc(condText(c))).join(' 且 ') : '范围内全部'}</span>
    <span class="rs-arrow">→</span><span class="act ${r.action.type}">${actionText(r.action)}</span>
    ${r.exceptions.length ? `<span class="rs-exc">例外 ${r.exceptions.length}</span>` : ''}`;
}
/* 折叠行里的出处：专家规则 = 原话前几个字；没有原话 = 明确标“无原话”；常识契约 = 无原话 + 常识理由（模拟） */
function provenanceSnippet(r) {
  if (r.src && r.src.kind === 'code') return `<div class="bm-src code"><span class="bm-src-k">代码</span><span class="bm-src-q">${esc(srcShort(r))}</span></div>`;
  if (r.src && r.src.kind === 'interview') return `<div class="bm-src"><span class="bm-src-k">访谈 L${esc(r.src.line)}</span><span class="bm-src-q">“${esc(clip(r.quote, 18))}”</span></div>`;
  if (r.origin === 'expert') return r.quote
    ? `<div class="bm-src"><span class="bm-src-k">原话</span><span class="bm-src-q">“${esc(clip(r.quote, 20))}”</span></div>`
    : `<div class="bm-src none"><span class="bm-src-k">无原话</span><span>无法溯源，建议补上专家原话</span></div>`;
  return `<div class="bm-src dflt"><span class="bm-src-k">无原话</span><span class="bm-src-q">常识理由：${esc(clip(r.why, 16))}</span>${mockTag()}</div>`;
}
function ruleDetailBody(s, r) {
  const sp = hitSplit(r);
  const bySub = {}; sp.hit.forEach(it => { const k = SC().distKey(it); bySub[k] = (bySub[k] || 0) + 1; });
  const cs = caseStatus(s).filter(c => c.e.fired.includes(r) || c.e.excepted.some(x => x.r === r) || (c.e.marks || []).includes(r));
  const via = r.createdFrom.via === 'repair' ? '来自 ④ 纠错循环' : r.createdFrom.via === 'pile' ? '来自 ② 分堆“区别在哪”' : r.createdFrom.via === 'matrix' ? '来自 ⑤ 覆盖矩阵' : r.createdFrom.via === 'default' ? '常识契约（访谈前生成）' : r.createdFrom.via === 'seed' ? '【示例】预置' : r.createdFrom.via === 'code' ? '代码规则（已对照只读克隆核对文件:行）' : r.createdFrom.via === 'interview' ? '老板访谈纪要（2026-09-28）' : '手动新建';
  const isCode = r.src && r.src.kind === 'code';
  const thr = SC().inlineThr && r.conds.some(c => FIELDS[c.field] && FIELDS[c.field].type === 'num');
  const condHtml = (c, i) => thr && FIELDS[c.field] && FIELDS[c.field].type === 'num'
    ? `<span class="cond thr-cond">${esc(FIELDS[c.field].label)} ${esc(c.op)} <input class="input sm num thr-in" type="number" step="any" value="${esc(c.value)}" data-thr="${r.id}" data-i="${i}" aria-label="${esc(FIELDS[c.field].label)} 阈值">${esc(FIELDS[c.field].unit)}</span>`
    : `<span class="cond">${esc(condText(c))}</span>`;
  return `<div class="rd-grid">
      <div class="rd-k">${isCode ? '代码出处' : r.origin === 'expert' ? (r.src && r.src.kind === 'interview' ? '访谈纪要原文' : '来源原话') : '常识理由'}</div><div class="rd-v">${isCode ? `<div class="why code-src"><code>${esc(srcRef(r))}</code>${r.src.ref ? ` <span class="muted tiny">@ ${esc(r.src.ref)}</span>` : ''}<div>${esc(r.why)}</div></div>` : r.origin === 'expert' ? (r.quote ? `<div class="quote">“${esc(r.quote)}”</div>${r.src && r.src.kind === 'interview' ? `<div class="muted tiny">${esc(srcRef(r))} · 纪要原文逐字摘录（纪要本身注明“不是逐字转录”）</div>` : ''}` : '<span class="missing">没有原话 → 无法溯源</span>') : `<div class="why">${esc(r.why)} ${mockTag('模拟 AI 新手')}</div>`}
        ${(r.pending || []).length ? `<div class="pend-box"><b>待确认</b>${r.pending.map(x => `<div>· ${esc(x)}</div>`).join('')}</div>` : ''}
        <div class="muted tiny">${via}${r.createdFrom.item && ITEM[r.createdFrom.item] ? ' · 案例：' + esc(ITEM[r.createdFrom.item].name) : ''}</div></div>
      <div class="rd-k">适用范围</div><div class="rd-v chips">${scopeChips(r)}</div>
      <div class="rd-k">条件</div><div class="rd-v">${r.conds.length ? r.conds.map(condHtml).join(' 且 ') : '<span class="muted">（无条件：范围内全部命中）</span>'}${thr ? `<div class="thr-bar" id="thr-bar"><span class="muted tiny">改阈值 → 实时预览命中（${esc(SC().entity)}数据）</span><span id="thr-prev" class="thr-prev"></span><span class="spacer"></span><button class="btn primary small" data-act="thr-apply" data-id="${r.id}" id="thr-apply" disabled>应用阈值</button><button class="btn ghost small" data-act="thr-reset" data-id="${r.id}" id="thr-reset" disabled>还原</button></div>` : ''}</div>
      <div class="rd-k">判定</div><div class="rd-v"><span class="act ${r.action.type}">${actionText(r.action)}</span></div>
      <div class="rd-k">例外</div><div class="rd-v">${r.exceptions.length ? r.exceptions.map(e => `<div><span class="cond exc">${esc(condText(e))}</span> ${e.quote ? `<span class="quote inline">“${esc(e.quote)}”</span>` : '<span class="missing small">无原话</span>'}</div>`).join('') : '<span class="muted">无</span>'}</div>
    </div>
    <div class="rd-hits">
      <div class="rd-hits-head"><b id="rd-hitn">命中 ${sp.hit.length}</b> <span class="muted small">/ 范围内 ${sp.inScope}${sp.exc.length ? ` · 例外排除 ${sp.exc.length}` : ''}</span>
        ${Object.keys(bySub).length ? `<span class="sub-dist">${Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `<span class="chip c-dist">${esc(k)} ${n}</span>`).join('')}</span>` : ''}
        ${sp.hit.length === 0 && r.active ? '<span class="badge b-warn">区分度：一个都不命中</span>' : ''}</div>
      <div class="hit-list" id="rd-hitlist">${sp.hit.slice(0, 8).map(miniItem).join('')}${sp.hit.length > 8 ? `<span class="muted small">…</span>` : ''}</div>
      ${cs.length ? `<div class="small rd-cases">涉及已标注案例 ${cs.length} 个：${cs.map(c => `<a class="link" data-act="goto-case" data-code="${c.code}">${esc(c.it.name.slice(0, 10))} ${c.agree ? '✓' : '✗'}</a>`).join('，')}</div>` : ''}
    </div>`;
}
function ruleActions(r) {
  return `<button class="btn small" data-act="rule-edit" data-id="${r.id}">编辑</button>
      <button class="btn ghost small" data-act="rule-toggle" data-id="${r.id}">${r.active ? '停用' : '启用'}</button>
      ${r.origin === 'expert' ? `<button class="btn ghost small danger-text" data-act="rule-del" data-id="${r.id}">删除</button>` : ''}`;
}
function ruleList(s) {
  const f = ui.ruleFilter;
  const list = s.rules.filter(r => f === 'all' || (f === 'expert' && r.origin === 'expert') || (f === 'default' && r.origin === 'default') || (f === 'off' && !r.active));
  list.sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'expert' ? -1 : 1));
  return list;
}
function rulesScreen(s) {
  const f = ui.ruleFilter; const list = ruleList(s);
  const sel = list.find(r => r.id === V().ruleSel) || list[0];
  if (sel && V().ruleSel !== sel.id) V().ruleSel = sel.id; // 记住实际选中项（契约面板里同步高亮）
  const Lb = SC().labels;
  const cnt = k => s.rules.filter(r => k === 'all' || (k === 'expert' && r.origin === 'expert') || (k === 'default' && r.origin === 'default') || (k === 'off' && !r.active)).length;
  const row = r => `<button class="bm-row ${sel && sel.id === r.id ? 'on' : ''} ${r.origin} ${r.active ? '' : 'off'}" data-act="b-rule" data-id="${r.id}" id="bm-${r.id}" aria-current="${sel && sel.id === r.id}">
      <span class="bm-top"><span class="rid">${r.id}</span>${originBadge(r)}${r.active ? '' : '<span class="badge b-off">已停用</span>'}${ruleFlags(r)}<span class="spacer"></span><span class="bm-hit"><b>${hitSplit(r).hit.length}</b> 命中</span></span>
      <span class="bm-sum">${ruleSummaryHtml(r)}</span>
      ${provenanceSnippet(r)}</button>`;
  const detail = sel ? `<article class="bm-detail ${sel.origin} ${sel.active ? '' : 'off'} ${V().flash === sel.id ? 'flash' : ''}" id="rule-${sel.id}">
      <div class="rc-head"><span class="rid">${sel.id}</span>${originBadge(sel)}${sel.active ? '' : '<span class="badge b-off">已停用</span>'}<span class="spacer"></span>${ruleActions(sel)}</div>
      <div class="bm-one"><span class="muted small">系统理解为</span>${esc(ruleOneLine(sel))}</div>
      ${ruleDetailBody(s, sel)}</article>` : '<div class="empty-note">没有符合筛选的规则</div>';
  return `${intro(SC().text.rulesTitle, SC().text.rulesBody)}
  ${backBar('rules')}
  ${SC().rulesExtra ? SC().rulesExtra(s) : ''}
  <div class="toolbar">${[['all', '全部'], ['expert', Lb.expertFilter], ['default', Lb.defFilter], ['off', '已停用']].map(([k, l]) => `<button class="tchip ${f === k ? 'on' : ''}" data-act="rule-filter" data-f="${k}">${l} <span class="tc-n">${cnt(k)}</span></button>`).join('')}<span class="spacer"></span><button class="btn primary small" data-act="rule-new">＋ 新建规则</button></div>
  <div class="bm"><nav class="bm-list" aria-label="规则列表">${list.map(row).join('') || '<div class="empty-note">没有符合筛选的规则</div>'}</nav><div class="bm-pane">${detail}</div></div>`;
}

/* ---------- ④ 纠错：一次一个分歧 + 去改规则 → ③ ---------- */
/* 与当前案例最相关的规则：先看命中的；没有命中就找“范围覆盖它但条件没满足”的专家规则，再找常识规则 */
function relatedRules(s, it, e) {
  if (e.fired.length) return { kind: 'fired', rules: e.fired };
  const exc = e.excepted.map(x => x.r); if (exc.length) return { kind: 'excepted', rules: exc };
  const inS = s.rules.filter(r => r.active && inScope(it, r.scope));
  inS.sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'expert' ? -1 : 1));
  return { kind: 'scope', rules: inS.slice(0, 2) };
}
function jumpLink(r, code, kind) {
  const why = kind === 'fired' ? '命中并扣分' : kind === 'excepted' ? '例外生效' : '范围覆盖它但没命中';
  return `<button class="jump" data-act="jump-rule" data-id="${r.id}" data-code="${code}" title="${r.id}：${why}">去改规则 ${r.id} → ③</button>`;
}
function traceHtmlJump(e, code) {
  if (!e.fired.length && !e.excepted.length) return '<div class="trace muted">没有规则命中 → 基础分 1.00</div>' + marksHtml(e);
  return `<div class="trace">${e.fired.map(r => `<div class="trace-row"><div class="tr-top"><span class="rid">${r.id}</span>${originBadge(r)} <span>${esc(ruleOneLine(r))}</span><span class="spacer"></span>${jumpLink(r, code, 'fired')}</div>${ruleWhyLine(r, true)}</div>`).join('')}
    ${e.excepted.map(x => `<div class="trace-row exc"><div class="tr-top"><span class="rid">${x.r.id}</span> 例外生效「${esc(condText(x.ex))}」→ 不扣分<span class="spacer"></span>${jumpLink(x.r, code, 'excepted')}</div>${x.ex.quote ? '<div class="quote small">“' + esc(x.ex.quote) + '”</div>' : ''}</div>`).join('')}</div>${marksHtml(e)}`;
}
function repairScreen(s) {
  const cs = caseStatus(s);
  const open = cs.filter(c => !c.agree && !c.accepted), ok = cs.filter(c => c.agree), acc = cs.filter(c => c.accepted);
  let sel = s.repair.selected && cs.find(c => c.code === s.repair.selected);
  if (!sel || (sel.agree && open.length)) sel = open[0] || sel || null;
  const defaultOnly = s.rules.filter(r => r.origin === 'default').map(r => Object.assign({}, r, { exceptions: [], active: true }));
  const qRow = c => { const dv = evaluate(c.it, defaultOnly).verdict; const vsDefault = dv !== c.label; return `<div class="q-row ${sel && sel.code === c.code ? 'on' : ''} ${c.agree ? 'ok' : c.accepted ? 'acc' : 'bad'}" data-act="repair-sel" data-code="${c.code}"><div class="q-name">${esc(c.it.name)}</div><div class="q-v">契约 ${vd(c.e.verdict)} → 你 ${vd(c.label)} ${vsDefault && !c.agree ? '<span class="tag-def" title="只用常识契约也会判错：这是专家与“AI 新手”的分歧">≠常识</span>' : ''}${seedTag(c.L.seed)}</div></div>`; };
  const queue = `<div class="queue">
    <div class="q-head">分歧队列 <span class="count bad">${open.length}</span></div>${open.map(qRow).join('') || '<div class="muted small pad">没有分歧 ✓</div>'}
    <div class="q-head">已一致 <span class="count">${ok.length}</span></div>${ok.map(qRow).join('')}
    ${acc.length ? `<div class="q-head">已接受分歧 <span class="count">${acc.length}</span></div>${acc.map(qRow).join('')}` : ''}
  </div>`;
  const all = [...open, ...ok, ...acc]; const i = sel ? all.findIndex(c => c.code === sel.code) : -1;
  const chip = c => `<button class="case-chip ${sel && sel.code === c.code ? 'on' : ''} ${c.agree ? 'ok' : c.accepted ? 'acc' : 'bad'}" data-act="repair-sel" data-code="${c.code}" title="${esc(c.it.name)}：契约 ${VERDICT[c.e.verdict]} → 你 ${VERDICT[c.label]}">${c.agree ? '✓' : c.accepted ? '≈' : '✗'} ${esc(c.it.name.slice(0, 7))}</button>`;
  const strip = cs.length ? `<div class="case-strip"><span class="cs-k">分歧 <b class="bad">${open.length}</b></span>${open.map(chip).join('')}<span class="cs-sep"></span><span class="cs-k">已一致 ${ok.length}</span>${ok.map(chip).join('')}${acc.length ? `<span class="cs-sep"></span><span class="cs-k">已接受 ${acc.length}</span>${acc.map(chip).join('')}` : ''}
      <span class="spacer"></span>${i >= 0 && all.length > 1 ? `<span class="muted small">${i + 1} / ${all.length}</span><button class="icon-btn" aria-label="上一个案例" data-act="repair-sel" data-code="${(all[i - 1] || all[all.length - 1]).code}">‹</button><button class="icon-btn" aria-label="下一个案例" data-act="repair-sel" data-code="${(all[i + 1] || all[0]).code}">›</button>` : ''}</div>
    <details class="b-q" ${ui.open.queue ? 'open' : ''} data-sec="queue"><summary class="muted small">展开完整队列（含 契约→你 判断与 ≠常识 标记）</summary>${queue}</details>` : '';
  let detail;
  if (!cs.length) detail = '<div class="empty-note">还没有已标注案例。先去 <a class="link" data-act="goto-tab" data-tab="pile">② 分堆排序</a>。</div>';
  else if (!sel) detail = `<div class="all-good"><div class="big">✓ 当前契约和你全部 ${cs.length} 个标注一致</div><div class="muted">去 <a class="link" data-act="goto-tab" data-tab="pile">② 再分一批</a>，或去 <a class="link" data-act="goto-tab" data-tab="matrix">⑤ 看还没聊到的格子</a>——只有契约犯错时才需要你补充知识。</div></div>`;
  else {
    const it = sel.it, e = sel.e, L = sel.L;
    const harsher = VERDICT_ORDER[sel.label] > VERDICT_ORDER[e.verdict];
    const draft = s.repair.drafts[it.code] || '';
    const sameScopeOk = cs.filter(c => c.agree && c.code !== it.code && SC().sameGroup(c.it, it));
    const featRows = SC().feat.map(k => { const f = FIELDS[k]; const vals = sameScopeOk.map(c => f.get(c.it)).filter(v => v != null); const v = f.get(it); const out = v != null && vals.length && (v > Math.max(...vals) || v < Math.min(...vals)); return `<tr class="${out ? 'hl' : ''}"><th>${f.label}</th><td>${v ?? '—'}${v != null ? f.unit : ''}</td><td>${vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)}${f.unit}` : '—'}</td><td>${out ? '可区分' : ''}</td></tr>`; }).join('');
    let ai = '';
    if (!sel.agree && harsher) { const ref = sameScopeOk.find(c => VERDICT_ORDER[c.label] < VERDICT_ORDER[sel.label]); ai = aiBubble([e.fired.length ? `契约只因 ${e.fired.map(r => r.id).join('、')} 扣了一点分，没有规则让它更差。` : '契约里没有任何规则管到它，所以给了满分。', ref ? `和同品类里你判为「${VERDICT[ref.label]}」的 <b>${esc(ref.it.name)}</b> 比，它差在哪？` : '它差在哪？什么信号让你一眼看出来？', '能再举一个同样情况的商品吗？']); }
    else if (!sel.agree) { const r0 = e.fired[0]; ai = aiBubble([r0 ? `契约因为 <b>${r0.id}</b>「${esc(ruleOneLine(r0))}」扣了分${r0.origin === 'default' ? SC().text.defNote : ''}。` : '', '这条在什么情况下不成立？这个商品属于哪种情况？', '这种情况还适用于别的商品吗？']); }
    const rel = relatedRules(s, it, e);
    const jumps = `<div class="jump-row" id="repair-jumps"><span class="muted small">${rel.kind === 'fired' ? '想直接改扣分的规则？' : rel.kind === 'excepted' ? '例外让它不扣分：' : rel.rules.length ? '没有规则命中它；同范围的规则：' : '没有任何规则覆盖它：'}</span>
      ${rel.rules.map(r => jumpLink(r, it.code, rel.kind)).join('') || `<button class="jump" data-act="jump-rule" data-code="${it.code}">去规则列表 → ③</button>`}</div>`;
    detail = `<div class="repair-detail">
      ${ui.repairMsg ? `<div class="success-box">${ui.repairMsg}</div>` : ''}
      <div class="a-case">${itemCard(it, { big: true })}
        <div class="rd-verdicts">
          <div class="rv"><div class="muted small">你的判断</div>${vd(sel.label, 'lg')}<div class="small">${L.reason ? '“' + esc(L.reason) + '”' : '<span class="muted">（没写理由）</span>'}</div></div>
          <div class="rv"><div class="muted small">契约的判断</div>${vd(e.verdict, 'lg')}<div class="small muted">得分 ${e.score.toFixed(2)}</div>${SC().verdictExtra ? SC().verdictExtra(it, e) : ''}</div>
        </div></div>
      ${sel.agree ? `<div class="success-box">这个案例现在已经一致。</div>${jumps}` : `
      <div class="ask-box">
        <div class="ask-q">这是契约的判断和理由，<b>你知道什么它不知道？</b></div>
        <textarea class="input" rows="3" id="repair-answer" data-repair-draft="${it.code}" placeholder="直接说，会逐字保存为原话…">${esc(draft)}</textarea>
        <div class="row gap wrap">
          ${harsher ? `<button class="btn primary" data-act="repair-newrule" data-code="${it.code}">据此新建规则（区分这个商品）</button>` : ''}
          ${!harsher ? e.fired.map(r => `<button class="btn primary" data-act="repair-exc" data-code="${it.code}" data-id="${r.id}">给 ${r.id} 加例外</button><button class="btn" data-act="repair-off" data-code="${it.code}" data-id="${r.id}">停用 ${r.id}</button>`).join('') : ''}
          ${!harsher && !e.fired.length ? `<span class="muted small">没有扣分规则命中却判得更差？请检查例外。</span>` : ''}
          ${harsher ? '' : `<button class="btn ghost" data-act="repair-newrule" data-code="${it.code}">新建规则</button>`}
          <span class="spacer"></span>
          <button class="btn ghost small" data-act="repair-accept" data-code="${it.code}">保留分歧</button>
        </div>
        <div class="row gap wrap"><span class="muted small">或者，我的标注错了，应该是：</span>${['good', 'mid', 'bad'].filter(v => v !== sel.label).map(v => `<button class="btn ghost small" data-act="repair-relabel" data-code="${it.code}" data-v="${v}">${VERDICT[v]}</button>`).join('')}</div>
        ${jumps}
      </div>
      ${ai}`}
      <div class="a-two">
        <div class="card"><div class="card-head"><b>契约的理由</b><span class="muted small">（逐条可溯源）</span></div>${traceHtmlJump(e, it.code)}</div>
        <div class="card"><div class="card-head"><b>区分特征</b><span class="muted small">这个${esc(SC().entity)} vs 同品类里契约已判对的 ${sameScopeOk.length} 个案例（自动计算，非 AI）</span></div>
          ${sameScopeOk.length ? `<table class="feat"><thead><tr><th>字段</th><th>这个商品</th><th>其余案例范围</th><th></th></tr></thead><tbody>${featRows}</tbody></table>` : '<div class="muted small">同品类还没有判对的案例——新规则不会翻转已知案例，但也缺少对照。</div>'}
        </div>
      </div>
    </div>`;
  }
  return `${intro('只在契约判错的地方问你', '契约先给你标过的商品打分；只有和你不一致时才提问（TEIRESIAS / Ripple-Down Rules）。新规则必须把这个商品和以前判对的案例区分开——会翻转判对案例的改动默认被阻止；每次保存后重跑全部已标注案例。想直接改某条规则时，用「去改规则 → ③」跳过去，改完可一键回到这个案例。')}
    ${backBar('repair')}${strip}${detail}`;
}

/* ---------- ⑤ 覆盖矩阵：空格子 → 去补样本 → ① ---------- */
function matrixScreen(s) {
  const md = matrixData(s);
  const cell = (cat, src) => md.cells.find(c => c.cat === cat && c.src === src);
  const sel = ui.matrixCell;
  const td = c => {
    if (!c.items.length) return `<td class="mc none" title="这一格没有商品">—</td>`;
    const cls = c.specific.length ? 'covered' : 'gap';
    const isSel = sel && sel.cat === c.cat && sel.src === c.src;
    return `<td class="mc ${cls} ${isSel ? 'sel' : ''}" data-act="cell" data-cat="${c.cat}" data-src="${c.src}">
      ${c.specific.length ? `<div class="mc-n">${c.specific.length} 条</div>` : '<div class="mc-gap">还没聊到</div>'}
      <div class="mc-sub">${SC().entity} ${c.items.length}${c.labeled ? ` · 标注 ${c.labeled}` : ''}</div>
      <div class="mc-sub2">${c.generic.length ? `${SC().labels.generic} ${c.generic.length} · ` : ''}${SC().labels.defShort} ${c.def.length}</div>
      ${c.specific.length ? '' : `<button class="mc-jump" data-act="cell-triad" data-cat="${c.cat}" data-src="${c.src}" title="用这一格的商品出三元组">去补样本 → ①</button>`}</td>`;
  };
  let detail = '';
  if (sel) {
    const c = cell(sel.cat, sel.src);
    const Lb = SC().labels;
    detail = `<div class="card mx-detail" id="cell-detail"><div class="card-head"><b>${esc(sel.src)} × ${esc(sel.cat)}</b><span class="muted small">${SC().entity} ${c.items.length} · ${Lb.specific} ${c.specific.length} · ${Lb.generic}规则 ${c.generic.length} · ${Lb.defShort} ${c.def.length}</span><span class="spacer"></span>
      <button class="btn ${c.specific.length ? '' : 'primary'} small" data-act="cell-triad">去补样本 → ①<span class="btn-sub">用这一格出三元组</span></button><button class="btn small" data-act="cell-rule">为这一格新建规则</button></div>
      ${!c.specific.length ? aiBubble(SC().text.matrixAsk(sel.cat, sel.src), 'AI 追问') : `<div class="small">${c.specific.map(r => `<div class="rp-rule-text"><a class="link" data-act="goto-rule" data-id="${r.id}"><span class="rid">${r.id}</span></a>${esc(ruleOneLine(r))}</div>`).join('')}</div>`}
      <div class="hit-list">${c.items.slice(0, 40).map(miniItem).join('')}${c.items.length > 40 ? `<span class="muted small">…共 ${c.items.length}</span>` : ''}</div>
      <div class="muted tiny">${SC().text.cellNote}</div></div>`;
  }
  const R = scopeDim(SC().matrix.row), C = scopeDim(SC().matrix.col);
  return `
  ${intro(SC().text.matrixTitle, SC().text.matrixBody)}
  ${backBar('matrix')}
  <div class="toolbar"><span class="small">有商品的格子 ${md.withItems} 个 · 已聊到 <b>${md.withItems - md.gapCount}</b> · 还没聊到 <b class="warn-text">${md.gapCount}</b></span><span class="spacer"></span><span class="legend"><i class="lgd gap"></i>还没聊到 <i class="lgd covered"></i>已有专属规则 <i class="lgd none"></i>无商品</span></div>
  <div class="matrix-wrap"><table class="matrix"><thead><tr><th>${SC().matrix.corner}</th>${C.values().map(x => `<th>${esc(x)}<div class="muted tiny">${ITEMS.filter(i => C.get(i) === x).length} 个</div></th>`).join('')}</tr></thead>
    <tbody>${R.values().map(cat => `<tr><th>${esc(R.rowLabel ? R.rowLabel(cat) : cat)}<div class="muted tiny">${ITEMS.filter(i => R.get(i) === cat).length} 个</div></th>${C.values().map(src => td(cell(cat, src))).join('')}</tr>`).join('')}</tbody></table></div>
  ${detail}
  ${SC().mapSection(s)}`;
}
function storeMapSection(s) {
  const overrides = Object.entries(s.catOverrides).filter(([c]) => ITEM[c]);
  const srcCount = p => ITEMS.filter(i => i.prefix === p).length;
  return `<details class="card" ${ui.open.map ? 'open' : ''} data-sec="map"><summary><b>分类与来源映射（假设，可改）</b></summary>
    <div class="map-grid">
      <div><h4>来源：包装编码前缀 → 来源系列</h4><table class="kv small">${SOURCE_RULES.map(r => `<tr><th>${r.prefix}-</th><td><b>${r.source}</b>（${srcCount(r.prefix)} 个）<div class="muted tiny">${esc(r.why)}</div></td></tr>`).join('')}</table></div>
      <div><h4>品类：关键词表（按顺序，先命中先得；都不中 → 未分类）</h4><div class="kw-table">${CAT_RULES.map(r => `<div class="kw-row"><span class="chip c-cat" style="--c:${CAT_COLORS[r.cat]}">${r.cat}·${r.sub}</span><span class="muted tiny">${r.kw.map(esc).join('、')}</span></div>`).join('')}</div></div>
    </div>
    <h4>手动改过归类的商品（${overrides.length}）</h4>
    ${overrides.length ? overrides.map(([c, o]) => `<div class="small">${miniItem(ITEM[c])}：${esc(ITEM[c].autoCat)}·${esc(ITEM[c].autoSub)} → <b>${esc(o.cat)}·${esc(o.sub)}</b></div>`).join('') : '<div class="muted small">还没有。任意商品点“详情”即可改品类/子类，例如“笨笨嘴抖王汉堡（1 元）”可能被关键词误归到烘焙·汉堡。</div>'}
  </details>`;
}

/* ---------- 空场景 ---------- */
function emptyScreen(s) {
  return `<section class="screen"><div class="empty-state">
    <div class="es-icon">＋</div>
    <h2>这个场景还没开始</h2>
    <p class="muted">演示版里只有「小小云雀选品」和「药点ERP 采购规则」接入了数据。这里展示新场景的第一步：先填场景槽位。数据导入（CSV/xlsx）、访谈、规则抽取都<b>未实现</b>。可从顶栏场景菜单切回已接入数据的场景。</p>
    <div class="card slot-form">
      <label class="field-label">被评对象（artifact）</label><input class="input" data-slot="artifact" value="${esc(s.scenario.artifact)}" placeholder="例如：一张采购单 / 一个 SKU">
      <label class="field-label">用途（谁用分数做什么决定）</label><input class="input" data-slot="purpose" value="${esc(s.scenario.purpose)}" placeholder="例如：采购员下单前自查">
      <label class="field-label">代价（放过坏的 vs 错杀好的）</label><input class="input" data-slot="stakes" value="${esc(s.scenario.stakes)}" placeholder="例如：错下单压库存比漏采更糟">
      <div class="row gap"><button class="btn" disabled>导入数据（未实现）</button><button class="btn" disabled>开始访谈（未实现）</button></div>
    </div>
  </div></section>`;
}

function renderMain() {
  const s = S(), el = $('#main');
  if (s.empty) { el.innerHTML = emptyScreen(s); return; }
  el.innerHTML = `<section class="screen" id="screen-${state.tab}" role="tabpanel" aria-labelledby="st-${state.tab}">${({ triad: triadScreenV2, pile: pileScreen, rules: rulesScreen, repair: repairScreen, matrix: matrixScreen })[state.tab](s)}</section>`;
  renderSteps(); // 步骤状态全部由真实数据推出，每次主区重绘都同步
}
