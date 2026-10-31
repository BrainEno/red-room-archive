# 性能、离线与发现

本轮保留首页 Three.js / GSAP / Lenis 场景和现有视觉，不为了体积数字删掉核心体验；优化重点放在缓存、重复访问、离线阅读和按需加载。

## 已实施的运行时策略

- **静态资源缓存**：`/_astro/*` 使用一年 immutable；模型使用一天缓存加七天 stale-while-revalidate。HTML 使用 `no-cache`，避免后台编辑后长期显示旧内容；`/sw.js` 永不长期固定缓存。
- **公共离线 worker**：首次在线访问后，页面采用 network-first 并保存成功响应；断网重载优先返回保存的页面，未缓存页面显示双语 `/offline` 或 `/zh-CN/offline`。页面缓存上限 60 个，资源缓存上限 140 个，更新 worker 时清理旧版本。
- **缓存边界**：不拦截／保存 `/api`、`/admin`、newsletter token 页面、profile editor、Range 请求和带查询的页面；`no-store` 响应不会写入 Cache Storage。后台、统计、订阅和搜索词不会因为离线功能被保存。
- **渐进增强**：不支持 Service Worker 或注册失败时，正常在线阅读不受影响；HTTPS／localhost 才注册 worker。减少动态、键盘导航和窄屏布局仍按设计系统执行。
- **按需后台报表**：Analytics 面板只有切换到该 tab 才加载独立 chunk；Node 后台不打开报表时不会执行报表初始化。公开采集脚本只在站点开启收集时输出，DNT/GPC 时不发请求。

离线不是完整的离线 CMS：未缓存的 Notion 图片、外链图片、搜索索引或新文章可能需要网络；离线页会诚实说明这一点。清除站点数据／浏览器缓存会删除离线副本。

## SEO / GEO（生成式搜索发现）

- 每个公开页面保留 canonical、Open Graph、Twitter card、双语 `hreflang` 和适用的 JSON-LD；文章包含发布时间、修改时间、主题和面包屑。
- SSR 与静态快照都生成带 `lastmod`、双语 alternate 和 `x-default` 的 `sitemap.xml`，不把搜索、离线、后台或 newsletter token 页列入索引。
- 新增 `/llms.txt`：只从公开站点 DTO 生成简介、栏目、近期文章、RSS／sitemap 和版权链接，方便答案引擎发现可引用的公开内容。它是发现指南，**不是训练许可、转载许可或版权声明的替代**。
- 继续保留 `robots.txt` 的 AI-training crawler 限制、TDMRep `tdm-reservation` / `tdm-policy` 和文章版权信息；GEO 不会被解释为撤回这些限制。
- `/llms.txt` 只包含已经公开的事实和链接，不生成未核实的作者介绍、出版信息或联系方式。

## 可复现的构建体积对比

以下数字来自本地 Node **22.23.4** 构建，使用 `scripts/asset-report.mjs` 对 `dist/client/_astro/*.js` 逐文件统计；gzip 使用 Node zlib 默认级别。基线是本轮修改前的 `b588cc7` 构建，当前是加入离线／统计并将 Analytics 面板按需加载后的构建。哈希文件名随构建变化，比较时按入口和模块角色看，不要只按文件名匹配。

| 口径 | 基线 | 当前 | 变化 |
| --- | ---: | ---: | ---: |
| 全部 `_astro` JS，未压缩 | 811,580 B | 822,702 B | +11,122 B（+1.37%） |
| 全部 `_astro` JS，gzip | 232,602 B | 237,008 B | +4,406 B（+1.89%） |
| 首页 `vendor-three`，未压缩 / gzip | 581,343 / 145,868 B | 581,343 / 145,868 B | 不变 |
| 首页 `vendor-motion`，未压缩 / gzip | 131,454 / 48,894 B | 131,454 / 48,894 B | 不变 |
| 后台主入口，未压缩 / gzip | 69,058 / 24,293 B | 74,301 / 26,332 B | +5,243 / +2,039 B |
| Analytics 延迟 chunk | — | 4,493 / 1,605 B | 仅打开报表时加载 |

当前新增的公开脚本单独约为：离线注册 387 B（gzip 267 B）、采集器 341 B（gzip 269 B）；`public/sw.js` 为 3,733 B，不在上述 `_astro` 合计中。总量增加主要来自双语报表和 API 契约，不应被描述成“总体积下降”。

这组数据是**构建产物对比，不是 Lighthouse 或真实网络测速**。尚未在真实 Netlify、真实设备、慢速网络或生产 Notion 数据上测量 LCP／INP／CLS，因此不能据此宣称线上速度已经提升。重复访问的缓存命中、断网重载和后台 tab 按需加载由自动化测试验证；上线后仍应使用浏览器 Performance／Lighthouse 和真实访问数据复测。

重新生成当前报告：

```bash
npm run build
node scripts/asset-report.mjs
```

若要公平比较另一版本，请在同一 Node 版本、同一依赖锁文件和同一构建命令下生成报告，保留原始 JSON，不把 gzip 当成所有 CDN 的实际传输大小。
