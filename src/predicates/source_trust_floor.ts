import type { Artifact, Violation } from '../predicates/types.js';

/**
 * sourceTrustFloor (P4.6 §1):source_trust 低于地板线触发违规。
 *
 * 两级门槛(贴合尽调"出处可信度"语义):
 *   - < 0.2 (hard):来源几乎不可信(匿名截图/无署名爬虫),该行不应进决策依据
 *   - < 0.4 (soft):来源偏弱(论坛/社交媒体),可用但需标注"待复核"
 *
 * 与 source_trust rubric(连续给分)互补:rubric 量化整体可信度,
 * 本约束是"地板线"——低于即不可接受,不参与评分直接违规。
 *
 * 适用于 table 族(情报表)。
 */
const HARD_FLOOR = 0.2;
const SOFT_FLOOR = 0.4;

export function sourceTrustFloor(artifact: Artifact): Violation[] {
  const violations: Violation[] = [];
  artifact.nodes.forEach((node, i) => {
    const t = node.source_trust;
    if (typeof t !== 'number' || Number.isNaN(t)) {
      // 缺 source_trust 字段:按 0 处理(无证据=0.0,见 rubric/types.ts 约定)
      violations.push({
        constraint_id: 'source_trust_floor',
        severity: 'hard',
        message: `row ${i} 缺 source_trust 字段(默认 0.0 < ${HARD_FLOOR} 硬地板)`,
        location: { node_index: i, field: 'source_trust' },
        fix_hint: '补充 source_trust 评分(官方源 0.8+ / 可信媒体 0.5+ / 匿名 0.2-)',
      });
      return;
    }
    if (t < HARD_FLOOR) {
      violations.push({
        constraint_id: 'source_trust_floor',
        severity: 'hard',
        message: `row ${i} source_trust=${t} < ${HARD_FLOOR} 硬地板(来源几乎不可信)`,
        location: { node_index: i, field: 'source_trust' },
        fix_hint: '替换为可信来源(官方文档/监管文件/权威媒体),否则该行不应入决策',
      });
    } else if (t < SOFT_FLOOR) {
      violations.push({
        constraint_id: 'source_trust_floor',
        severity: 'soft',
        message: `row ${i} source_trust=${t} < ${SOFT_FLOOR} 软地板(来源偏弱,待复核)`,
        location: { node_index: i, field: 'source_trust' },
        fix_hint: '标注"待复核"或补充更可信的佐证来源',
      });
    }
  });
  return violations;
}
