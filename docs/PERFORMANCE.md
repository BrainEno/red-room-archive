# 性能、离线与发现

本轮保留首页 Three.js / GSAP / Lenis 场景和现有视觉，不为了体积数字删掉核心体验；优化重点放在首屏关键路径、缓存、重复访问、离线阅读和按需加载。

## 已实施的运行时策略

- **首屏与 3D 分离**：首页第一屏本来就是 2D 霓虹招牌，因此 Three.js、场景代码和 GLB 模型只在读者首次滚动，或语言切换后恢复到已有滚动位置时加载。轻量 `scene-state.ts` 先与 GSAP 共享镜头状态，场景加载后接续同一状态；WebGL 不可用时正文和导航仍可使用。
- **开场不长期阻挡内容**：开场计数与揭幕缩短，字体最多只短暂等待；慢字体不会把整页长时间留在 loader 后面。减少动态和语言切换后的位置恢复仍跳过开场。
- **静态资源缓存**：`/_astro/*` 使用一年 immutable；模型使用一天缓存加七天 stale-while-revalidate。HTML 使用 `no-cache`，避免后台编辑后长期显示旧内容；`/sw.js` 永不长期固定缓存。
- **公共离线 worker**：首次在线访问后，页面采用 network-first 并保存成功响应；断网重载使用保存的页面，未缓存页面显示双语 `/offline` 或 `/zh-CN/offline`。源站明确返回 5xx 时也回退到已保存页面，不用错误页覆盖好的副本。页面缓存上限 60 个，资源缓存上限 140 个，更新 worker 时清理旧版本。
- **缓存边界**：不拦截／保存 `/api`、`/admin`、newsletter token 页面、profile editor、Range 请求和带查询的页面；`no-store` 响应不会写入 Cache Storage。后台、统计、订阅和搜索词不会因为离线功能被保存。真实 404 和 429 不伪装成离线页。
- **渐进增强**：不支持 Service Worker 或注册失败时，正常在线阅读不受影响；HTTPS／localhost 才注册 worker。减少动态、键盘导航和窄屏布局仍按设计系统执行。
- **按需后台报表**：Analytics 面板只有切换到该 tab 才加载独立 chunk；Node 后台不打开报表时不会执行报表初始化。公开采集脚本只在站点开启收集时输出，DNT/GPC 时不发请求。

离线不是完整的离线 CMS：未缓存的 Notion 图片、外链图片、搜索索引或新文章可能需要网络；离线页会诚实说明这一点。清除站点数据／浏览器缓存会删除离线副本。5xx 回退只能帮助已经保存过页面的浏览器，不能绕过 Netlify 整站额度暂停或保证首次访客可用。

## 本地 Lighthouse 对照

测速环境：Node **22.23.4**、Chromium **153.0.8010.0**、Lighthouse **13.0.3**，同一个本地静态 demo 和默认移动端模拟节流。基线与修改后使用相同命令；本地服务没有 Netlify CDN，因此这些分数不与 Deploy Preview 的分数直接相等。

| 指标 | 修改前单次 | 修改后两次范围 |
| --- | ---: | ---: |
| Performance | 67 | **92–93** |
| First Contentful Paint | 3.3 s | **1.7–1.8 s** |
| Largest Contentful Paint | 6.0 s | **3.0–3.2 s** |
| Speed Index | 3.3 s | **1.9–2.1 s** |
| Total Blocking Time | 230 ms | **50–70 ms** |
| Cumulative Layout Shift | 0 | **0** |

两次最终测试的首屏均没有请求 `vendor-three` 或 `/models/`；另有浏览器回归确认首次滚动后场景模块仍会加载。基线的 LCP 元素是 loader 计数“100”，说明固定开场等待确实影响了指标。修改后 LCP 仍主要受这段保留的开场动画影响，不能把 92–93 当成任何设备或网络下的保证。

这只是本地实验室对照，不是 Netlify 生产测量。Deploy Preview 上已有的 79 分截图来自另一环境；合并部署后仍应在相同 Netlify URL、相同 Lighthouse 设置下复测，并检查真实设备与慢网。不要为了单次分数继续删除场景或做没有实际体验收益的改动。

## 可复现的构建体积对比

以下数字来自本地 Node **22.23.4** 构建，使用 `scripts/asset-report.mjs` 对 `dist/client/_astro/*.js` 逐文件统计；gzip 使用 Node zlib 默认级别。基线是性能／离线／统计工作前的 `b588cc7` 构建。总数包含按需 chunk，**不能全部算成首屏成本**；哈希文件名随构建变化，比较时按入口和模块角色看。

| 口径 | 基线 | 当前 | 变化 |
| --- | ---: | ---: | ---: |
| 全部 `_astro` JS，未压缩 | 811,580 B | 823,826 B | +12,246 B（+1.51%） |
| 全部 `_astro` JS，gzip | 232,602 B | 237,956 B | +5,354 B（+2.30%） |
| 首页首屏入口（主 chunk + preload helper），未压缩 / gzip | 17,930 / 8,050 B | 14,110 / 6,366 B | **-3,820 / -1,684 B** |
| `vendor-three`，未压缩 / gzip | 581,343 / 145,868 B | 581,343 / 145,868 B | 文件不变；改为首次滚动才加载 |
| 3D 场景延迟 chunk | — | 6,151 / 3,095 B | 首次滚动才加载 |
| `vendor-motion`，未压缩 / gzip | 131,454 / 48,894 B | 131,454 / 48,894 B | 不变 |
| 后台主入口，未压缩 / gzip | 69,058 / 24,293 B | 72,694 / 25,706 B | +3,636 / +1,413 B |
| Analytics 延迟 chunk | — | 4,493 / 1,606 B | 仅打开报表时加载 |

当前新增的公开脚本单独约为：离线注册 387 B（gzip 267 B）、采集器 341 B（gzip 269 B）；`public/sw.js` 为 3,970 B，不在上述 `_astro` 合计中。朗读变速、离线／统计和动态加载辅助代码增加了一些总量，不应被描述成“总体积下降”；真正的首屏改善来自关键路径变短和 3D 延迟加载。

重新生成当前报告：

```bash
npm run build
node scripts/asset-report.mjs
```

若要公平比较另一版本，请在同一 Node 版本、同一依赖锁文件和同一构建命令下生成报告，保留原始 JSON，不把 gzip 当成所有 CDN 的实际传输大小。

## SEO / GEO（生成式搜索发现）

- 每个公开页面保留 canonical、Open Graph、Twitter card、双语 `hreflang` 和适用的 JSON-LD；文章包含发布时间、修改时间、主题和面包屑。
- SSR 与静态快照都生成带 `lastmod`、双语 alternate 和 `x-default` 的 `sitemap.xml`，不把搜索、离线、后台或 newsletter token 页列入索引。
- `/llms.txt` 只从公开站点 DTO 生成简介、栏目、近期文章、RSS／sitemap 和版权链接，方便答案引擎发现可引用的公开内容。它是发现指南，**不是训练许可、转载许可或版权声明的替代**。
- 继续保留 `robots.txt` 的 AI-training crawler 限制、TDMRep `tdm-reservation` / `tdm-policy` 和文章版权信息；GEO 不会被解释为撤回这些限制。
- `/llms.txt` 只包含已经公开的事实和链接，不生成未核实的作者介绍、出版信息或联系方式。
