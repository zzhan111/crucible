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
import { scorerRun } from '../agents/scorer.js';
import { startLiveEnv } from './index.js';
import { hk3dayBuggy } from '../fixtures/hk-3day-buggy.js';
import { intelTableBuggy } from '../fixtures/intel-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IterationInfo {
  index: number;
  scoreBefore: number;
  scoreAfter: number;
  consumedEventIds: string[];
  /** 确定性层分数(快通道:硬约束 + deterministic rubric)。可选,向后兼容。 */
  detScore?: number;
  /** LLM judge 层分数(慢通道:judge rubric overall)。可选,向后兼容。 */
  judgeScore?: number;
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

      // 已完成的 iteration(workflow 跑完后 push 进数组)逐条回放,
      // 让晚连进来的客户端也能看到分数轨迹。spec §11.7 message type "iteration"。
      for (const it of iterations) {
        res.write(formatSseMessage('iteration', it));
      }

      // 回放历史 env-event,让晚连进来的 UI 能看到完整时间线。
      // 必须在 subscribe 之前 + 同一个同步 tick 内调用(无 await),否则可能漏 publish。
      for (const e of bus.snapshot()) {
        res.write(formatSseMessage('env-event', e));
      }

      // 订阅 bus(只接收 snapshot 之后 publish 的事件)
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
  :root {
    --bg: #070b18;
    --panel: rgba(20, 30, 56, 0.55);
    --border: rgba(120, 160, 220, 0.25);
    --text: #eaf2ff;
    --dim: #8fa3c8;
    --cyan: #22e3ff;
    --magenta: #ff3ea5;
    --glow-c: rgba(34, 227, 255, 0.45);
    --glow-m: rgba(255, 62, 165, 0.40);
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0; padding: 28px 32px; background: var(--bg); color: var(--text);
    min-height: 100vh;
  }
  body::before {
    content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image:
      linear-gradient(rgba(80,130,200,0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(80,130,200,0.08) 1px, transparent 1px);
    background-size: 40px 40px;
    mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 35%, transparent 78%);
  }
  body::after {
    content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(40vw 40vw at 82% 18%, var(--glow-c), transparent 60%),
      radial-gradient(36vw 36vw at 12% 88%, var(--glow-m), transparent 62%);
    opacity: 0.45;
  }
  .wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
  h1 {
    font-size: 22px; letter-spacing: 0.18em; text-transform: uppercase; margin: 0;
    background: linear-gradient(100deg, var(--cyan), #9db8ff 50%, var(--magenta));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  #status {
    font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 11px;
    color: var(--dim); letter-spacing: 0.15em; text-transform: uppercase;
  }
  .card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px 18px; backdrop-filter: blur(8px);
  }
  .card h2 {
    margin: 0 0 10px; font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--cyan); font-weight: 600;
  }
  .card.slow h2 { color: var(--magenta); }
  .grid {
    display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; margin-bottom: 16px;
  }
  .dual {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  }
  .timeline {
    font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 12px;
    line-height: 1.7; max-height: 220px; overflow: hidden;
  }
  .event {
    padding: 5px 10px; margin: 3px 0; border-left: 3px solid #666;
    background: rgba(120, 160, 220, 0.06); border-radius: 0 6px 6px 0;
    opacity: 0; transform: translateX(-12px);
    transition: opacity .35s ease, transform .35s ease;
  }
  .event.shown { opacity: 1; transform: translateX(0); }
  .event.disruption { border-color: #ff5a6e; color: #ffd5db; }
  .event.info_drop { border-color: #5ec8ff; color: #d6efff; }
  .event.constraint_update { border-color: #ffba4d; color: #ffe7c2; }
  .event .tk { color: var(--dim); margin-right: 8px; }
  .event .lb {
    display: inline-block; padding: 1px 7px; border-radius: 4px; margin-right: 8px;
    font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    background: rgba(255,255,255,0.08);
  }
  .lane-head { display: flex; align-items: baseline; justify-content: space-between; }
  .lane-cap {
    font-size: 11px; color: var(--dim); letter-spacing: 0.1em; text-transform: uppercase;
  }
  .runs { display: flex; gap: 6px; margin-top: 14px; min-height: 86px; align-items: end; }
  .bar {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
    font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 12px;
  }
  .bar .col {
    width: 100%; min-height: 4px; border-radius: 4px 4px 0 0;
    background: linear-gradient(180deg, var(--cyan), rgba(34,227,255,0.15));
    box-shadow: 0 0 12px var(--glow-c);
    transition: height .8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .slow .bar .col {
    background: linear-gradient(180deg, var(--magenta), rgba(255,62,165,0.15));
    box-shadow: 0 0 12px var(--glow-m);
  }
  .bar .val { color: var(--text); font-weight: 600; }
  .bar .lab { color: var(--dim); font-size: 10px; letter-spacing: 0.12em; }
  .formula {
    text-align: center; padding: 14px 0;
    font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 13px; color: var(--dim);
  }
  .formula b { color: var(--text); font-weight: 600; }
  .formula .cy { color: var(--cyan); }
  .formula .mg { color: var(--magenta); }
  .final {
    text-align: center; padding: 22px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    backdrop-filter: blur(8px);
  }
  .final .label {
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--dim);
    margin-bottom: 8px;
  }
  .final .score {
    font-size: 58px; font-weight: 700; line-height: 1;
    background: linear-gradient(120deg, var(--cyan), var(--magenta));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    text-shadow: 0 0 0 transparent;
    transition: transform .6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .final .score.pop { transform: scale(1.06); }
  .final .delta { margin-top: 8px; color: var(--cyan); font-family: ui-monospace, monospace; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Crucible · Live Env</h1>
    <div id="status">connecting…</div>
  </header>

  <div class="grid">
    <!-- 事件总线时间轴 -->
    <div class="card">
      <h2>◆ 事件总线 · 边走边吐</h2>
      <div id="timeline" class="timeline"></div>
    </div>

    <!-- 快慢双轨 -->
    <div class="dual">
      <div class="card">
        <div class="lane-head">
          <h2>⚡ 确定性 · 快</h2>
          <span class="lane-cap">零漂移 · 可解释</span>
        </div>
        <div id="lane-det" class="runs"></div>
      </div>
      <div class="card slow">
        <div class="lane-head">
          <h2>🧠 大模型 · 慢</h2>
          <span class="lane-cap">有品味 · τ 校准</span>
        </div>
        <div id="lane-judge" class="runs"></div>
      </div>
    </div>
  </div>

  <div class="formula">
    最终分 = <b class="cy">确定性</b> × 0.6 &nbsp;+&nbsp; <b class="mg">大模型</b> × 0.4
  </div>

  <div class="final">
    <div class="label">Final Score</div>
    <div id="score" class="score">—</div>
    <div id="delta" class="delta"></div>
  </div>
</div>

<script>
const timeline = document.getElementById('timeline');
const scoreEl = document.getElementById('score');
const deltaEl = document.getElementById('delta');
const statusEl = document.getElementById('status');
const laneDet = document.getElementById('lane-det');
const laneJudge = document.getElementById('lane-judge');

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'travel-drift';
const es = new EventSource('/env/stream?scenario=' + scenario);

// 入场节奏:让 SSE 一次性回放的 iteration 视觉上呈"逐轮落下"
const itQueue = [];
let itTimer = null;
const evQueue = [];
let evTimer = null;

function drainEvents() {
  if (evQueue.length === 0) { evTimer = null; return; }
  const ev = evQueue.shift();
  const div = document.createElement('div');
  div.className = 'event ' + ev.kind;
  const t = new Date(ev.t_offset_ms).toISOString().substr(14, 5);
  div.innerHTML = '<span class="tk">' + t + '</span>'
                + '<span class="lb">' + ev.kind + '</span>'
                + (ev.reason || ev.constraint_id || ev.subject || '');
  timeline.appendChild(div);
  requestAnimationFrame(() => div.classList.add('shown'));
  evTimer = setTimeout(drainEvents, 380);
}

function renderIteration(it) {
  // 双轨柱状条:把 0..1 映射到 0..72px
  const detH = Math.max(4, Math.round((it.detScore ?? it.scoreAfter) * 72));
  const judgeH = Math.max(4, Math.round((it.judgeScore ?? it.scoreAfter) * 72));
  const vlabel = 'v' + (it.index + 1);
  laneDet.insertAdjacentHTML('beforeend',
    '<div class="bar"><span class="val">' + (it.detScore ?? it.scoreAfter).toFixed(2) + '</span>'
  + '<div class="col" style="height:0"></div>'
  + '<span class="lab">' + vlabel + '</span></div>');
  laneJudge.insertAdjacentHTML('beforeend',
    '<div class="bar"><span class="val">' + (it.judgeScore ?? it.scoreAfter).toFixed(2) + '</span>'
  + '<div class="col" style="height:0"></div>'
  + '<span class="lab">' + vlabel + '</span></div>');
  // 触发动画:下一帧把 height 填上
  requestAnimationFrame(() => {
    const ds = laneDet.querySelectorAll('.col');
    const js = laneJudge.querySelectorAll('.col');
    ds[ds.length - 1].style.height = detH + 'px';
    js[js.length - 1].style.height = judgeH + 'px';
  });
  // 最终分
  const prev = parseFloat(scoreEl.textContent);
  scoreEl.textContent = it.scoreAfter.toFixed(2);
  scoreEl.classList.add('pop');
  setTimeout(() => scoreEl.classList.remove('pop'), 600);
  if (!isNaN(prev)) {
    const d = it.scoreAfter - prev;
    deltaEl.textContent = (d >= 0 ? '▲ +' : '▼ ') + d.toFixed(2);
  } else {
    deltaEl.textContent = '';
  }
}

function drainIterations() {
  if (itQueue.length === 0) { itTimer = null; return; }
  renderIteration(itQueue.shift());
  itTimer = setTimeout(drainIterations, 1500);
}

es.addEventListener('meta', () => { statusEl.textContent = '● live · ' + scenario; });
es.addEventListener('env-event', (e) => {
  evQueue.push(JSON.parse(e.data));
  if (!evTimer) evTimer = setTimeout(drainEvents, 0);
});
es.addEventListener('iteration', (e) => {
  itQueue.push(JSON.parse(e.data));
  if (!itTimer) itTimer = setTimeout(drainIterations, 600);
});
es.addEventListener('heartbeat', () => {});
es.addEventListener('done', (e) => { statusEl.textContent = '○ done · ' + JSON.parse(e.data).reason; });
es.onerror = () => { statusEl.textContent = '… reconnecting'; };
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
  // 把 workflow 返回的合并分数拆回 det / judge 两层(快慢双轨视觉)。
  // 复用 P3 §2.2 scorer cache:对同 artifact + 同 contract 版本的二次打分命中缓存,
  // 不产生额外 LLM 调用。
  async function fillLayered(it: { artifact: import('../predicates/types.js').Artifact; score: number; consumedEventIds: string[] }, i: number): Promise<IterationInfo> {
    const report = await scorerRun(it.artifact, baseScorer, contract);
    return {
      index: i,
      scoreBefore: 0,
      scoreAfter: it.score,
      consumedEventIds: it.consumedEventIds,
      detScore: report.deterministic.deterministic_score,
      judgeScore: report.judge?.overall_score ?? it.score,
    };
  }
  if (isExport) {
    await handle.start();
    await new Promise(r => setTimeout(r, 50));
    const result = await runCrucibleWorkflow({ artifact, contract, baseScorer, artifactId: 'live-export', knownStates: [], liveEnv: handle, minImprovement: 0 });
    for (let i = 0; i < result.iterations.length; i++) {
      iterations.push(await fillLayered(result.iterations[i], i));
    }
    await handle.stop();
    writeFileSync(join(process.cwd(), scenario + '.snapshot.json'), handleSnapshotRequest(handle.bus, iterations));
    console.log('Exported ' + scenario + '.snapshot.json');
    return;
  }
  const server = startHttpServer(handle.bus, iterations, port);
  console.log('Crucible Live Env on http://localhost:' + port + ' (scenario=' + scenario + ', mode=' + (isRecord ? 'record' : 'replay') + ')');
  await handle.start();
  await new Promise(r => setTimeout(r, 50));
  const result = await runCrucibleWorkflow({ artifact, contract, baseScorer, artifactId: 'live-demo', knownStates: [], liveEnv: handle, minImprovement: 0 });
  for (let i = 0; i < result.iterations.length; i++) {
    iterations.push(await fillLayered(result.iterations[i], i));
  }
  console.log('Workflow done: ' + result.iterations.length + ' iterations, finalScore=' + result.finalScore.toFixed(4) + '. Server alive on port ' + port + '.');
  void server;
}

if (process.env.CRUCIBLE_LIVE_ENV === '1' || process.env.CRUCIBLE_LIVE_ENV === 'record') {
  runLiveEnvDemo().catch(e => { console.error('[env] demo error:', e); process.exit(1); });
}
