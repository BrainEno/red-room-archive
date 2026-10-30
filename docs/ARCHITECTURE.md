# 架构

网站只读 Notion：一个数据库 = 一组文章。SQLite 中的文章和正文是缓存；后台设置（含 Notion token）和“更多”页面不是缓存，需要安全备份。

```
src/
├── shared/      线上契约：API 类型（contracts.ts）、公开 URL 规则（routes.ts）、语言协商（i18n.ts）；零运行时依赖
├── core/        纯函数：Notion 块 → HTML（blocks.ts）、富文本类型、URL 安全、slug、文本与日期格式、排序（order.ts）、中英标签归并（tags.ts）、“更多”页面文档的校验与按语言取值（more.ts）、媒体识别、错误类型、.env
├── content/     站点文案（en / zh-CN 两份）与默认值、“更多”页面的默认示例（more.ts）、内置标签对照（tags.ts）、演示文章（Notion 块格式）
├── middleware.ts 每个请求的语言：页面看路径（/zh-CN/x rewrite 到 /x，写 locals.locale / locals.path），?lang、cookie、Accept-Language 只触发跳转；API 仍按 ?lang → cookie → Accept-Language；另写安全头、Content-Language、Vary
├── server/      后端（只在 Node 里运行）
│   ├── config.ts            环境变量 → 运行配置
│   ├── db/                  SQLite 连接 + 版本化迁移 + repository（只有 SQL）
│   │                        articles（文章、正文缓存、notion_media 白名单）· settings · meta · more（“更多”页面，一行 JSON）
│   ├── notion/              client（只读 REST：超时、429/5xx 重试、分页）
│   │                        mapper（页面 → 文章、列识别、schema 检查）· tree（并发受限地取块树）
│   ├── storage/             uploads（后台上传）· notion-media（Notion 文件的磁盘副本）
│   ├── services/            articles（同步、缓存、正文渲染）· media（图片代理）· search · settings · tags（主题索引、按语言命名、筛选）· more（“更多”页面：保存的文档或内置示例）· auth · status
│   │                        newsletter（邮件订阅：双重确认、退订、限流、后台列表与 CSV；只依赖 NewsletterStore / Mailer 接口）
│   ├── newsletter/          邮件订阅的可移植部件（不 import db/connection、astro、ui）：
│   │                        store（NewsletterStore 接口）· document-store（Blobs 等键值存储上的 ETag 事务）· crypto（token 哈希、HMAC、AES-GCM）
│   │                        config · mailer（Resend / Brevo 适配器）· emails（模板）· http（共用的路由处理）
│   │                        node（SQLite 组合根）· netlify（Blobs 组合根）
│   ├── presenters.ts        领域数据 → shared/contracts 里的 DTO
│   ├── queries.ts           **页面唯一可用的服务端入口**（只读，返回 DTO）
│   └── http/
│       ├── respond.ts       JSON 响应、错误转换、请求体解析、分页、缓存头
│       └── endpoints/       public · admin · more · uploads · media · legacy（旧地址 301）· newsletter
├── ui/          前端（只做展示）
│   ├── layouts/ components/ views/   Astro 组件，只通过 props 接收数据
│   ├── i18n.ts              界面文字字典 messages(locale)
│   ├── feeds.ts             RSS / sitemap（含 hreflang 两种语言）/ robots（纯函数）
│   ├── scripts/site/        首页动画（Three.js / GSAP / Lenis / Canvas 招牌）· newsletter（订阅表单、确认/退订页）
│   ├── scripts/admin/       后台单页应用（Articles / More / Newsletter / Settings / Files；more-model.ts 是编辑器的纯状态函数）
│   ├── scripts/lib/api-client.ts  带类型的浏览器 API 客户端
│   └── styles/              base / home / pages（含 Notion 块与颜色）/ more（/more 页面）/ cjk（全部中文排版规则）/ admin
└── pages/       路由（组合根）
    ├── api/**               一行 re-export 到 server/http/endpoints
    ├── media/ uploads/      文件服务 → endpoints/media.ts、endpoints/uploads.ts
    ├── works/ writing/ journal/ posts/   旧地址 → endpoints/legacy.ts
    └── *.astro              调用 server/queries.ts，把结果交给 ui/views/*
netlify/functions/newsletter.mts   静态部署上唯一的服务端代码：/api/newsletter/* → server/newsletter/http.ts + Netlify Blobs
```

## 依赖规则（`tests/architecture.test.mjs` 自动检查）

```
pages/api/*   ──▶ server/http/endpoints/*
pages/*.astro ──▶ server/queries.ts  +  ui/views/*
pages/media|uploads|works|writing|journal|posts ──▶ 对应的 endpoint 模块
ui/*          ──▶ shared/ core/ content/          （永远不 import server/）
server/*      ──▶ shared/ core/ content/          （永远不 import ui/）
shared/ core/ ──▶ （叶子层，不 import server/ ui/ pages/）
better-sqlite3 只出现在 server/db/connection.ts（订阅的 SQL 只在 db/newsletter.repository.ts）
netlify/functions/* ──▶ server/newsletter/* + server/services/auth.ts   （打包图里没有 db/connection、astro、ui、pages；tests/newsletter.test.mjs 检查）
notion/client.ts 没有 PATCH/PUT/DELETE，唯一的 POST 是 databases/:id/query
```

## 一次请求的路径

```
GET /articles/first-light
  middleware.ts                             Astro.locals.locale = en（/zh-CN/articles/first-light 则 rewrite 到同一路由，locale = zh-CN）
  pages/articles/[slug].astro
  → server/queries.ts getArticle
    → services/articles.ts findArticle      ensureFresh：从未同步 → 等一次同步；过期 → 后台刷新，先返回缓存
    → services/articles.ts articleBody      缓存命中（body_updated == updated 且渲染版本匹配）→ 直接返回
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

- 同步 = 查询整个数据库 → `mapper.toArticles` 在本地过滤（必须明确 Published、日期 ≤ 现在、有标题、未归档；缺少或无法识别发布字段时不公开）→ 整体替换 `articles` 表。
  在本地过滤，所以任何列结构都能用，没有对 Notion filter 语法的依赖。
- 排序（`core/order.ts newestFirst`）：按 Date 列的**时刻**倒序；只有日期的视为当天 00:00 UTC；同一时刻再按 Notion 创建时间、标题。
  显示时保留作者写下的时间（不做时区换算）。
- Slug 按页面**创建时间**从旧到新分配：新页面和旧页面重名时，旧文章的地址不会变。
- 单进程内同一配置下并发同步共享一个任务；配置切换后，旧任务的结果被丢弃，新任务等待旧任务的清理完成再启动。失败时保留旧缓存，错误写入 `meta.sync_error`，后台可见。同步由访问或后台操作触发，没有定时器。
- 正文首次阅读时渲染并缓存；`last_edited_time` 变化后，正文作废、该文章的图片副本删除。
- 启动及访问时检查有效 token、数据库 ID、API base 与发布策略版本的加盐指纹；来源变化或首次升级时清除旧文章缓存及同步状态。后台修改 Notion token 或数据库时，在同一 SQLite 事务中清除文章缓存及同步状态，提交后清理图片副本；正在进行的旧同步和正文获取不再写入或返回旧结果。配置校验和设置写入作为整体执行，失败时回滚。SQLite 保存配置版本，旧任务写入前在事务内检查版本；媒体副本按版本隔离，异步下载完成前后重新检查。
- “更多”页面（`more_page` 表）**不是缓存**：同步、全量重新同步、修改 Notion 设置都不会动它（`tests/more.test.mjs` 检查）。所有写入都经过 `core/more.ts` 的 `normalizeMoreDocument`，存进去的 JSON 总是合法的。
- 单篇正文的子块按层获取，最多同时 3 个子块列表请求（不是全站限速）；根块深度记为 0，最多向下 8 层、共 5000 块。超限、分页 cursor 缺失/重复或单个列表超过 1000 页时明确报错，不保存截断正文；`child_page`/`child_database` 不展开，同步块读取原始块的内容。静态构建失败并清理产物；Node 模式可回退到同来源旧正文，旧正文可能仍不完整。升级后旧版正文会惰性重新抓取。

请求体读取时实施实际字节限额；multipart 文件另限 8 MiB，大文件使用原始流。上传先写随机临时文件再原子无覆盖提交；重命名先创建目标硬链接，再保存 More 引用，最后删除旧名称；崩溃可能留下重复文件但不会因顺序导致引用断开。RSS 不假设未知封面的 MIME/大小，暂不发 enclosure。

后台限流忽略代理转发 IP；带转发头请求共用桶，直连使用适配器地址（不可得时使用共享桶），桶数有限且有进程级总上限。代理层应另设限流和后台访问控制。

多进程共享同一份数据目录仍不受支持：同步去重、磁盘清理及限流不是跨进程协调的。客户端或 CDN 已缓存的内容不能通过撤回文章立即收回。

## 数据库迁移

`PRAGMA user_version` 记录版本。第 11 步新增邮件订阅的四张表：`newsletter_subscribers`（`normalized_email` 唯一）、`newsletter_tokens`（只存 SHA-256 哈希，`token_hash` 唯一，随订阅者级联删除）、`newsletter_send_log`（每日发信计数）、`newsletter_rate_limits`（键为 HMAC）；见 [NEWSLETTER.md](NEWSLETTER.md#数据结构)。第 9 步为正文增加 `body_renderer_version`，保留旧正文用于离线回退及搜索；第 8 步保存空 Date 的首次发现公开日期。第 7 步新增 `more_page`（单行：`id = 1`、`doc` JSON、`updated`），没有这一行时显示内置示例。第 6 步给 `articles` 加 `created` 列（旧缓存为空，下一次同步填上）。第 5 步新增 `articles` 与 `notion_media`；之前版本留下的 `items`、`posts`、`post_revisions`
**不删除**（没有破坏性迁移），只是不再被读取。

## 静态快照构建

`scripts/static-snapshot.mjs` 在临时目录启动构建后的 Node SSR，校验 Notion 标题和发布列，拉取已发布文章及媒体，生成仅公开内容的 `static-dist/`；构建失败时删除输出。此模式没有运行时数据库，也没有文章/设置 API；唯一的服务端部分是邮件订阅的 Netlify Function（数据在 Netlify Blobs），`/admin` 外壳在静态站上只显示订阅模块。构建会去掉 `NEWSLETTER_*` 环境变量，并在发布前扫描输出中的服务端密钥和数据库文件。可选的非机密 `site-profile.json` 在构建时通过认证的临时管理 API 导入；静态离线编辑器只能导入/导出本地文件，不能更改已部署站点。双语页面使用 `/zh-CN/` 路径，列表筛选及分页生成独立静态路径，搜索在浏览器读取公开索引。详细限制和部署流程见 README「静态部署」。
