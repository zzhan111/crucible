/* ================= 事件与启动 ================= */
// render() / renderSidebar() / renderRight() 在 shell.js（v0.2 外壳）
function nextId(s, p) { const n = s.rules.concat(s.dims).map(x => x.id).filter(id => id && id.startsWith(p)).map(id => parseInt(id.slice(p.length), 10) || 0); return p + (Math.max(0, ...n) + 1); }
function snapshot(s) { const m = {}; labeledCodes(s).forEach(c => m[c] = evaluate(ITEM[c], s.rules).verdict); return m; }
function snapDiff(s, b, a) {
  const out = { flipped: [], fixed: [], changed: [], total: 0, agreeBefore: 0, agreeAfter: 0 };
  labeledCodes(s).forEach(c => { const L = s.labels[c].v; out.total++; if (b[c] === L) out.agreeBefore++; if (a[c] === L) out.agreeAfter++; if (b[c] === L && a[c] !== L) out.flipped.push({ it: ITEM[c] }); else if (b[c] !== L && a[c] === L) out.fixed.push({ it: ITEM[c] }); });
  return out;
}
function regMsg(reg) { return `重跑 ${reg.total} 个已标注案例：一致 ${reg.agreeBefore} → <b>${reg.agreeAfter}</b>${reg.fixed.length ? `，修好 ${reg.fixed.map(x => esc(x.it.name)).join('、')}` : ''}${reg.flipped.length ? `，翻转 ${reg.flipped.length} 个（已改标）` : ''}`; }
function closeModal() { ui.modal = null; ui.editor = null; renderModal(); }
function gotoRule(id) {
  // v0.2：③ 是主从布局 → 选中该规则（列表行滚到可见 + 详情闪一下）；契约面板若开着保持打开
  state.tab = 'rules'; ui.ruleFilter = 'all'; V().ruleSel = id; V().flash = id; render(); save();
  const row = document.getElementById('bm-' + id); if (row) row.scrollIntoView({ block: 'nearest' });
  const el = document.getElementById('rule-' + id); if (el) el.scrollIntoView({ block: 'nearest' });
  setTimeout(() => { V().flash = null; const d = document.getElementById('rule-' + id); d && d.classList.remove('flash'); }, 1600);
}
function setLabel(s, code, v, from) {
  if (!v) { delete s.labels[code]; delete s.accepted[code]; return; }
  const old = s.labels[code];
  s.labels[code] = { v, reason: old ? old.reason : '', from: from || 'pile', ts: nowIso(), seed: old && old.v === v ? !!old.seed : false };
}
function applyRuleChange(s, newRule, text) {
  const after = s.rules.map(x => x.id === newRule.id ? newRule : x);
  const reg = regression(s.rules, after);
  if (reg.flipped.length) { openEditor({ ruleId: newRule.id }); ui.editor.draft = newRule; renderModal(); toast('这个改动会翻转原本判对的案例，已转入编辑器确认', 'warn'); return; }
  s.rules = after; bump(s, 'rule', text, reg); save(); render(); toast(regMsg(reg));
}

const actions = {
  'switch-session': d => { state.active = d.id; ui.matrixCell = null; ui.v2 = null; const pop = document.querySelector('details.sess-pop'); if (pop) pop.open = false; ui.triadMsg = null; ui.repairMsg = null; save(); render(); },
  'new-session': () => { ui.modal = { type: 'new-session' }; renderModal(); },
  'create-session': () => { const name = ($('#new-sess-name').value || '').trim() || '未命名场景'; const id = 's' + Date.now(); state.sessions[id] = emptySession(id, name); state.order.push(id); state.active = id; closeModal(); save(); render(); toast(`已创建空场景「${esc(name)}」（占位）`); },
  'reset': () => openConfirm('重置演示数据？', '会清空本浏览器里的全部改动（规则、标注、维度、新场景），恢复到初始示例状态。', () => { state = freshState(); applyOverrides(); ui.matrixCell = null; ui.v2 = null; ui.triadMsg = null; ui.repairMsg = null; ui.rateExtra = {}; save(); render(); toast('已重置'); }, '重置', true),
  'confirm-ok': () => { const fn = ui.modal && ui.modal.onOk; closeModal(); fn && fn(); },
  'close-modal': closeModal,
  'tab': d => { state.tab = d.tab; ui.repairMsg = null; save(); render(); $('#main').scrollTop = 0; const b = document.getElementById('st-' + d.tab); if (b && document.activeElement && document.activeElement.closest && document.activeElement.closest('.steps-v2')) b.focus(); },
  'goto-tab': d => actions.tab(d),
  'toggle-right': () => { state.rightOpen = !state.rightOpen; save(); renderContract(); if (state.rightOpen) { const b = $('.cp-tab.on'); b && b.focus(); } },
  'clear-seed': () => openConfirm('清除全部示例内容？', '删除带【示例】标记的规则、维度、标注和日志（常识契约保留）。', () => { const s = S(); s.rules = s.rules.filter(r => !r.seed); s.dims.filter(d => d.seed).forEach(d => delete s.ratings[d.id]); s.dims = s.dims.filter(d => !d.seed); Object.keys(s.labels).forEach(c => { if (s.labels[c].seed) { delete s.labels[c]; delete s.accepted[c]; } }); s.log = s.log.filter(l => !l.seed); s.triad.lastDim = null; bump(s, 'seed', '清除全部示例内容'); save(); render(); toast('示例已清除'); }, '清除', true),
  'export-json': () => { const s = S(); download(`contract-${s.id}-v${s.version}.json`, JSON.stringify(contractSpec(), null, 2), 'application/json'); toast('已导出 JSON'); },
  'export-yaml': () => { const s = S(); download(`contract-${s.id}-v${s.version}.yaml`, contractYaml(), 'text/yaml'); toast('已导出 YAML'); },
  'view-yaml': () => { ui.modal = { type: 'yaml' }; renderModal(); },
  'item': d => { ui.modal = { type: 'item', code: d.code }; renderModal(); },
  'im-save-cat': d => {
    const s = S(), it = ITEM[d.code], cat = $('#im-cat').value, sub = $('#im-sub').value; const b = snapshot(s); const from = `${it.cat}·${it.sub}`;
    if (cat === it.autoCat && sub === it.autoSub) delete s.catOverrides[d.code]; else s.catOverrides[d.code] = { cat, sub };
    applyOverrides(); const reg = snapDiff(s, b, snapshot(s)); bump(s, 'cat', `改归类「${it.name}」：${from} → ${cat}·${sub}`, reg); save(); renderModal(); render(); toast('已改归类。' + regMsg(reg));
  },
  'im-reset-cat': d => { const s = S(); const b = snapshot(s); delete s.catOverrides[d.code]; applyOverrides(); const reg = snapDiff(s, b, snapshot(s)); bump(s, 'cat', `恢复自动归类「${ITEM[d.code].name}」`, reg); save(); renderModal(); render(); },
  'im-label': d => { const s = S(); setLabel(s, d.code, d.v, 'manual'); s.log.unshift({ ts: nowIso(), kind: 'label', text: d.v ? `标注「${ITEM[d.code].name}」为 ${VERDICT[d.v]}` : `清除「${ITEM[d.code].name}」的标注` }); save(); renderModal(); render(); },
  'goto-rule': d => { closeModal(); gotoRule(d.id); },
  'goto-case': d => { const s = S(); state.tab = 'repair'; s.repair.selected = d.code; ui.repairMsg = null; save(); render(); },
  // ① 三元比较
  'triad-mode': d => { const s = S(); V().fill = null; newTriad(s, d.mode); save(); renderMain(); },
  'triad-new': () => { const s = S(); const f = V().fill; if (f && s.triad.mode === 'gap') newTriad(s, 'cell', f); else newTriad(s, s.triad.mode); save(); renderMain(); },
  'triad-odd': d => { const s = S(); s.triad.odd = d.code; ui.triadMsg = null; save(); renderMain(); setTimeout(() => { const i = $('#triad-like'); i && i.focus(); }, 0); },
  'triad-clear': () => { S().triad.odd = null; save(); renderMain(); },
  'triad-save': () => {
    const s = S(), like = $('#triad-like').value.trim(), diff = $('#triad-diff').value.trim();
    if (!like || !diff) { toast('两句都写一下：像在哪、不同在哪', 'err'); return; }
    const id = nextId(s, 'V'), odd = s.triad.odd;
    s.dims.push({ id, left: like, right: diff, quoteL: like, quoteR: diff, triad: s.triad.current.slice(), odd, notes: [], seed: false, createdAt: nowIso() });
    s.ratings[id] = {}; s.triad.current.forEach(c => s.ratings[id][c] = c === odd ? 5 : 1);
    s.triad.lastDim = id; s.triad.odd = null;
    bump(s, 'dim', `新增维度 ${id}：${like} ↔ ${diff}`);
    ui.triadMsg = aiBubble([`你说那两个「${esc(like)}」。能再举一个最「${esc(like)}」的商品吗？`, `怎么一眼认出一个商品是「${esc(diff)}」——看包装、价格，还是别的？`, `「${esc(like)}」和「${esc(diff)}」跟“该不该留在货架上”有关系吗？`, `<div class="row gap"><input class="input grow" id="triad-followup" placeholder="回答会作为维度 ${id} 的补充原话保存（原型不做自动抽取）"><button class="btn small" data-act="triad-answer" data-dim="${id}">保存回答</button></div>`], '追问（laddering 通用探针）');
    save(); render(); toast(`已存为维度 ${id}，并把这 3 个商品放在两端（可在下方改分）`);
  },
  'triad-answer': d => { const s = S(); const v = ($('#triad-followup').value || '').trim(); if (!v) return; const dim = s.dims.find(x => x.id === d.dim); if (dim) { (dim.notes = dim.notes || []).push({ text: v, ts: nowIso() }); s.log.unshift({ ts: nowIso(), kind: 'dim', text: `维度 ${dim.id} 补充原话：“${v}”` }); } ui.triadMsg = null; save(); render(); toast('已保存为补充原话'); },
  'rate': d => { const s = S(); const r = s.ratings[d.dim] = s.ratings[d.dim] || {}; const v = +d.v; if (r[d.code] === v) delete r[d.code]; else r[d.code] = v; save(); renderMain(); renderRight(); },
  'rate-more': d => { const s = S(); const dim = s.dims.find(x => x.id === d.dim); const cats = [...new Set(dim.triad.map(c => ITEM[c].cat))]; ui.rateExtra = ui.rateExtra || {}; const have = new Set([...(ui.rateExtra[d.dim] || []), ...Object.keys(s.ratings[d.dim] || {}), ...dim.triad]); const pool = ITEMS.filter(i => !have.has(i.code) && (Math.random() < 0.5 ? cats.includes(i.cat) : true)); ui.rateExtra[d.dim] = [...(ui.rateExtra[d.dim] || []), ...distinctSku(pool, 5).map(i => i.code)]; renderMain(); },
  'dim-del': d => openConfirm('删除维度？', `删除 ${esc(d.id)} 及其打分。`, () => { const s = S(); s.dims = s.dims.filter(x => x.id !== d.id); delete s.ratings[d.id]; if (s.triad.lastDim === d.id) s.triad.lastDim = null; bump(s, 'dim', `删除维度 ${d.id}`); save(); render(); }, '删除', true),
  // ② 分堆
  'pile-set': d => { const s = S(); setLabel(s, d.code, d.v, 'pile'); save(); render(); },
  'pile-new': () => { const s = S(); newPileBatch(s); save(); render(); toast('已换一批（9 个未标注商品，含同子类商品）'); },
  'inc-note': d => { const s = S(); const el = document.getElementById('inc-' + d.key.replace(/\|/g, '_')); const v = (el && el.value || '').trim(); if (!v) { toast('写一句区别', 'err'); return; } s.pile.notes[d.key] = { text: v, ts: nowIso() }; const [a, b] = d.key.split('|'); s.log.unshift({ ts: nowIso(), kind: 'note', text: `区别（${ITEM[a].name} vs ${ITEM[b].name}）：“${v}”` }); save(); render(); },
  'inc-reopen': d => { delete S().pile.notes[d.key]; save(); render(); },
  'inc-same': d => { const s = S(); const p = pileInconsistencies(s).find(x => x.key === d.key); if (p) { setLabel(s, p.b.code, s.labels[p.a.code].v, 'pile'); } save(); render(); },
  'inc-rule': d => {
    const s = S(); const p = pileInconsistencies(s).find(x => x.key === d.key); const n = s.pile.notes[d.key]; if (!p) return;
    const cand = [p.b, p.a].find(it => evaluate(it, s.rules).verdict !== s.labels[it.code].v) || p.b;
    const e = evaluate(cand, s.rules);
    openEditor({ draft: { scope: { sources: [...new Set([p.a.source, p.b.source])], cats: [p.a.cat], subs: [p.a.sub] }, conds: [], action: suggestAmount(e.score, s.labels[cand.code].v), quote: n ? n.text : '' }, target: cand.code, via: 'pile', title: `把“区别”变成规则（${p.a.sub}）` });
  },
  // ③ 规则卡片
  'rule-filter': d => { ui.ruleFilter = d.f; renderMain(); },
  'rule-new': () => openEditor({ via: 'manual' }),
  'rule-edit': d => openEditor({ ruleId: d.id }),
  'rule-toggle': d => { const s = S(); const r = clone(s.rules.find(x => x.id === d.id)); r.active = !r.active; applyRuleChange(s, r, `${r.active ? '启用' : '停用'} ${r.id}`); },
  'rule-del': d => openConfirm('删除规则？', `删除 ${esc(d.id)}，然后重跑回归。`, () => { const s = S(); const after = s.rules.filter(r => r.id !== d.id); const reg = regression(s.rules, after); s.rules = after; bump(s, 'rule', `删除 ${d.id}`, reg); save(); render(); toast(regMsg(reg)); }, '删除', true),
  'rc-scope-del': d => {
    const s = S(); const r = clone(s.rules.find(x => x.id === d.id)); r.scope[d.k] = r.scope[d.k].filter(x => x !== d.v);
    if (d.k === 'cats' && r.scope.cats.length) { const ok = r.scope.cats.flatMap(c => SUBS_BY_CAT[c]); r.scope.subs = r.scope.subs.filter(x => ok.includes(x)); }
    if (d.k === 'cats' && !r.scope.cats.length) r.scope.subs = [];
    applyRuleChange(s, r, `${r.id} 范围去掉「${d.v}」→ ${scopeText(r.scope)}`);
  },
  // ④ 纠错
  'repair-sel': d => { S().repair.selected = d.code; ui.repairMsg = null; save(); renderMain(); },
  'repair-newrule': d => {
    const s = S(), it = ITEM[d.code], e = evaluate(it, s.rules), L = s.labels[d.code].v;
    openEditor({ draft: { scope: { sources: [it.source], cats: [it.cat], subs: [it.sub] }, conds: [], action: suggestAmount(e.score, L), quote: s.repair.drafts[d.code] || '' }, target: d.code, via: 'repair', title: `新建规则：区分「${it.name}」` });
  },
  'repair-exc': d => {
    const s = S(), it = ITEM[d.code];
    const others = caseStatus(s).filter(c => c.agree && c.code !== d.code && c.e.fired.some(r => r.id === d.id)).map(c => c.it);
    const sg = distinguish(it, others);
    const ex = sg.find(g => g.field === 'spec' || g.field === 'sub') || sg[0] || (it.spec != null ? { field: 'spec', op: '≥', value: it.spec } : { field: 'sub', op: '=', value: it.sub });
    openEditor({ ruleId: d.id, target: d.code, focusExc: true, title: `给 ${d.id} 加例外（为「${it.name}」）` });
    ui.editor.draft.exceptions.push({ field: ex.field, op: ex.op, value: ex.value, quote: s.repair.drafts[d.code] || '' });
    renderModal();
  },
  'repair-off': d => { openEditor({ ruleId: d.id, target: d.code, title: `停用 ${d.id}？（先看回归）` }); ui.editor.draft.active = false; renderModal(); },
  'repair-accept': d => { const s = S(); s.accepted[d.code] = { note: s.repair.drafts[d.code] || '', ts: nowIso() }; s.log.unshift({ ts: nowIso(), kind: 'accept', text: `接受分歧：「${ITEM[d.code].name}」` }); s.repair.selected = null; save(); render(); toast('已记为“接受的分歧”（会在导出里公开占比）'); },
  'repair-relabel': d => { const s = S(); const L = s.labels[d.code]; const old = L.v; L.v = d.v; L.seed = false; L.reason = (L.reason || '') + ` 〔纠错时改标：${VERDICT[old]}→${VERDICT[d.v]}〕`; s.log.unshift({ ts: nowIso(), kind: 'label', text: `改标「${ITEM[d.code].name}」：${VERDICT[old]} → ${VERDICT[d.v]}` }); save(); render(); },
  // ⑤ 矩阵
  'cell': d => { ui.matrixCell = { cat: d.cat, src: d.src }; renderMain(); },
  'cell-triad': d => { const s = S(); const c = d && d.cat ? { cat: d.cat, src: d.src } : ui.matrixCell; if (!c) return; ui.matrixCell = c; V().fill = { cat: c.cat, src: c.src }; newTriad(s, 'cell', c); state.tab = 'triad'; save(); render(); $('#main').scrollTop = 0; },
  'cell-rule': () => { const c = ui.matrixCell; openEditor({ draft: { scope: { sources: [c.src], cats: [c.cat], subs: [] } }, via: 'matrix', title: `为 ${c.src} × ${c.cat} 新建规则` }); },
  // 编辑器
  'ed-scope': d => { const sc = ui.editor.draft.scope; const a = sc[d.k]; const i = a.indexOf(d.v); if (i >= 0) a.splice(i, 1); else a.push(d.v); if (d.k === 'cats') { const ok = sc.cats.flatMap(c => SUBS_BY_CAT[c]); sc.subs = sc.subs.filter(x => ok.includes(x)); } renderModal(); },
  'ed-add': d => { const t = ui.editor.target ? ITEM[ui.editor.target] : null; const c = { field: 'price', op: d.kind === 'exc' ? '≤' : '>', value: t && t.price != null ? t.price : '' }; if (d.kind === 'exc') { c.quote = ''; ui.editor.draft.exceptions.push(c); } else ui.editor.draft.conds.push(c); renderModal(); },
  'ed-del': d => { const arr = d.kind === 'exc' ? ui.editor.draft.exceptions : ui.editor.draft.conds; arr.splice(+d.i, 1); renderModal(); },
  'ed-sugg': d => { const g = JSON.parse(d.g); const c = { field: g.field, op: g.op, value: g.value }; if (d.kind === 'exc') { c.quote = (S().repair.drafts[ui.editor.target] || ''); ui.editor.draft.exceptions.push(c); } else ui.editor.draft.conds.push(c); renderModal(); },
  'ed-toggle-active': () => { ui.editor.draft.active = !ui.editor.draft.active; renderEdDynamic(); },
  'ed-save': () => {
    const E = ui.editor, s = S(), d = E.draft;
    const bad = [...d.conds, ...d.exceptions].find(c => { const t = FIELDS[c.field].type; return (t === 'num' && (c.value === '' || c.value == null || isNaN(+c.value))) || (t === 'text' && !c.value); });
    if (bad) { toast('有条件/例外没填值', 'err'); return; }
    const reg = regression(s.rules, edRulesAfter());
    if (reg.flipped.length && !E.force) return;
    const isNew = !E.ruleId;
    if (isNew) { d.id = nextId(s, 'R'); d.createdAt = nowIso(); d.seed = false; s.rules.push(d); } else s.rules = s.rules.map(r => r.id === E.ruleId ? d : r);
    if (reg.flipped.length && E.force) reg.flipped.forEach(x => { const L = s.labels[x.it.code]; L.v = x.a; L.seed = false; L.reason = (L.reason || '') + ` 〔因 ${d.id} 改标〕`; });
    bump(s, 'rule', `${isNew ? '新增' : '修改'} ${d.id}：${ruleOneLine(d)}${d.active ? '' : '（已停用）'}`, reg);
    const msg = `已保存 ${d.id}。` + regMsg(reg);
    if (E.target) ui.repairMsg = msg;
    closeModal(); save(); render(); $('#main').scrollTop = 0; toast(msg, 'ok');
  },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'overlay') { if (e.target === t) closeModal(); return; }
  if (t.tagName === 'A') e.preventDefault();
  const fn = actions[act];
  if (fn) { e.stopPropagation(); fn(t.dataset, t, e); }
});
document.addEventListener('change', e => {
  const t = e.target, s = S();
  if (t.dataset.actChange === 'im-cat') { const sub = $('#im-sub'); sub.innerHTML = SUBS_BY_CAT[t.value].map(x => `<option>${esc(x)}</option>`).join(''); return; }
  if (t.dataset.actChange === 'rate-dim') { s.triad.lastDim = t.value; save(); renderMain(); return; }
  if (t.dataset.actChange === 'pile-show') { s.pile.showContract = t.checked; save(); renderMain(); return; }
  if (t.dataset.reason) { const L = s.labels[t.dataset.reason]; if (L) { L.reason = t.value.trim(); save(); renderRight(); } return; }
  if (t.dataset.slot) { s.scenario[t.dataset.slot] = t.value; save(); return; }
  if (t.dataset.ed) edInput(t, true);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.repairDraft) { S().repair.drafts[t.dataset.repairDraft] = t.value; save(); return; }
  if (t.dataset.ed && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && t.type !== 'radio' && t.type !== 'checkbox') edInput(t, false);
});
function edInput(t, isChange) {
  const E = ui.editor; if (!E) return; const d = E.draft; const k = t.dataset.ed;
  if (k === 'quote') { d.quote = t.value; return; }
  if (k === 'force') { E.force = t.checked; renderEdDynamic(); return; }
  if (k === 'action') { if (t.dataset.p === 'type') { d.action.type = t.value; renderModal(); } else { d.action.amount = +t.value; renderEdDynamic(); } return; }
  if (k === 'cond' || k === 'exc') {
    const arr = k === 'exc' ? d.exceptions : d.conds; const c = arr[+t.dataset.i]; const p = t.dataset.p;
    if (p === 'field') {
      if (!isChange) return;
      c.field = t.value; const f = FIELDS[c.field]; const tg = E.target ? ITEM[E.target] : null;
      c.op = OPS[f.type][0]; c.value = f.type === 'enum' ? (tg ? tg.sub : ITEMS[0].sub) : f.type === 'bool' ? '无' : f.type === 'num' ? (tg && f.get(tg) != null ? f.get(tg) : '') : '';
      renderModal(); return;
    }
    if (p === 'quote') { c.quote = t.value; return; }
    if (p === 'value') { const f = FIELDS[c.field]; c.value = f.type === 'num' ? (t.value.trim() === '' ? '' : (isNaN(+t.value) ? t.value : +t.value)) : t.value; }
    if (p === 'op') c.op = t.value;
    renderEdDynamic();
  }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modal) closeModal(); });
document.addEventListener('toggle', e => { const sec = e.target.dataset && e.target.dataset.sec; if (sec) ui.open[sec] = e.target.open; }, true);
// 拖放
document.addEventListener('dragstart', e => { const it = e.target.closest && e.target.closest('.item[draggable="true"]'); if (!it) return; e.dataTransfer.setData('text/plain', it.dataset.code); e.dataTransfer.effectAllowed = 'move'; it.classList.add('dragging'); });
document.addEventListener('dragend', e => { const it = e.target.closest && e.target.closest('.item'); if (it) it.classList.remove('dragging'); document.querySelectorAll('.pile-col.over').forEach(x => x.classList.remove('over')); });
document.addEventListener('dragover', e => { const col = e.target.closest && e.target.closest('.pile-col'); if (!col) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.pile-col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', e => { const col = e.target.closest && e.target.closest('.pile-col'); if (!col) return; e.preventDefault(); const code = e.dataTransfer.getData('text/plain'); col.classList.remove('over'); if (code && ITEM[code]) actions['pile-set']({ code, v: col.dataset.pile }); });

/* ---------- v0.2 新增：步骤页签间的跳转、契约面板 ---------- */
Object.assign(actions, {
  'b-rule': d => { V().ruleSel = d.id; renderMain(); if (state.rightOpen) renderContract(); },
  // ④ → ③：带着当前案例跳去改相关规则，③ 顶部出现“← 回到 ④”条
  'jump-rule': d => {
    const it = ITEM[d.code];
    V().back = { on: 'rules', to: 'repair', code: d.code, label: `④ 纠错：${it ? it.name : ''}`, hint: d.id ? `从这个分歧跳来改 ${d.id}；改完回去看它是否已一致` : '从这个分歧跳来' };
    if (d.id) gotoRule(d.id); else { state.tab = 'rules'; ui.ruleFilter = 'all'; save(); render(); $('#main').scrollTop = 0; }
  },
  'go-back': () => {
    const f = V().fill;
    if (state.tab === 'triad' && f) { V().fill = null; ui.matrixCell = { cat: f.cat, src: f.src }; state.tab = 'matrix'; save(); render(); return; }
    const b = V().back; if (!b) return; V().back = null;
    if (b.to === 'repair' && b.code) S().repair.selected = b.code;
    state.tab = b.to; ui.repairMsg = null; save(); render(); $('#main').scrollTop = 0;
  },
  'back-dismiss': () => { V().back = null; renderMain(); },
  'fill-clear': () => { V().fill = null; renderMain(); },
  // 契约面板：条上的分区按钮 = 打开到该标签（再点一次收起）；面板内标签 = 切换
  'cp-tab': d => { const l = LY(); if (d.from === 'bar' && state.rightOpen && l.tab === d.k) state.rightOpen = false; else { l.tab = d.k; state.rightOpen = true; } saveLayout(); save(); renderContract(); },
  'cp-close': () => { state.rightOpen = false; save(); renderContract(); const b = $('.cb-title'); b && b.focus(); },
  'cp-dock': () => { const l = LY(); l.dock = l.dock === 'right' ? 'bottom' : 'right'; saveLayout(); renderContract(); },
});

state = loadState();
applyOverrides();
render();
save();
