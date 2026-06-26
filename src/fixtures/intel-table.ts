import type { Artifact } from '../predicates/types.js';

/**
 * 情报表 fixture (P1 §2.8 跨族探针):从 BigSet 深度调研报告提取的竞品数据。
 *
 * buggy 版:含 2 个 bug
 * - Bug 1: 行 2(CompetitorC)缺 source 字段 → no_empty_source 违规
 * - Bug 2: 行 3(CompetitorD)pricing="未知" → pricing_format 违规
 * - Bug 3: 行 4 重复 CompetitorA → no_duplicate_competitor 违规
 *
 * golden 版:全部合规,用于验证探针能区分好坏。
 */

/** buggy 情报表:3 个硬违规(缺 source / pricing 未知 / 重复竞品) */
export const intelTableBuggy: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    {
      competitor_name: 'CompetitorA',
      feature: 'AI 自动评分 + 迭代',
      pricing: '¥299/月',
      source: 'bigset-report-2026.pdf',
      source_trust: 0.8,
      last_verified: '2026-06-01',
    },
    {
      competitor_name: 'CompetitorB',
      feature: '多 agent 协作',
      pricing: '免费',
      source: '官网 product page',
      source_trust: 0.7,
      last_verified: '2026-05-15',
    },
    {
      // Bug 1: 缺 source
      competitor_name: 'CompetitorC',
      feature: '契约驱动编排',
      pricing: '$49/mo',
      source_trust: 0.3,
      last_verified: '2026-03-20',
    },
    {
      // Bug 2: pricing = 未知
      competitor_name: 'CompetitorD',
      feature: 'DSL 可视化',
      pricing: '未知',
      source: 'github readme',
      source_trust: 0.5,
      last_verified: '2026-04-10',
    },
    {
      // Bug 3: 重复 CompetitorA
      competitor_name: 'CompetitorA',
      feature: 'API 集成',
      pricing: '¥299/月',
      source: 'bigset-report-2026.pdf',
      source_trust: 0.8,
      last_verified: '2026-06-01',
    },
  ],
};

/** golden 情报表:零硬违规,数据完整新鲜 */
export const intelTableGolden: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    {
      competitor_name: 'CompetitorA',
      feature: 'AI 自动评分 + 迭代',
      pricing: '¥299/月',
      source: 'bigset-report-2026.pdf',
      source_trust: 0.8,
      last_verified: '2026-06-01',
    },
    {
      competitor_name: 'CompetitorB',
      feature: '多 agent 协作',
      pricing: '免费',
      source: '官网 product page',
      source_trust: 0.7,
      last_verified: '2026-05-15',
    },
    {
      competitor_name: 'CompetitorC',
      feature: '契约驱动编排',
      pricing: '$49/mo',
      source: '行业白皮书 2026',
      source_trust: 0.6,
      last_verified: '2026-04-20',
    },
    {
      competitor_name: 'CompetitorD',
      feature: 'DSL 可视化',
      pricing: '¥99/月',
      source: 'github readme',
      source_trust: 0.5,
      last_verified: '2026-04-10',
    },
  ],
};
