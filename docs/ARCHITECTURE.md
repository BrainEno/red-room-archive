# 架构

```
src/
├── shared/      线上契约：API 请求/响应类型、collection 定义（服务端与浏览器共用，零运行时依赖）
├── core/        纯函数：错误类型、Markdown/Notion 块渲染、URL 安全、slug、文本、媒体识别、.env 解析
├── content/     站点文案与默认值（名称、简介、引言、facts……），可被后台设置覆盖
├── server/      后端（只在 Node 里运行）
│   ├── config.ts            环境变量 → 运行配置
│   ├── db/                  SQLite 连接 + 版本化迁移 + repository（只有 SQL）
│   ├── notion/              Notion REST 客户端、属性映射、写回
│   ├── storage/uploads.ts   本地文件存储（流式写盘、路径安全）
│   ├── services/            业务规则：archive（缓存/同步）、posts、search、settings、auth、status
│   ├── presenters.ts        领域数据 → shared/contracts 里的 DTO
│   ├── queries.ts           **页面唯一可用的服务端入口**（只读，返回 DTO）
│   └── http/
│       ├── respond.ts       JSON 响应、错误转换、请求体解析、分页、缓存头
│       └── endpoints/       每个资源一个模块：public / posts / admin / uploads
├── ui/          前端（只做展示）
│   ├── layouts/ components/ views/   Astro 组件，只通过 props 接收数据
│   ├── feeds.ts             RSS / sitemap / robots 生成（纯函数）
│   ├── scripts/site/        首页动画（Three.js / GSAP / Lenis / Canvas 招牌）
│   ├── scripts/admin/       后台单页应用（按面板拆分）
│   ├── scripts/lib/api-client.ts  带类型的浏览器 API 客户端
│   └── styles/              base / home / pages / admin
└── pages/       路由（组合根）：只做“取数 + 渲染视图”或“转发到 endpoint”
    ├── api/**               一行 re-export，例如 export { list as GET } from '…/endpoints/posts.ts'
    └── *.astro              调用 server/queries.ts，把结果交给 ui/views/*
```

## 依赖规则（`tests/architecture.test.mjs` 自动检查）

```
pages/api/*  ──▶ server/http/endpoints/*
pages/*.astro ──▶ server/queries.ts  +  ui/views/*
ui/*          ──▶ shared/ core/ content/          （永远不 import server/）
server/*      ──▶ shared/ core/ content/          （永远不 import ui/）
shared/ core/ ──▶ （叶子层，不 import server/ ui/ pages/）
better-sqlite3 只出现在 server/db/connection.ts
```

这样 UI 和 API 是**真正分开的两个面**：

- 浏览器里的后台只通过 `api-client.ts` 走 HTTP；类型来自 `shared/contracts.ts`，接口一改编译就报错。
- 服务端渲染的页面不经过 HTTP（避免自己请求自己），但它拿到的是与 API **完全相同的 DTO**（都经过 `presenters.ts`），所以访客看到的和 API 客户端看到的永远一致。
- 想把前端换成别的框架、或把 API 单独部署，只需要替换 `ui/` 或 `pages/`，`server/` 不用动。

## 一次请求的路径

```
GET /api/posts/dawn
  pages/api/posts/[slug].ts           （re-export）
  → server/http/endpoints/posts.ts    read：鉴权判断、参数解析
  → server/services/posts.ts          requirePost：草稿可见性、404
  → server/db/posts.repository.ts     SELECT
  → server/presenters.ts              PostView → PostDetail
  ← respond.ts                        JSON + 缓存头；任何 AppError → { error, code, details? }

GET /journal/dawn
  pages/journal/[slug].astro
  → server/queries.ts                 getJournalPost：同一个 service + presenter，再渲染 Markdown
  → ui/views/JournalPostView.astro    纯展示
```

## Notion 缓存策略

- 公开页面永远只读本地 SQLite 缓存，不等 Notion。
- 每个分类独立维护 `synced:<kind>`：从未同步 → 首次访问时同步；超过 `SYNC_TTL_SECONDS` → 先返回旧数据，后台刷新。
- 同一分类同一时刻只有一个同步任务（并发请求共享同一个 Promise）。
- 同步失败：保留旧缓存继续服务，错误写入 `sync_error`，后台 Settings 可见；下一次成功后清空。
- 正文 HTML 首次阅读时拉取并缓存；页面在 Notion 里被编辑（`last_edited_time` 变化）后自动作废。
