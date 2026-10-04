// 截图：node shots.js [filter]   → ../shots/*.png（每屏 1366×768 与 1440×900，外加契约展开态、跳转链接）
const { chromium } = require('playwright-core'); const path = require('path');
const HTML = 'file://' + path.resolve(__dirname, '../index.html'); const OUT = path.resolve(__dirname, '../shots');
const only = process.argv[2] || '';
const tab = t => `[data-act="tab"][data-tab="${t}"]`;
const SCREENS = [
  ['01-triad', p => p.click(tab('triad'))],
  ['02-pile', p => p.click(tab('pile'))],
  ['03-rules', p => p.click(tab('rules'))],
  ['04-repair', p => p.click(tab('repair'))],
  ['05-matrix', p => p.click(tab('matrix'))],
  ['06-session-menu', async p => { await p.click('.sess-pop > summary'); }],
  ['07-empty-session', async p => { await p.click('.sess-pop > summary'); await p.click('[data-act="new-session"]'); await p.fill('#new-sess-name', '新场景'); await p.click('[data-act="create-session"]'); }], // v0.3：药点已接入数据，空场景改为新建
  ['08-yaodian-rules', async p => { await p.click('.sess-pop > summary'); await p.click('[data-act="switch-session"][data-id="yaodian"]'); await p.click('[data-act="tab"][data-tab="rules"]'); await p.click('#bm-I4'); }],
  ['10-contract-right-rules', async p => { await p.click(tab('rules')); await p.click('[data-act="toggle-right"]'); }],
  ['11-contract-right-dims', async p => { await p.click(tab('rules')); await p.click('#cbar [data-act="cp-tab"][data-k="dims"]'); }],
  ['12-contract-right-cases', async p => { await p.click(tab('repair')); await p.click('#cbar [data-act="cp-tab"][data-k="cases"]'); }],
  ['13-contract-right-todo', async p => { await p.click(tab('repair')); await p.click('#cbar [data-act="cp-tab"][data-k="conflicts"]'); }],
  ['14-contract-right-log', async p => { await p.click(tab('triad')); await p.click('#cbar [data-act="cp-tab"][data-k="log"]'); }],
  ['15-contract-bottom-rules', async p => { await p.click(tab('rules')); await p.click('[data-act="toggle-right"]'); await p.click('[data-act="cp-dock"]'); }],
  ['16-contract-bottom-todo-repair', async p => { await p.click(tab('repair')); await p.click('[data-act="toggle-right"]'); await p.click('[data-act="cp-dock"]'); await p.click('.cp-tab[data-k="conflicts"]'); }],
  ['20-jump-repair-links', async p => { await p.click(tab('repair')); await p.click('.case-chip[data-code="XM-0129-P01"]'); await p.locator('#repair-jumps').scrollIntoViewIfNeeded(); }],
  ['21-jump-repair-to-rules', async p => { await p.click(tab('repair')); await p.click('.case-chip[data-code="XM-0129-P01"]'); await p.click('#repair-jumps [data-act="jump-rule"]'); }],
  ['22-jump-matrix-gap-hover', async p => { await p.click(tab('matrix')); await p.hover('td.mc.gap >> nth=2'); }],
  ['23-jump-matrix-cell-detail', async p => { await p.click(tab('matrix')); await p.click('td.mc.gap >> nth=2'); await p.evaluate(() => document.querySelector('#cell-detail').scrollIntoView({ block: 'center' })); }],
  ['24-jump-matrix-to-triad', async p => { await p.click(tab('matrix')); await p.hover('td.mc.gap >> nth=2'); await p.click('td.mc.gap >> nth=2 >> .mc-jump'); }],
  ['30-editor-newrule-from-repair', async p => { await p.click(tab('repair')); await p.click('.case-chip[data-code="XM-0080-P01"]'); await p.click('[data-act="repair-newrule"][data-code="XM-0080-P01"]'); }],
];
const SIZES = [[1366, 768], [1440, 900]];
(async () => {
  const browser = await chromium.launch({ executablePath: require('./chrome')(), args: ['--no-sandbox'] });
  const errs = [];
  for (const [W, H] of SIZES) for (const [name, fn] of SCREENS) {
    if (only && !name.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(`${name}@${W}: ${e.message}`));
    await page.goto(HTML); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('.steps-v2');
    await fn(page); await page.waitForTimeout(400);
    await page.evaluate(() => { const r = document.getElementById('toast-root'); if (r) r.innerHTML = ''; });
    const file = `${OUT}/${name}-${W}x${H}.png`; await page.screenshot({ path: file }); console.log(file);
    await ctx.close();
  }
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await browser.close();
})();
