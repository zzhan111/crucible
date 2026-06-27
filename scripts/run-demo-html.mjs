// 跨平台启动 demo-html(生成五段式 HTML 报告)。
// 为什么需要这个 wrapper:package.json 里 "VAR=val tsx ..." 是 Unix shell 语法,
// Windows PowerShell/CMD 不认。用 node 设 env + shell:false 调 tsx,全平台一致。
// 等价于:CRUCIBLE_DEMO_HTML=1 tsx src/demo-html.ts
//
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const r = spawnSync(process.execPath, [TSX, 'src/demo-html.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CRUCIBLE_DEMO_HTML: '1' },
  shell: false,
});
process.exit(r.status ?? 1);
