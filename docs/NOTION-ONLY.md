# 转为 Notion-only：选型与取舍

> 历史决策记录（2026-10）：后续新增的“更多”页面和站点设置保存在 SQLite，并非可重建缓存；请以 README 和 ARCHITECTURE 为准。
>
> 本次改动的背景记录。问题是：在 red-room-archive 里实现旧项目
> [BrainEno/astro-notion](https://github.com/BrainEno/astro-notion) 的功能，还是更新旧仓库、把这里的首页 UI 与动画搬过去？

## 结论：留在本仓库，把旧项目的 Notion 约定移植过来

| 维度 | astro-notion（旧） | red-room-archive（本仓库） |
| --- | --- | --- |
| 能否构建 | **不能**：`astro.config.mjs` 两次 `import cloudflare`（SyntaxError） | CI 通过（类型检查 + 测试 + 构建） |
| 测试 / CI | 无 | node:test 覆盖渲染、映射、接口契约、架构边界；GitHub Actions |
| 发布新文章 | 文章页 `prerender = true`，新文章要**重新构建部署**；没有 webhook/定时构建 | SSR + 本地缓存，过期后台刷新，发文后几分钟内可见 |
| 运行时一致性 | 部署目标是 Cloudflare Workers，却用 `node:fs` 写 `tmp/` 缓存、把图片下载到 `public/notion`（Workers 上不可写） | Node 进程 + 磁盘缓存，读写路径一致 |
| Notion 图片 | 依赖构建时下载；运行时签名 URL 约 1 小时后失效 | `/media/notion/:id` 按需重新签名并缓存到磁盘 |
| 缓存 | 模块级 `postsCache` / `dbCache` 永不失效 | 以 `last_edited_time` 为版本，同步时失效 |
| 健壮性 | 列名硬编码，缺列时 `_validPageObject` 直接抛错；重试对 429 也放弃；子块串行 N+1 | 列按名称+类型识别、缺列有回退；429/5xx 按 `Retry-After` 重试；子块并发受限 |
| 页面 bug | 文章不存在时报 500（错误信息用单引号，模板没插值）；“全部文章”只显示 9 篇无分页；标签页写死“小说/诗歌/其他” | 404 正常；分页；任意标签 |
| 安全 | `/api/chatbot` 无鉴权、无校验、无限流地转发到 Cloudflare AI，客户端可注入 system 消息 → 滥用与费用风险 | 管理接口统一 Bearer + 限流；HTML 全量转义、URL 白名单 |
| 仓库卫生 | 提交了 14 个 `.nx/` 缓存文件、`.yarn` install-state、下载的图片；README 是 Astro 模板；`the-ract-library` 拼写错误；多余的 `install` 依赖 | — |
| 首页 | 普通博客首页 | 独有的 Three.js 红房间 + GSAP 镜头编排 |

搬迁方向的成本不对称：首页场景依赖本仓库的 SSR 布局、`home.ts` 的滚动/镜头约定和样式体系，搬过去等于在一个
不能构建、没有测试、部署模型自相矛盾的仓库里重做一遍基础设施；而旧项目真正有价值的部分——**Notion 数据库约定和块的覆盖范围**
——是纯数据与纯函数，移植成本低，而且可以用测试锁定。

## 从旧项目移植了什么

- 数据库约定：`Page`（标题）`Slug` `Date` `Published` `Tags` `Excerpt` `FeaturedImage` `Rank`，旧库无需改动即可接入；
  环境变量 `NOTION_API_SECRET` / `DATABASE_ID` 也照样识别。
- 定时发布（`Date ≤ now`）与 Rank 精选（首页 Featured 区块）。
- 块覆盖：段落、标题、列表、待办、引用、Callout、Toggle、代码、公式、图片、视频、文件、嵌入、书签、链接预览、表格、分栏、
  同步块、目录、页面链接、富文本注释、@提及、颜色。
- 旧 URL：`/posts/:slug`、`/posts/tag/:tag` 301 到新地址，旧博客的外链不会失效。

没有移植：AI 聊天接口（安全问题见上表）、mermaid（体积大，列入“还没做”）；KaTeX / Prism / metascraper 的功能后来以更轻、符合 CSP 的方式补上：Temml 输出原生 MathML、highlight.js 服务器端高亮、自带受限的书签标题抓取（见 README“公式、代码与书签”）、nx / yarn 工具链。

## 本仓库因此删除的东西

- 音乐、影像模块（`/music`、`/video`、`/works` 分类、`MediaPlayer`、首页内联播放器）——按要求暂时移除。
- 本地随笔（Journal）及其编辑器、Markdown 渲染、unified/remark 依赖。
- PR #11 的数据安全功能：历史版本、回收站、数据库快照、ZIP 导出/导入。它们保护的是“只存在于 SQLite 的随笔”；
  内容移到 Notion 后，SQLite 只剩可重建的缓存，这些功能失去对象（Notion 自带页面历史与回收站）。
- 写回 Notion 的接口与后台表单（网站现在只读）。

旧数据表（`items` `posts` `post_revisions`）不会被迁移删除。若之前在 Journal 写过随笔，升级前可以用旧版本的导出功能留一份，
或直接在 SQLite 里查询 `posts` 表。

## 导航

Works 与 Journal 合并为 **Articles**：内页导航只有 Articles · Search；首页导航为 intro · articles · topics · about · contact。
首页三个列表区块的镜头关键帧原样保留，只是换了内容：Works → Articles（最新），Music → Featured（Rank），Video → Topics（标签）。
