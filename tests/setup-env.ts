// vitest setup: 加载 .env 文件(若存在),让真实 LLM 测试能用 API key。
// 不依赖 dotenv,用 Node 内置 fs 解析简单 KEY=VALUE 格式。
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // 只设未定义的(不覆盖已设置的 process.env)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
