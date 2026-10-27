# 架构

网站只读 Notion：一个数据库 = 一组文章。SQLite 是可丢弃的本地缓存。

```
src/
├── shared/      线上契约：API 类型（contracts.ts）、公开 URL 规则（routes.ts）、语言协商（i18n.ts）；零运行时依赖
├── core/        纯函数：Notion 块 → HTML（blocks.ts）、富文本类型、URL 安全、slug、文本与日期格式、排序（order.ts）、中英标签归并（tags.ts）、“更多”页面文档的校验与按语言取值（more.ts）、媒体识别、错误类型、.env
├── content/     站点文案（en / zh-CN 两份）与默认值、“更多”页面的默认示例（more.ts）、内置标签对照（tags.ts）、演示文章（Notion 块格式）
├── middleware.ts 决定每个请求的语言（?lang → cookie → Accept-Language），写 cookie、Content-Language、Vary
├── server/      后端（只在 Node 里运行）
│   ├── config.ts            环境变量 → 运行配置
│   ├── db/                  SQLite 连接 + 版本化迁移 + repository（只有 SQL）
│   │                        articles（文章、正文缓存、notion_media 白名单）· settings · meta · more（“更多”页面，一行 JSON）
│   ├── notion/              client（只读 REST：超时、429/5xx 重试、分页）
│   │                        mapper（页面 → 文章、列识别、schema 检查）· tree（并发受限地取块树）
│   ├── storage/             uploads（后台上传）· notion-media（Notion 文件的磁盘副本）
│   ├── services/            articles（同步、缓存、正文渲染）· media（图片代理）· search · settings · tags（主题索引、按语言命名、筛选）· more（“更多”页面：保存的文档或内置示例）· auth · status
│   ├── presenters.ts        领域数据 → shared/contracts 里的 DTO
│   ├── queries.ts           **页面唯一可用的服务端入口**（只读，返回 DTO）
│   └── http/
│       ├── respond.ts       JSON 响应、错误转换、请求体解析、分页、缓存头
│       └── endpoints/       public · admin · more · uploads · media · legacy（旧地址 301）
├── ui/          前端（只做展示）
│   ├── layouts/ components/ views/   Astro 组件，只通过 props 接收数据
│   ├── i18n.ts              界面文字字典 messages(locale)
│   ├── feeds.ts             RSS / sitemap（含 hreflang 两种语言）/ robots（纯函数）
│   ├── scripts/site/        首页动画（Three.js / GSAP / Lenis / Canvas 招牌）
│   ├── scripts/admin/       后台单页应用（Articles / More / Settings / Files；more-model.ts 是编辑器的纯状态函数）
│   ├── scripts/lib/api-client.ts  带类型的浏览器 API 客户端
│   └── styles/              base / home / pages（含 Notion 块与颜色）/ more（/more 页面）/ cjk（全部中文排版规则）/ admin
└── pages/       路由（组合根）
    ├── api/**               一行 re-export 到 server/http/endpoints
    ├── media/ uploads/      文件服务 → endpoints/media.ts、endpoints/uploads.ts
    ├── works/ writing/ journal/ posts/   旧地址 → endpoints/legacy.ts
    └── *.astro              调用 server/queries.ts，把结果交给 ui/views/*
```

## 依赖规则（`tests/architecture.test.mjs` 自动检查）

```
pages/api/*   ──▶ server/http/endpoints/*
pages/*.astro ──▶ server/queries.ts  +  ui/views/*
pages/media|uploads|works|writing|journal|posts ──▶ 对应的 endpoint 模块
ui/*          ──▶ shared/ core/ content/          （永远不 import server/）
server/*      ──▶ shared/ core/ content/          （永远不 import ui/）
shared/ core/ ──▶ （叶子层，不 import server/ ui/ pages/）
better-sqlite3 只出现在 server/db/connection.ts
notion/client.ts 没有 PATCH/PUT/DELETE，唯一的 POST 是 databases/:id/query
```

## 一次请求的路径

```
GET /articles/first-light
  middleware.ts                             Astro.locals.locale = en | zh-CN
  pages/articles/[slug].astro
  → server/queries.ts getArticle
    → services/articles.ts findArticle      ensureFresh：从未同步 → 等一次同步；过期 → 后台刷新，先返回缓存
    → services/articles.ts articleBody      缓存命中（body_updated == updated）→ 直接返回
                                            未命中 → notion/tree.ts 取块树 → core/blocks.ts 渲染 → 存缓存
                                            Notion 不可达 → 返回上一次渲染的旧正文
    → presenters.ts                         ArticleRow + ArticleBody → ArticleDetail
  → ui/views/ArticleView.astro              纯展示

GET /media/notion/<id>
  → endpoints/media.ts → services/media.ts
      id 不在 notion_media 白名单 → 404
      磁盘副本存在且属于当前文章版本 → 直接发送（支持 Range / ETag）
      否则：GET /blocks/:id 或 /pages/:id 取新的签名地址 → 下载（超时、大小上限）→ 原子写盘
```

## 同步与缓存

- 同步 = 查询整个数据库 → `mapper.toArticles` 在本地过滤（Published、日期 ≤ 现在、有标题、未归档）→ 整体替换 `articles` 表。
  在本地过滤，所以任何列结构都能用，没有对 Notion filter 语法的依赖。
- 排序（`core/order.ts newestFirst`）：按 Date 列的**时刻**倒序；只有日期的视为当天 00:00 UTC；同一时刻再按 Notion 创建时间、标题。
  显示时保留作者写下的时间（不做时区换算）。
- Slug 按页面**创建时间**从旧到新分配：新页面和旧页面重名时，旧文章的地址不会变。
- 同一时刻只有一个同步任务（并发请求共享同一个 Promise）；失败时保留旧缓存，错误写入 `meta.sync_error`，后台可见。
- 正文首次阅读时渲染并缓存；`last_edited_time` 变化后，正文作废、该文章的图片副本删除。
- 修改 Notion token 或数据库后，文章缓存与图片副本整体清空。
- “更多”页面（`more_page` 表）**不是缓存**：同步、全量重新同步、修改 Notion 设置都不会动它（`tests/more.test.mjs` 检查）。所有写入都经过 `core/more.ts` 的 `normalizeMoreDocument`，存进去的 JSON 总是合法的。
- 子块按层并发获取（并发 3，最多 8 层、5000 块），`child_page`/`child_database` 不展开；同步块读取原始块的内容。

## 数据库迁移

`PRAGMA user_version` 记录版本。第 7 步新增 `more_page`（单行：`id = 1`、`doc` JSON、`updated`），没有这一行时显示内置示例。第 6 步给 `articles` 加 `created` 列（旧缓存为空，下一次同步填上）。第 5 步新增 `articles` 与 `notion_media`；之前版本留下的 `items`、`posts`、`post_revisions`
**不删除**（没有破坏性迁移），只是不再被读取。
