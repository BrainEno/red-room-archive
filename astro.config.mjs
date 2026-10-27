import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // 开发服务器会用 --host 暴露端口；允许预览域名访问（只影响 dev）
  server: { allowedHosts: true },
  vite: { ssr: { external: ['better-sqlite3'] } },
});
