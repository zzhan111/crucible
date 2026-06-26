import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 加载 .env 文件(若存在),让真实 LLM 测试能用 API key
    setupFiles: ['tests/setup-env.ts'],
  },
});
