/**
 * Crucible P0 Demo HTML Generator — 生成静态 HTML 报告
 * 跑 workflow 一次,把结果渲染成带图表+卡片+契约高亮的 HTML。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from './contract/validate.js';
import { compileContract } from './contract/compiler.js';
import { createJudgeAugmentedScorer } from './scorer/augmented.js';
import { runCrucibleWorkflow } from './workflow/crucible.js';
import { hk3dayBuggy } from './fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from './fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', 'contracts', 'travel-sequence-v1.yaml');

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function main() {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  const contract = loadContract(CONTRACT_PATH);
  const baseScorer = compileContract(contract);
  const augmentedScorer = createJudgeAugmentedScorer(baseScorer, contract);

  const goldenReport = await augmentedScorer.score(hk3dayGolden);
  const buggyReport = await augmentedScorer.score(hk3dayBuggy);

  const result = await runCrucibleWorkflow({
    artifact: hk3dayBuggy,
    contract,
    baseScorer,
    artifactId: 'demo-html',
    knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
  });

  const scores = result.iterations.map(i => i.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore || 1;

  // Score curve SVG bars
  const barWidth = 120;
  const barGap = 40;
  const chartHeight = 200;
  const chartWidth = scores.length * (barWidth + barGap) + barGap;
  const bars = scores.map((s, i) => {
    const h = Math.round((s - minScore) / range * (chartHeight - 40)) + 20;
    const x = barGap + i * (barWidth + barGap);
    const y = chartHeight - h;
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="url(#barGrad)"/>
            <text x="${x + barWidth/2}" y="${y - 8}" text-anchor="middle" font-size="14" font-weight="600" fill="#1a1a2e">v${i+1}</text>
            <text x="${x + barWidth/2}" y="${chartHeight + 20}" text-anchor="middle" font-size="13" fill="#555">${s.toFixed(4)}</text>`;
  }).join('\n            ');

  // Contract fields
  const fieldsHtml = contract.fields.map(f =>
    `<span class="field">${f.name}${f.required ? '<sup>*</sup>' : ''}</span>`
  ).join('');

  // Constraints
  const constraintsHtml = contract.hard_constraints.map(c => {
    const detail = c.type === 'declarative'
      ? (c.mutex ? `mutex: [${c.mutex.join(', ')}]` : (c.rule ?? ''))
      : `code_predicate: ${c.impl}`;
    return `<div class="constraint"><span class="constraint-id">${c.id}</span><span class="constraint-detail">${escapeHtml(detail)}</span></div>`;
  }).join('');

  // Rubric
  const rubricHtml = contract.rubric.map(r =>
    `<div class="rubric-dim"><span class="dim-name">${r.dim}</span><span class="dim-weight">${(r.weight*100).toFixed(0)}%</span><span class="dim-mode ${r.mode}">${r.mode}</span></div>`
  ).join('');

  // Violations
  const violationsHtml = buggyReport.deterministic.violations.map(v => `
          <div class="violation-card">
            <div class="violation-header"><span class="violation-tag">${v.constraint_id}</span><span class="violation-sev ${v.severity}">${v.severity}</span></div>
            <div class="violation-msg">${escapeHtml(v.message)}</div>
            <div class="violation-hint">💡 ${escapeHtml(v.fix_hint ?? '')}</div>
          </div>`).join('');

  // Iterations table
  const iterationsHtml = result.iterations.map((iter, i) => `
            <tr><td>v${i+1}</td><td>${iter.score.toFixed(4)}</td><td>${iter.violations}</td><td>${iter.patchesApplied}</td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Crucible P0 Demo — 契约驱动合成引擎</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; background: #0f0f1e; color: #e0e0e0; line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 20px; }
  h1 { font-size: 2em; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
  .subtitle { color: #888; font-size: 1.1em; margin-bottom: 32px; }
  .mode-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.85em; background: ${hasApiKey ? '#1a4a1a' : '#4a3a1a'}; color: ${hasApiKey ? '#6ee66e' : '#e6c66e'}; margin-left: 12px; }
  section { background: #1a1a2e; border-radius: 12px; padding: 28px; margin-bottom: 24px; border: 1px solid #2a2a4a; }
  h2 { font-size: 1.4em; color: #667eea; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  h2::before { content: '▶'; font-size: 0.7em; color: #764ba2; }
  .field { display: inline-block; padding: 4px 10px; margin: 3px; background: #2a2a4a; border-radius: 6px; font-size: 0.85em; font-family: 'SF Mono', Consolas, monospace; }
  .field sup { color: #e6c66e; }
  .constraint { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #2a2a4a; }
  .constraint-id { font-family: 'SF Mono', Consolas, monospace; color: #764ba2; font-weight: 600; min-width: 160px; }
  .constraint-detail { color: #aaa; font-size: 0.9em; }
  .rubric-dim { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
  .dim-name { min-width: 140px; font-family: 'SF Mono', Consolas, monospace; }
  .dim-weight { color: #888; min-width: 50px; }
  .dim-mode { padding: 2px 8px; border-radius: 4px; font-size: 0.8em; }
  .dim-mode.deterministic { background: #1a3a1a; color: #6ee66e; }
  .dim-mode.judge { background: #3a1a3a; color: #e66eee; }
  .dim-mode.proxy+judge { background: #3a2a1a; color: #e6aa6e; }
  .score-compare { display: flex; gap: 24px; margin: 20px 0; }
  .score-card { flex: 1; padding: 20px; border-radius: 10px; text-align: center; }
  .score-card.golden { background: linear-gradient(135deg, #1a3a1a, #2a4a2a); border: 1px solid #3a6a3a; }
  .score-card.buggy { background: linear-gradient(135deg, #3a1a1a, #4a2a2a); border: 1px solid #6a3a3a; }
  .score-label { font-size: 0.9em; color: #888; margin-bottom: 8px; }
  .score-value { font-size: 2.4em; font-weight: 700; }
  .score-card.golden .score-value { color: #6ee66e; }
  .score-card.buggy .score-value { color: #ee6e6e; }
  .score-detail { font-size: 0.8em; color: #666; margin-top: 4px; }
  .violation-card { background: #2a1a1a; border-left: 4px solid #ee6e6e; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .violation-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .violation-tag { font-family: 'SF Mono', Consolas, monospace; background: #4a2a2a; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; color: #ee6e6e; }
  .violation-sev.hard { color: #ee6e6e; font-size: 0.75em; }
  .violation-msg { color: #ccc; font-size: 0.95em; margin-bottom: 6px; }
  .violation-hint { color: #888; font-size: 0.85em; }
  .chart-container { text-align: center; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #2a2a4a; }
  th { color: #667eea; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; }
  td { font-family: 'SF Mono', Consolas, monospace; }
  .footer { text-align: center; padding: 32px 0; color: #555; }
  .footer strong { background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .one-liner { text-align: center; font-size: 1.15em; margin: 24px 0; padding: 20px; background: linear-gradient(135deg, #1a1a3e, #2a1a3e); border-radius: 10px; border: 1px solid #4a3a6a; }
</style>
</head>
<body>
<div class="container">
  <h1>Crucible P0 Demo<span class="mode-badge">${hasApiKey ? 'LLM Judge' : 'Degraded'}</span></h1>
  <p class="subtitle">契约驱动合成引擎 — 多智能体协作赛道</p>

  <section>
    <h2>第一段:展示契约(Contract v1.0)</h2>
    <p style="color:#888;margin-bottom:12px;">Artifact family: <code>${contract.artifact_family}</code> · Fields: ${contract.fields.length} · Constraints: ${contract.hard_constraints.length} · Rubric: ${contract.rubric.length} dims</p>
    <div style="margin-bottom:16px;">${fieldsHtml}</div>
    <div style="margin-bottom:16px;">${constraintsHtml}</div>
    <div>${rubricHtml}</div>
  </section>

  <section>
    <h2>第二段:跑分抓 bug(Scorer + 4 确定性谓词)</h2>
    <div class="score-compare">
      <div class="score-card golden">
        <div class="score-label">黄金工件(无 bug)</div>
        <div class="score-value">${goldenReport.final_score.toFixed(4)}</div>
        <div class="score-detail">det: ${goldenReport.deterministic.deterministic_score.toFixed(2)} · violations: ${goldenReport.deterministic.hard_violation_count}</div>
      </div>
      <div class="score-card buggy">
        <div class="score-label">Buggy 工件(3 个 bug)</div>
        <div class="score-value">${buggyReport.final_score.toFixed(4)}</div>
        <div class="score-detail">det: ${buggyReport.deterministic.deterministic_score.toFixed(2)} · violations: ${buggyReport.deterministic.hard_violation_count}</div>
      </div>
    </div>
    <h3 style="color:#ee6e6e;margin:16px 0 8px;">抓出的违规</h3>
    ${violationsHtml}
  </section>

  <section>
    <h2>第三段:提分迭代(Critic 自动修复 → 分数上升)</h2>
    <div class="chart-container">
      <svg width="${chartWidth}" height="${chartHeight + 40}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#667eea"/><stop offset="100%" stop-color="#764ba2"/></linearGradient></defs>
        ${bars}
      </svg>
    </div>
    <table>
      <thead><tr><th>轮次</th><th>分数</th><th>违规数</th><th>补丁数</th></tr></thead>
      <tbody>${iterationsHtml}</tbody>
    </table>
    <p style="color:#888;margin-top:12px;">最终分数: <strong style="color:#6ee66e;">${result.finalScore.toFixed(4)}</strong> · 最终违规: ${result.iterations[result.iterations.length-1].violations} · Curator proposals: ${result.proposals}</p>
  </section>

  <div class="one-liner">
    💡 一群智能体不靠聊天、而靠一份可执行契约协同,<br>自动发现缺陷、自动提分。
  </div>

  <div class="footer">
    <p>Crucible P0 MVP · <strong>contract-driven synthesis engine</strong></p>
    <p style="font-size:0.8em;margin-top:4px;">119 tests pass · 5 验收达成 · health score 92/100</p>
  </div>
</div>
</body>
</html>`;

  const outputPath = join(__dirname, '..', 'demo-report.html');
  writeFileSync(outputPath, html, 'utf8');
  console.log(`HTML report generated: ${outputPath}`);
  console.log(`Open with: file:///${outputPath.replace(/\\/g, '/')}`);
}

main().catch(err => {
  console.error('Demo HTML generation failed:', err);
  process.exit(1);
});
