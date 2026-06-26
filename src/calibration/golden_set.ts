import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_ARTIFACTS } from '../fixtures/golden-set.js';
import type { GoldenArtifact, HumanRanking } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, '..', '..', 'golden');

/**
 * getGoldenArtifacts: 返回冻结黄金集 8 工件(带 ID + 质量梯度)。
 * 数据源:src/fixtures/golden-set.ts(P1 §2.3 构造)。
 */
export function getGoldenArtifacts(): GoldenArtifact[] {
  return GOLDEN_ARTIFACTS.map(g => ({
    id: g.id,
    region: g.region,
    quality_tier: g.quality_tier,
    artifact: g.artifact,
  }));
}

/**
 * loadHumanRanking: 读取 golden/human-ranking.jsonl(§2.4 人工标注产出)。
 * 文件格式:单行 JSON(非逐行 jsonl,用 .jsonl 后缀沿用 PRD 命名约定)。
 * @returns 人类排序;文件不存在则返回 null(标注未完成)
 */
export function loadHumanRanking(): HumanRanking | null {
  const path = resolve(GOLDEN_DIR, 'human-ranking.jsonl');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw) as HumanRanking;
}

/**
 * saveHumanRanking: 写入人类排序到 golden/human-ranking.jsonl。
 * 供 §2.4 标注流程(Task 4 AskUserQuestion pairwise)调用。
 */
export function saveHumanRanking(ranking: string[], dimension = '整体感受(综合时间/动线/记忆点/餐饮/来源)'): void {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  const payload: HumanRanking = {
    created_at: new Date().toISOString(),
    ranking,
    dimension,
  };
  const path = resolve(GOLDEN_DIR, 'human-ranking.jsonl');
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * loadCalibrationReport: 读取 golden/calibration-report.json(§2.4 judge 校准产出)。
 * @returns 校准报告;不存在则 null
 */
export function loadCalibrationReportPath(): string {
  return resolve(GOLDEN_DIR, 'calibration-report.json');
}
