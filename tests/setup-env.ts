// vitest setup: 加载 .env 文件(若存在)。
// 注: 不加载 OPENAI_API_KEY — 测试应在降级模式运行(可复现,无网络依赖)。
// 真实 LLM 验证由 scripts/run-calibration.ts 手动完成(该脚本自行解析 .env)。
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SKIP_KEYS = new Set(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']);

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (SKIP_KEYS.has(key)) continue; // 跳过 LLM key,测试用降级模式
    const value = trimmed.slice(eqIdx + 1).trim();
    // 只设未定义的(不覆盖已设置的 process.env)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
