/* ================= 通用 UI 组件 ================= */
const ui = { modal: null, editor: null, toastTimer: null, open: { rules: true, dims: true, cases: true, conflicts: true, log: false }, matrixCell: null, triadMsg: null, repairMsg: null, ruleFilter: 'all', pileSel: null };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = sel => document.querySelector(sel);
const money = p => p == null ? '—' : '¥' + p.toFixed(2);

function vd(v, extra = '') { return `<span class="vd vd-${v} ${extra}">${VERDICT[v]}</span>`; }
function mockTag(text = '模拟') { return `<span class="mock-tag" title="原型中这里是脚本/模板，真实产品会由 LLM 生成">${esc(text)}</span>`; }
function seedTag(on) { return on ? '<span class="seed-tag">示例</span>' : ''; }
function originBadge(r) {
  if (r.origin === 'default') return `<span class="badge b-default">常识契约</span>${mockTag()}`;
  return `<span class="badge b-expert">专家规则</span>${seedTag(r.seed)}${!r.quote ? '<span class="badge b-warn">未溯源</span>' : ''}`;
}
function thumb(it, big) { return `<div class="thumb${big ? ' big' : ''}" style="--c:${CAT_COLORS[it.cat] || '#94a3b8'}"><span>${esc(it.cat === '未分类' ? '?' : it.cat.slice(0, 2))}</span></div>`; }
function itemMeta(it) {
  const p = [`<b>${money(it.price)}</b>`];
  if (it.spec != null) p.push(`${it.spec}${/毫升|ml|升|L/i.test(it.pkgName + it.rawName) ? 'ml' : 'g'}`);
  if (it.shelf != null) p.push(`保质 ${it.shelf} 天`);
  return p.join(' · ');
}
function itemChips(it) {
  return `<span class="chip c-src">${esc(it.source)}</span><span class="chip c-cat" style="--c:${CAT_COLORS[it.cat]}">${esc(it.cat)}·${esc(it.sub)}</span>${it.photo ? '' : '<span class="chip c-warn">无正面照</span>'}`;
}
function itemCard(it, opts = {}) {
  return `<div class="item ${opts.cls || ''}" data-code="${it.code}" ${opts.drag ? 'draggable="true"' : ''} ${opts.act ? `data-act="${opts.act}"` : ''}>
    ${thumb(it, opts.big)}
    <div class="item-body">
      <div class="item-name" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="item-meta">${itemMeta(it)}</div>
      <div class="chips">${itemChips(it)}<a class="link small" data-act="item" data-code="${it.code}">详情</a></div>
      ${opts.extra || ''}
    </div>
  </div>`;
}
function miniItem(it) { return `<span class="mini-item" data-act="item" data-code="${it.code}" title="${esc(it.code)}">${esc(it.name)} <em>${money(it.price)}</em></span>`; }

function toast(msg, kind = '') {
  const r = $('#toast-root'); r.innerHTML = `<div class="toast ${kind}">${msg}</div>`;
  clearTimeout(ui.toastTimer); ui.toastTimer = setTimeout(() => { r.innerHTML = ''; }, 3200);
}
function download(name, text, mime) {
  const b = new Blob([text], { type: mime }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* 侧边栏 / 右侧契约预览：v0.2 已移到 shell.js（顶栏场景下拉 + 底部契约条 + 可停靠契约面板） */


/* ---------- 弹窗 ---------- */
function renderModal() {
  const root = $('#modal-root');
  if (!ui.modal) { root.innerHTML = ''; return; }
  const m = ui.modal;
  let inner = '';
  if (m.type === 'item') inner = itemModal(m.code);
  else if (m.type === 'editor') inner = editorModal();
  else if (m.type === 'confirm') inner = `<div class="modal"><div class="modal-head"><h3>${esc(m.title)}</h3><button class="icon-btn" data-act="close-modal">×</button></div><div class="modal-body"><p>${m.html}</p></div><div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button><button class="btn ${m.danger ? 'danger' : 'primary'}" data-act="confirm-ok">${esc(m.ok || '确定')}</button></div></div>`;
  else if (m.type === 'new-session') inner = `<div class="modal"><div class="modal-head"><h3>新场景</h3><button class="icon-btn" data-act="close-modal">×</button></div><div class="modal-body"><label class="field-label">场景名称</label><input id="new-sess-name" class="input" placeholder="例如：社区团购选品" maxlength="30"><p class="muted small">演示版只会创建一个空的占位场景：数据导入、访谈都尚未实现。</p></div><div class="modal-foot"><button class="btn ghost" data-act="close-modal">取消</button><button class="btn primary" data-act="create-session">创建</button></div></div>`;
  else if (m.type === 'yaml') inner = `<div class="modal wide"><div class="modal-head"><h3>契约导出预览（YAML 风格）</h3><button class="icon-btn" data-act="close-modal">×</button></div><div class="modal-body"><pre class="yaml">${esc(contractYaml())}</pre></div><div class="modal-foot"><button class="btn" data-act="export-json">下载 JSON</button><button class="btn primary" data-act="export-yaml">下载 YAML</button></div></div>`;
  root.innerHTML = `<div class="overlay" data-act="overlay">${inner}</div>`;
  if (m.type === 'editor') renderEdDynamic();
  if (m.type === 'new-session') setTimeout(() => { const i = $('#new-sess-name'); i && i.focus(); }, 0);
}
function openConfirm(title, html, onOk, ok, danger) { ui.modal = { type: 'confirm', title, html, onOk, ok, danger }; renderModal(); }

function itemModal(code) {
  const it = ITEM[code], s = S(); const e = evaluate(it, s.rules); const L = s.labels[code];
  const ov = s.catOverrides[code];
  const subOpts = SUBS_BY_CAT[it.cat].includes(it.sub) ? SUBS_BY_CAT[it.cat] : SUBS_BY_CAT[it.cat].concat([it.sub]);
  return `<div class="modal"><div class="modal-head"><h3>${esc(it.name)}</h3><button class="icon-btn" data-act="close-modal">×</button></div>
  <div class="modal-body">
    <div class="item-detail">${thumb(it, true)}<table class="kv">
      <tr><th>包装编码</th><td>${esc(it.code)}（SKU ${esc(it.sku)}）</td></tr>
      <tr><th>商品名称 / 包装名称</th><td>${esc(it.rawName)} / ${esc(it.pkgName)}</td></tr>
      <tr><th>零售价</th><td>${money(it.price)}</td></tr>
      <tr><th>规格（解析）</th><td>${it.spec ?? '解析不出'} ${it.unitPrice != null ? `· 每100g/ml ¥${it.unitPrice}` : ''} <span class="muted tiny">从名称正则解析，可能不准</span></td></tr>
      <tr><th>保质期</th><td>${it.shelf ?? '—'} 天</td></tr>
      <tr><th>来源系列</th><td>${esc(it.source)} <span class="muted tiny">由编码前缀 ${esc(it.prefix)} 推出（假设）；CSV“来源”列：${esc(it.origin)}</span></td></tr>
      <tr><th>照片</th><td>正面${it.photo ? '有' : '无'} · 侧面${it.side ? '有' : '无'} · 背面${it.back ? '有' : '无'}</td></tr>
      ${it.note ? `<tr><th>备注</th><td>${esc(it.note)}</td></tr>` : ''}
      <tr><th>销量 / 毛利</th><td class="muted">CSV 中没有 —— 占位，原型不编造</td></tr>
    </table></div>
    <h4>品类归属 ${ov ? '<span class="badge b-expert">已手动改</span>' : ''}</h4>
    <div class="muted small">自动归类：${esc(it.autoCat)} · ${esc(it.autoSub)}（${it.autoKw ? '命中关键词“' + esc(it.autoKw) + '”' : '无关键词命中 → 未分类'}）</div>
    <div class="row gap">
      <select class="input" id="im-cat" data-act-change="im-cat">${CATS.map(c => `<option ${c === it.cat ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select class="input" id="im-sub">${subOpts.map(c => `<option ${c === it.sub ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button class="btn small" data-act="im-save-cat" data-code="${code}">保存归类</button>
      ${ov ? `<button class="btn ghost small" data-act="im-reset-cat" data-code="${code}">恢复自动</button>` : ''}
    </div>
    <h4>契约当前判断：${vd(e.verdict)} <span class="muted">${e.score.toFixed(2)}</span></h4>
    ${traceHtml(e)}
    <h4>你的标注</h4>
    <div class="row gap">${['good', 'mid', 'bad'].map(v => `<button class="btn small pile-btn p-${v} ${L && L.v === v ? 'on' : ''}" data-act="im-label" data-code="${code}" data-v="${v}">${VERDICT[v]}</button>`).join('')}
    ${L ? `<button class="btn ghost small" data-act="im-label" data-code="${code}" data-v="">清除标注</button>` : ''}</div>
  </div></div>`;
}
function traceHtml(e) {
  if (!e.fired.length && !e.excepted.length) return '<div class="trace muted">没有规则命中 → 基础分 1.00</div>';
  return `<div class="trace">${e.fired.map(r => `<div class="trace-row"><span class="rid">${r.id}</span>${originBadge(r)} <span>${esc(ruleOneLine(r))}</span><div class="${r.origin === 'expert' ? 'quote small' : 'why'}">${r.origin === 'expert' ? (r.quote ? '“' + esc(r.quote) + '”' : '（无原话）') : '常识理由（模拟）：' + esc(r.why)}</div></div>`).join('')}
    ${e.excepted.map(x => `<div class="trace-row exc"><span class="rid">${x.r.id}</span> 例外生效「${esc(condText(x.ex))}」→ 不扣分 ${x.ex.quote ? '<div class="quote small">“' + esc(x.ex.quote) + '”</div>' : ''}</div>`).join('')}</div>`;
}

/* ---------- 规则编辑器 ---------- */
function newDraft(base = {}) {
  return Object.assign({ id: null, origin: 'expert', seed: false, active: true, scope: { sources: [], cats: [], subs: [] }, conds: [], action: { type: 'penalty', amount: 0.3 }, exceptions: [], quote: '', why: '', createdFrom: { via: 'manual' } }, clone(base));
}
function openEditor(opts) {
  // opts: {draft, ruleId, target, title, via}
  const s = S();
  let draft;
  if (opts.ruleId) draft = clone(s.rules.find(r => r.id === opts.ruleId)); else draft = newDraft(opts.draft || {});
  if (opts.via && !opts.ruleId) draft.createdFrom = { via: opts.via, item: opts.target || null };
  ui.editor = { draft, ruleId: opts.ruleId || null, target: opts.target || null, title: opts.title || (opts.ruleId ? `编辑规则 ${opts.ruleId}` : '新建规则'), force: false, focusExc: opts.focusExc || false };
  ui.modal = { type: 'editor' }; renderModal();
}
function edRulesAfter() {
  const s = S(), d = ui.editor.draft;
  return ui.editor.ruleId ? s.rules.map(r => r.id === ui.editor.ruleId ? d : r) : s.rules.concat([Object.assign({}, d, { id: '__draft' })]);
}
function condRow(c, i, kind) {
  const f = FIELDS[c.field];
  const fieldSel = `<select class="input sm" data-ed="${kind}" data-i="${i}" data-p="field">${Object.entries(FIELDS).map(([k, v]) => `<option value="${k}" ${k === c.field ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`;
  const opSel = `<select class="input sm" data-ed="${kind}" data-i="${i}" data-p="op">${OPS[f.type].map(o => `<option ${o === c.op ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  let val;
  if (f.type === 'enum') { const all = [...new Set(ITEMS.map(x => x.sub))]; val = `<select class="input sm" data-ed="${kind}" data-i="${i}" data-p="value">${all.map(o => `<option ${o === c.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; }
  else if (f.type === 'bool') val = `<select class="input sm" data-ed="${kind}" data-i="${i}" data-p="value">${['有', '无'].map(o => `<option ${o === c.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  else val = `<input class="input sm ${f.type === 'num' ? 'num' : ''}" data-ed="${kind}" data-i="${i}" data-p="value" value="${esc(c.value)}" placeholder="${f.type === 'num' ? '数值' : '关键词'}"><span class="unit">${f.unit}</span>`;
  const q = kind === 'exc' ? `<input class="input sm grow" data-ed="exc" data-i="${i}" data-p="quote" value="${esc(c.quote || '')}" placeholder="例外的原话（溯源）">` : '';
  return `<div class="cond-row">${fieldSel}${opSel}${val}${q}<button class="icon-btn" data-act="ed-del" data-kind="${kind}" data-i="${i}" title="删除">×</button></div>`;
}
function editorModal() {
  const E = ui.editor, d = E.draft, s = S();
  const chip = (k, v, label) => `<button class="tchip ${d.scope[k].includes(v) ? 'on' : ''}" data-act="ed-scope" data-k="${k}" data-v="${esc(v)}">${esc(label || v)}</button>`;
  const subs = (d.scope.cats.length ? d.scope.cats : []).flatMap(c => SUBS_BY_CAT[c]);
  const t = E.target ? ITEM[E.target] : null;
  const tgt = t ? (() => { const L = s.labels[t.code]; const e = evaluate(t, s.rules); return `<div class="ed-target"><div class="muted small">正在修复的分歧</div>${itemCard(t)}<div class="small">你判 ${L ? vd(L.v) : '—'} · 当前契约判 ${vd(e.verdict)}（${e.score.toFixed(2)}）</div></div>`; })() : '';
  return `<div class="modal xwide"><div class="modal-head"><h3>${esc(E.title)} ${d.origin === 'default' ? originBadge(d) : ''}</h3><button class="icon-btn" data-act="close-modal">×</button></div>
  <div class="ed-grid">
    <div class="ed-form">
      ${tgt}
      <section><h4>适用范围 <span class="muted small">不选 = 全部；同一句话在不同来源/子类可能不成立</span></h4>
        <div class="ed-row"><label>来源</label><div class="chipset">${SOURCES.map(v => chip('sources', v)).join('')}</div></div>
        <div class="ed-row"><label>品类</label><div class="chipset">${CATS.map(v => chip('cats', v)).join('')}</div></div>
        <div class="ed-row"><label>子类</label><div class="chipset">${subs.length ? subs.map(v => chip('subs', v)).join('') : '<span class="muted small">先选品类，再细分到子类</span>'}</div></div>
      </section>
      <section><h4>条件 <span class="muted small">全部满足才命中；没有条件 = 范围内全部命中</span></h4>
        ${d.conds.map((c, i) => condRow(c, i, 'cond')).join('')}
        <button class="btn ghost small" data-act="ed-add" data-kind="cond">＋ 条件</button>
        <div id="ed-sugg-cond"></div>
      </section>
      <section><h4>判定</h4>
        <div class="row gap">
          <label class="radio"><input type="radio" name="ed-act" data-ed="action" data-p="type" value="penalty" ${d.action.type === 'penalty' ? 'checked' : ''}> 扣分</label>
          <select class="input sm" data-ed="action" data-p="amount" ${d.action.type === 'veto' ? 'disabled' : ''}>${[0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6].map(a => `<option ${a === d.action.amount ? 'selected' : ''}>${a}</option>`).join('')}</select>
          <label class="radio"><input type="radio" name="ed-act" data-ed="action" data-p="type" value="veto" ${d.action.type === 'veto' ? 'checked' : ''}> 否决（直接判差）</label>
        </div>
        <div class="muted tiny">新规则默认扣分；升为否决需确认在已标注的“好”样本上不误杀（见右侧回归）。</div>
      </section>
      <section><h4>例外 <span class="muted small">任一满足则这条规则不适用</span></h4>
        ${d.exceptions.map((c, i) => condRow(c, i, 'exc')).join('')}
        <button class="btn ghost small" data-act="ed-add" data-kind="exc">＋ 例外</button>
        <div id="ed-sugg-exc"></div>
      </section>
      ${d.origin === 'expert' ? `<section><h4>来源原话 <span class="req">溯源</span></h4>
        <textarea class="input" rows="2" data-ed="quote" placeholder="逐字记录专家说的话，例如：“……”">${esc(d.quote)}</textarea>
        <div class="muted tiny">原型里由你手动粘贴/输入；真实产品中原话来自对话转写，并做子串校验。</div></section>` : `<section><h4>常识理由 ${mockTag('模拟 AI')}</h4><div class="why">${esc(d.why)}</div><div class="muted tiny">这是常识契约的规则。你加的例外需要附上你的原话。</div></section>`}
    </div>
    <div class="ed-preview" id="ed-preview"></div>
  </div>
  <div class="modal-foot" id="ed-foot"></div></div>`;
}
function renderEdDynamic() {
  const E = ui.editor; if (!E) return; const d = E.draft, s = S();
  const sp = hitSplit(d);
  const reg = regression(s.rules, edRulesAfter());
  const bySub = {}; sp.hit.forEach(it => { const k = it.cat + '·' + it.sub; bySub[k] = (bySub[k] || 0) + 1; });
  const subRows = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
  const maxN = Math.max(1, ...subRows.map(x => x[1]));
  const t = E.target ? ITEM[E.target] : null;
  let tgtHtml = '';
  if (t) {
    const L = s.labels[t.code]; const a = evaluate(t, edRulesAfter());
    tgtHtml = `<div class="tgt-status ${L && a.verdict === L.v ? 'ok' : 'bad'}">当前商品：保存后契约判 ${vd(a.verdict)}（${a.score.toFixed(2)}），你判 ${L ? vd(L.v) : '—'} ${L && a.verdict === L.v ? '✓ 分歧解决' : '✗ 还没让它变对'}</div>`;
  }
  let flipHtml = '';
  if (reg.flipped.length) {
    const sugg = t ? distinguish(t, reg.flipped.map(x => x.it)) : [];
    flipHtml = `<div class="flip-box"><b>⚠ 会翻转 ${reg.flipped.length} 个原本判对的案例</b>
      <div class="small">Ripple-Down 原则：新规则必须把当前商品和以前判对的案例区分开。请收窄范围、加条件，或加例外。</div>
      ${reg.flipped.map(x => `<div class="flip-row">${miniItem(x.it)}：你判 ${vd(x.L)}，现在契约 ${vd(x.b)} → 将变 ${vd(x.a)}</div>`).join('')}
      ${t ? `<div class="small" style="margin-top:6px">区分特征（自动计算，当前商品 vs 被翻转案例）：</div>${sugg.length ? sugg.map((g, i) => `<button class="tchip sugg" data-act="ed-sugg" data-kind="${E.focusExc ? 'exc' : 'cond'}" data-g='${esc(JSON.stringify(g))}'>＋ ${esc(condText(g))}<span class="muted tiny">　${esc(g.text)}</span></button>`).join('') : '<div class="muted small">现有字段区分不开 —— 可能是数据里没有的信息（口感、品牌认知…）。可用“名称包含”，或记为“需要新字段”。</div>'}` : ''}
    </div>`;
  }
  $('#ed-preview').innerHTML = `
    <div class="backtrans"><div class="muted small">系统理解为（回译确认）</div><div>${esc(ruleOneLine(d))}</div></div>
    ${tgtHtml}
    <div class="pv-stat"><b>${sp.hit.length}</b> 个商品命中 <span class="muted small">（范围内 ${sp.inScope} 个${sp.exc.length ? `，例外排除 ${sp.exc.length} 个` : ''}）</span></div>
    ${subRows.length ? `<div class="bars">${subRows.slice(0, 8).map(([k, n]) => `<div class="bar-row"><span class="bar-label">${esc(k)}</span><span class="bar" style="width:${Math.round(n / maxN * 100)}%"></span><span class="bar-n">${n}</span></div>`).join('')}</div>` : ''}
    <div class="hit-list">${sp.hit.slice(0, 14).map(miniItem).join('')}${sp.hit.length > 14 ? `<span class="muted small">…等 ${sp.hit.length} 个</span>` : ''}</div>
    ${sp.exc.length ? `<div class="muted small">被例外排除：</div><div class="hit-list exc">${sp.exc.slice(0, 6).map(miniItem).join('')}${sp.exc.length > 6 ? '…' : ''}</div>` : ''}
    <div class="reg-box"><div class="small"><b>回归：</b>重跑全部 ${reg.total} 个已标注案例 → 一致 ${reg.agreeBefore} → <b>${reg.agreeAfter}</b></div>
      ${reg.fixed.map(x => `<div class="fix-row">✓ 修好 ${miniItem(x.it)}：${vd(x.b)} → ${vd(x.a)}（你判 ${vd(x.L)}）</div>`).join('')}
      ${reg.changed.map(x => `<div class="muted small">· ${esc(x.it.name)}：${VERDICT[x.b]} → ${VERDICT[x.a]}（你判 ${VERDICT[x.L]}，仍不一致）</div>`).join('')}
    </div>
    ${flipHtml}`;
  // 条件建议（无翻转时也给出：当前商品 vs 同范围已判对案例）
  const condBox = $('#ed-sugg-cond'), excBox = $('#ed-sugg-exc');
  if (t && condBox) {
    const correct = caseStatus(s).filter(c => c.agree && c.code !== t.code && inScope(c.it, d.scope)).map(c => c.it);
    const sg = distinguish(t, correct);
    const html = sg.length ? `<div class="muted tiny">区分特征（当前商品 vs 同范围内已判对的 ${correct.length} 个案例，自动计算）：</div>` + sg.map(g => `<button class="tchip sugg" data-act="ed-sugg" data-kind="KIND" data-g='${esc(JSON.stringify(g))}'>＋ ${esc(condText(g))}</button>`).join('') : (correct.length ? '<div class="muted tiny">同范围内已判对的案例，用现有字段区分不开。</div>' : '<div class="muted tiny">同范围内没有已判对的案例，不会翻转已知案例。</div>');
    condBox.innerHTML = E.focusExc ? '' : html.replace(/KIND/g, 'cond');
    excBox.innerHTML = E.focusExc ? html.replace(/KIND/g, 'exc') : '';
  }
  const blocked = reg.flipped.length && !E.force;
  $('#ed-foot').innerHTML = `
    ${reg.flipped.length ? `<label class="small force"><input type="checkbox" data-ed="force" ${E.force ? 'checked' : ''}> 这些翻转是对的：把这 ${reg.flipped.length} 个案例的标注改成新判断（记入日志）</label>` : '<span></span>'}
    <div class="row gap">${E.ruleId ? `<button class="btn ghost danger-text" data-act="ed-toggle-active">${d.active ? '停用此规则' : '启用此规则'}</button>` : ''}
    <button class="btn ghost" data-act="close-modal">取消</button>
    <button class="btn primary" data-act="ed-save" ${blocked ? 'disabled title="会翻转原本判对的案例，请先区分"' : ''}>${blocked ? '已阻止：会翻转判对的案例' : '保存并重跑回归'}</button></div>`;
}
