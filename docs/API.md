# API 约定（v1）

类型定义的唯一来源是 [`src/shared/contracts.ts`](../src/shared/contracts.ts)，本文是它的说明。

## 通用规则

- **鉴权**：写操作与后台读取需要 `Authorization: Bearer <ADMIN_TOKEN>`。标记为 *公开* 的接口可匿名访问。
- **请求体**：JSON（`Content-Type: application/json`，默认上限 2 MB，`MAX_JSON_KB` 可调）；上传除外。
- **资源命名**：复数名词；路径参数用于定位资源，查询参数用于过滤/选项，每个选项只有一种写法。
- **方法语义**：`GET` 读取 · `POST` 创建或触发动作 · `PATCH` 局部更新（`PUT` 是保留的别名）· `DELETE` 删除。
- **成功响应**：创建 → `201` + 资源本体 + `Location`；更新 → `200` + 资源本体；删除 → `204` 无内容。
- **分页**：`?limit=&offset=`，响应带 `total / limit / offset`。
- **错误**：始终是
  ```json
  { "error": "人类可读的说明", "code": "conflict", "details": { "slug": "dawn" } }
  ```
  | HTTP | code | 何时 |
  | --- | --- | --- |
  | 400 | `bad_request` | 参数缺失/非法、未知 kind、Notion 未配置 |
  | 401 | `unauthorized` | 缺少或错误的 token（带 `WWW-Authenticate: Bearer`） |
  | 404 | `not_found` | 资源不存在（草稿对匿名用户也是 404） |
  | 409 | `conflict` | slug / 文件名已存在 |
  | 413 | `payload_too_large` | 请求体或文件过大 |
  | 429 | `rate_limited` | 错误 token 次数过多（同 IP 10 分钟内 12 次） |
  | 502 | `upstream_error` | Notion 拒绝或不可达（上游细节只写服务器日志） |
  | 503 | `unavailable` | 服务器未配置 `ADMIN_TOKEN` |
  | 500 | `internal` | 未预期的错误（细节只写日志） |
- **缓存**：公开读接口带短 `Cache-Control`（`public, max-age, stale-while-revalidate`）；带 token 的请求一律 `no-store`。
- **kind**：API 使用稳定的机器名 `writing | films | music`；公开页面路径分别是 `/works`、`/video`、`/music`（对照表在 `src/shared/kinds.ts`）。

## 公开接口

| 方法 | 路径 | 响应 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | `HealthResponse` | 部署探针；数据库不可用时 503 |
| GET | `/api/site` | `SiteResponse` | 站点名称/邮箱/简介/引言 + 各分类条数 |
| GET | `/api/archive` | `ArchiveResponse` | 三个分类的全部条目（无正文） |
| GET | `/api/items/:kind` | `ItemListResponse` | 单个分类，`?limit=&offset=` |
| GET | `/api/items/:kind/:slug` | `ItemDetail` | 单条 + 已消毒的 `bodyHtml`；`?refresh=1` 强制重取正文（**需 token**） |
| GET | `/api/posts` | `PostListResponse` | 已发布文章，`?tag=&limit=&offset=`；`?drafts=1` 包含草稿（**需 token**，否则 401） |
| GET | `/api/posts/:slug` | `PostDetail` | `?format=html` 附带渲染后的 `html`；草稿仅 token 可见 |
| GET | `/api/search?q=` | `SearchResponse` | 已发布文章 + 已缓存条目；`?limit=`（≤50） |
| GET | `/api/auth` | `{ configured }` | 服务器是否配置了 `ADMIN_TOKEN` |
| GET/HEAD | `/uploads/:name` | 文件 | 支持 `Range`（含后缀范围）、`ETag` / `304` |

## 后台接口（需要 token）

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/api/auth` | `{ token }` | `{ ok: true }`；错误 401 / 429（无需 Bearer 头） |
| POST | `/api/posts` | `{ title, body, slug?, tags?, excerpt?, published?, created? }` | `201 PostDetail` |
| PATCH | `/api/posts/:slug` | 上述字段的任意子集；`slug` 可改名 | `PostDetail`（冲突 409） |
| DELETE | `/api/posts/:slug` | — | `204` |
| POST | `/api/markdown` | `{ markdown }` | `{ html }` —— 与公开文章同一渲染管线，用于预览 |
| GET | `/api/settings` | — | `SettingsResponse`（token 以 `••••1234` 掩码返回） |
| PATCH | `/api/settings` | `Partial<SettingValues>` | `SettingsResponse`；空字符串 = 清除覆盖；空/掩码 token = 保持不变 |
| GET | `/api/sync` | — | `{ status: SyncStatus }` |
| POST | `/api/sync?kind=` | — | `SyncResponse`；不带 kind = 同步所有已配置的库 |
| GET | `/api/notion/:kind` | — | `{ kind, fields: NotionField[] }`（后台据此生成表单） |
| POST | `/api/notion/:kind` | `{ title?, body?, <列名或别名>: 值 }` | `201 NotionWriteResponse`，随后刷新该分类缓存 |
| PATCH | `/api/notion/:kind/:pageId` | 同上；带 `body` 时整页正文替换 | `NotionWriteResponse` |
| DELETE | `/api/notion/:kind/:pageId` | `?purge=1` 只清本地缓存 | `NotionWriteResponse`（Notion 中为归档，可从回收站恢复） |
| GET | `/api/uploads` | — | `{ files, usage }` |
| POST | `/api/uploads?name=x.mp4` | 原始字节作为 body | `201 UploadResponse`；边收边写盘，超限中断并清理 |
| POST | `/api/uploads` | multipart `file=` | `201 UploadResponse` |
| | …`&as=model` | 查询串或表单字段 | 把 `.glb` 存为首页 3D 雕像 |
| GET | `/api/uploads/:name` | — | `UploadFile` |
| PATCH | `/api/uploads/:name` | `{ name }` | `UploadFile`（扩展名必须不变；冲突 409） |
| DELETE | `/api/uploads/:name` | — | `204` |

## 相对旧版本的变更（迁移说明）

| 旧 | 新 |
| --- | --- |
| `/api/upload`、`/api/upload/:name` | `/api/uploads`、`/api/uploads/:name` |
| `DELETE /api/upload?name=` | `DELETE /api/uploads/:name` |
| `GET /api/upload?bare=1` | 删除（读 `files` 字段） |
| `PUT /api/posts/:slug`、`PUT /api/settings` | `PATCH`（`PUT` 仍可用） |
| 写操作返回 `{ ok, slug, … }` | 返回资源本体；删除返回 `204` |
| `GET /api/items/:kind/:slug` 的 `body` 字段 | 只保留 `bodyHtml` |
| `GET /api/notion/:kind` 返回数组 | `{ kind, fields }` |
| `GET /api/notion/:kind/:id`（占位 404） | 删除 |
| `/api/search?query=`、`/api/posts/:slug?html=1`、`POST /api/sync` body `{kind}` | `?q=`、`?format=html`、`?kind=` |
| 同步状态 `dbs` / `synced` | `databases` / `syncedAt` |
| 错误 `{ error, ...extra }` | `{ error, code, details? }` |
| 页面 `/writing/:slug` | `/works/:slug`（旧地址 301 跳转） |
