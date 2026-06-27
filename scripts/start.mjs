// Crucible 一键启动入口(跨平台 Node 版)。
//
// 用法:
//   npm start                 # 降级模式(judge=neutral 0.5,无需 API key)
//   npm start -- --llm        # 真实 LLM 模式(需 .env 填好 OPENAI_API_KEY,会调计费 API)
//   node scripts/start.mjs    # 等价
//
// 为什么是 .mjs 而非 .sh:bash 在 Windows 上可能解析到 WSL,导致用 Linux node 加载
// win32-only 的 node_modules(rollup 平台包不匹配)。Node 是 npm 唯一保证存在的运行时,
// 始终用当前平台的 node,不涉及 shell 平台歧义。start.sh 保留给 Git Bash/WSL 用户。
//
// 任一步失败立即退出。设计依据见 docs/qa/handtest-startup.md。
//
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LLM_MODE = process.argv.includes('--llm');

// ── 颜色(无 TTY 时退化为空) ─────────────────────────────
const TTY = process.stdout.isTTY;
const C = TTY
  ? { B: '\x1b[1m', G: '\x1b[32m', R: '\x1b[31m', Y: '\x1b[33m', C: '\x1b[36m', D: '\x1b[2m', X: '\x1b[0m' }
  : { B: '', G: '', R: '', Y: '', C: '', D: '', X: '' };
const step = (s) => console.log(`${C.C}${C.B}▶ ${s}${C.X}`);
const ok   = (s) => console.log(`${C.G}  ✓ ${s}${C.X}`);
const warn = (s) => console.log(`${C.Y}  ! ${s}${C.X}`);
const die  = (s) => { console.error(`${C.R}${C.B}  ✗ ${s}${C.X}`); process.exit(1); };

// ── 子进程封装:直接用 node 调 JS 入口(shell:false,无 DEP0190 警告、无注入风险) ──
// 不经 npm/.bin 包装层,直接指向真实 JS 文件,跨平台一致。
const TSC   = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const TSX   = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runNode(jsEntry, args, label, envExtra = {}) {
  const r = spawnSync(process.execPath, [jsEntry, ...args],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...envExtra }, shell: false });
  if (r.status !== 0) die(`${label} 失败 (exit ${r.status})`);
}

console.log(`${C.B}═══════════════════════════════════════════════════════════${C.X}`);
console.log(`${C.B}  Crucible 一键启动 — 契约驱动合成引擎${C.X}`);
console.log(`${C.B}  Worktree: ${ROOT}${C.X}`);
console.log(`${C.B}  模式: ${LLM_MODE ? '真实 LLM' : '降级 (judge=neutral 0.5)'}${C.X}`);
console.log(`${C.B}═══════════════════════════════════════════════════════════${C.X}`);

// ── 1. 前置检查 ──────────────────────────────────────────
step('1/6 前置检查 (node / npm / better-sqlite3 native binding)');
// npm 版本:优先用 npm run 注入的 npm_version;否则用 npm_execpath(node 跑 npm 的 cli.js,
// shell:false,避免 DEP0190);都拿不到则只显示 node 版本(npm 存在性由后续 install 验证)。
let npmVer = process.env.npm_version;
if (!npmVer && process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
  const r = spawnSync(process.execPath, [process.env.npm_execpath, '-v'], { stdio: 'pipe', shell: false });
  npmVer = r.stdout?.toString().trim();
}
ok(`node ${process.version}${npmVer ? `, npm ${npmVer}` : ' (npm 版本未检出)'}`);

// ── 2. 依赖 ──────────────────────────────────────────────
step('2/6 依赖检查 (尊重 .npmrc include=dev)');
const nm = join(ROOT, 'node_modules');
const needInstall = !existsSync(nm)
  || !existsSync(TSX) || !existsSync(VITEST) || !existsSync(TSC)
  || !existsSync(join(nm, '@mastra', 'core'));
// npm 调用:用 npm_execpath(node 跑 npm cli.js,shell:false),避免 Windows 上 npm.cmd 需 shell 的问题。
const npmJs = process.env.npm_execpath && existsSync(process.env.npm_execpath) ? process.env.npm_execpath : null;
function runNpm(args, label) {
  if (!npmJs) die(`${label} 需要 npm,但未找到 npm_execpath。请用 \`npm start\` 而非 \`node scripts/start.mjs\` 运行,或先 npm install。`);
  const r = spawnSync(process.execPath, [npmJs, ...args], { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) die(`${label} 失败 (exit ${r.status})`);
}
if (needInstall) {
  console.log(`  ${C.D}缺失依赖,执行 npm install(含 devDeps: tsx/vitest/typescript)...${C.X}`);
  runNpm(['install'], 'npm install');
  ok('依赖已安装');
} else {
  ok('依赖已就绪,跳过安装');
}
// native binding 抽检
const probe = spawnSync(process.execPath, ['-e', "require('better-sqlite3')"], { cwd: ROOT, stdio: 'pipe' });
if (probe.status !== 0) {
  warn('better-sqlite3 native binding 加载失败,尝试 npm rebuild better-sqlite3 ...');
  runNpm(['rebuild', 'better-sqlite3'], 'npm rebuild better-sqlite3');
  const probe2 = spawnSync(process.execPath, ['-e', "require('better-sqlite3')"], { cwd: ROOT, stdio: 'pipe' });
  if (probe2.status !== 0) die('better-sqlite3 仍不可用');
}
ok('better-sqlite3 native binding 可加载');

// ── 3. .env ──────────────────────────────────────────────
step('3/6 .env 检查');
const envFile = join(ROOT, '.env');
const envExample = join(ROOT, '.env.example');
if (!existsSync(envFile) && existsSync(envExample)) {
  copyFileSync(envExample, envFile);
  warn('.env 不存在,已从 .env.example 复制空模板。填 OPENAI_API_KEY 可跑真实 LLM(judge),否则降级模式。');
}
let hasKey = !!process.env.OPENAI_API_KEY;
if (!hasKey && existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('#') || !t) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    if (t.slice(0, eq).trim() === 'OPENAI_API_KEY' && t.slice(eq + 1).trim()) { hasKey = true; break; }
  }
}
if (hasKey) ok('检测到 OPENAI_API_KEY(.env 或环境变量)');
else warn('无 OPENAI_API_KEY → judge 降级为 neutral 0.5,workflow 仍跑通,但 τ 校准会 skipped');
if (LLM_MODE && !hasKey) die('--llm 模式要求 OPENAI_API_KEY(在 .env 填好或导出环境变量)。当前无 key,改用降级模式: npm start');

// ── 4. typecheck ─────────────────────────────────────────
step('4/6 类型检查 (tsc --noEmit)');
runNode(TSC, ['--noEmit'], 'typecheck');
ok('typecheck 通过');

// ── 5. 测试 ──────────────────────────────────────────────
step('5/6 测试套件 (vitest, 含 e2e — 端到端跑通的客观判据)');
// e2e 测试强制 delete OPENAI_API_KEY,始终降级、确定性可复现
runNode(VITEST, ['run'], '测试');
ok('全部测试通过(含 e2e: 分数上升 / 违规清零 / 多智能体日志 / curator proposal)');

// ── 6. 端到端报告 ────────────────────────────────────────
step('6/6 生成端到端 HTML 报告 (demo-report.html)');
// 用 Node 设 env 再调 tsx,绕开 npm script "VAR=val cmd" 在 Windows cmd.exe 失效的问题。
// demo-html.ts 自加载 .env;无 key 时 τ=skipped 属正常。
runNode(TSX, ['src/demo-html.ts'], '生成 HTML 报告', { CRUCIBLE_DEMO_HTML: '1' });
const report = join(ROOT, 'demo-report.html');
if (!existsSync(report)) die('demo-report.html 未生成');
ok(`报告已生成: ${report}`);

// ── 可选:真实 LLM 五段式 console ─────────────────────────
if (LLM_MODE) {
  step('附加:真实 LLM 五段式 console (demo-p1.ts, 会调计费 API)');
  runNode(TSX, ['src/demo-p1.ts'], '真实 LLM demo');
  ok('真实 LLM demo 完成,τ 应为真实数值(非 skipped)');
}

// ── 手测 QA 指引 ─────────────────────────────────────────
console.log();
console.log(`${C.B}═══════════════════════════════════════════════════════════${C.X}`);
console.log(`${C.G}${C.B}  ✓ 端到端启动完成${C.X}`);
console.log(`${C.B}═══════════════════════════════════════════════════════════${C.X}`);
console.log();
console.log(`${C.B}手测 QA(完整清单见 docs/qa/handtest-startup.md):${C.X}`);
console.log(`  ${C.C}A.${C.X} 浏览器打开 ${C.B}demo-report.html${C.X},核对五段全在`);
console.log(`     (契约卡 / τ仪表盘 / 分数曲线SVG / 违规卡 / 演化时间线 / A/B柱状图 / 跨族GO徽章)`);
console.log(`     降级模式 τ=skipped 属正常。`);
console.log(`  ${C.C}B.${C.X} 端到端闭环已由 e2e 测试自动覆盖(上面 npm test 已验证)。`);
console.log(`  ${C.C}C.${C.X} 真实 LLM(可选): ${C.B}npm start -- --llm${C.X}`);
console.log(`     → τ 出真实值,分数曲线含 judge 贡献(会调计费 API)。`);
console.log(`  ${C.C}D.${C.X} MCP server(可选): ${C.B}npm run mcp:serve${C.X}`);
console.log(`     → stdin 发 JSON-RPC: initialize / tools/list / tools/call(score_artifact)。`);
console.log(`  ${C.C}E.${C.X} 降级安全网: 删 key 重跑应仍跑通(judge=0.5,不崩)。`);
console.log();
console.log(`${C.D}风险: .env 含明文 API key(gitignore 未提交,本机盘上)。共享前请轮换。${C.X}`);
console.log(`${C.D}架构: 永久 adapter 模式,不 fork BigSet(docs/decisions/bigset-fork-evaluation.md)。${C.X}`);
