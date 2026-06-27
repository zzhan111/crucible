#!/usr/bin/env node
/**
 * P4.1 §6 — 审计轨迹导出脚本(工件为中心)。
 *
 * 把某工件的评分历史从 SQLite 导出成 JSON + Markdown 审计报告。
 * 前提:先用 `CRUCIBLE_DB_PATH=./crucible-audit.db npm start` 跑过 workflow 落库。
 *
 * 用法:
 *   CRUCIBLE_DB_PATH=./crucible-audit.db npx tsx scripts/audit-trail-export.ts --artifact <工件.json>
 *   # 或指定输出目录:
 *   npx tsx scripts/audit-trail-export.ts --artifact hk-buggy.json --out docs/audit/
 *
 * 参数:
 *   --artifact <path>   工件 JSON 文件路径(必填)
 *   --out <dir>         输出目录(默认 docs/audit/)
 *
 * 产出:
 *   <out>/audit-<artifact_hash>-<date>.json
 *   <out>/audit-<artifact_hash>-<date>.md
 *
 * 退出码:
 *   0 — 成功,或该工件无评分记录(非错误,可能没跑过 workflow)
 *   1 — 参数/环境错误
 *
 * spec ref: PRD v1.2 §6 审计轨迹;P4.1 §6
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openAndMigrate } from '../src/persistence/db.js';
import { getArtifactAuditTrail } from '../src/persistence/audit.js';
import { exportAuditJson, exportAuditMarkdown } from '../src/audit/export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function main(): void {
  const { values } = parseArgs({
    options: {
      artifact: { type: 'string' },
      out: { type: 'string', default: 'docs/audit' },
    },
    strict: true,
  });

  if (!values.artifact) {
    console.error('错误: 缺少 --artifact <工件.json>');
    console.error('用法: npx tsx scripts/audit-trail-export.ts --artifact <工件.json> [--out docs/audit]');
    process.exit(1);
  }

  const dbPath = process.env.CRUCIBLE_DB_PATH;
  if (!dbPath) {
    console.error('错误: CRUCIBLE_DB_PATH 未设置。审计轨迹需要先落库:');
    console.error('  先跑: CRUCIBLE_DB_PATH=./crucible-audit.db npm start');
    console.error('  再导: CRUCIBLE_DB_PATH=./crucible-audit.db npx tsx scripts/audit-trail-export.ts --artifact <工件.json>');
    process.exit(1);
  }

  const artifactPath = resolve(ROOT, values.artifact);
  if (!existsSync(artifactPath)) {
    console.error(`错误: 工件文件不存在: ${artifactPath}`);
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

  const db = openAndMigrate(dbPath);
  const trail = getArtifactAuditTrail(db, artifact);
  db.close();

  if (!trail) {
    console.log(`该工件无评分记录(artifact_hash 未在 ${dbPath} 中找到)。`);
    console.log('可能原因:还没跑过 workflow,或工件 JSON 与评分时不一致(影响 hash)。');
    process.exit(0); // 非错误
  }

  const outDir = resolve(ROOT, values.out!);
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const base = `audit-${trail.artifact_hash}-${date}`;
  const jsonPath = join(outDir, `${base}.json`);
  const mdPath = join(outDir, `${base}.md`);

  writeFileSync(jsonPath, exportAuditJson(trail), 'utf8');
  writeFileSync(mdPath, exportAuditMarkdown(trail), 'utf8');

  console.log('=== 审计轨迹导出完成 ===');
  console.log(`工件 hash:    ${trail.artifact_hash}`);
  console.log(`评分次数:     ${trail.runs.length}`);
  console.log(`契约版本:     ${trail.runs.map(r => 'v' + r.contract_version).join(', ')}`);
  console.log(`JSON 报告:    ${jsonPath}`);
  console.log(`Markdown 报告: ${mdPath}`);
}

main();
