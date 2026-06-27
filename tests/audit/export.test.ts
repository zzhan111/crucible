import { describe, it, expect } from 'vitest';
import { exportAuditJson, exportAuditMarkdown } from '../../src/audit/export.js';
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
        { dim: 'routing', score: 0.6, mode: 'judge' as const, rationale: 'ok route' },
      ],
      violations: [
        { constraint_id: 'continuity', severity: 'hard' as const, message: 'gap at node 2', location: { node_index: 2 }, fix_hint: 'add transit' },
      ],
      hard_violation_count: 1,
      source_trust: 0.4,
    })),
  };
}

describe('P4.1 审计轨迹导出器', () => {
  describe('exportAuditJson', () => {
    it('可 JSON.parse 回环,结构完整', () => {
      const trail = makeTrail();
      const json = exportAuditJson(trail);
      const back = JSON.parse(json) as ArtifactAuditTrail;
      expect(back.artifact_hash).toBe('abc123def4560');
      expect(back.runs).toHaveLength(1);
      expect(back.runs[0].source_trust).toBe(0.4);
    });
    it('含 rubric_scores 与 violations', () => {
      const json = exportAuditJson(makeTrail());
      expect(json).toContain('rubric_scores');
      expect(json).toContain('violations');
      expect(json).toContain('continuity');
    });
  });

  describe('exportAuditMarkdown', () => {
    it('含标题 / artifact_hash / 契约版本', () => {
      const md = exportAuditMarkdown(makeTrail());
      expect(md).toContain('# 审计轨迹');
      expect(md).toContain('abc123def4560');
      expect(md).toContain('契约 v1');
    });
    it('source_trust 单独高亮(企业付费核心)', () => {
      const md = exportAuditMarkdown(makeTrail());
      expect(md).toContain('source_trust');
      expect(md).toContain('0.400');
    });
    it('含违规 constraint_id + 修复提示', () => {
      const md = exportAuditMarkdown(makeTrail());
      expect(md).toContain('continuity');
      expect(md).toContain('add transit');
    });
    it('含 rubric 维度表(deterministic / judge 标注来源)', () => {
      const md = exportAuditMarkdown(makeTrail());
      expect(md).toContain('cost_fit');
      expect(md).toContain('routing');
      expect(md).toContain('确定性');
      expect(md).toContain('LLM judge');
    });
    it('多次评分 → 多个小节(契约演化)', () => {
      const md = exportAuditMarkdown(makeTrail(3));
      expect(md).toContain('评分 #1');
      expect(md).toContain('评分 #2');
      expect(md).toContain('评分 #3');
      expect(md).toContain('v1');
      expect(md).toContain('v3');
    });
    it('含可辩驳性脚注(回溯链)', () => {
      const md = exportAuditMarkdown(makeTrail());
      expect(md).toContain('可辩驳性');
      expect(md).toContain('契约版本');
      expect(md).toContain('命中谓词');
    });
    it('pipe 字符被转义不破坏表格', () => {
      const trail: ArtifactAuditTrail = {
        artifact_hash: 'h',
        runs: [{
          contract_version: 1, family: 'sequence', scored_at: 't', det_score: 0.5, judge_score: null, final_score: 0.5,
          rubric_scores: [], violations: [{ constraint_id: 'x|y', severity: 'hard', message: 'a|b', location: {} }],
          hard_violation_count: 1, source_trust: null,
        }],
      };
      const md = exportAuditMarkdown(trail);
      // 转义后应是 \| 而非裸 |
      expect(md).toContain('x\\|y');
    });
  });
});
