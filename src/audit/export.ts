/**
 * P4.1 — 审计轨迹导出器(JSON + Markdown)。
 *
 * 接收 ArtifactAuditTrail,产出两种格式:
 * - JSON:机器可读,含完整 rubric_scores / violations,可回灌校验。
 * - Markdown:人读,面向"向监管/上级交代"(PRD §6)——每条分数能回溯到
 *   契约版本 + rubric 维度 + 命中谓词,source_trust 单独高亮。
 *
 * 风格抄 demo-html.ts 的 generateHtml(data):string 自包含渲染 + audit-golden-set.ts
 * 的字符串拼接(.padEnd / .toFixed),零新依赖。
 *
 * spec ref: PRD v1.2 §6 审计轨迹(出处+分数=可辩护)
 */
import type { ArtifactAuditTrail, AuditRun } from '../persistence/audit.js';

/** JSON 导出:pretty-printed,可直接 JSON.parse 回环。 */
export function exportAuditJson(trail: ArtifactAuditTrail): string {
  return JSON.stringify(trail, null, 2);
}

/** 转义 Markdown 表格里的 pipe 与反引号,避免破坏表格结构。 */
function escapeMd(s: unknown): string {
  return String(s).replace(/[|`]/g, c => '\\' + c);
}

function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(3);
}

function renderRubricTable(run: AuditRun): string {
  if (run.rubric_scores.length === 0) return '_无 rubric 维度_\n';
  const lines = ['| 维度 | 分数 | 模式 | 来源 |', '| --- | --- | --- | --- |'];
  for (const r of run.rubric_scores) {
    lines.push(
      `| ${escapeMd(r.dim)} | ${fmtScore(r.score)} | ${escapeMd(r.mode)} | ${r.mode === 'deterministic' ? '确定性' : 'LLM judge'} |`
    );
  }
  return lines.join('\n') + '\n';
}

function renderViolations(run: AuditRun): string {
  if (run.violations.length === 0) return '_无违规_\n';
  const lines = [
    '| 约束 | 严重度 | 说明 | 修复提示 |',
    '| --- | --- | --- | --- |',
  ];
  for (const v of run.violations) {
    lines.push(
      `| ${escapeMd(v.constraint_id)} | ${escapeMd(v.severity)} | ${escapeMd(v.message)} | ${escapeMd(v.fix_hint ?? '—')} |`
    );
  }
  return lines.join('\n') + '\n';
}

function renderRun(run: AuditRun, idx: number): string {
  const out: string[] = [];
  out.push(`## 评分 #${idx + 1} — 契约 v${run.contract_version} (${escapeMd(run.family)})`);
  out.push('');
  out.push(`- **时间**: ${run.scored_at}`);
  out.push(`- **确定性分 (det_score)**: ${fmtScore(run.det_score)}`);
  out.push(`- **判官分 (judge_score)**: ${fmtScore(run.judge_score)}`);
  out.push(`- **最终分 (final_score)**: ${fmtScore(run.final_score)}  `);
  out.push(`  _= det_score × 0.6 + judge_score × 0.4(无 judge 时 final = det)_`);
  out.push(`- **硬违规数**: ${run.hard_violation_count}`);
  out.push('');
  // source_trust 单独高亮:企业付费核心(出处可信度)
  out.push(`> **来源可信度 (source_trust)**: ${fmtScore(run.source_trust)}  `);
  out.push(`> _PRD §6:出处 + 分数 = 审计轨迹,企业可向监管辩驳_`);
  out.push('');
  out.push('### Rubric 维度明细');
  out.push('');
  out.push(renderRubricTable(run));
  out.push('### 命中谓词 / 违规清单');
  out.push('');
  out.push(renderViolations(run));
  return out.join('\n');
}

/**
 * Markdown 导出:工件为中心的审计报告。
 * 结构:头部摘要 → 每次评分一小节 → 可辩驳性脚注。
 */
export function exportAuditMarkdown(trail: ArtifactAuditTrail): string {
  const out: string[] = [];
  const times = trail.runs.map(r => r.scored_at).sort();
  out.push(`# 审计轨迹 — 工件 ${trail.artifact_hash}`);
  out.push('');
  out.push(`> PRD v1.2 §6 审计轨迹:出处 + 分数 = 可向监管/上级交代的可辩驳记录。`);
  out.push('');
  out.push('## 摘要');
  out.push('');
  out.push(`- **工件 hash**: \`${trail.artifact_hash}\``);
  out.push(`- **评分次数**: ${trail.runs.length}`);
  out.push(`- **时间范围**: ${times[0] ?? '—'} ~ ${times[times.length - 1] ?? '—'}`);
  out.push(`- **涉及契约版本**: ${trail.runs.map(r => 'v' + r.contract_version).join(', ') || '—'}`);
  out.push('');
  out.push('---');
  out.push('');
  trail.runs.forEach((run, i) => {
    out.push(renderRun(run, i));
    out.push('');
  });
  out.push('---');
  out.push('');
  out.push('## 可辩驳性');
  out.push('');
  out.push('每条分数可回溯到:');
  out.push('- **契约版本**:评分所用 Contract 的 `metadata.version`(见各小节标题)');
  out.push('- **Rubric 维度**:各维度的打分与模式(deterministic / judge)见维度明细表');
  out.push('- **命中谓词**:触发的硬约束 violation 见违规清单(constraint_id 定位到具体约束)');
  out.push('- **来源可信度**:source_trust 维度分独立列出,无来源工件记 0.0(无证据=0 约定)');
  out.push('');
  return out.join('\n');
}
