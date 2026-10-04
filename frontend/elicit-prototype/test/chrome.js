// 浏览器路径：优先 CHROME_PATH 环境变量；否则用系统 Chrome/Chromium；都没有则交给 playwright-core 自带的浏览器（需 npx playwright-core install chromium）
const fs = require('fs');
module.exports = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  return c.find(p => fs.existsSync(p));
};
