import { describe, it, expect } from 'vitest';
import { runInSandbox, makeSandboxedPredicate, detectSandboxBackend } from '../../src/contract/sandbox.js';
import type { Artifact } from '../../src/predicates/types.js';

const sampleArtifact: Artifact = {
  family: 'sequence',
  nodes: [
    { action: 'a', cost: 100, duration_min: 60 },
    { action: 'b', cost: 200, duration_min: 30 },
  ],
};

describe('P2 §2.1 code_predicate 沙箱', () => {
  it('detectSandboxBackend 返回可用后端', () => {
    const backend = detectSandboxBackend();
    expect(backend).toMatch(/isolated-vm|vm/);
  });

  it('正例: 简单 check 函数返回 violations', () => {
    const impl = `
      function check(artifact) {
        const violations = [];
        if (artifact.nodes.length > 1) {
          violations.push({
            constraint_id: 'test_predicate',
            severity: 'hard',
            message: 'more than 1 node',
            location: { node_index: 0 }
          });
        }
        return violations;
      }
    `;
    const result = runInSandbox(impl, sampleArtifact);
    expect(result).toHaveLength(1);
    expect(result[0].constraint_id).toBe('test_predicate');
    expect(result[0].message).toBe('more than 1 node');
  });

  it('正例: 检查 cost 超阈值', () => {
    const impl = `
      function check(artifact) {
        const violations = [];
        for (let i = 0; i < artifact.nodes.length; i++) {
          if (artifact.nodes[i].cost > 150) {
            violations.push({
              constraint_id: 'cost_limit',
              severity: 'hard',
              message: 'node ' + i + ' cost too high: ' + artifact.nodes[i].cost,
              location: { node_index: i, field: 'cost' }
            });
          }
        }
        return violations;
      }
    `;
    const result = runInSandbox(impl, sampleArtifact);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('200');
  });

  it('无 check 函数 → 返回空数组(不 crash)', () => {
    const impl = `const x = 1;`;
    const result = runInSandbox(impl, sampleArtifact);
    expect(result).toEqual([]);
  });

  it('恶意代码: require fs 被拦截(返回空数组)', () => {
    const impl = `
      function check(artifact) {
        const fs = require('fs');
        fs.writeFileSync('/tmp/pwned', 'hacked');
        return [];
      }
    `;
    const result = runInSandbox(impl, sampleArtifact);
    // require 不可用 → 抛错 → 沙箱捕获 → 返回空
    expect(result).toEqual([]);
  });

  it('恶意代码: while(true) 超时被拦截', () => {
    const impl = `
      function check(artifact) {
        while (true) { /* 死循环 */ }
        return [];
      }
    `;
    const result = runInSandbox(impl, sampleArtifact);
    // 超时 → 抛错 → 沙箱捕获 → 返回空
    expect(result).toEqual([]);
  });

  it('makeSandboxedPredicate 返回可调用的 Predicate', () => {
    const impl = `
      function check(artifact) {
        return [{
          constraint_id: 'sandboxed',
          severity: 'hard',
          message: 'from sandbox',
          location: { node_index: 0 }
        }];
      }
    `;
    const predicate = makeSandboxedPredicate(impl);
    const result = predicate(sampleArtifact);
    expect(result).toHaveLength(1);
    expect(result[0].constraint_id).toBe('sandboxed');
  });

  it('语法错误的 impl → 返回空数组(不 crash)', () => {
    const impl = `function check( { syntax error`;
    const result = runInSandbox(impl, sampleArtifact);
    expect(result).toEqual([]);
  });

  it('返回非数组 → 返回空数组', () => {
    const impl = `function check(artifact) { return "not an array"; }`;
    const result = runInSandbox(impl, sampleArtifact);
    expect(result).toEqual([]);
  });
});
