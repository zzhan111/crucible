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
import { financialGolden, financialTaxFlag, financialCashflowFlag, financialRelatedPartyFlag } from './financial-dd.js';
import { publicCompetitorSampleSaaS, publicCompetitorSampleOSS } from './public-competitor-sample.js'; // P4.6 §4

export type GoldenPurpose = 'calibration' | 'detection';
export type QualityTier = 'high' | 'mid' | 'low';
export type ViolationPattern =
  | 'none' | 'time_budget' | 'state_mutex' | 'duplicate_state'
  | 'continuity' | 'missing_source' | 'pricing_format' | 'duplicate_competitor'
  // P4.3 财务尽调红旗
  | 'tax_ratio_low' | 'cashflow_anomaly' | 'related_party_transfer'
  // P4.6 intel 深化:陈旧定价 / 来源地板
  | 'stale_pricing' | 'trust_floor';

export interface ExpandedGoldenEntry {
  id: string;
  family: 'sequence' | 'table' | 'financial';
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

// ─── P4.5 table 族梯度补全:每 tier +1 无违规 calibration 工件(审计 cell ≥2) ───
// governance §3.1:calibration 工件无硬违规,质量差异只在 judge 维度。
// 现有 intel-high/mid/low 各仅 1 个(audit:golden 报 ~ 告警),这里各补一个不同数据。

/** table/high 第二样本:企业级 SaaS,来源多元、可信度高 */
const intelHigh2: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompG', feature: '可视化看板', pricing: '¥199/月', source: '官网定价页', source_trust: 0.88, last_verified: '2026-06-15' },
    { competitor_name: 'CompH', feature: 'API 集成', pricing: '$79/mo', source: '开发者文档', source_trust: 0.85, last_verified: '2026-06-10' },
    { competitor_name: 'CompI', feature: '团队协作', pricing: '¥399/月', source: '产品页', source_trust: 0.8, last_verified: '2026-05-28' },
  ],
};

/** table/mid 第二样本:中等可信度,部分来源偏弱 */
const intelMid2: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompJ', feature: '自动化规则', pricing: '¥149/月', source: '技术博客评测', source_trust: 0.55, last_verified: '2026-04-20' },
    { competitor_name: 'CompK', feature: '邮件提醒', pricing: '¥29/月', source: '应用商店', source_trust: 0.5, last_verified: '2026-03-15' },
  ],
};

/** table/low 第二样本:低可信度但合规(有 source、pricing 合法、无重复) */
const intelLow2: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'CompL', feature: '单页表单', pricing: '¥9/月', source: '论坛帖', source_trust: 0.25, last_verified: '2026-01-10' },
  ],
};

// ─── P4.6 §5 公开竞品快照 calibration(3 个,基于 §4 样本)───
// 基于公开 SaaS pricing page / OSS readme 的真实形态样本,补充高可信度梯度。
// governance §3.1:calibration 工件无硬违规(公开源可信度高、定价新鲜、单位规范)。

/** 公开 SaaS 快照 → high 梯度(官方定价页,source_trust 0.85-0.9) */
const intelPubSaaS: Artifact = publicCompetitorSampleSaaS;

/** 公开 OSS 快照 → mid 梯度(readme 可能滞后,source_trust 0.75-0.8) */
const intelPubOSS: Artifact = publicCompetitorSampleOSS;

/** 公开 OSS 低可信样本:readme 长期未更新 + 部分定价模糊 */
const intelPubOssLow: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'OSSProjectC', feature: 'CLI 工具', pricing: '免费', source: 'github.com/ossprojectc (readme, 6 月未更新)', source_trust: 0.45, last_verified: '2026-02-20' },
    { competitor_name: 'OSSProjectD', feature: '社区版报表', pricing: '¥0.5/次', source: 'github.com/ossprojectd (discussions)', source_trust: 0.4, last_verified: '2026-01-15' },
  ],
};

// ─── P4.6 §5 detection 探针(2 个,各触发对应新 constraint_id)───

/** stale_pricing:全部 last_verified 超 180 天阈值(定价陈旧失效) */
const violationStalePricing: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'StaleA', feature: '老功能 A', pricing: '¥199/月', source: '官网存档页', source_trust: 0.7, last_verified: '2025-09-01' },
    { competitor_name: 'StaleB', feature: '老功能 B', pricing: '$29/mo', source: '产品页存档', source_trust: 0.65, last_verified: '2025-08-15' },
  ],
};

/** trust_floor:全部 source_trust < 0.2 硬地板(来源几乎不可信) */
const violationTrustFloor: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    { competitor_name: 'UntrustedA', feature: '匿名声称功能', pricing: '¥99/月', source: '匿名截图', source_trust: 0.1, last_verified: '2026-06-01' },
    { competitor_name: 'UntrustedB', feature: '无署名爬虫数据', pricing: '$10/mo', source: '无署名爬虫', source_trust: 0.15, last_verified: '2026-05-20' },
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
  { id: 'intel-high2', family: 'table', region: 'intel', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: intelHigh2 },
  { id: 'intel-mid2', family: 'table', region: 'intel', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: intelMid2 },
  { id: 'intel-low2', family: 'table', region: 'intel', quality_tier: 'low', violation: 'none', purpose: 'calibration', artifact: intelLow2 },
  { id: 'vio-time-budget', family: 'sequence', region: 'hongkong', quality_tier: 'low', violation: 'time_budget', purpose: 'detection', artifact: violationTimeBudget },
  { id: 'vio-state-mutex', family: 'sequence', region: 'hongkong', quality_tier: 'low', violation: 'state_mutex', purpose: 'detection', artifact: violationStateMutex },
  { id: 'vio-dup-state', family: 'sequence', region: 'yunnan', quality_tier: 'low', violation: 'duplicate_state', purpose: 'detection', artifact: violationDuplicateState },
  { id: 'vio-continuity', family: 'sequence', region: 'yunnan', quality_tier: 'low', violation: 'continuity', purpose: 'detection', artifact: violationContinuity },
  { id: 'vio-missing-source', family: 'table', region: 'intel', quality_tier: 'low', violation: 'missing_source', purpose: 'detection', artifact: violationMissingSource },
  { id: 'vio-pricing-format', family: 'table', region: 'intel', quality_tier: 'low', violation: 'pricing_format', purpose: 'detection', artifact: violationPricingFormat },
  { id: 'vio-dup-competitor', family: 'table', region: 'intel', quality_tier: 'low', violation: 'duplicate_competitor', purpose: 'detection', artifact: violationDuplicateCompetitor },

  // ─── P4.6 §5 intel 深化:公开快照 calibration(3 个) + 新 detection(2 个) ───
  // calibration:基于公开 SaaS/OSS 快照,补充高可信度梯度
  { id: 'intel-pub-saas', family: 'table', region: 'intel', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: intelPubSaaS },
  { id: 'intel-pub-oss', family: 'table', region: 'intel', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: intelPubOSS },
  { id: 'intel-pub-oss-low', family: 'table', region: 'intel', quality_tier: 'low', violation: 'none', purpose: 'calibration', artifact: intelPubOssLow },
  // detection:触发 P4.6 新 constraint_id
  { id: 'vio-stale-pricing', family: 'table', region: 'intel', quality_tier: 'low', violation: 'stale_pricing', purpose: 'detection', artifact: violationStalePricing },
  { id: 'vio-trust-floor', family: 'table', region: 'intel', quality_tier: 'low', violation: 'trust_floor', purpose: 'detection', artifact: violationTrustFloor },

  // ─── P4.3 财务尽调 vertical(financial 族)───
  // calibration:无硬违规,quality 差异在 source_trust(audit 质量)。fin-high=audited, fin-mid=reviewed, fin-low=unaudited。
  // 复用 financialGolden(干净,audited)作 high;mid/low 用同结构改 audit_status + source_trust(仍无硬违规)。
  { id: 'fin-high', family: 'financial', region: 'financial', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: financialGolden },
  { id: 'fin-mid', family: 'financial', region: 'financial', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: { ...financialGolden, metadata: { ...financialGolden.metadata, audit_status: 'reviewed' }, nodes: financialGolden.nodes.map(n => ({ ...n, source_trust: 0.7 })) } },
  { id: 'fin-low', family: 'financial', region: 'financial', quality_tier: 'low', violation: 'none', purpose: 'calibration', artifact: { ...financialGolden, metadata: { ...financialGolden.metadata, audit_status: 'unaudited' }, nodes: financialGolden.nodes.map(n => ({ ...n, source_trust: 0.3, source: 'internal.xlsx' })) } },
  // 每梯队第二样本(满足审计 cell ≥2;数据量级不同,仍无硬违规)
  { id: 'fin-high2', family: 'financial', region: 'financial', quality_tier: 'high', violation: 'none', purpose: 'calibration', artifact: { ...financialGolden, metadata: { ...financialGolden.metadata, company: 'SampleCo2 Ltd' }, nodes: financialGolden.nodes.map(n => ({ ...n, amount: (n.amount as number) * 2 })) } },
  { id: 'fin-mid2', family: 'financial', region: 'financial', quality_tier: 'mid', violation: 'none', purpose: 'calibration', artifact: { ...financialGolden, metadata: { ...financialGolden.metadata, audit_status: 'reviewed', company: 'SampleCo2 Ltd' }, nodes: financialGolden.nodes.map(n => ({ ...n, amount: (n.amount as number) * 2, source_trust: 0.7 })) } },
  { id: 'fin-low2', family: 'financial', region: 'financial', quality_tier: 'low', violation: 'none', purpose: 'calibration', artifact: { ...financialGolden, metadata: { ...financialGolden.metadata, audit_status: 'unaudited', company: 'SampleCo2 Ltd' }, nodes: financialGolden.nodes.map(n => ({ ...n, amount: (n.amount as number) * 2, source_trust: 0.3, source: 'internal.xlsx' })) } },
  // detection:3 个红旗档案,各触发对应 constraint_id
  { id: 'vio-tax-ratio', family: 'financial', region: 'financial', quality_tier: 'low', violation: 'tax_ratio_low', purpose: 'detection', artifact: financialTaxFlag },
  { id: 'vio-cashflow', family: 'financial', region: 'financial', quality_tier: 'low', violation: 'cashflow_anomaly', purpose: 'detection', artifact: financialCashflowFlag },
  { id: 'vio-related-party', family: 'financial', region: 'financial', quality_tier: 'low', violation: 'related_party_transfer', purpose: 'detection', artifact: financialRelatedPartyFlag },
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
