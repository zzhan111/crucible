#!/usr/bin/env node
/**
 * P4.6 §6 — 市场情报/竞品监测演示。
 *
 * 加载 intel-table-v1.1 契约,对 4 份情报表跑监测评分,
 * 打印每份的 hard 违规 / 5 维 rubric(含 strategic_insight judge mock fallback)/ 总分排名。
 *
 * 用法:npm run intel:monitor
 *
 * 4 份工件:
 *   - intelTableBuggy(合成,含 3 硬违规:缺 source / pricing 未知 / 重复竞品)
 *   - intelTableGolden(合成,干净)
 *   - publicCompetitorSampleSaaS(公开 SaaS pricing page 快照,高可信)
 *   - publicCompetitorSampleOSS(公开 OSS readme 快照,中高可信)
 *
 * 注:strategic_insight 是 judge 维度,无 OPENAI_API_KEY 时走 mock fallback(基于结构特征给近似分),
 *     保证 demo 离线可跑。有 key 时走真实 LLM 评估。
 *
 * spec ref: P4.6 plan §6;PRD v1.2 §6 审计轨迹(出处 + 分数 = 可向监管/上级辩护)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { createJudgeAugmentedScorer } from '../src/scorer/augmented.js';
import { intelTableBuggy, intelTableGolden } from '../src/fixtures/intel-table.js';
import { publicCompetitorSampleSaaS, publicCompetitorSampleOSS } from '../src/fixtures/public-competitor-sample.js';
import type { Artifact } from '../src/predicates/types.js';
import type { ScoreReport } from '../src/scorer/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', 'contracts', 'intel-table-v1.yaml');

function section(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(title);
  console.log('═'.repeat(60));
}

interface CaseRow {
  label: string;
  artifact: Artifact;
  report: ScoreReport;
}

async function main(): Promise<void> {
  const contract = loadContract(CONTRACT);
  const baseScorer = compileContract(contract);
  const scorer = createJudgeAugmentedScorer(baseScorer, contract);

  const cases: Array<{ label: string; artifact: Artifact }> = [
    { label: '合成-buggy', artifact: intelTableBuggy },
    { label: '合成-golden', artifact: intelTableGolden },
    { label: '公开-SaaS', artifact: publicCompetitorSampleSaaS },
    { label: '公开-OSS', artifact: publicCompetitorSampleOSS },
  ];

  section('P4.6 市场情报/竞品监测 — 5 维评分(含 strategic_insight judge)');
  console.log(`契约: intel-table-v1.1 | 谓词: ${baseScorer.deterministicPredicateCount} | 确定性 rubric: ${baseScorer.deterministicRubricCount} + 1 judge(strategic_insight)`);
  console.log(`LLM: ${process.env.OPENAI_API_KEY ? '已配置(走真实 judge)' : '未配置(strategic_insight 走 mock fallback)'}`);

  const rows: CaseRow[] = [];
  for (const c of cases) {
    const report = await scorer.score(c.artifact);
    rows.push({ label: c.label, artifact: c.artifact, report });
    printCase(c.label, c.artifact, report);
  }

  section('总分排名(final_score = det*0.6 + judge*0.4)');
  rows.sort((a, b) => b.report.final_score - a.report.final_score);
  rows.forEach((r, i) => {
    const det = r.report.deterministic.deterministic_score.toFixed(3);
    const judge = r.report.judge ? r.report.judge.overall_score.toFixed(3) : '—';
    console.log(`  ${i + 1}. ${r.label.padEnd(14)} final=${r.report.final_score.toFixed(3)}  (det=${det}, judge=${judge})`);
  });

  section('监测说明');
  console.log('• hard 违规 = 不可接受的情报(缺来源/定价未知/重复竞品/陈旧定价/来源不可信)');
  console.log('• soft 违规 = 待复核(来源偏弱/单位不可归一化),不阻断但需标注');
  console.log('• 5 维 rubric: coverage + freshness + source_trust + differentiator_density + strategic_insight');
  console.log('• 审计轨迹(出处+分数)支撑"可向采购/上级辩护" — 见 P4.1 audit:trail 导出。');
}

function printCase(label: string, art: Artifact, report: ScoreReport): void {
  const d = report.deterministic;
  const hard = d.hard_violation_count;
  const soft = d.violations.filter(v => v.severity === 'soft').length;
  console.log(`\n[${label}] ${art.nodes.length} 行竞品`);
  console.log(`  硬违规: ${hard}  软违规: ${soft}  det_score: ${d.deterministic_score.toFixed(3)}`);
  // 确定性 rubric(4 维)
  const detDims = d.rubric_scores;
  detDims.forEach(r => console.log(`    ${r.dim.padEnd(22)} = ${r.score.toFixed(3)}  (${r.rationale})`));
  // judge(1 维)
  if (report.judge) {
    report.judge.rubric_scores.forEach(r =>
      console.log(`    ${r.dim.padEnd(22)} = ${r.score.toFixed(3)}  [judge] (${r.rationale})`)
    );
  }
  console.log(`  final_score: ${report.final_score.toFixed(3)}`);
  if (d.violations.length > 0) {
    console.log(`  ⚠ 命中违规:`);
    d.violations.forEach(v => {
      const icon = v.severity === 'hard' ? '🚩' : '◇';
      console.log(`     ${icon} ${v.constraint_id}: ${v.message}`);
    });
  } else {
    console.log(`  ✓ 无违规(干净情报)`);
  }
}

main().catch(err => {
  console.error('intel:monitor 演示失败:', err);
  process.exit(1);
});
