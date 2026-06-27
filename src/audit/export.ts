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
import type { ActivityLogEntry } from '../persistence/repositories.js';

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
  out.push(`- **操作者 (actor)**: \`${run.actor_id ?? 'system'}\`  `);
  out.push(`  _P4.2 RBAC:谁触发这次评分。完整 RBAC 下此字段绑定到 users 表 + 角色权限_`);
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
 * 结构:头部摘要 → 每次评分一小节 → 活动日志(actor 维度)→ 可辩驳性脚注 → RBAC 演进展望。
 *
 * @param activityLog 可选:全量活动日志(谁在何时做了什么)。传入则渲染"活动日志"小节。
 */
export function exportAuditMarkdown(
  trail: ArtifactAuditTrail,
  activityLog: ActivityLogEntry[] = []
): string {
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
  out.push(`- **操作者**: ${trail.runs.map(r => r.actor_id ?? 'system').filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'}`);
  out.push('');
  out.push('---');
  out.push('');
  trail.runs.forEach((run, i) => {
    out.push(renderRun(run, i));
    out.push('');
  });

  // 活动日志(actor 维度)— 让 ToB demo 对象看到"谁在何时做了什么"
  if (activityLog.length > 0) {
    out.push('---');
    out.push('');
    out.push(renderActivityLog(activityLog));
  }

  out.push('---');
  out.push('');
  out.push('## 可辩驳性');
  out.push('');
  out.push('每条分数可回溯到:');
  out.push('- **契约版本**:评分所用 Contract 的 `metadata.version`(见各小节标题)');
  out.push('- **Rubric 维度**:各维度的打分与模式(deterministic / judge)见维度明细表');
  out.push('- **命中谓词**:触发的硬约束 violation 见违规清单(constraint_id 定位到具体约束)');
  out.push('- **来源可信度**:source_trust 维度分独立列出,无来源工件记 0.0(无证据=0 约定)');
  out.push('- **操作者 (P4.2)**:每条评分带 actor_id,可追溯"谁触发的评分"');
  out.push('');
  // 🔒 RBAC 演进展望框 — 用户重点:让 demo 对象一眼看到落地路径与场景
  out.push('---');
  out.push('');
  out.push('## 🔒 RBAC 演进展望(ToB on-prem)');
  out.push('');
  out.push('> **当前(P4.2 轻量 actor)**:操作者 `actor_id` 是外部传入的字符串标识,');
  out.push('> 契约变更审批已受 `approve:contract` 权限保护(仅 `admin` / `approver` 角色可批)。');
  out.push('> 审计报告已能回答"谁在何时评分/审批了哪个工件"。');
  out.push('>');
  out.push('> **演进到完整 RBAC(P4.2.5)**:加 `users` 表 + 会话 token + 密码哈希,');
  out.push('> 4 角色权限矩阵(admin / author / approver / viewer)落地为强制检查:');
  out.push('> - `approver` 角色独占契约审批权(合规/法务)');
  out.push('> - `author` 角色可评分 + 跑 workflow 但不能改契约(数据工程师)');
  out.push('> - `viewer` 角色只读审计轨迹(审计员 / 监管对接)');
  out.push('> - `admin` 全权(运维)');
  out.push('>');
  out.push('> **企业场景**:某保险公司 on-prem 部署 — 精算师(author)跑报价契约评分,');
  out.push('> 合规官(approver)审批契约版本升级,审计员(viewer)导出季度审计轨迹交监管。');
  out.push('> 引擎 AGPL 开源,客户的报价契约私有 — 即 PRD §5 "引擎开源 / 契约私有"分层。');
  out.push('');
  return out.join('\n');
}

/** 渲染活动日志小节:时间线"谁 在何时 做了什么(评分/提议/审批)"。 */
function renderActivityLog(entries: ActivityLogEntry[]): string {
  const out: string[] = [];
  out.push('## 活动日志(actor 维度)');
  out.push('');
  out.push('> "谁在何时对哪个工件做了什么" — 企业审计的核心追溯链。');
  out.push('');
  out.push('| 时间 | 操作者 | 事件 | 工件 | 契约 | 详情 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of entries) {
    const detail = e.event === 'score_run'
      ? `det=${e.det_score?.toFixed(3) ?? '—'} judge=${e.judge_score?.toFixed(3) ?? '—'}`
      : `dim=${e.dim ?? '—'} gate=${e.gate_decision ?? '—'}${e.approver_id ? ` by ${e.approver_id}` : ''}`;
    out.push(
      `| ${e.at} | ${e.actor_id ?? '—'} | ${e.event} | ${e.artifact_hash} | v${e.contract_version} | ${escapeMd(detail)} |`
    );
  }
  out.push('');
  return out.join('\n');
}
