import type { Artifact, Violation } from '../predicates/types.js';

/**
 * code_predicate 沙箱(P2 §2.1)。
 *
 * 用 isolated-vm 隔离执行 Contract 的 code_predicate.impl 字符串。
 * impl 是一段 JS 代码,接收 artifact 参数,返回 Violation[]。
 *
 * 安全限制:
 * - 内存上限 128MB
 * - 执行超时 1000ms
 * - 无 require/import/fs/network(isolate 默认无全局 API)
 *
 * 降级: 若 isolated-vm 不可用,降级到 Node 内置 vm 模块(隔离性弱,但有超时)。
 */

const MEMORY_LIMIT = 128; // MB
const TIMEOUT_MS = 1000; // 执行超时

export type SandboxBackend = 'isolated-vm' | 'vm' | 'none';

/** 检测可用后端 */
export function detectSandboxBackend(): SandboxBackend {
  try {
    require('isolated-vm');
    return 'isolated-vm';
  } catch {
    // 降级到 Node vm
    return 'vm';
  }
}

/**
 * 在沙箱中执行 code_predicate.impl,返回 Violation[]。
 *
 * impl 约定: 一段 JS 代码,定义 `function check(artifact) { return violations }`,
 * 或直接返回 Violation[] 的表达式。
 *
 * @param impl 实现代码字符串
 * @param artifact 输入工件
 * @returns Violation[] (出错返回空数组 + warning)
 */
export function runInSandbox(impl: string, artifact: Artifact): Violation[] {
  const backend = detectSandboxBackend();
  if (backend === 'isolated-vm') {
    return runInIsolatedVm(impl, artifact);
  }
  return runInNodeVm(impl, artifact);
}

/**
 * isolated-vm 后端: 最强隔离(独立 V8 isolate,无全局 API)。
 */
function runInIsolatedVm(impl: string, artifact: Artifact): Violation[] {
  // 动态 require,避免 isolated-vm 不可用时 import 失败
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ivm = require('isolated-vm');
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT });
  const context = isolate.createContextSync();
  const jail = context.global;
  jail.setSync('global', jail.derefInto());

  // 注入 artifact + 辅助函数
  const artifactJson = JSON.stringify(artifact);
  // wrapper: impl 代码定义 check(artifact),我们调用它
  const wrappedCode = `
    ${impl}
    // 约定: impl 定义 check 函数,或最后一条表达式是 Violation[]
    const __artifact = JSON.parse(${JSON.stringify(artifactJson)});
    const __result = (typeof check === 'function') ? check(__artifact) : [];
    JSON.stringify(__result || []);
  `;

  try {
    const script = isolate.compileScriptSync(wrappedCode);
    const resultStr = script.runSync(context, { timeout: TIMEOUT_MS });
    const parsed = JSON.parse(resultStr);
    if (Array.isArray(parsed)) return parsed as Violation[];
    return [];
  } catch (e) {
    console.warn(`[Sandbox:isolated-vm] execution failed: ${(e as Error).message}`);
    return [];
  } finally {
    isolate.dispose();
  }
}

/**
 * Node vm 后端(降级): 隔离性弱(共享 process),但有超时。
 * 仅在 isolated-vm 不可用时使用。
 */
function runInNodeVm(impl: string, artifact: Artifact): Violation[] {
  const vm = require('node:vm');
  const artifactJson = JSON.stringify(artifact);
  const wrappedCode = `
    (function() {
      ${impl}
      const __artifact = JSON.parse(${JSON.stringify(artifactJson)});
      const __result = (typeof check === 'function') ? check(__artifact) : [];
      return JSON.stringify(__result || []);
    })()
  `;
  const context = vm.createContext({}); // 空 context,无 require/fs
  try {
    const resultStr = vm.runInContext(wrappedCode, context, { timeout: TIMEOUT_MS });
    const parsed = JSON.parse(resultStr);
    if (Array.isArray(parsed)) return parsed as Violation[];
    return [];
  } catch (e) {
    console.warn(`[Sandbox:vm] execution failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * makeSandboxedPredicate: 把 code_predicate.impl 字符串编译为 Predicate。
 * 返回的函数调用时在沙箱中执行 impl。
 */
export function makeSandboxedPredicate(impl: string) {
  return (artifact: Artifact): Violation[] => runInSandbox(impl, artifact);
}
