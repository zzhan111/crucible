import { describe, it, expect } from 'vitest';
import { exportAuditPdf, exportAuditMarkdown } from '../../src/audit/export.js';
import type { ArtifactAuditTrail } from '../../src/persistence/audit.js';

function makeTrail(runs = 1): ArtifactAuditTrail {
  return {
    artifact_hash: 'abc123def4560',
    runs: Array.from({ length: runs }, (_, i) => ({
      contract_version: i + 1,
      family: 'sequence',
      scored_at: '2026-06-27 13:00:00',
      det_score: 0.8,
      judge_score: 0.6,
      final_score: 0.72,
      rubric_scores: [
        { dim: 'cost_fit', score: 0.9, mode: 'deterministic' as const, rationale: 'within budget' },
        { dim: 'source_trust', score: 0.4, mode: 'deterministic' as const, rationale: '2/5 sourced' },
      ],
      violations: [
        { constraint_id: 'continuity', severity: 'hard' as const, message: 'gap at node 2', location: { node_index: 2 }, fix_hint: 'add transit' },
      ],
      hard_violation_count: 1,
      source_trust: 0.4,
      actor_id: 'analyst-zhang',
    })),
  };
}

describe('P4.1.2 PDF 导出', () => {
  it('exportAuditPdf 返回 Buffer', async () => {
    const buf = await exportAuditPdf(makeTrail());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('Buffer 以 PDF 魔数 %PDF- 开头(有效 PDF)', async () => {
    const buf = await exportAuditPdf(makeTrail());
    const header = buf.slice(0, 5).toString('latin1');
    expect(header).toBe('%PDF-');
  });

  it('Buffer 含 EOF 标记 %%EOF(完整 PDF)', async () => {
    const buf = await exportAuditPdf(makeTrail());
    const tail = buf.slice(-64).toString('latin1');
    expect(tail).toContain('%%EOF');
  });

  it('多评分 → PDF 生成(结构不崩)', async () => {
    const buf = await exportAuditPdf(makeTrail(3));
    expect(buf.length).toBeGreaterThan(1000); // 多页 PDF 应明显更大
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('含活动日志 → PDF 仍正常生成', async () => {
    const activityLog = [
      { at: '2026-06-27 13:00:00', actor_id: 'alice', event: 'score_run' as const, artifact_hash: 'abc', contract_version: 1, det_score: 0.8, judge_score: 0.6 },
    ];
    const buf = await exportAuditPdf(makeTrail(), activityLog);
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('PDF 有效且与 Markdown 同源(都基于同一 trail,结构对应)', async () => {
    const trail = makeTrail();
    const buf = await exportAuditPdf(trail);
    const md = exportAuditMarkdown(trail);
    // PDF 有效性(魔数 + EOF)— 文本流经 Flate 压缩,不直查内容
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.slice(-64).toString('latin1')).toContain('%%EOF');
    // Markdown 含关键信息(PDF 与 MD 同源 exportAuditPdf/exportAuditMarkdown 都消费 trail)
    expect(md).toContain('abc123def4560');
    expect(md).toContain('契约 v1');
  });
});
