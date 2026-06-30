/**
 * Crucible Live Env — HTTP/SSE server。
 * spec ref: 2026-06-30-crucible-live-env-design.md §6.2, §11.7
 *
 * 两个 endpoint:
 *   GET /env/snapshot?scenario=...  → 一次性 JSON {events, iterations}
 *   GET /env/stream?scenario=...    → SSE,6 种 message type
 *
 * 纯函数(formatSseMessage, handleSnapshotRequest)可单测;
 * startHttpServer() 用 node:http 启真实端口(路演用)。
 * 不引 Express/Socket.io(spec §6.2)。
 *
 * Bootstrap main(Fix B1):run-live-env.mjs 以 CRUCIBLE_LIVE_ENV=1 spawn 本文件时,
 * 触发 runLiveEnvDemo() —— 否则进程会立即退出(server.listen 在 startHttpServer 内,
 * 但 demo 需要先组装 env + 跑 workflow 才有数据可推)。guard 仿 src/mcp/server.ts 习语。
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_CONST } from './constants.js';
import type { EventBus, LiveEnvEvent } from './types.js';
import { loadContract } from '../contract/validate.js';
import { compileContract } from '../contract/compiler.js';
import { runCrucibleWorkflow } from '../workflow/crucible.js';
import { startLiveEnv } from './index.js';
import { hk3dayBuggy } from '../fixtures/hk-3day-buggy.js';
import { intelTableBuggy } from '../fixtures/intel-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IterationInfo {
  index: number;
  scoreBefore: number;
  scoreAfter: number;
  consumedEventIds: string[];
}

/** 格式化一条 SSE message(spec §11.7 6 种 type) */
export function formatSseMessage(type: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${type}\ndata: ${payload}\n\n`;
}

/** snapshot endpoint 的纯函数:返回 JSON 字符串 */
export function handleSnapshotRequest(bus: EventBus, iterations: IterationInfo[]): string {
  return JSON.stringify({
    events: bus.snapshot(),
    iterations,
  });
}

/** 启动 HTTP server(路演用,测试不调) */
export function startHttpServer(
  bus: EventBus,
  iterations: IterationInfo[],
  port: number = 5173
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/env/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(handleSnapshotRequest(bus, iterations));
      return;
    }

    if (url.pathname === '/env/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // 首帧 meta
      res.write(formatSseMessage('meta', { scenario: url.searchParams.get('scenario'), startedAt: new Date().toISOString() }));

      // 订阅 bus
      const unsub = bus.subscribe((e: LiveEnvEvent) => {
        res.write(formatSseMessage('env-event', e));
      });

      // 心跳
      const heartbeat = setInterval(() => {
        res.write(formatSseMessage('heartbeat', ''));
      }, ENV_CONST.SSE_HEARTBEAT_MS);

      // 清理
      req.on('close', () => {
        unsub();
        clearInterval(heartbeat);
      });
      return;
    }

    // 默认:返回 live HTML 页面
    if (url.pathname === '/' || url.pathname === '/env') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(liveHtmlPage());
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port);
  return server;
}

/** live 形态的 HTML 页面(SSE 订阅 + vanilla JS 渲染) */
function liveHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Crucible Live Env</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #fafafa; }
  .card { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .timeline { font-family: monospace; font-size: 13px; line-height: 1.6; }
  .event { padding: 4px 8px; margin: 2px 0; border-left: 3px solid #666; }
  .event.disruption { border-color: #e74c3c; }
  .event.info_drop { border-color: #3498db; }
  .event.constraint_update { border-color: #f39c12; }
  .score { font-size: 24px; font-weight: bold; color: #27ae60; }
  #status { color: #999; font-size: 12px; }
</style>
</head>
<body>
<h1>Crucible Live Env</h1>
<div id="status">connecting...</div>
<div class="card">
  <h2>Event Timeline</h2>
  <div id="timeline" class="timeline"></div>
</div>
<div class="card">
  <h2>Score</h2>
  <div id="score" class="score">—</div>
</div>
<script>
const timeline = document.getElementById('timeline');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'travel-drift';
const es = new EventSource('/env/stream?scenario=' + scenario);

es.addEventListener('meta', (e) => { statusEl.textContent = 'live: ' + scenario; });
es.addEventListener('env-event', (e) => {
  const ev = JSON.parse(e.data);
  const div = document.createElement('div');
  div.className = 'event ' + ev.kind;
  const t = new Date(ev.t_offset_ms).toISOString().substr(14, 5);
  div.textContent = t + ' [' + ev.kind + '] ' + (ev.reason || ev.constraint_id || ev.subject || '');
  timeline.appendChild(div);
});
es.addEventListener('iteration', (e) => {
  const it = JSON.parse(e.data);
  scoreEl.textContent = it.scoreAfter.toFixed(2);
});
es.addEventListener('heartbeat', () => { statusEl.textContent = 'live: ' + scenario + ' (♥)'; });
es.addEventListener('done', (e) => { statusEl.textContent = 'done: ' + JSON.parse(e.data).reason; });
es.onerror = () => { statusEl.textContent = 'reconnecting...'; };
</script>
</body>
</html>`;
}

/**
 * Fix B1 bootstrap:被 run-live-env.mjs(Task 9)以 CRUCIBLE_LIVE_ENV=1/record spawn 时运行。
 * 组装 live env + 跑一遍 workflow,把 iteration 塞进 iterations 数组供 snapshot 输出,
 * 并启动 HTTP server(server.listen 保持进程存活)。
 */
async function runLiveEnvDemo(): Promise<void> {
  const scenario = process.env.CRUCIBLE_LIVE_ENV_SCENARIO || 'travel-drift';
  const port = Number(process.env.CRUCIBLE_LIVE_ENV_PORT || '5173');
  const isRecord = process.env.CRUCIBLE_LIVE_ENV === 'record';
  const isExport = process.env.CRUCIBLE_LIVE_ENV_EXPORT === '1';
  const isIntel = scenario === 'intel-drift';
  const contract = loadContract(join(__dirname, '..', '..', 'contracts', isIntel ? 'intel-table-v1.yaml' : 'travel-sequence-v1.yaml'));
  const baseScorer = compileContract(contract);
  const artifact = isIntel ? intelTableBuggy : hk3dayBuggy;
  const fixturePath = join(__dirname, 'scenarios', scenario + '.recorded.jsonl');
  const outPath = isRecord ? join(process.cwd(), scenario + '.recorded.jsonl') : fixturePath;
  const handle = await startLiveEnv({
    scenario, mode: isRecord ? 'record' : 'replay', fixturePath: outPath, contract,
    ...(isRecord ? { maxEvents: 8 } : {}),
  });
  const iterations: IterationInfo[] = [];
  if (isExport) {
    await handle.start();
    await new Promise(r => setTimeout(r, 50));
    const result = await runCrucibleWorkflow({ artifact, contract, baseScorer, artifactId: 'live-export', knownStates: [], liveEnv: handle });
    result.iterations.forEach((it, i) => iterations.push({ index: i, scoreBefore: 0, scoreAfter: it.score, consumedEventIds: it.consumedEventIds }));
    await handle.stop();
    writeFileSync(join(process.cwd(), scenario + '.snapshot.json'), handleSnapshotRequest(handle.bus, iterations));
    console.log('Exported ' + scenario + '.snapshot.json');
    return;
  }
  const server = startHttpServer(handle.bus, iterations, port);
  console.log('Crucible Live Env on http://localhost:' + port + ' (scenario=' + scenario + ', mode=' + (isRecord ? 'record' : 'replay') + ')');
  await handle.start();
  await new Promise(r => setTimeout(r, 50));
  const result = await runCrucibleWorkflow({ artifact, contract, baseScorer, artifactId: 'live-demo', knownStates: [], liveEnv: handle });
  result.iterations.forEach((it, i) => iterations.push({ index: i, scoreBefore: 0, scoreAfter: it.score, consumedEventIds: it.consumedEventIds }));
  console.log('Workflow done: ' + result.iterations.length + ' iterations, finalScore=' + result.finalScore.toFixed(4) + '. Server alive on port ' + port + '.');
  void server;
}

if (process.env.CRUCIBLE_LIVE_ENV === '1' || process.env.CRUCIBLE_LIVE_ENV === 'record') {
  runLiveEnvDemo().catch(e => { console.error('[env] demo error:', e); process.exit(1); });
}
