# API 约定（v2 · Notion-only）

类型定义的唯一来源是 [`src/shared/contracts.ts`](../src/shared/contracts.ts)，本文是它的说明。
v2 起网站只读 Notion：没有任何创建/修改文章的接口，内容请在 Notion 里编辑。

## 通用规则

- **鉴权**：后台接口需要 `Authorization: Bearer <ADMIN_TOKEN>`。标记为 *公开* 的接口可匿名访问。
- **请求体**：JSON（`Content-Type: application/json`，默认上限 256 KB，`MAX_JSON_KB` 可调）；上传除外。
- **分页**：`?limit=&offset=`，响应带 `total / limit / offset`。
- **错误**：始终是 `{ "error": "说明", "code": "not_found", "details": { "slug": "x" } }`

  | HTTP | code | 何时 |
  | --- | --- | --- |
  | 400 | `bad_request` | 参数非法、Notion 未配置 |
  | 401 | `unauthorized` | 缺少或错误的 token（带 `WWW-Authenticate: Bearer`） |
  | 404 | `not_found` | 文章不存在（未发布、定时未到也是 404） |
  | 409 | `conflict` | 上传文件名冲突 |
  | 413 | `payload_too_large` | 请求体、上传文件或 Notion 文件过大 |
  | 429 | `rate_limited` | 错误 token 次数过多（同 IP 10 分钟内 12 次） |
  | 502 | `upstream_error` | Notion 拒绝或不可达（上游细节只写服务器日志） |
  | 503 | `unavailable` | 服务器未配置 `ADMIN_TOKEN` / Notion |
  | 500 | `internal` | 未预期的错误 |
- **缓存**：公开读接口带短 `Cache-Control`；带 token 的请求一律 `no-store`。
- **语言**：`/api/site` 的简介/引言，以及文章、标签、搜索接口里的**标签名**随 `?lang=en|zh-CN` 变化（默认 `en`；不看 cookie 和 `Accept-Language`，同一个 URL 永远返回同一种语言，方便缓存）。
  标题、摘要、正文是 Notion 原文，与语言无关。`TagCount.key` 在两种语言里相同，可以当作稳定的主题 id。HTML 页面按 `?lang` → `lang` cookie → `Accept-Language` → `en` 决定语言，响应带 `Content-Language` 与 `Vary: Cookie, Accept-Language`。

## 公开接口

| 方法 | 路径 | 说明 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | 探针 | `HealthResponse` |
| GET | `/api/site?lang=` | 站点信息（`about`/`intro` 为该语言的版本，`locale` 回显实际语言）、文章数、是否演示模式 | `SiteResponse` |
| GET | `/api/articles?tag=&limit=&offset=&lang=` | 文章列表，按日期时间倒序（只有日期的按当天 00:00 UTC；同一时刻按 Notion 创建时间，再按标题）；`tag` 接受主题的任一名称或 key（`fiction`、`Fiction`、`小说` 等价） | `ArticleListResponse` |
| GET | `/api/articles/:slug?lang=` | 单篇（含渲染后的 `html`、`toc`、`readingMinutes`、`previous`/`next`）。`?refresh=1` 重新从 Notion 取正文，**仅管理员** | `ArticleDetail` |
| GET | `/api/tags?lang=` | 所有主题（中英同义标签已合并）及文章数，按数量倒序；`{ key, name, count }` | `TagListResponse` |
| GET | `/api/search?q=&limit=&lang=` | 标题、标签（含另一种语言的对照名）、摘要、已缓存正文；多个词必须都命中 | `SearchResponse` |

```ts
interface ArticleSummary {
  id: string;          // Notion page id
  slug: string;
  title: string;
  date: string;        // Notion Date 列原样（YYYY-MM-DD，或带时间和时区的 ISO），没有 Date 列时为创建时间
  tags: string[];      // 标签显示名（?lang= 的语言），每个主题一个：同时标了 Fiction 和 小说 只出现一次
  excerpt: string;
  cover: string | null; // /media/notion/<id>（Notion 上传）或外链
  rank: number;        // >0 为精选
  href: string;        // /articles/<slug>
  updated: string;     // Notion last_edited_time
}
```

### 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/HEAD | `/media/notion/:id` | Notion 上传文件的本地副本。只服务已发布文章引用过的 id；支持 Range、ETag；带 `Content-Security-Policy: sandbox`；非图片/音视频/PDF 类型以附件下载 |
| GET/HEAD | `/uploads/:name` | 后台上传的文件 |

## 后台接口（需要 token）

| 方法 | 路径 | 说明 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/auth` | 服务器是否配置了 `ADMIN_TOKEN`（公开） | `AuthStatusResponse` |
| POST | `/api/auth` | `{ token }` 校验登录（公开，带限流） | `AuthResponse` |
| GET | `/api/settings` | 设置（token 打码）+ 同步状态 | `SettingsResponse` |
| PATCH | `/api/settings` | 局部更新。空字符串 = 清除覆盖值；打码的 token = 保持不变；`NOTION_DATABASE_ID` 可传 id 或数据库链接。改变 token/数据库会清空文章缓存 | `SettingsResponse` |
| GET | `/api/sync` | 同步状态 | `SyncStatusResponse` |
| POST | `/api/sync` | 立即同步。`?full=1` 先清空正文与图片缓存；`?bodies=1` 同步后预取所有缺失正文 | `SyncResponse` |
| GET | `/api/notion/schema` | 数据库的列、每个文章字段对应到哪一列、警告 | `NotionSchemaResponse` |
| GET/POST | `/api/uploads` | 列表 / 上传（`?name=` 流式或 multipart；`as=model` 替换首页雕像） | `UploadListResponse` / `UploadResponse` |
| GET/PATCH/DELETE | `/api/uploads/:name` | 信息 / 改名 / 删除 | `UploadFile` / 204 |

`SettingKey`：`site_name` `site_email` `site_about` `site_intro` `site_about_zh` `site_intro_zh` `tag_glossary` `NOTION_TOKEN` `NOTION_DATABASE_ID`。
`tag_glossary` 是多行文本，一行一组同义标签（`Fiction = 小说`），叠加在内置对照表 `src/content/tags.ts` 之上。
`*_zh` 是中文版本；某种语言没有覆盖值时使用 `src/content/site.ts` 里该语言的内置文案（不会跨语言回退）。保存的值等于默认值时会删除该覆盖。

## 从 v1 迁移

| v1 | v2 |
| --- | --- |
| `GET /api/archive`、`/api/items/:kind`、`/api/items/:kind/:slug` | `GET /api/articles`、`/api/articles/:slug` |
| `/api/posts*`、`/api/markdown`、`/api/posts/:slug/revisions*`、`/api/trash*` | 删除（文章只在 Notion 里编辑） |
| `/api/backups*`、`/api/export`、`/api/import` | 删除（数据在 Notion；SQLite 只是缓存） |
| `/api/notion/:kind`（读列 / 写页面） | `GET /api/notion/schema`（只读） |
| `POST /api/sync?kind=` | `POST /api/sync?full=&bodies=` |
| `SearchResponse.posts / items` | `SearchResponse.articles` |
| `SettingKey` `NOTION_DB_WRITING/FILMS/MUSIC` | `NOTION_DATABASE_ID`（旧的 `NOTION_DB_WRITING` 仍作为后备读取） |
