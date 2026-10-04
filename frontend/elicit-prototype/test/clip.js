// node clip.js <tab> <selector> <out> [clicks js]
const { chromium } = require('playwright-core'); const path = require('path');
const [tab, sel, out, js] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: require('./chrome')(), args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('file://' + path.resolve(__dirname, '../index.html')); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.click(`[data-act="tab"][data-tab="${tab}"]`); if (js) { await p.evaluate(js); await p.waitForTimeout(300); }
  await p.locator(sel).first().screenshot({ path: out }); await b.close();
})();
