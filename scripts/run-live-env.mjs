// 跨平台启动 Live Env demo(replay / record / export 三模式)。
// 不用 Unix "VAR=val" 前缀(Windows 不认),内部读 argv 设 env。
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config'; // 加载 .env → OPENAI_API_KEY 传入 tsx 子进程,judge 不再降级为 0.5

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// 解析 argv
const args = process.argv.slice(2);
const isExport = args.includes('--export');
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'travel-drift';
const portArg = args.find(a => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : '5173';
const isRecord = args.includes('--record') || process.env.CRUCIBLE_LIVE_ENV === 'record';

const env = {
  ...process.env,
  CRUCIBLE_LIVE_ENV: isRecord ? 'record' : '1',
  CRUCIBLE_LIVE_ENV_SCENARIO: scenario,
  CRUCIBLE_LIVE_ENV_PORT: port,
  ...(isExport ? { CRUCIBLE_LIVE_ENV_EXPORT: '1' } : {}),
};

const target = isExport ? 'src/env/http.ts' : 'src/env/http.ts'; // 都启 http,export 额外产出文件
const r = spawnSync(process.execPath, [TSX, target], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
  shell: false,
});
process.exit(r.status ?? 1);
