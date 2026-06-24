import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpansionProposal } from '../agents/curator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * writeProposal: 把 Curator 的扩张提议写到 contracts/proposals/ + git commit。
 * 验收 4.4:契约版本化(每次 Curator 提议产生 commit)。
 * 降级:git commit 失败时只写文件(spec §8)。
 *
 * 安全(eng-review C1):用 execFileSync + 参数数组,不用 execSync 拼字符串,
 * 避免 artifactId / proposal.dim 含特殊字符时的 shell 注入风险。
 */
export function writeProposal(proposal: ExpansionProposal, artifactId: string): string {
  const proposalsDir = join(__dirname, '..', '..', 'contracts', 'proposals');
  mkdirSync(proposalsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${artifactId}-${proposal.dim}.yaml`;
  const filepath = join(proposalsDir, filename);

  const yamlContent = `# Curator expansion proposal (auto-generated)
# Artifact: ${artifactId}
# Dimension: ${proposal.dim}
# Timestamp: ${timestamp}
dim: ${proposal.dim}
tokens:
${proposal.tokens.map(t => `  - ${t}`).join('\n')}
rationale: ${JSON.stringify(proposal.rationale)}
proposed_constraint: ${proposal.proposed_constraint ? JSON.stringify(proposal.proposed_constraint) : 'null'}
`;

  writeFileSync(filepath, yamlContent, 'utf8');

  // 尝试 git add + commit(失败降级)。用 execFileSync + 参数数组,无 shell 注入。
  const repoRoot = join(__dirname, '..', '..');
  const commitMsg = `chore(contract): curator proposal ${proposal.dim} for ${artifactId}`;
  try {
    execFileSync('git', ['add', filepath], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: repoRoot, stdio: 'pipe' });
    console.log(`[Curator] proposal committed: ${filename}`);
  } catch (err) {
    console.warn(`[Curator] git commit failed (file written): ${err instanceof Error ? err.message : String(err)}`);
  }

  return filepath;
}
