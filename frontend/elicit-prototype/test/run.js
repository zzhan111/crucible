// v0.2 测试：核心流程 + 新结构（步骤页签/状态、跳转链接、契约面板）+ 55 个 data-act 可达性
// 用法：node run.js      （需要 /usr/bin/google-chrome；流程截图写到 ../shots/flow-*.png）
const { chromium } = require('playwright-core');
const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = path.resolve(__dirname, '../shots');
const ALL = 'cell cell-rule cell-triad clear-seed close-modal confirm-ok create-session dim-del ed-add ed-del ed-save ed-scope ed-sugg ed-toggle-active export-json export-yaml goto-case goto-rule goto-tab im-label im-reset-cat im-save-cat inc-note inc-reopen inc-rule inc-same item new-session overlay pile-new pile-set rate rate-more rc-scope-del repair-accept repair-exc repair-newrule repair-off repair-relabel repair-sel reset rule-del rule-edit rule-filter rule-new rule-toggle switch-session tab toggle-right triad-answer triad-clear triad-mode triad-new triad-save view-yaml'.split(' ');
const CHANGE = ['im-cat', 'pile-show', 'rate-dim'];
(async () => {
  const browser = await chromium.launch({ executablePath: require('./chrome')(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], requests = [], results = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file://') && !u.startsWith('blob:') && !u.startsWith('data:')) requests.push(u); });
  const seen = new Set();
  const collect = async () => { const acts = await page.evaluate(() => [...document.querySelectorAll('[data-act],[data-act-change]')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && b.left < innerWidth && b.right > 0; }).map(e => e.dataset.act || ('change:' + e.dataset.actChange))); acts.forEach(a => seen.add(a)); };
  const shot = async name => { await page.waitForTimeout(150); await page.evaluate(() => { document.getElementById('toast-root').innerHTML = ''; }); await page.screenshot({ path: path.join(SHOTS, 'flow-' + name + '.png') }); };
  let cur = '';
  const check = (name, ok, detail = '') => { results.push({ step: cur, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${cur}] ${name}${detail ? ' — ' + detail : ''}`); };
  const step = async (name, fn) => { cur = name; try { await fn(); await collect(); } catch (e) { check('step threw', false, e.message.split('\n')[0]); } };
  const status = async id => page.evaluate(id => { const b = document.querySelector(`.st[data-tab="${id}"]`); if (!b) return null; const n = b.querySelector('.st-n'); return { k: b.dataset.status, n: n ? +n.textContent : 0, sub: b.querySelector('.st-s').textContent.trim(), on: b.getAttribute('aria-selected') === 'true' }; }, id);
  const tab = async t => { await page.click(`[data-act="tab"][data-tab="${t}"]`); await page.waitForTimeout(80); };
  const panelOpen = () => page.evaluate(() => document.body.classList.contains('cp-open') && !document.getElementById('contract').hidden);
  const rect = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, sel);

  await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('.steps-v2');

  await step('shell 结构', async () => {
    check('头部高度 94px', (await rect('#head')).h === 94, String((await rect('#head')).h));
    check('底部契约条 56px', (await rect('#cbar')).h === 56, String((await rect('#cbar')).h));
    check('5 个步骤页签', await page.locator('.steps-v2 .st').count() === 5);
    check('没有 上一步/下一步 按钮', await page.locator('text=/上一步|下一步/').count() === 0 && await page.locator('.step-foot').count() === 0);
    check('左侧栏已移除（场景在顶栏下拉）', await page.locator('#sidebar').count() === 0 && await page.locator('.sess-pop').count() === 1);
    check('说明卡默认折叠成一行', await page.locator('details.intro2:not([open])').count() === 1);
    check('契约面板默认收起', !(await panelOpen()));
  });
  await step('步骤状态（初始，来自真实数据）', async () => {
    const t = await status('triad'), p = await status('pile'), r = await status('rules'), rp = await status('repair'), m = await status('matrix');
    check('① 已完成 ✓（有 1 个维度）', t.k === 'done' && t.sub.includes('维度 1'), JSON.stringify(t));
    check('② 进行中 + 待处理数（待分 3 + 不一致 1 = 4）', p.k === 'prog' && p.n === 4 && p.sub.includes('进行中'), JSON.stringify(p));
    check('③ 已完成（专家规则 1，无 0 命中/未溯源）', r.k === 'done', JSON.stringify(r));
    check('④ 有待处理：分歧 3（红）', rp.k === 'alert' && rp.n === 3, JSON.stringify(rp));
    check('⑤ 未聊到 17', m.k === 'prog' && m.n === 17, JSON.stringify(m));
    await shot('00-initial');
  });
  await step('页签可任意顺序点击', async () => {
    await tab('matrix'); check('⑤ 直接可进', (await status('matrix')).on && await page.locator('#screen-matrix').count() === 1);
    await tab('triad'); check('再跳回 ①', (await status('triad')).on && await page.locator('#screen-triad').count() === 1);
    await page.focus('#st-triad'); await page.keyboard.press('ArrowRight'); check('方向键在页签间移动焦点', await page.evaluate(() => document.activeElement.id) === 'st-pile');
  });
  await step('① 三元比较 → 存维度 → 状态更新', async () => {
    await page.locator('.triad-card').nth(2).click(); await collect();
    check('选出“不一样”后 ① 仍显示（有维度=完成）', (await status('triad')).k === 'done');
    await page.fill('#triad-like', '都是正餐能顶饿的'); await page.fill('#triad-diff', '这个是解馋的小零食'); await page.click('[data-act="triad-save"]');
    await page.waitForSelector('.ai-bubble'); await collect();
    await page.locator('.rate-row').first().locator('.rb').nth(2).click();
    check('① 状态变为 维度 2', (await status('triad')).sub.includes('维度 2'), (await status('triad')).sub);
    await page.fill('#triad-followup', '【测试】补充'); await page.click('[data-act="triad-answer"]');
    await page.click('[data-act="triad-mode"][data-mode="samecat"]'); await page.click('[data-act="triad-new"]');
    await page.locator('.triad-card').first().click(); await collect(); await page.click('[data-act="triad-clear"]');
    await page.click('[data-act="rate-more"]'); await collect();
    await page.selectOption('[data-act-change="rate-dim"]', { index: 0 }); await collect();
  });
  await step('② 分堆：拖放 + 状态更新', async () => {
    await tab('pile'); await collect();
    const before = await status('pile');
    const tray = page.locator('.tray .pile-card'); const n0 = await tray.count();
    const sb = await tray.first().boundingBox(), db = await page.locator('.piles .pile-col.p-mid .pile-title').boundingBox();
    await page.mouse.move(sb.x + 20, sb.y + 20); await page.mouse.down(); await page.mouse.move(db.x + 40, db.y + 10, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(200);
    const n1 = await page.locator('.tray .pile-card').count();
    check('拖放到「中」成功', n1 === n0 - 1, `${n0}->${n1}`);
    const after = await status('pile');
    check('② 待处理数随之变化', after.n !== before.n || after.k !== before.k, `${before.n}->${after.n}`);
    await page.locator('.tray .pile-card').first().locator('[data-act="pile-set"][data-v="bad"]').click(); await collect();
    const inc = page.locator('.inc-row input.input').first();
    if (await inc.count()) { await inc.fill('【测试】手撕面包口感差一些'); await page.locator('[data-act="inc-note"]').first().click(); await collect(); }
    await page.locator('[data-act-change="pile-show"]').click(); await page.locator('[data-act-change="pile-show"]').click();
    await shot('02-pile-after-drag');
  });
  await step('③ 主从：行内原话 + 选中', async () => {
    await tab('rules'); await collect();
    const rows = page.locator('.bm-row');
    check('列表 8 行', await rows.count() === 8, String(await rows.count()));
    check('每行都有出处行（原话 / 无原话）', await page.locator('.bm-row .bm-src').count() === 8);
    check('R1 行显示原话前几个字', (await page.locator('#bm-R1 .bm-src').innerText()).includes('原话') && (await page.locator('#bm-R1 .bm-src').innerText()).includes('“'));
    check('常识规则行明确标「无原话」', (await page.locator('#bm-D1 .bm-src').innerText()).includes('无原话'));
    await page.click('#bm-D2'); check('点行 → 右侧详情切到 D2', await page.locator('#rule-D2').count() === 1);
    await page.click('[data-act="rule-filter"][data-f="expert"]'); check('筛选：专家规则', await rows.count() === 1);
    await page.click('[data-act="rule-filter"][data-f="all"]');
    await page.click('[data-act="rule-new"]'); await page.waitForSelector('#ed-preview .pv-stat');
    await page.click('[data-act="ed-scope"][data-k="cats"][data-v="烘焙"]'); await page.click('[data-act="ed-scope"][data-k="subs"][data-v="面包"]');
    await page.click('[data-act="ed-add"][data-kind="cond"]'); await page.fill('.cond-row input.num', '3'); await collect();
    await page.click('[data-act="ed-add"][data-kind="exc"]'); await collect(); await page.click('[data-act="ed-del"][data-kind="exc"]');
    await page.click('[data-act="close-modal"]');
    await page.click('#bm-R1'); await page.click('[data-act="rule-edit"][data-id="R1"]'); await page.waitForSelector('#ed-foot'); await collect(); await page.click('[data-act="close-modal"]');
  });
  await step('契约面板：打开 / 标签 / Esc / 关闭按钮 / 停靠', async () => {
    await page.click('.cb-title'); check('点条标题 → 面板打开', await panelOpen());
    const pr = await rect('#contract'), mr = await rect('#main');
    check('右侧停靠：面板宽 ≤ 55% 视口', pr.w <= 1366 * 0.55, `w=${pr.w}`);
    check('主区未被遮挡（被挤窄，仍 ≥ 50% 视口宽）', mr.w >= 683 && mr.x + mr.w <= pr.x + 1, `main ${mr.x}+${mr.w} panel@${pr.x}`);
    check('③ 详情仍可见', await page.evaluate(() => { const e = document.querySelector('.bm-detail'); const b = e.getBoundingClientRect(); const p = document.getElementById('contract').getBoundingClientRect(); return b.right <= p.left + 1 && b.width > 300; }));
    const labels = await page.locator('.cp-tab').allInnerTexts();
    check('面板标签 = 规则|维度|样本|待办|记录', ['规则', '维度', '样本', '待办', '记录'].every((l, i) => (labels[i] || '').startsWith(l)), labels.join(','));
    for (const k of ['rules', 'dims', 'cases', 'conflicts', 'log']) { await page.click(`.cp-tab[data-k="${k}"]`); check(`切到标签 ${k}`, await page.locator(`.cp-body.cp-${k}`).count() === 1); await collect(); }
    await shot('03-contract-right');
    await page.keyboard.press('Escape'); check('Esc 关闭面板', !(await panelOpen()));
    await page.click('#cbar [data-act="cp-tab"][data-k="conflicts"]'); check('条上「待办」→ 打开到待办', await panelOpen() && await page.locator('.cp-tab.on[data-k="conflicts"]').count() === 1);
    await page.click('[data-act="cp-close"]'); check('✕ 按钮关闭', !(await panelOpen()));
    await page.click('[data-act="toggle-right"]'); await page.click('[data-act="cp-dock"]');
    const pb = await rect('#contract');
    check('底部停靠：高度 ≤ 50% 视口', pb.h <= 768 * 0.5 + 1, `h=${pb.h}`);
    check('底部停靠：主区仍在面板上方可见', (await rect('#main')).h >= 150, `main h=${(await rect('#main')).h}`);
    await shot('03-contract-bottom');
    // 拖动调整大小
    const hb = await rect('.cp-resize'); await page.mouse.move(hb.x + hb.w / 2, hb.y + 4); await page.mouse.down(); await page.mouse.move(hb.x + hb.w / 2, 768 - 56 - 200, { steps: 5 }); await page.mouse.up();
    check('拖动把底部面板调到约 200px', Math.abs((await rect('#contract')).h - 200) < 30, `h=${(await rect('#contract')).h}`);
    await page.mouse.move(hb.x + hb.w / 2, 768 - 56 - 200 + 4); await page.mouse.down(); await page.mouse.move(hb.x + hb.w / 2, 40, { steps: 5 }); await page.mouse.up();
    check('拖得再高也不超过 50vh', (await rect('#contract')).h <= 384 + 1, `h=${(await rect('#contract')).h}`);
    await page.click('[data-act="cp-dock"]'); check('切回右侧停靠', await page.evaluate(() => document.body.classList.contains('dock-right')));
    await page.keyboard.press('Escape'); check('Esc 再次关闭', !(await panelOpen()));
  });
  await step('④ 纠错：去改规则 → ③ 并回到', async () => {
    await tab('repair'); await page.click('[data-act="repair-sel"][data-code="XM-0080-P01"]'); await collect();
    const j = page.locator('#repair-jumps [data-act="jump-rule"]').first();
    check('有「去改规则 → ③」链接', await j.count() === 1 && (await j.innerText()).includes('→ ③'));
    const rid = await j.getAttribute('data-id');
    await j.click();
    check('跳到 ③', (await status('rules')).on);
    check(`深链：选中 ${rid}`, await page.locator(`#rule-${rid}`).count() === 1 && await page.locator(`#bm-${rid}.on`).count() === 1);
    check('③ 顶部出现「← 回到 ④」条', await page.locator('.backbar').count() === 1 && (await page.locator('.backbar').innerText()).includes('米西尔'));
    await shot('04-jump-to-rules');
    await page.click('.backbar [data-act="go-back"]');
    check('回到 ④ 且仍是同一案例', (await status('repair')).on && await page.locator('.case-chip.on[data-code="XM-0080-P01"]').count() === 1);
  });
  await step('④ RDR：阻止 → 加区分条件 → 保存', async () => {
    const n0 = (await status('repair')).n;
    await page.fill('#repair-answer', '【测试】米西尔这款保质期短，口感一般');
    await page.click('[data-act="repair-newrule"][data-code="XM-0080-P01"]');
    await page.waitForSelector('.flip-box'); await collect();
    check('新规则会翻转判对案例 → 保存被阻止', await page.locator('[data-act="ed-save"][disabled]').count() === 1);
    await shot('04-rdr-blocked');
    await page.locator('.flip-box [data-act="ed-sugg"]', { hasText: '保质期' }).first().click(); await page.waitForTimeout(150);
    check('加区分条件后不再翻转', await page.locator('.flip-box').count() === 0);
    await page.click('[data-act="ed-save"]'); await page.waitForSelector('.success-box');
    check('保存成功', await page.locator('.success-box').count() >= 1);
    check('④ 分歧数 -1（米西尔已一致）', (await status('repair')).n === n0 - 1, `${n0} -> ${(await status('repair')).n}`);
    check('③ 专家规则数增加', (await status('rules')).sub.includes('2'), (await status('rules')).sub);
  });
  await step('④ 加例外（达利园 · D3）', async () => {
    await page.click('[data-act="repair-sel"][data-code="XM-0129-P01"]'); await collect();
    const n1 = (await status('repair')).n;
    check('trace 里每条命中规则都有跳转链接', await page.locator('.trace [data-act="jump-rule"][data-id="D3"]').count() === 1);
    await page.fill('#repair-answer', '【测试】家庭装按克算不贵');
    await page.click('[data-act="repair-exc"][data-id="D3"]'); await page.waitForSelector('#ed-preview .tgt-status'); await collect();
    await page.click('[data-act="ed-save"]'); await page.waitForSelector('.success-box');
    check('④ 分歧数再 -1（达利园已一致）', (await status('repair')).n === n1 - 1, `${n1} -> ${(await status('repair')).n}`);
    await shot('04-after-two-fixes');
    // 冈本：停用 / 改标 / 保留分歧 都可达（只打开不保存）
    const open = page.locator('.case-chip.bad'); if (await open.count()) { await open.first().click(); await collect(); const off = page.locator('[data-act="repair-off"]').first(); if (await off.count()) { await off.click(); await page.waitForSelector('#ed-foot'); await collect(); await page.click('[data-act="ed-toggle-active"]'); await page.click('[data-act="close-modal"]'); } }
    await page.click('details[data-sec="queue"] > summary'); await collect();
  });
  await step('⑤ 矩阵：去补样本 → ① 并回到', async () => {
    await tab('matrix'); await collect();
    const before = (await status('matrix')).n;
    const link = page.locator('td.mc.gap .mc-jump').nth(1);
    const cat = await link.getAttribute('data-cat'), src = await link.getAttribute('data-src');
    await link.click();
    check('跳到 ①', (await status('triad')).on);
    const ctxText = await page.locator('#fill-ctx').innerText();
    check('① 带着这一格的上下文', ctxText.includes(cat) && ctxText.includes(src), ctxText.slice(0, 60));
    const fromCell = await page.evaluate(([c, s]) => [...document.querySelectorAll('.triad-card')].filter(e => e.innerText.includes(s) && e.innerText.includes(c)).length, [cat, src]);
    check('三元组至少 1 个来自这一格', fromCell >= 1, String(fromCell));
    await shot('05-jump-to-triad');
    await page.click('#fill-ctx [data-act="triad-new"]'); check('“同一格再抽一组”保持上下文', await page.locator('#fill-ctx').count() === 1);
    await page.click('#fill-ctx [data-act="go-back"]');
    check('回到 ⑤ 且这一格被选中', (await status('matrix')).on && await page.locator('#cell-detail').count() === 1 && await page.locator('td.mc.sel').count() === 1);
    await page.click('details[data-sec="map"] > summary'); await collect();
    // 为没有标注的空格新建规则 → ⑤ 未聊到 -1
    const target = await page.evaluate(() => { const t = [...document.querySelectorAll('td.mc.gap')].find(td => !td.innerText.includes('标注')); return t ? [t.dataset.cat, t.dataset.src] : null; });
    await page.click(`td.mc.gap[data-cat="${target[0]}"][data-src="${target[1]}"]`); await collect();
    await page.click('#cell-detail [data-act="cell-rule"]'); await page.waitForSelector('#ed-foot');
    await page.fill('textarea[data-ed="quote"]', '【测试】这一格的规则'); await page.click('[data-act="ed-save"]'); await page.waitForTimeout(200);
    check('⑤ 未聊到 -1（状态实时更新）', (await status('matrix')).n === before - 1, `${before}->${(await status('matrix')).n}`);
    await page.click(`td.mc[data-cat="${target[0]}"][data-src="${target[1]}"]`);
    await page.click('#cell-detail [data-act="goto-rule"]'); check('格子里的规则号可跳 ③', (await status('rules')).on);
    await tab('matrix'); await page.click('td.mc.gap >> nth=0'); await page.click('#cell-detail [data-act="cell-triad"]'); check('详情卡按钮也能去补样本', await page.locator('#fill-ctx').count() === 1);
    await page.click('[data-act="fill-clear"]'); check('可结束补样本', await page.locator('#fill-ctx').count() === 0);
  });
  await step('跨屏链接（契约面板）', async () => {
    await tab('rules'); await page.click('#cbar [data-act="cp-tab"][data-k="rules"]');
    await page.click('.rp-rule[data-id="D3"]');
    check('面板 goto-rule → ③ 选中 D3，面板保持打开', await page.locator('#bm-D3.on').count() === 1 && await panelOpen());
    await page.click('.cp-tab[data-k="cases"]'); await page.locator('.rp-case').first().click();
    check('面板 goto-case → ④', (await status('repair')).on && await panelOpen());
    await page.click('.cp-tab[data-k="conflicts"]'); await collect();
    const g = page.locator('.cp-body [data-act="goto-tab"]'); if (await g.count()) { await g.first().click(); check('面板 goto-tab → ②', (await status('pile')).on); }
    await page.keyboard.press('Escape');
  });
  await step('③ 规则操作（范围收窄/停用/删除）', async () => {
    await tab('rules'); await page.click('#bm-R1');
    await page.click('#rule-R1 [data-act="rule-toggle"]'); await page.waitForTimeout(100); await collect();
    if (await page.locator('.modal').count()) await page.click('[data-act="close-modal"]');
    const x = page.locator('#rule-R1 [data-act="rc-scope-del"]').first(); if (await x.count()) { await x.click(); await page.waitForTimeout(100); if (await page.locator('.modal').count()) await page.click('[data-act="close-modal"]'); }
    const last = page.locator('.bm-row.expert').last(); await last.click(); const del = page.locator('.bm-detail [data-act="rule-del"]'); await del.click(); await collect(); await page.click('[data-act="close-modal"]');
  });
  await step('② 不一致 → 规则 / 改写 / 其实一样', async () => {
    await tab('pile');
    if (await page.locator('[data-act="inc-rule"]').count()) { await page.click('[data-act="inc-rule"]'); await page.waitForSelector('#ed-foot'); await page.click('[data-act="close-modal"]'); await page.click('[data-act="inc-reopen"]'); await collect(); }
    await page.click('[data-act="pile-new"]'); await collect();
  });
  await step('商品详情：改归类 → 恢复自动', async () => {
    await tab('rules'); await page.locator('.bm-detail .mini-item').first().click(); await page.waitForSelector('#im-cat'); await collect();
    await page.selectOption('#im-cat', '未分类'); await page.click('[data-act="im-save-cat"]'); await page.waitForTimeout(150);
    check('改归类后出现「恢复自动」', await page.locator('[data-act="im-reset-cat"]').count() === 1); await collect();
    await page.click('[data-act="im-reset-cat"]'); await page.click('[data-act="im-label"] >> nth=0'); await collect();
    await page.click('[data-act="close-modal"]');
  });
  await step('导出 JSON / YAML / 预览', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cbar [data-act="export-json"]')]);
    const j = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('JSON 可解析且含规则/案例', j.rules && j.rules.length >= 9 && j.labeled_cases && j.labeled_cases.length > 0, `rules ${j.rules && j.rules.length} cases ${j.labeled_cases && j.labeled_cases.length}`);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#cbar [data-act="export-yaml"]')]);
    const y = fs.readFileSync(await dl2.path(), 'utf8'); check('YAML 有内容', y.split('\n').length > 50, `${y.split('\n').length} lines`);
    await page.click('#cbar [data-act="view-yaml"]'); await collect(); check('YAML 预览弹窗', await page.locator('pre.yaml').count() === 1);
    await page.click('.overlay', { position: { x: 5, y: 5 } }); check('点遮罩关闭弹窗', await page.locator('.overlay').count() === 0);
  });
  await step('持久化', async () => {
    await page.click('[data-act="toggle-right"]');
    const v1 = await page.locator('.b-ver').innerText(); await page.reload(); await page.waitForSelector('.b-ver');
    check('刷新后版本不变', v1 === await page.locator('.b-ver').innerText());
    check('刷新后面板开合状态保留', await panelOpen()); await page.keyboard.press('Escape');
  });
  await step('会话：顶栏下拉 切换 / 新建 / 切回', async () => {
    await page.click('.sess-pop > summary'); await collect();
    check('下拉列出 2 个场景 + 新场景 + 重置', await page.locator('.sess-pop .sess').count() === 2 && await page.locator('.sess-pop [data-act="new-session"]').count() === 1 && await page.locator('.sess-pop [data-act="reset"]').count() === 1);
    await page.keyboard.press('Escape'); check('Esc 关闭下拉', await page.locator('details.sess-pop[open]').count() === 0);
    await page.click('.sess-pop > summary'); await page.click('[data-act="switch-session"][data-id="yaodian"]'); await page.waitForSelector('.empty-state');
    check('空场景：步骤页签禁用', await page.locator('.steps-v2.disabled').count() === 1);
    await page.click('.sess-pop > summary'); await page.click('[data-act="new-session"]'); await page.fill('#new-sess-name', '测试场景'); await collect(); await page.click('[data-act="create-session"]');
    await page.waitForSelector('.empty-state'); check('新场景已创建', (await page.locator('.sess-pop h1').innerText()).includes('测试场景'));
    await page.click('.sess-pop > summary'); check('下拉里有 3 个场景', await page.locator('.sess-pop .sess').count() === 3);
    await page.click('[data-act="switch-session"][data-id="sparrow"]'); check('切回小小云雀', await page.locator('.steps-v2:not(.disabled)').count() === 1);
  });
  await step('重置', async () => {
    await page.click('.sess-pop > summary'); await page.click('[data-act="reset"]'); await collect(); await page.click('[data-act="confirm-ok"]'); await page.waitForTimeout(150);
    await page.click('.sess-pop > summary'); check('重置后 2 个场景', await page.locator('.sess-pop .sess').count() === 2); await page.keyboard.press('Escape');
    check('重置后 v1', (await page.locator('.b-ver').innerText()).includes('v1'));
    check('重置后步骤状态回到初始（分歧 3 / 未聊到 17）', (await status('repair')).n === 3 && (await status('matrix')).n === 17);
  });
  await step('示例弹出层 / 清除示例', async () => {
    await page.click('.seed-pop > summary'); await collect();
    await page.click('[data-act="clear-seed"]'); await collect(); await page.click('[data-act="confirm-ok"]'); await page.waitForTimeout(100);
    check('清除示例后 ① 无维度 → 未开始', (await status('triad')).k === 'todo', JSON.stringify(await status('triad')));
    check('清除示例后 ④ 无标注 → 未开始', (await status('repair')).k === 'todo', JSON.stringify(await status('repair')));
  });
  // 重新载入初始态，收集 dim-del / rc-scope-del 等只在有示例时出现的入口
  await step('补充可达性收集', async () => { await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('.steps-v2'); await tab('triad'); await collect(); await tab('rules'); await collect(); await tab('repair'); await collect(); await page.click('details[data-sec="queue"] > summary'); await collect();
    await page.click('#cbar [data-act="cp-tab"][data-k="conflicts"]'); await collect(); const g = page.locator('.cp-body [data-act="goto-tab"]'); check('初始态面板「待办」里有分堆不一致 → ② 链接', await g.count() >= 1); await g.first().click(); check('goto-tab → ②', (await status('pile')).on); await page.keyboard.press('Escape'); });

  const missing = ALL.filter(a => !seen.has(a) && a !== 'overlay');
  const missingChange = CHANGE.filter(c => !seen.has('change:' + c));
  cur = '可达性'; check(`55 个 data-act 全部可见可点（${ALL.length - missing.length}/${ALL.length}）`, missing.length === 0, missing.join(','));
  check('3 个 change 入口可达', missingChange.length === 0, missingChange.join(','));
  cur = '健康'; check('无控制台错误/页面异常', errors.length === 0, errors.join(' | ')); check('无外部网络请求（离线）', requests.length === 0, requests.join(' '));
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${results.length} checks · reachability ${ALL.length - missing.length}/${ALL.length}`);
  fs.writeFileSync(path.join(__dirname, 'last-result.json'), JSON.stringify({ pass, fail, reach: `${ALL.length - missing.length}/${ALL.length}`, missing, missingChange, errors, requests, results }, null, 1));
  await browser.close(); process.exit(fail ? 1 : 0);
})();
