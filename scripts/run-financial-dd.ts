#!/usr/bin/env node
/**
 * P4.3 §7 — 财务尽调红旗筛查演示。
 *
 * 加载 financial-v1 契约,对 4 份合成档案 + 2 份公开财报样例跑红旗筛查,
 * 打印每份档案的红旗数 / source_trust / ratio_health / 命中 constraint_id。
 *
 * 用法:npm run dd:financial
 *
 * ⚠️ 合规边界:红旗是"按尽调 rubric 触发的筛查信号",不是"偷漏税定性"。
 *   "是否真逃税"是审计师/律师判断。Crucible 价值是系统化、一致、可向监管辩护的筛查。
 *
 * spec ref: P4.3 plan §7;PRD v1.2 §6 审计轨迹
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { financialGolden, financialTaxFlag, financialCashflowFlag, financialRelatedPartyFlag } from '../src/fixtures/financial-dd.js';
import { publicReportSample, publicReportTaxFlagSample } from '../src/fixtures/public-report-sample.js';
import { parseFinancialReport } from '../src/collection/financial-report-parser.js';
import type { Artifact } from '../src/predicates/types.js';
import type { ScoreReport } from '../src/scorer/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', 'contracts', 'financial-v1.yaml');

function section(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(title);
  console.log('═'.repeat(60));
}

function score(report: ScoreReport, label: string, art: Artifact): void {
  const v = report.deterministic.violations;
  const hard = report.deterministic.hard_violation_count;
  const st = report.deterministic.rubric_scores.find(r => r.dim === 'source_trust');
  const rh = report.deterministic.rubric_scores.find(r => r.dim === 'ratio_health');
  const audit = art.metadata?.audit_status ?? '?';
  console.log(`\n[${label}] ${art.metadata?.company ?? '?'} (${audit})`);
  console.log(`  红旗数(hard): ${hard}  |  det_score: ${report.deterministic.deterministic_score.toFixed(3)}`);
  console.log(`  source_trust: ${st?.score.toFixed(3) ?? '—'}  (${st?.rationale ?? ''})`);
  console.log(`  ratio_health: ${rh?.score.toFixed(3) ?? '—'}  (${rh?.rationale ?? ''})`);
  if (v.length > 0) {
    console.log(`  🚩 命中红旗:`);
    v.forEach(x => console.log(`     - ${x.constraint_id}: ${x.message}`));
  } else {
    console.log(`  ✓ 无红旗(干净档案)`);
  }
}

function main(): void {
  const contract = loadContract(CONTRACT);
  const scorer = compileContract(contract);

  section('P4.3 财务尽调红旗筛查 — 合成档案(建契约 + 校准)');
  score(scorer.score(financialGolden), '合成-干净', financialGolden);
  score(scorer.score(financialTaxFlag), '合成-偷漏税', financialTaxFlag);
  score(scorer.score(financialCashflowFlag), '合成-现金流', financialCashflowFlag);
  score(scorer.score(financialRelatedPartyFlag), '合成-关联方', financialRelatedPartyFlag);

  section('P4.3 公开财报样例(JSON 解析 → 红旗筛查)');
  const pub1 = parseFinancialReport(publicReportSample);
  score(scorer.score(pub1), '公开-干净', pub1);
  const pub2 = parseFinancialReport(publicReportTaxFlagSample);
  score(scorer.score(pub2), '公开-税务红旗', pub2);

  section('合规说明');
  console.log('红旗 = 按尽调 rubric 触发的筛查信号,非偷漏税定性。');
  console.log('source_trust 区分审计质量(audited 0.95 > reviewed 0.70 > unaudited 0.30)。');
  console.log('审计轨迹(出处+分数)支撑"可向监管/上级辩护" — 见 P4.1 audit:trail 导出。');
}

main();
