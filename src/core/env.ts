import { existsSync, readFileSync } from 'node:fs';

/**
 * 服务端环境变量解析。
 *
 * 为什么不是只读 `import.meta.env`：Vite 6 起开发服务器的 module runner
 * 不允许动态访问 `import.meta.env[SOME_KEY]`（会直接抛错），而构建产物里的
 * `import.meta.env` 又只有静态键。所以顺序是：
 *   1. `process.env`（部署平台/命令行传入，最可靠）
 *   2. `import.meta.env`（构建时静态注入的值）
 *   3. 运行目录下的 `.env` / `.env.local`（让 `cp .env.example .env` 后 `npm run dev` 直接可用）
 */

/** 解析 .env 文本：支持 export、引号、# 注释；后者覆盖前者。 */
export function parseEnv(text: string, into: Record<string, string> = {}) {
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');   // 行尾注释
    }
    into[m[1]] = value;
  }
  return into;
}

let cache: Record<string, string> | null = null;

function fromFiles(): Record<string, string> {
  if (cache) return cache;
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {      // .env.local 优先
    try { if (existsSync(name)) parseEnv(readFileSync(name, 'utf8'), merged); } catch { /* 读不到就忽略 */ }
  }
  cache = merged;
  return merged;
}

export function readEnv(key: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env[key] : undefined;
  if (fromProcess) return fromProcess;
  try {
    const value = (import.meta as any)?.env?.[key];
    if (value) return String(value);
  } catch { /* dev: 动态访问 import.meta.env 会抛错 */ }
  return fromFiles()[key];
}
