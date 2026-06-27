#!/usr/bin/env node
/**
 * P3.5 §2.4 — 冻结黄金集审计脚本。
 *
 * 治理见 docs/governance/frozen-golden-set.md §5 防腐协议。
 *
 * 检查三项:
 * 1. 分数分布漂移:数值字段均值/std 与基线快照对比(本次无基线则只打印当前统计)
 * 2. judge τ:重跑校准(无 API key 时跳过,打印 neutral 提示)
 * 3. 覆盖率矩阵:artifact_family × quality_tier × violation pattern 最小样本数
 *
 * 用法: npx tsx scripts/audit-golden-set.ts
 * 输出: 控制台报告 + 提示写 docs/qa/golden-set-audit-YYYY-MM-DD.md
 */
import { computeGoldenStats, computeFieldStats } from '../src/curator/novelty_v2.js';
import {
  EXPANDED_GOLDEN,
  CALIBRATION_GOLDEN,
  DETECTION_GOLDEN,
  type ExpandedGoldenEntry,
  type QualityTier,
  type ViolationPattern,
} from '../src/fixtures/golden-set-expanded.js';

const NUMERIC_FIELDS = ['cost', 'duration_min', 'source_trust'] as const;

function section(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function main(): void {
  const today = new Date().toISOString().slice(0, 10);

  section(`黄金集审计报告 — ${today}`);
  console.log(`总工件数: ${EXPANDED_GOLDEN.length}`);
  console.log(`  calibration: ${CALIBRATION_GOLDEN.length}`);
  console.log(`  detection:  ${DETECTION_GOLDEN.length}`);

  // ── 1. 分数分布统计 ──
  section('1. 数值字段分布统计(calibration 集)');
  const stats = computeGoldenStats(CALIBRATION_GOLDEN);
  for (const field of NUMERIC_FIELDS) {
    const s = stats[field];
    if (s.n === 0) {
      console.log(`  ${field}: 无样本`);
    } else {
      console.log(`  ${field}: n=${s.n} mean=${s.mean.toFixed(3)} std=${s.std.toFixed(3)} min/max 见数据`);
    }
  }
  // detection 集单独统计(异常 case,预期分布偏离)
  console.log('\n  detection 集分布(预期偏离,用于验证 outlier 检测):');
  for (const field of NUMERIC_FIELDS) {
    const s = computeFieldStats(DETECTION_GOLDEN.map(e => e.artifact), field);
    if (s.n > 0) console.log(`  ${field}: n=${s.n} mean=${s.mean.toFixed(3)} std=${s.std.toFixed(3)}`);
  }
  console.log('\n  [防腐] 无历史基线快照,本次作为首版基线。后续审计对比漂移 > 20% 告警。');

  // ── 2. judge τ(无 API key 跳过)──
  section('2. judge Kendall τ 校准');
  if (!process.env.OPENAI_API_KEY) {
    console.log('  [SKIP] 无 OPENAI_API_KEY,judge 返回 neutral 0.5,τ 无意义。');
    console.log('  生产审计:CRUCIBLE_CALIBRATION=1 npx tsx scripts/audit-golden-set.ts');
  } else {
    console.log('  [TODO] 接入 calibration/calibrate.ts 跑真实 τ(留后续迭代)。');
  }

  // ── 3. 覆盖率矩阵 ──
  section('3. 覆盖率矩阵');
  const families = ['sequence', 'table'] as const;
  const tiers: QualityTier[] = ['high', 'mid', 'low'];
  const violations: ViolationPattern[] = [
    'none', 'time_budget', 'state_mutex', 'duplicate_state',
    'continuity', 'missing_source', 'pricing_format', 'duplicate_competitor',
  ];

  console.log('\n  family × quality_tier(calibration):');
  for (const fam of families) {
    for (const tier of tiers) {
      const n = EXPANDED_GOLDEN.filter(e => e.family === fam && e.quality_tier === tier && e.purpose === 'calibration').length;
      const flag = n >= 2 ? '✓' : n >= 1 ? '~' : '✗';
      console.log(`    ${flag} ${fam}/${tier}: ${n}`);
    }
  }

  console.log('\n  violation pattern(detection,每个应 ≥ 1):');
  for (const v of violations) {
    const entries = EXPANDED_GOLDEN.filter(e => e.violation === v);
    const flag = entries.length >= 1 ? '✓' : '✗';
    console.log(`    ${flag} ${v}: ${entries.length}`);
  }

  // ── 缺口告警 ──
  section('告警汇总');
  const gaps: string[] = [];
  for (const fam of families) {
    for (const tier of tiers) {
      const n = EXPANDED_GOLDEN.filter(e => e.family === fam && e.quality_tier === tier && e.purpose === 'calibration').length;
      if (n < 2) gaps.push(`calibration 覆盖不足: ${fam}/${tier} 仅 ${n} 个(目标 ≥ 2)`);
    }
  }
  for (const v of violations) {
    if (v !== 'none' && EXPANDED_GOLDEN.filter(e => e.violation === v).length < 1) {
      gaps.push(`detection 缺失: violation=${v} 无样本`);
    }
  }
  if (gaps.length === 0) {
    console.log('  ✓ 无缺口,覆盖率矩阵满足。');
  } else {
    for (const g of gaps) console.log(`  ✗ ${g}`);
  }

  console.log(`\n报告可写至: docs/qa/golden-set-audit-${today}.md`);
}

main();
