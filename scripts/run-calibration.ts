/**
 * 真实 LLM judge 校准脚本(P1 §2.4 手动验证)。
 *
 * 用法:
 *   npx tsx scripts/run-calibration.ts
 *
 * 需要先配置 .env(OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL)。
 * 对 8 个黄金工件 × 3 个 judge 维度 = 24 次 LLM 调用,约 30-60 秒。
 *
 * 产出:
 *   - 打印 τ 值 + per_dim_tau + 判定(pass/fail)
 *   - 写入 golden/calibration-report.json
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { runJudgeCalibration, saveCalibrationReport } from '../src/calibration/calibrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 手动加载 .env(脚本不经过 vitest setup)
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const CONTRACT_PATH = resolve(__dirname, '..', 'contracts', 'travel-sequence-v1.yaml');

async function main() {
  console.log('=== P1 §2.4 真实 LLM judge 校准 ===\n');

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || '(default)';
  const model = process.env.OPENAI_MODEL || '(default)';
  console.log(`配置: model=${model}, baseURL=${baseUrl}, key=${apiKey ? 'SET' : 'MISSING'}\n`);

  if (!apiKey) {
    console.error('错误: OPENAI_API_KEY 未设置。请先配置 .env 文件。');
    process.exit(1);
  }

  console.log('加载 Contract...');
  const contract = loadContract(CONTRACT_PATH);
  const baseScorer = compileContract(contract);
  console.log(`  编译成功: ${baseScorer.deterministicPredicateCount} 谓词 + ${baseScorer.deterministicRubricCount} rubric\n`);

  console.log('对 8 个黄金工件跑 judge(24 次 LLM 调用,请耐心等待)...\n');
  const startTime = Date.now();
  const report = await runJudgeCalibration(contract, baseScorer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const path = saveCalibrationReport(report);

  console.log(`\n=== 校准完成(${elapsed}s)===\n`);
  console.log(`整体 Kendall τ:  ${report.overall_tau.toFixed(4)}`);
  console.log(`阈值:           ${report.threshold}`);
  console.log(`判定:           ${report.verdict.toUpperCase()}${report.verdict === 'pass' ? ' ✅' : ' ❌'}\n`);
  console.log('Per-dimension τ:');
  for (const [dim, tau] of Object.entries(report.per_dim_tau)) {
    console.log(`  ${dim.padEnd(15)} τ = ${tau.toFixed(4)}`);
  }
  console.log('\nJudge 排序(优→劣):');
  console.log('  ' + report.judge_ranking.join(' > '));
  console.log('\n人类排序(优→劣):');
  console.log('  ' + report.human_ranking.join(' > '));

  // 对比表
  console.log('\n逐工件对比(judge vs human):');
  console.log('  工件    | judge位次 | human位次 | 差值');
  console.log('  -------|----------|----------|-----');
  for (const id of report.judge_ranking) {
    const jIdx = report.judge_ranking.indexOf(id) + 1;
    const hIdx = report.human_ranking.indexOf(id) + 1;
    const diff = jIdx - hIdx;
    const sign = diff > 0 ? '+' : '';
    console.log(`  ${id.padEnd(7)} | ${String(jIdx).padStart(8)} | ${String(hIdx).padStart(8)} | ${sign}${diff}`);
  }

  console.log(`\n报告已保存: ${path}`);

  if (report.verdict === 'pass') {
    console.log('\n✅ §3.2 judge 校准通过(τ > 0.5)');
    process.exit(0);
  } else {
    console.log(`\n⚠️  τ = ${report.overall_tau.toFixed(4)} < 0.5,未达阈值。`);
    console.log('   可能需要调 judge prompt(加 few-shot / 改维度描述)。');
    process.exit(0); // 不用非零退出,τ 不达标是数据问题不是脚本错误
  }
}

main().catch(e => {
  console.error('校准失败:', e);
  process.exit(1);
});
