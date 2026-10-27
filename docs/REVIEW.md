# 代码审查记录（重构前，基于 `main@6da7298`）

本文件记录重构前的审查结论：哪些设计不合理、哪些接口互相冲突，以及每一项最终如何处理。
重构后的结构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，确定下来的接口约定见 [API.md](./API.md)。

> 历史记录：其中关于 items / posts / 写回 Notion 的条目已随 v2（Notion-only，见 [NOTION-ONLY.md](./NOTION-ONLY.md)）一并移除。

## 一、结构设计问题

| # | 问题 | 影响 | 处理 |
| --- | --- | --- | --- |
| S1 | `lib/db.ts` 一个文件同时承担：连接与迁移、Notion 缓存、同步调度、文章 CRUD、搜索、站点设置、状态统计（250 行，9 类职责） | 改任何一处都要读懂全部；无法单独测试 | 拆成 `server/db/*.repository.ts`（只有 SQL）+ `server/services/*`（业务规则） |
| S2 | `notion.ts` 持有全局可变的 `resolve`，`db()` 初始化时通过 `setResolver()` 偷偷替换它 | **调用顺序决定结果**：在 `db()` 之前调用 `notionReady()`（例如 `/api/health`）会忽略后台保存的 Notion 配置；各 route 不得不手写 `db()` 来“预热” | 删除全局解析器。`services/settings.ts` 的 `resolveSetting()` 显式地“数据库优先、环境变量其次” |
| S3 | `env()`、`esc`、`slugify` 都从 `notion.ts` 导出，`auth.ts`/`files.ts` 为了读环境变量而依赖 Notion 模块 | 依赖方向混乱，形成环 | 纯工具进 `core/`（无框架依赖），配置进 `server/config.ts` |
| S4 | 页面（`.astro`）直接 import `lib/db.ts` 读写 SQLite；首页把个人简介文案硬编码在模板里 | UI 与持久化耦合；UI 看到的数据形状和 API 返回的不一样 | 页面只通过 `server/queries.ts` 取数（返回与 API 相同的 DTO）；视图组件只接收 props；文案集中在 `content/site.ts` |
| S5 | `admin.ts` 一个 270 行文件：手写 `fetch`、字符串拼 URL、四个面板混在一起 | 接口一改前端就悄悄坏掉 | 拆为 `admin/main.ts` + 四个 `panels/*`，统一经过带类型的 `ui/scripts/lib/api-client.ts` |
| S6 | 两套错误：`HttpError(status, msg)`，以及 route 里 `fail(502, String(e))` 直接把 Notion 原始响应（含工作区信息）返回给客户端 | 泄露上游细节；客户端只能按文案判断错误 | 统一 `AppError(status, code, message, details)`；Notion 响应体只写日志 |
| S7 | 没有迁移版本，`migratePosts()` 每次启动都跑 `PRAGMA table_info` + `ALTER` 探测 | 难以继续演进表结构 | `PRAGMA user_version` + 有序迁移列表 |

## 二、接口冲突与不一致（已确立）

| # | 冲突 | 确立后的约定 |
| --- | --- | --- |
| A1 | 删除文件有两条路：`DELETE /api/upload?name=` 与 `DELETE /api/upload/<name>`；`GET /api/upload?bare=1` 返回数组、默认返回对象 | 只保留 `DELETE /api/uploads/:name`；列表永远返回 `{ files, usage }` |
| A2 | 资源命名单复数混用：`/api/posts`、`/api/items`，但 `/api/upload` | 统一复数：`/api/uploads`（公开下载仍是 `/uploads/:name`） |
| A3 | **小文件 `as=model` 实际无效**：后台把 `as` 放在 multipart 表单字段里，服务端只读查询串 | 查询串 `?as=model` 与表单字段 `as=model` 都接受（有测试） |
| A4 | `PUT /api/posts/:slug` 和 `PUT /api/settings` 实际是**局部更新**语义 | 标准方法为 `PATCH`；`PUT` 保留为别名 |
| A5 | 写操作返回形状各不相同：`{ok,slug,created,url}` / `{ok,slug,url,updated}` / `{ok,slug,deleted}` | 创建 → `201` + 资源本体 + `Location`；更新 → `200` + 资源本体；删除 → `204` 无内容 |
| A6 | `GET /api/items/:kind/:slug` 同时返回 `body` 与 `bodyHtml`（同一份内容两次） | 只返回 `bodyHtml` |
| A7 | `GET /api/notion/:kind` 返回裸数组，其余接口都返回对象 | `{ kind, fields }` |
| A8 | `GET /api/notion/:kind/:id` 是一个永远返回 404 的占位 | 删除（该路径只有 `PATCH` / `DELETE`） |
| A9 | 同义参数：搜索 `?q=` 与 `?query=`；文章 `?format=html` 与 `?html=1`；同步 `?kind=` 与 body `{kind}` | 每个参数只有一种写法：`?q=`、`?format=html`、`?kind=` |
| A10 | `/api/sync` 单库同步返回本次条数，全量同步却返回**缓存总数** | 都返回 `synced: { kind: 本次条数 }` |
| A11 | `?drafts=1` 未登录时被静默忽略 | 返回 `401`，避免客户端误以为“没有草稿” |
| A12 | `?refresh=1` 对匿名用户开放，任何人都能让服务器反复请求 Notion | 需要管理员 token |
| A13 | 状态字段命名：`dbs`、`synced` | `databases`、`syncedAt` |
| A14 | 错误体只有 `{ error }`，并把 409 的上下文平铺在顶层 | `{ error, code, details? }`，`code` 是稳定的机器可读枚举 |

## 三、行为缺陷（顺带修复）

| # | 缺陷 | 修复 |
| --- | --- | --- |
| B1 | 同步去重按“分类组合字符串”做 key：`writing` 与 `writing,films,music` 可以同时跑，重复请求 Notion | 按单个分类去重，所有调用方共享同一个进行中的任务 |
| B2 | 首次访问任何一个分类都会**等待全部三个库**同步完成 | 每个分类独立判断新鲜度、独立同步 |
| B3 | 同标题的 Notion 条目生成相同 slug，`getItem` 随机命中其中一条 | 同库内 slug 冲突自动加 `-2`、`-3` |
| B4 | 匿名访问受保护接口（不带 token）也会累计失败次数，**陌生人可以把站长锁在后台外** | 只有“带了错误 token”才计入节流 |
| B5 | `Range: bytes=-500`（后缀范围）被当成 `0-500` | 正确返回最后 500 字节 |
| B6 | 文件列表会列出上传中的 `.part` 临时文件 | 过滤掉 |
| B7 | 搜索结果里音乐/影像条目的链接都指向 `/#music` | 每个条目都有独立页面 `/music/:slug`、`/video/:slug` |
| B8 | 文章摘要直接截取 Markdown 源码（含 `#`、`**`） | 先转成纯文本再截取 |
| B9 | 后台“保存设置”会把当前默认值写成覆盖项，之后改默认文案不再生效 | 与默认值相同的输入视为“清除覆盖” |
| B10 | Astro `checkOrigin` 拦截了没有 `Origin` 头的 multipart / DELETE 请求（脚本、反向代理后） | 本站没有 cookie，写操作全部依赖 `Authorization` 头，不存在 CSRF；关闭该检查并在配置中注明原因 |
| B11 | Notion 请求没有超时 | `AbortSignal.timeout(NOTION_TIMEOUT_MS)`，默认 15s |
