import type { Artifact, Violation } from '../predicates/types.js';

/**
 * unitConsistency (P4.6 §1):pricing 单位必须可归一化,否则 soft 违规。
 *
 * 监测场景下竞品定价常混用 ¥/月、¥/年、$/mo、免费、按量 等单位,
 * 无法横向比较的定价 = 无效情报。本约束标记"单位不可归一化"的行。
 *
 * 接受的归一化单位(任一匹配即合规):
 *   - 月费:¥/月、$XX/mo、/month、/月
 *   - 年费:¥/年、/year、/年、/yr
 *   - 免费:"免费" / "free"
 *   - 按量:含"按量"/"usage"/"per call"/"按次"
 *   - 一次性:含"一次性"/"one-time"
 *
 * 不含上述任一(且 pricing_format 已通过 = 有数字)→ soft 违规。
 * 注意:pricing_format (hard) 已保证有数字或"免费";本约束在此基础上
 * 检查"数字是否带可比较单位"。
 *
 * 适用于 table 族(情报表)。
 */
const UNIT_PATTERNS = [
  /[¥$￥]\s*\d/,          // ¥299 / $49 / ￥100 (带货币符)
  /\d[\d,]*\s*[./]?\s*(月|mo|month|年|yr|year)/i, // 299/月 / 49/mo / 1000/年
  /免费|free/i,           // 免费
  /按量|usage|per\s*call|按次/i, // 按量计费
  /一次性|one-?time/i,    // 一次性买断
];

export function unitConsistency(artifact: Artifact): Violation[] {
  const violations: Violation[] = [];
  artifact.nodes.forEach((node, i) => {
    const pricing = node.pricing;
    if (pricing === undefined || pricing === null) return; // missing 交给 pricing_format
    const p = String(pricing).trim();
    if (p === '') return;
    // pricing_format 已拦截"未知/n/a/无";这里若已是无效词也跳过(避免重复报)
    if (/^未知|n\/?a|无$/i.test(p)) return;

    const hasKnownUnit = UNIT_PATTERNS.some(re => re.test(p));
    if (!hasKnownUnit) {
      violations.push({
        constraint_id: 'unit_consistency',
        severity: 'soft',
        message: `row ${i} pricing="${p}" 单位不可归一化(无法横向比较月费/年费/按量)`,
        location: { node_index: i, field: 'pricing' },
        fix_hint: '标注计费单位:¥/月 或 $XX/mo 或 /年 或 "免费" 或 "按量"',
      });
    }
  });
  return violations;
}
