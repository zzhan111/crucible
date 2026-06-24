import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CONTRACT = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('loadContract', () => {
  it('loads and validates travel-sequence-v1.yaml', () => {
    const contract = loadContract(FIXTURE_CONTRACT);
    expect(contract.artifact_family).toBe('sequence');
    expect(contract.fields).toHaveLength(10);
    expect(contract.hard_constraints).toHaveLength(4);
    expect(contract.rubric).toHaveLength(5);
    expect(contract.hard_constraints.find(c => c.id === 'state_mutex')?.type).toBe('declarative');
  });

  it('throws on malformed YAML', () => {
    const tmpPath = join(__dirname, 'tmp-malformed.yaml');
    writeFileSync(tmpPath, 'artifact_family: [unclosed');
    expect(() => loadContract(tmpPath)).toThrow();
    unlinkSync(tmpPath);
  });

  it('throws on schema-invalid contract', () => {
    const tmpPath = join(__dirname, 'tmp-bad.yaml');
    writeFileSync(tmpPath, 'artifact_family: bogus\nfields: []\n');
    expect(() => loadContract(tmpPath)).toThrow();
    unlinkSync(tmpPath);
  });
});

// 引用 readFileSync 避免未使用 import 警告(测试中用 __dirname 推导路径)
void readFileSync;
