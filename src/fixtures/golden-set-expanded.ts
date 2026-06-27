/**
 * P3.5 §2.4 — 扩容冻结黄金集(8 → ≥ 20)。
 *
 * 治理见 docs/governance/frozen-golden-set.md。
 *
 * 组成:
 * - 复用 P1 GOLDEN_ARTIFACTS(8 个,sequence 族,calibration 用途)
 * - 新增防城港 mid(梯度补全)
 * - 新增情报表族(table)3 个探针(跨族覆盖率)
 * - 新增 violation pattern 异常 case(detection 用途,故意含硬违规)
 *
 * purpose 标记:
 * - 'calibration': 无硬违规,进 judge τ 校准 + novelty 分布统计基线
 * - 'detection': 故意含硬违规,只进打分器检出率测试,不进 τ 校准
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.4
 */
import type { Artifact } from '../predicates/types.js';
import { GOLDEN_ARTIFACTS } from './golden-set.js';

export type GoldenPurpose = 'calibration' | 'detection';
export type QualityTier = 'high' | 'mid' | 'low';
export type ViolationPattern =
  | 'none' | 'time_budget' | 'state_mutex' | 'duplicate_state'
  | 'continuity' | 'missing_source' | 'pricing_format' | 'duplicate_competitor';

export interface ExpandedGoldenEntry {
  id: string;
  family: 'sequence' | 'table';
  region: string;
  quality_tier: QualityTier;
  violation: ViolationPattern;
  purpose: GoldenPurpose;
  artifact: Artifact;
}

// ─── 防城港 mid(梯度补全)─────────────────────────────────────

const fcMid: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 500 } },
  nodes: [
    {
      time_block: '08:00-08:30', action: '早餐 海鲜粥', route: '酒店 → 白龙老街',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 20, source: '防城港本地公众号', source_trust: 0.6, state: ['at_hotel'],
    },
    {
      time_block: '08:30-09:00', action: '公交至怪石滩', route: '市区 → 怪石滩',
      duration_min: 30, node_type: 'transit', elasticity: 'non_compressible',
      cost: 8, source: '防城港公交', source_trust: 0.7, state: [],
    },
    {
      time_block: '09:00-11:00', action: '怪石滩拍照 + 海岸徒步', route: '怪石滩海岸',
      duration_min: 120, node_type: 'core_experience', elasticity: 'compressible',
      cost: 0, source: '防城港本地公众号', source_trust: 0.6, state: ['beach'],
    },
  ],
};

/** 防城港 high(补强 high 梯度,来源多元动线顺) */
const fcHigh2: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 500 } },
  nodes: [
    {
      time_block: '07:30-08:00', action: '早餐 鱼粉', route: '酒店 → 渔港早市',
      duration_min: 30, node_type: 'dining', elasticity: 'compressible',
      cost: 18, source: '防城港文旅官方', source_trust: 0.85, state: ['at_hotel'],
    },
    {
      time_block: '08:00-08:40', action: '渡轮至白龙半岛', route: '渔港 → 白龙半岛',
      duration_min: 40, node_type: 'transit', elasticity: 'non_compressible',
      cost: 25, source: '防城港航运时刻表', source_trust: 0.9, state: [],
    },
    {
      time_block: '08:40-12:00', action: '白龙半岛环岛徒步 + 礁石赶海', route: '白龙半岛环线',
      duration_min: 200, node_type: 'core_experience', elasticity: 'non_compressible',
      cost: 0, source: '防城港文旅官方', source_trust: 0.85, state: ['beach'],
    },
    {
      time_block: '12:00-13:00', action: '海鲜午餐', route: '白龙渔村',
      duration_min: 60, node_type: 'dining', elasticity: 'compressible',
      cost: 120, source: '大众点评高分店', source_trust: 0.8, state: [],
    },
  ],
};

// ─── 情报表族(table)3 个探针 ─────────────────────────────────

const intelHigh: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompA', feature: 'AI 评分', pricing: '¥299/月', source: '官网', source_trust: 0.9, last_verified: '2026-06-01' },
    { competitor_name: 'CompB', feature: '多 agent', pricing: '免费', source: 'github', source_trust: 0.8, last_verified: '2026-05-20' },
    { competitor_name: 'CompC', feature: 'DSL 可视化', pricing: '$49/mo', source: 'product page', source_trust: 0.75, last_verified: '2026-05-10' },
  ],
};

const intelMid: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompD', feature: '基础爬虫', pricing: '¥99/月', source: '论坛帖', source_trust: 0.4, last_verified: '2026-03-01' },
    { competitor_name: 'CompE', feature: '数据导出', pricing: '免费', source: '论坛帖', source_trust: 0.4, last_verified: '2026-02-15' },
  ],
};

const intelLow: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompF', feature: '手动表单', pricing: '未知', source: '微信群截图', source_trust: 0.2, last_verified: '2025-12-01' },
  ],
};

// ─── violation pattern 异常 case(detection 用途)──────────────

/** time_budget 超限:daily_available_minutes=960 但节点总时长 1200 */
const violationTimeBudget: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-10:00', action: 'A', route: 'x', duration_min: 120, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.8, state: [] },
    { time_block: '10:00-14:00', action: 'B', route: 'y', duration_min: 240, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.8, state: [] },
    { time_block: '14:00-20:00', action: 'C', route: 'z', duration_min: 360, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.8, state: [] },
    { time_block: '20:00-22:00', action: 'D', route: 'w', duration_min: 120, node_type: 'dining', elasticity: 'compressible', cost: 50, source: 's', source_trust: 0.8, state: [] },
    { time_block: '22:00-24:00', action: 'E', route: 'v', duration_min: 120, node_type: 'transit', elasticity: 'non_compressible', cost: 30, source: 's', source_trust: 0.8, state: [] },
  ],
};

/** state_mutex 冲突:同一节点同时含互斥 state(at_hotel + departed) */
const violationStateMutex: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-09:00', action: 'A', route: 'x', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 40, source: 's', source_trust: 0.7, state: ['at_hotel', 'depart_from_hotel'] },
  ],
};

/** duplicate_state:连续两节点重复同 state */
const violationDuplicateState: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-09:00', action: 'A', route: 'x', duration_min: 60, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.7, state: ['hiking'] },
    { time_block: '09:00-10:00', action: 'B', route: 'y', duration_min: 60, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.7, state: ['hiking'] },
  ],
};

/** continuity 断裂:时间块不连续(08:00-09:00 后跳 11:00) */
const violationContinuity: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-09:00', action: 'A', route: 'x', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 30, source: 's', source_trust: 0.7, state: ['at_hotel'] },
    { time_block: '11:00-12:00', action: 'B', route: 'y', duration_min: 60, node_type: 'core_experience', elasticity: 'non_compressible', cost: 0, source: 's', source_trust: 0.7, state: [] },
  ],
};

/** missing_source:情报表行缺 source */
const violationMissingSource: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompX', feature: 'f', pricing: '¥1', source_trust: 0.5, last_verified: '2026-01-01' },
  ],
};

/** pricing_format:情报表 pricing=未知 */
const violationPricingFormat: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompY', feature: 'f', pricing: '未知', source: 's', source_trust: 0.5, last_verified: '2026-01-01' },
  ],
};

/** duplicate_competitor:情报表重复竞品名 */
const violationDuplicateCompetitor: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompZ', feature: 'f1', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' },
    { competitor_name: 'CompZ', feature: 'f2', pricing: '¥2', source: 's', source_trust: 0.5, last_verified: '2026-01-01' },
  ],
};

// ─── 组装扩容集 ─────────────────────────────────────────────

/** P1 黄金集(8 个)转 calibration 用途 */
const p1Calibration: ExpandedGoldenEntry[] = GOLDEN_ARTIFACTS.map(g => ({
  id: g.id,
  family: 'sequence' as const,
  region: g.region,
  quality_tier: g.quality_tier,
  violation: 'none' as ViolationPattern,
  purpose: 'calibration' as GoldenPurpose,
  artifact: g.artifact,
}));

const expandedAdditions: ExpandedGoldenEntry[] = [
  { id: 'fc-mid', family: 'sequence', region: 'fangchenggang', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: fcMid },
  { id: 'fc-high2', family: 'sequence', region: 'fangchenggang', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: fcHigh2 },
  { id: 'intel-high', family: 'table', region: 'intel', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: intelHigh },
  { id: 'intel-mid', family: 'table', region: 'intel', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: intelMid },
  { id: 'intel-low', family: 'table', region: 'intel', quality_tier: 'low', violation: 'none', purpose: 'calibration', artifact: intelLow },
  { id: 'vio-time-budget', family: 'sequence', region: 'hongkong', quality_tier: 'low', violation: 'time_budget', purpose: 'detection', artifact: violationTimeBudget },
  { id: 'vio-state-mutex', family: 'sequence', region: 'hongkong', quality_tier: 'low', violation: 'state_mutex', purpose: 'detection', artifact: violationStateMutex },
  { id: 'vio-dup-state', family: 'sequence', region: 'yunnan', quality_tier: 'low', violation: 'duplicate_state', purpose: 'detection', artifact: violationDuplicateState },
  { id: 'vio-continuity', family: 'sequence', region: 'yunnan', quality_tier: 'low', violation: 'continuity', purpose: 'detection', artifact: violationContinuity },
  { id: 'vio-missing-source', family: 'table', region: 'intel', quality_tier: 'low', violation: 'missing_source', purpose: 'detection', artifact: violationMissingSource },
  { id: 'vio-pricing-format', family: 'table', region: 'intel', quality_tier: 'low', violation: 'pricing_format', purpose: 'detection', artifact: violationPricingFormat },
  { id: 'vio-dup-competitor', family: 'table', region: 'intel', quality_tier: 'low', violation: 'duplicate_competitor', purpose: 'detection', artifact: violationDuplicateCompetitor },
];

/** 扩容黄金集(≥ 20 工件) */
export const EXPANDED_GOLDEN: ExpandedGoldenEntry[] = [...p1Calibration, ...expandedAdditions];

/** calibration 用途工件(进 τ 校准 + 分布统计) */
export const CALIBRATION_GOLDEN: Artifact[] = EXPANDED_GOLDEN
  .filter(e => e.purpose === 'calibration')
  .map(e => e.artifact);

/** detection 用途工件(进检出率测试) */
export const DETECTION_GOLDEN: ExpandedGoldenEntry[] = EXPANDED_GOLDEN
  .filter(e => e.purpose === 'detection');
