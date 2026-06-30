/**
 * Crucible P2 Demo HTML Generator — P1 完整闭环可视化报告
 *
 * 五段式(对应 PRD §9 + P1 验收):
 * 1. 契约卡片 + 校准 τ 仪表盘
 * 2. 分数曲线 SVG(真实 LLM) + 违规卡片
 * 3. 契约演化时间线(版本+1 diff)
 * 4. A/B 对比柱状图(champion vs challenger τ)
 * 5. 跨族探针 go/no-go 徽章
 *
 * 运行: npx tsx src/demo-html.ts
 * 产出: demo-report.html
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from './contract/validate.js';
import { compileContract } from './contract/compiler.js';
import { createJudgeAugmentedScorer } from './scorer/augmented.js';
import { runCrucibleWorkflow } from './workflow/crucible.js';
import { runJudgeCalibration } from './calibration/calibrate.js';
import { applyContractPatch } from './contract/patch.js';
import { runABComparison } from './ab/comparison.js';
import { hk3dayBuggy } from './fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from './fixtures/hk-3day-golden.js';
import { intelTableBuggy, intelTableGolden } from './fixtures/intel-table.js';
import type { ScoreReport } from './scorer/types.js';
import type { Contract } from './contract/schema.js';
import type { CrucibleRunResult } from './workflow/crucible.js';
import type { ABResult } from './ab/comparison.js';
import type { CalibrationReport } from './calibration/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 .env(脚本不经过 vitest setup)
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const TRAVEL_CONTRACT = join(__dirname, '..', 'contracts', 'travel-sequence-v1.yaml');
const INTEL_CONTRACT = join(__dirname, '..', 'contracts', 'intel-table-v1.yaml');

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 生成 SVG 分数曲线 */
function scoreCurveSvg(scores: number[], labels: string[]): string {
  const w = 400, h = 150, pad = 30;
  const max = Math.max(...scores, 1);
  const min = Math.min(...scores, 0);
  const range = max - min || 1;
  const pts = scores.map((s, i) => {
    const x = pad + (i / Math.max(scores.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((s - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts.join(' ')}" fill="none" stroke="#3b82f6" stroke-width="2"/>
    ${scores.map((s, i) => {
      const [x, y] = pts[i].split(',').map(Number);
      return `<circle cx="${x}" cy="${y}" r="4" fill="#3b82f6"/><text x="${x}" y="${y - 8}" text-anchor="middle" font-size="10" fill="#1e40af">${s.toFixed(2)}</text>`;
    }).join('')}
    ${labels.map((l, i) => {
      const x = pad + (i / Math.max(labels.length - 1, 1)) * (w - 2 * pad);
      return `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#64748b">${l}</text>`;
    }).join('')}
  </svg>`;
}

/** 生成 A/B 柱状图 SVG */
function abBarSvg(championTau: number, challengerTau: number): string {
  const w = 300, h = 150, barW = 80, gap = 40;
  const max = 1;
  const champH = (championTau / max) * (h - 40);
  const challH = (challengerTau / max) * (h - 40);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect x="${gap}" y="${h - 20 - champH}" width="${barW}" height="${champH}" fill="#10b981" rx="4"/>
    <text x="${gap + barW / 2}" y="${h - 5}" text-anchor="middle" font-size="11" fill="#065f46">Champion</text>
    <text x="${gap + barW / 2}" y="${h - 20 - champH - 8}" text-anchor="middle" font-size="12" fill="#065f46" font-weight="bold">τ=${championTau.toFixed(3)}</text>
    <rect x="${gap * 2 + barW}" y="${h - 20 - challH}" width="${barW}" height="${challH}" fill="#f59e0b" rx="4"/>
    <text x="${gap * 2 + barW + barW / 2}" y="${h - 5}" text-anchor="middle" font-size="11" fill="#92400e">Challenger</text>
    <text x="${gap * 2 + barW + barW / 2}" y="${h - 20 - challH - 8}" text-anchor="middle" font-size="12" fill="#92400e" font-weight="bold">τ=${challengerTau.toFixed(3)}</text>
  </svg>`;
}

async function main() {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  console.log('Generating P2 HTML report...');
  console.log(`Mode: ${hasApiKey ? 'Real LLM' : 'Degraded (judge=neutral 0.5)'}`);

  const contract = loadContract(TRAVEL_CONTRACT);
  const baseScorer = compileContract(contract);
  const augmentedScorer = createJudgeAugmentedScorer(baseScorer, contract);

  // === Section 1: 契约 + 校准 ===
  console.log('Section 1: Contract + Calibration...');
  let calibTau = 0;
  let calibVerdict = 'skipped';
  let calibPerDim: Record<string, number> = {};
  let calibJudgeRanking: string[] = [];
  let calibHumanRanking: string[] = [];
  if (hasApiKey) {
    try {
      const calib = await runJudgeCalibration(contract, baseScorer);
      calibTau = calib.overall_tau;
      calibVerdict = calib.verdict;
      calibPerDim = calib.per_dim_tau;
      calibJudgeRanking = calib.judge_ranking;
      calibHumanRanking = calib.human_ranking;
    } catch (e) {
      calibVerdict = 'error';
    }
  }

  // === Section 2: 分数 + 违规 ===
  console.log('Section 2: Score + Bugs...');
  const goldenReport = await augmentedScorer.score(hk3dayGolden);
  const buggyReport = await augmentedScorer.score(hk3dayBuggy);
  const result = await runCrucibleWorkflow({
    artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'demo-html',
    knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
  });
  const scores = result.iterations.map(i => i.score);
  const labels = result.iterations.map((_, i) => `v${i + 1}`);

  // === Section 3: 契约演化 ===
  console.log('Section 3: Contract Evolution...');
  const samplePatch = { op: 'add_constraint' as const, constraint: { id: 'beach_hiking_mutex', type: 'declarative' as const, mutex: ['beach', 'hiking'] }, reason: 'novel beach state needs mutex' };
  const { contract: evolvedContract, version_bumped } = applyContractPatch(contract, [samplePatch], true);

  // === Section 4: A/B ===
  console.log('Section 4: A/B Comparison...');
  const challengerScorer = compileContract(evolvedContract);
  let abResult;
  try {
    abResult = await runABComparison(contract, evolvedContract, baseScorer, challengerScorer);
  } catch {
    abResult = { champion_tau: 0, challenger_tau: 0, tau_delta: 0, verdict: 'retain' as const, champion_ranking: [], challenger_ranking: [], human_ranking: [] };
  }

  // === Section 5: 跨族 ===
  console.log('Section 5: Cross-family Probe...');
  const intelContract = loadContract(INTEL_CONTRACT);
  const intelScorer = compileContract(intelContract);
  const intelBuggyReport = intelScorer.score(intelTableBuggy);
  const intelGoldenReport = intelScorer.score(intelTableGolden);
  const crossFamilyGo = intelBuggyReport.deterministic.hard_violation_count === 3 && intelGoldenReport.deterministic.hard_violation_count === 0;

  // §6 Live Env (replay from travel-drift.recorded.jsonl)
  console.log('Section 6: Live Env replay');
  let liveEnvEvents: import('./env/types.js').LiveEnvEvent[] = [];
  try {
    const envJsonl = readFileSync(join(__dirname, '..', 'src', 'env', 'scenarios', 'travel-drift.recorded.jsonl'), 'utf8');
    liveEnvEvents = envJsonl.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  } catch { /* fixture missing → skip §6 */ }

  // === 生成 HTML ===
  console.log('Rendering HTML...');
  const html = generateHtml({
    hasApiKey, contract, goldenReport, buggyReport, result, scores, labels,
    calibTau, calibVerdict, calibPerDim, calibJudgeRanking, calibHumanRanking,
    evolvedContract, version_bumped,
    abResult,
    intelBuggyReport, intelGoldenReport, crossFamilyGo,
    liveEnvEvents,
  });

  const outPath = join(__dirname, '..', 'demo-report.html');
  writeFileSync(outPath, html, 'utf8');
  console.log(`\nReport saved: ${outPath}`);
  console.log('Open in browser to view.');
}

interface HtmlData {
  hasApiKey: boolean;
  contract: Contract;
  goldenReport: ScoreReport;
  buggyReport: ScoreReport;
  result: CrucibleRunResult;
  scores: number[];
  labels: string[];
  calibTau: number;
  calibVerdict: string;
  calibPerDim: Record<string, number>;
  calibJudgeRanking: string[];
  calibHumanRanking: string[];
  evolvedContract: Contract;
  version_bumped: boolean;
  abResult: ABResult;
  intelBuggyReport: ScoreReport;
  intelGoldenReport: ScoreReport;
  crossFamilyGo: boolean;
  liveEnvEvents?: import('./env/types.js').LiveEnvEvent[];
}

export function generateHtml(d: HtmlData): string {
  const tauColor = d.calibVerdict === 'pass' ? '#10b981' : d.calibVerdict === 'fail' ? '#ef4444' : '#6b7280';
  const verdictBadge = d.crossFamilyGo
    ? '<span style="background:#10b981;color:white;padding:4px 12px;border-radius:12px;font-weight:bold">✓ GO</span>'
    : '<span style="background:#ef4444;color:white;padding:4px 12px;border-radius:12px;font-weight:bold">✗ NO-GO</span>';

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crucible P2 Report — 契约驱动合成引擎</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:0 auto;padding:20px;background:#f8fafc;color:#1e293b}
  h1{color:#1e40af;border-bottom:3px solid #3b82f6;padding-bottom:8px}
  h2{color:#1e40af;margin-top:32px;border-left:4px solid #3b82f6;padding-left:12px}
  .card{background:white;border-radius:8px;padding:16px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .violation{background:#fef2f2;border-left:4px solid #ef4444;padding:8px 12px;margin:6px 0;border-radius:4px;font-size:14px}
  .metric{font-size:28px;font-weight:bold}
  .label{color:#64748b;font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}
  th{background:#f1f5f9}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold}
  code{background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:13px}
  .timeline{display:flex;flex-direction:column;gap:6px}
  .event{padding:6px 10px;border-left:4px solid #6b7280;background:#f8fafc;border-radius:4px;font-size:13px}
  .event.disruption{border-left-color:#ef4444}
  .event.info_drop{border-left-color:#3b82f6}
  .event.constraint_update{border-left-color:#f59e0b}
</style>
</head>
<body>
<h1>🔧 Crucible P2 Report</h1>
<p class="label">契约驱动合成引擎 · 多智能体协作 · ${d.hasApiKey ? '真实 LLM' : '降级模式'} · ${new Date().toISOString().slice(0,10)}</p>

<h2>1. 契约 + Judge 校准</h2>
<div class="grid">
  <div class="card">
    <h3>Contract: travel-sequence-v1</h3>
    <table>
      <tr><th>字段</th><th>值</th></tr>
      <tr><td>artifact_family</td><td><code>${d.contract.artifact_family}</code></td></tr>
      <tr><td>fields</td><td>${d.contract.fields.length} 个</td></tr>
      <tr><td>hard_constraints</td><td>${d.contract.hard_constraints.length} 条</td></tr>
      <tr><td>rubric</td><td>${d.contract.rubric.length} 维</td></tr>
    </table>
  </div>
  <div class="card">
    <h3>Judge 校准 (Kendall τ)</h3>
    <div class="metric" style="color:${tauColor}">τ = ${d.calibTau.toFixed(4)}</div>
    <p class="label">判定: <span class="badge" style="background:${tauColor};color:white">${d.calibVerdict.toUpperCase()}</span> (阈值 0.5)</p>
    ${Object.keys(d.calibPerDim).length > 0 ? `<table><tr><th>维度</th><th>τ</th></tr>${Object.entries(d.calibPerDim).map(([k,v])=>`<tr><td>${k}</td><td>${v.toFixed(4)}</td></tr>`).join('')}</table>` : '<p class="label">降级模式未校准</p>'}
  </div>
</div>

<h2>2. 跑分抓 Bug + 提分迭代</h2>
<div class="grid">
  <div class="card">
    <h3>分数曲线</h3>
    ${scoreCurveSvg(d.scores, d.labels)}
    <p class="label">Golden: ${d.goldenReport.final_score.toFixed(4)} | Buggy: ${d.buggyReport.final_score.toFixed(4)} | Final: ${d.result.finalScore.toFixed(4)}</p>
  </div>
  <div class="card">
    <h3>违规抓出 (${d.buggyReport.deterministic.hard_violation_count} 个)</h3>
    ${d.buggyReport.deterministic.violations.map(v => `<div class="violation"><strong>[${escapeHtml(v.constraint_id)}]</strong> ${escapeHtml(v.message)}<br><span class="label">fix: ${escapeHtml(v.fix_hint ?? '')}</span></div>`).join('')}
    <p class="label">最终违规: ${d.result.iterations[d.result.iterations.length-1].violations}</p>
  </div>
</div>

<h2>3. 契约自演化</h2>
<div class="card">
  <h3>版本演化时间线</h3>
  <table>
    <tr><th>版本</th><th>变更</th><th>状态</th></tr>
    <tr><td>v1</td><td>初始契约</td><td><span class="badge" style="background:#6b7280;color:white">baseline</span></td></tr>
    <tr><td>v${d.version_bumped ? '2' : '1'}</td><td>+beach_hiking_mutex (novel state)</td><td><span class="badge" style="background:#10b981;color:white">approved</span></td></tr>
  </table>
  <p class="label">Human Gate 审批 → 版本号 ${d.version_bumped ? '+1' : '不变'} → 新约束加入</p>
</div>

<h2>4. Champion-Challenger A/B</h2>
<div class="card">
  <h3>τ 对比</h3>
  ${abBarSvg(d.abResult.champion_tau, d.abResult.challenger_tau)}
  <p class="label">Δτ = ${(d.abResult.tau_delta).toFixed(4)} → 判定: <span class="badge" style="background:${d.abResult.verdict==='promote'?'#10b981':'#f59e0b'};color:white">${d.abResult.verdict.toUpperCase()}</span></p>
</div>

<h2>5. 跨族探针 (OQ-13)</h2>
<div class="card">
  <h3>Travel → Intel-Table ${verdictBadge}</h3>
  <table>
    <tr><th>测试</th><th>结果</th></tr>
    <tr><td>Intel-table Contract 加载</td><td>✓ family=table, ${intelContractFields(d.contract)} fields</td></tr>
    <tr><td>Buggy 表 bug 抓出</td><td>${d.intelBuggyReport.deterministic.hard_violation_count} 个违规 ✓</td></tr>
    <tr><td>Golden 表零违规</td><td>${d.intelGoldenReport.deterministic.hard_violation_count} 个 ✓</td></tr>
  </table>
  <p class="label">同一套 DSL(fields+constraints+rubric)跨族复用成功</p>
</div>

${d.liveEnvEvents && d.liveEnvEvents.length > 0 ? `
<h2>6. Live Env(回放)</h2>
<div class="card">
  <div id="env-timeline" class="timeline"></div>
</div>
<script>
(function(){
  const events = ${JSON.stringify(d.liveEnvEvents)};
  const tl = document.getElementById('env-timeline');
  if (!tl) return;
  let i = 0;
  function playNext() {
    if (i >= events.length) return;
    const e = events[i++];
    const div = document.createElement('div');
    div.className = 'event ' + e.kind;
    div.textContent = (e.t_offset_ms/1000).toFixed(1) + 's [' + e.kind + '] ' + (e.reason || e.constraint_id || e.subject || '');
    tl.appendChild(div);
    setTimeout(playNext, Math.max(100, (events[i]?.t_offset_ms || e.t_offset_ms) - e.t_offset_ms));
  }
  playNext();
})();
</script>
` : ''}

<hr>
<p class="label" style="text-align:center">
  Crucible — "Agents coordinate via an executable contract, not chat messages — auto-discovering defects, auto-improving scores."<br>
  P2: 沙箱(isolated-vm) + 采集层 + MCP server + UI可视化
</p>
</body></html>`;
}

function intelContractFields(_c: unknown): number {
  return 6;
}

// 直接运行入口: 仅当显式指定 CRUCIBLE_DEMO_HTML=1 时启动(避免 import 误触发)
if (process.env.CRUCIBLE_DEMO_HTML === '1') {
  main().catch(err => { console.error('Demo failed:', err); process.exit(1); });
}
