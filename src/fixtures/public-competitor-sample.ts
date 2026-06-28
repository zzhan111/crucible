import type { Artifact } from '../predicates/types.js';

/**
 * P4.6 §4 — 公开竞品页快照样本(脱敏)。
 *
 * 仿照 P4.3 public-report-sample.ts:从公开可见的 pricing page / changelog /
 * GitHub readme 文本中提取的竞品情报,作为"真实数据"补强 demo 可信度。
 *
 * 两个样本:
 *   - publicCompetitorSampleSaaS:公开 SaaS pricing page 风格(3 行,高可信度)
 *   - publicCompetitorSampleOSS:GitHub readme + release notes 风格(2 行,中高可信度)
 *
 * 数据为合成但形态真实(字段结构、来源标注、可信度分配贴合实际采集结果)。
 * 真实网页抓取(HTML→Artifact)留待 P4.6.2 collector,本轮直接给 Artifact。
 */

/**
 * 公开 SaaS pricing page 快照:
 *   - 来源:厂商官方定价页(脱敏为 VendorX/Y/Z)
 *   - source_trust: 0.85-0.9(官方一手源)
 *   - last_verified: 2026-06 内(新鲜)
 *   - 计费单位规范(¥/月 或 $/mo)
 */
export const publicCompetitorSampleSaaS: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    {
      competitor_name: 'VendorX',
      feature: '可视化数据看板 + 自定义指标',
      pricing: '¥499/月',
      source: 'vendorx.com/pricing (官方定价页)',
      source_trust: 0.9,
      last_verified: '2026-06-18',
    },
    {
      competitor_name: 'VendorY',
      feature: 'API 集成 + Webhook 自动化',
      pricing: '$79/mo',
      source: 'vendory.com/pricing (官方定价页)',
      source_trust: 0.88,
      last_verified: '2026-06-15',
    },
    {
      competitor_name: 'VendorZ',
      feature: '团队协作 + 权限分级',
      pricing: '¥299/月',
      source: 'vendorz.cn/pricing (官方定价页)',
      source_trust: 0.85,
      last_verified: '2026-06-10',
    },
  ],
};

/**
 * 公开 OSS 项目快照(GitHub readme + release notes 风格):
 *   - 来源:GitHub 仓库 readme + releases 页(脱敏为 OSSProjectA/B)
 *   - source_trust: 0.7-0.8(公开仓库,但 readme 更新可能滞后)
 *   - last_verified: 2026-05 内
 *   - 计费:开源免费 / 企业版年费
 */
export const publicCompetitorSampleOSS: Artifact = {
  family: 'table',
  metadata: { day: 1 },
  nodes: [
    {
      competitor_name: 'OSSProjectA',
      feature: '开源契约引擎 + 插件生态',
      pricing: '免费',
      source: 'github.com/ossprojecta (readme + releases)',
      source_trust: 0.8,
      last_verified: '2026-05-22',
    },
    {
      competitor_name: 'OSSProjectB',
      feature: '企业版 SSO + 审计日志导出',
      pricing: '¥1200/年',
      source: 'github.com/ossprojectb/releases (v2.4 release notes)',
      source_trust: 0.75,
      last_verified: '2026-05-08',
    },
  ],
};
