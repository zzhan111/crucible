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
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';

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
  out.push('> **当前(P4.2 轻量 actor + P4.2.5 可插拔 IdP)**:操作者 `actor_id` 可从会话 token 解析');
  out.push('> (users + sessions 表 + `IdentityProvider` 接口已交付)。契约变更审批已受 `approve:contract` 权限保护');
  out.push('(仅 `admin` / `approver` 角色可批)。**凭证委托 IdP** — Crucible 不存密码(on-prem 企业用 SSO/LDAP)。');
  out.push('>');
  out.push('> **4 角色权限矩阵(admin / author / approver / viewer)落地为强制检查:**');
  out.push('> - `approver` 角色独占契约审批权(合规/法务)');
  out.push('> - `author` 角色可评分 + 跑 workflow 但不能改契约(数据工程师)');
  out.push('> - `viewer` 角色只读审计轨迹(审计员 / 监管对接)');
  out.push('> - `admin` 全权(运维)');
  out.push('>');
  out.push('> **未来扩展**:生产 `LdapProvider` / `SamlProvider` 实现 `IdentityProvider` 接口,');
  out.push('> token 由企业 IdP 颁发;Crucible 仅校验 + 取角色,不碰凭证。');
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

// ───────────────────── P4.1.2 PDF 导出 ─────────────────────

/**
 * 解析 CJK 字体路径(报告是 CJK 重度,必须嵌入 TTF/TTC 才能正常显示中文)。
 * 优先级:CRUCIBLE_CJK_FONT env → 常见 Windows 字体 → null(回退 Helvetica,中文变方块但 PDF 仍生成)。
 */
function resolveCjkFont(): string | null {
  const env = process.env.CRUCIBLE_CJK_FONT;
  if (env && existsSync(env)) return env;
  const candidates = [
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\simsun.ttc',
    '/c/Windows/Fonts/simhei.ttf',
    '/c/Windows/Fonts/msyh.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/PingFang.ttc',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * PDF 导出:镜像 exportAuditMarkdown 的 8 段结构(摘要→每评分→活动日志→可辩驳性→RBAC 展望框)。
 * 用 pdfkit 的 text/moveDown/addPage API。返回 PDF Buffer。
 *
 * CJK 字体:找到则嵌入(中文正常);找不到则回退默认字体(中文变方块,console.warn 提示,
 * PDF 仍生成 — 不因字体缺失阻断审计导出)。
 */
export function exportAuditPdf(
  trail: ArtifactAuditTrail,
  activityLog: ActivityLogEntry[] = []
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // CJK 字体嵌入
    const fontPath = resolveCjkFont();
    const fontName = 'cjk';
    if (fontPath) {
      try {
        doc.registerFont(fontName, fontPath);
        doc.font(fontName);
      } catch {
        console.warn(`[audit:pdf] CJK 字体注册失败(${fontPath}),回退默认字体(中文可能变方块)`);
      }
    } else {
      console.warn('[audit:pdf] 未找到 CJK 字体,中文将变方块。设 CRUCIBLE_CJK_FONT=<ttf/ttc 路径> 修复。');
    }

    const times = trail.runs.map(r => r.scored_at).sort();
    // 1. 标题
    doc.fontSize(18).text(`审计轨迹 — 工件 ${trail.artifact_hash}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('gray').text('PRD v1.2 §6 审计轨迹:出处 + 分数 = 可向监管/上级交代的可辩驳记录。', { align: 'center' });
    doc.fillColor('black').moveDown();

    // 2. 摘要
    doc.fontSize(14).text('摘要');
    doc.fontSize(10);
    doc.text(`工件 hash: ${trail.artifact_hash}`);
    doc.text(`评分次数: ${trail.runs.length}`);
    doc.text(`时间范围: ${times[0] ?? '—'} ~ ${times[times.length - 1] ?? '—'}`);
    doc.text(`涉及契约版本: ${trail.runs.map(r => 'v' + r.contract_version).join(', ') || '—'}`);
    doc.text(`操作者: ${trail.runs.map(r => r.actor_id ?? 'system').filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'}`);
    doc.moveDown();

    // 3. 每次评分
    trail.runs.forEach((run, i) => {
      doc.addPage();
      doc.fontSize(14).text(`评分 #${i + 1} — 契约 v${run.contract_version} (${run.family})`);
      doc.fontSize(10).moveDown(0.3);
      doc.text(`时间: ${run.scored_at}`);
      doc.text(`确定性分 (det_score): ${fmtScore(run.det_score)}`);
      doc.text(`判官分 (judge_score): ${fmtScore(run.judge_score)}`);
      doc.text(`最终分 (final_score): ${fmtScore(run.final_score)}  (= det × 0.6 + judge × 0.4)`);
      doc.text(`硬违规数: ${run.hard_violation_count}`);
      doc.text(`操作者 (actor): ${run.actor_id ?? 'system'}`);
      doc.moveDown(0.3);
      doc.fillColor('blue').text(`来源可信度 (source_trust): ${fmtScore(run.source_trust)}  (PRD §6 企业付费核心)`);
      doc.fillColor('black').moveDown();

      // Rubric 维度表
      doc.fontSize(12).text('Rubric 维度明细');
      doc.fontSize(9).moveDown(0.2);
      doc.text('维度'.padEnd(20) + '分数'.padEnd(10) + '模式'.padEnd(16) + '来源');
      for (const r of run.rubric_scores) {
        doc.text(`${r.dim}`.padEnd(20) + `${fmtScore(r.score)}`.padEnd(10) + `${r.mode}`.padEnd(16) + (r.mode === 'deterministic' ? '确定性' : 'LLM judge'));
      }
      doc.moveDown();

      // 违规清单
      doc.fontSize(12).text('命中谓词 / 违规清单');
      doc.fontSize(9).moveDown(0.2);
      if (run.violations.length === 0) {
        doc.text('无违规');
      } else {
        doc.text('约束'.padEnd(24) + '严重度'.padEnd(10) + '说明');
        for (const v of run.violations) {
          doc.text(`${v.constraint_id}`.padEnd(24) + `${v.severity}`.padEnd(10) + `${v.message}` + (v.fix_hint ? ` (修复: ${v.fix_hint})` : ''));
        }
      }
      doc.moveDown();
    });

    // 4. 活动日志
    if (activityLog.length > 0) {
      doc.addPage();
      doc.fontSize(14).text('活动日志(actor 维度)');
      doc.fontSize(9).moveDown(0.3);
      doc.text('"谁在何时对哪个工件做了什么" — 企业审计的核心追溯链。');
      doc.moveDown(0.3);
      doc.text('时间'.padEnd(22) + '操作者'.padEnd(18) + '事件'.padEnd(14) + '契约'.padEnd(8) + '详情');
      for (const e of activityLog) {
        const detail = e.event === 'score_run'
          ? `det=${e.det_score?.toFixed(3) ?? '—'} judge=${e.judge_score?.toFixed(3) ?? '—'}`
          : `dim=${e.dim ?? '—'} gate=${e.gate_decision ?? '—'}`;
        doc.text(`${e.at}`.padEnd(22) + `${e.actor_id ?? '—'}`.padEnd(18) + `${e.event}`.padEnd(14) + `v${e.contract_version}`.padEnd(8) + detail);
      }
      doc.moveDown();
    }

    // 5. 可辩驳性
    doc.addPage();
    doc.fontSize(14).text('可辩驳性');
    doc.fontSize(10).moveDown(0.3);
    doc.text('每条分数可回溯到:');
    doc.text('• 契约版本:评分所用 Contract 的 metadata.version(见各小节标题)');
    doc.text('• Rubric 维度:各维度的打分与模式(deterministic / judge)见维度明细表');
    doc.text('• 命中谓词:触发的硬约束 violation 见违规清单(constraint_id 定位到具体约束)');
    doc.text('• 来源可信度:source_trust 维度分独立列出,无来源工件记 0.0');
    doc.text('• 操作者 (P4.2):每条评分带 actor_id,可追溯"谁触发的评分"');
    doc.moveDown();

    // 6. RBAC 演进展望框
    doc.fontSize(14).fillColor('blue').text('🔒 RBAC 演进展望(ToB on-prem)');
    doc.fillColor('black').fontSize(9).moveDown(0.3);
    doc.text('当前(P4.2 轻量 actor + P4.2.5 可插拔 IdP):操作者 actor_id 可从会话 token 解析(users + sessions 表 + IdentityProvider 接口已交付)。契约变更审批已受 approve:contract 权限保护(仅 admin / approver 角色可批)。凭证委托 IdP — Crucible 不存密码(on-prem 企业用 SSO/LDAP)。');
    doc.moveDown(0.2);
    doc.text('4 角色权限矩阵(admin/author/approver/viewer)落地为强制检查:');
    doc.text('  - approver 角色独占契约审批权(合规/法务)');
    doc.text('  - author 角色可评分 + 跑 workflow 但不能改契约(数据工程师)');
    doc.text('  - viewer 角色只读审计轨迹(审计员 / 监管对接)');
    doc.text('  - admin 全权(运维)');
    doc.moveDown(0.2);
    doc.text('企业场景:某保险公司 on-prem 部署 — 精算师(author)跑报价契约评分,合规官(approver)审批契约版本升级,审计员(viewer)导出季度审计轨迹交监管。引擎 AGPL 开源,客户的报价契约私有 — 即 PRD §5 "引擎开源 / 契约私有"分层。');

    doc.end();
  });
}
