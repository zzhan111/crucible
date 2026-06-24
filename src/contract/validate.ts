import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ContractSchema, type Contract } from './schema.js';

export function loadContract(path: string): Contract {
  const text = readFileSync(path, 'utf8');
  const raw = parseYaml(text);
  return ContractSchema.parse(raw);
}

// 注:parseContractYaml(从字符串解析)在 P0 未使用,留 Part 2 Contract-Author Agent 用。
// 不导出 dead code,Part 2 需要时再加(outside-voice #25)。
