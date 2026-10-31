# API 约定（v2 · Notion-only）

类型定义的唯一来源是 [`src/shared/contracts.ts`](../src/shared/contracts.ts)，本文是它的说明。
v2 起网站只读 Notion：没有任何创建/修改文章的接口，内容请在 Notion 里编辑。

## 通用规则

- **鉴权**：后台接口需要 `Authorization: Bearer <ADMIN_TOKEN>`。标记为 *公开* 的接口可匿名访问。
- **请求体**：JSON（`Content-Type: application/json`，默认上限 256 KB，`MAX_JSON_KB` 可调；More 文档上限为两者中较大的 8 MiB）；上传除外。读取时按实际字节限额，超限响应关闭连接。multipart 单文件上限为 `min(MAX_UPLOAD_MB, 8 MiB)`，较大文件使用 `?name=` 原始流上传。
- **分页**：`?limit=&offset=`，响应带 `total / limit / offset`。
- **错误**：始终是 `{ "error": "说明", "code": "not_found", "details": { "slug": "x" } }`

  | HTTP | code | 何时 |
  | --- | --- | --- |
  | 400 | `bad_request` | 参数非法、Notion 未配置 |
  | 401 | `unauthorized` | 缺少或错误的 token（带 `WWW-Authenticate: Bearer`） |
  | 403 | `forbidden` | 邮件订阅或浏览统计的公开写入收到跨站请求（`Origin` / `Sec-Fetch-Site` 不符） |
  | 404 | `not_found` | 文章不存在（未发布、定时未到也是 404） |
  | 409 | `conflict` | 上传文件名冲突，或 Notion 设置/文章在操作期间发生变化，请重试 |
  | 410 | `gone` | 订阅确认链接已过期（`details.reason: "expired"`） |
  | 413 | `payload_too_large` | 请求体、上传文件或 Notion 文件过大 |
  | 429 | `rate_limited` | 错误 token 次数过多（10 分钟内每个桶 12 次，另有全局上限）；带转发头的请求共用一个桶，不信任转发 IP |
  | 502 | `upstream_error` | Notion 拒绝或不可达（上游细节只写服务器日志） |
  | 503 | `unavailable` | 服务器未配置 `ADMIN_TOKEN` / Notion |
  | 500 | `internal` | 未预期的错误 |
- **缓存**：公开读接口通常带短 `Cache-Control`，即使请求带 token 也可能被公开缓存；`/api/site`、管理接口和带管理员凭据的文章详情使用 `no-store`。不要向公开接口发送敏感数据。
- **语言**：`/api/site` 的简介/引言/标语，以及文章、标签、搜索接口里的**标签名**随 `?lang=en|zh-CN` 变化（默认 `en`；不看 cookie 和 `Accept-Language`，同一个 URL 永远返回同一种语言，方便缓存）。
  标题、摘要、正文是 Notion 原文，与语言无关。`TagCount.key` 在两种语言里相同，可以当作稳定的主题 id。HTML 页面按 `?lang` → `lang` cookie → `Accept-Language` → `en` 决定语言，响应带 `Content-Language` 与 `Vary: Cookie, Accept-Language`。

## 公开接口

| 方法 | 路径 | 说明 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | 探针 | `HealthResponse` |
| GET | `/api/site?lang=` | 站点信息（`about`/`intro`/`tagline` 为该语言的版本，`locale` 回显实际语言）、文章数、是否演示模式 | `SiteResponse` |
| GET | `/api/articles?tag=&limit=&offset=&lang=` | 文章列表，按日期时间倒序（只有日期的按当天 00:00 UTC；同一时刻按 Notion 创建时间，再按标题）；`tag` 接受主题的任一名称或 key（`fiction`、`Fiction`、`小说` 等价） | `ArticleListResponse` |
| GET | `/api/articles/:slug?lang=` | 单篇（含渲染后的 `html`、`toc`、`readingMinutes`、`previous`/`next`）。`?refresh=1` 重新从 Notion 取正文，**仅管理员** | `ArticleDetail` |
| GET | `/api/tags?lang=` | 所有主题（中英同义标签已合并）及文章数，按数量倒序；`{ key, slug, name, count }`，`slug` 是主题页 `/topics/<slug>` 的地址段 | `TagListResponse` |
| GET | `/api/search?q=&limit=&lang=` | 标题、标签（含另一种语言的对照名）、摘要、已缓存正文；多个词必须都命中 | `SearchResponse` |
| GET | `/api/more?lang=` | “更多”页面（该语言；空字段用另一种语言补上；选读已按空行分段）。与 `/more` 页面数据相同 | `MoreResponse` |

```ts
interface ArticleSummary {
  id: string;          // Notion page id
  slug: string;
  title: string;
  date: string;        // Notion Date 列原样（YYYY-MM-DD，或带时间和时区的 ISO），Date 留空或缺失时为首次成功同步发现公开的服务器本地日期
  tags: string[];      // 标签显示名（?lang= 的语言），每个主题一个：同时标了 Fiction 和 小说 只出现一次
  topics: { name: string; slug: string }[]; // 与 tags 一一对应，带主题页 slug（/topics/<slug>，中文页加 /zh-CN）
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

## 第一方浏览统计

`/api/analytics/*` 在 Node 由 SQLite、在 Netlify 静态站由 Function + Blobs 提供，两种部署共用 `src/server/analytics/http.ts` 和 DTO。统计只有每日 pageview 聚合，不是独立访客或用户跟踪；详细隐私和部署说明见 [ANALYTICS.md](ANALYTICS.md)。

### 公开收集

`POST /api/analytics/collect`，请求体最多 2 KiB，`Content-Type: application/json`：

```json
{ "path": "/articles/example", "referrer": "news.example" }
```

只接受公开路径白名单和来源主机（或 `(direct)` / `(internal)`）；查询字符串、完整 referrer、IP、User-Agent 和访客 ID 不进入接口契约。成功返回 `204`，无响应体。DNT/GPC 请求也返回 `204`，但不写入。跨站 Origin / Fetch-Site 返回 `403`。

### 管理接口

以下接口都需要 `Authorization: Bearer <ADMIN_TOKEN>`，并返回 `Cache-Control: no-store`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/analytics/admin/summary?days=7\|30\|90` | `AnalyticsSummaryResponse`：UTC 日期范围、总量、今日、每日序列、路径／来源／语言计数、开关、存储类型和 90 天滚动窗口 |
| PATCH | `/api/analytics/admin/settings` | `{ enabled: boolean }`，暂停／恢复收集；已有数据保留 |
| DELETE | `/api/analytics/admin/data` | 删除所有每日聚合，保留开关；返回 `{ cleared: true }` |
| GET | `/api/analytics/admin/export?days=7\|30\|90` | UTF-8 BOM CSV：`date,metric,key,pageviews`，防电子表格公式注入 |

统计接口不使用 cookie 会话；管理 token 只在当前后台标签页保存。公开页面不会因为统计服务不可用而影响阅读。

## 后台接口（需要 token）

| 方法 | 路径 | 说明 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/auth` | 服务器是否配置了 `ADMIN_TOKEN`（公开） | `AuthStatusResponse` |
| POST | `/api/auth` | `{ token }` 校验登录（公开，带限流） | `AuthResponse` |
| GET | `/api/overview` | 后台概览：同步状态；站点名称、邮箱、`SITE_URL`；文章总数、精选（Rank > 0）、主题数、无标签数、最新一篇、每年篇数；“更多”页（是否保存过、出版物/渠道数）；上传文件数与大小；`checks`：需要处理的事项（`{ code, level: 'warn' \| 'info', count? }`，只给代码，文字由后台按界面语言翻译）。只读，不含任何凭据 | `OverviewResponse` |
| GET | `/api/settings` | 设置（token 打码）+ 同步状态 | `SettingsResponse` |
| PATCH | `/api/settings` | 局部更新。空字符串清除普通设置的覆盖值；空或打码的 Notion token 表示保持不变；`NOTION_DATABASE_ID` 可传 id 或数据库链接。改变 token/数据库会清空文章缓存 | `SettingsResponse` |
| POST | `/api/settings/profile` | 导入站点资料 JSON（`red-room-site-profile`，版本 1 或 2），只替换公开字段，不动 Notion 配置 | `SettingsResponse` |
| GET | `/api/content-bundle` | 下载内容包 ZIP：`site-profile.json`、`more.json`（保存过才有）、`uploads/`（“更多”页面引用的文件 + 雕像模型）、`README.txt`。供静态构建使用（解压到 `site-content/`） | `application/zip` |
| GET | `/api/sync` | 同步状态 | `SyncStatusResponse` |
| POST | `/api/sync` | 立即同步。`?full=1` 成功取回文章列表后清空正文与图片缓存；`?bodies=1` 同步后预取所有缺失正文 | `SyncResponse` |
| GET | `/api/notion/schema` | 数据库的列、每个文章字段对应到哪一列、警告 | `NotionSchemaResponse` |
| GET | `/api/webhooks/notion` | Webhook 状态：接收地址（需 `SITE_URL`）、`state`（`off` / `pending` / `active`）、令牌（仅 `pending` 时完整显示，之后打码；`NOTION_WEBHOOK_TOKEN` 固定的永不返回）、收到/拒绝的事件数和时间 | `WebhookStatusResponse` |
| DELETE | `/api/webhooks/notion` | 清除保存的令牌和计数，以便重新订阅 | `WebhookStatusResponse` |
| GET/POST | `/api/uploads` | 列表 / 上传（`?name=` 流式或 multipart；`as=model` 替换首页雕像） | `UploadListResponse` / `UploadResponse` |
| GET/PATCH/DELETE | `/api/uploads/:name` | 信息 / 改名 / 删除。改名时“更多”页面里引用它的封面/二维码地址同步更新 | `UploadFile` / 204 |
| GET | `/api/more/document` | “更多”页面的双语文档；`custom: false` 表示还没保存过（显示 `src/content/more.ts` 示例） | `MoreDocumentResponse` |
| PUT | `/api/more/document` | 整体替换（不是局部更新），校验后保存；请求体上限 `max(MAX_JSON_KB, 8 MB)` | `MoreDocumentResponse` |
| DELETE | `/api/more/document` | 删除保存的文档，回到内置示例 | `MoreDocumentResponse` |

列表接口里的 `UploadFile.usedBy` 为 `['more']` 时，表示该文件是“更多”页面的封面或二维码。

### “更多”页面文档

```ts
interface LocalizedText { en: string; 'zh-CN': string }   // 空的一边在页面上用另一边
interface MoreDocument {
  intro: LocalizedText;
  publications: {            // 最多 60 本；数组顺序 = 页面顺序
    id: string;              // [\w-]{1,40}，缺失或重复时自动生成
    title, subtitle, format, edition, size, excerptSource, linkLabel: LocalizedText;
    excerpt: LocalizedText;  // 空一行 = 新段落；每种语言最多 20 000 字
    year: string;
    pages: number | null;    // 0–100000 的整数
    cover: string;           // '' | 站内路径（/uploads/…、/more/…）| https://…
    link: string;            // '' | http(s):// | mailto: | 站内路径
  }[];
  channels: {                // 最多 30 个
    id: string;
    name, note: LocalizedText;
    handle: string;
    href: string;            // 同 link
    qr: string;              // 同 cover
  }[];
}
```

校验失败返回 `400 bad_request`，`details.field` 是出错字段的路径（如 `publications.0.link`、`channels.1.qr`），后台据此定位输入框。
`PUT` 也接受宽松写法：字符串表示两种语言相同；`excerpt` 可以是段落数组；`link` 可以是 `{ href, label }`（与 `src/content/more.ts` 的写法一致）。

`SettingKey`：`site_name` `site_email` `site_about` `site_intro` `site_about_zh` `site_intro_zh` `site_tagline` `site_tagline_zh` `site_facts` `site_facts_zh` `tag_glossary` `NOTION_TOKEN` `NOTION_DATABASE_ID`。
`tag_glossary` 是多行文本，一行一组同义标签（`Fiction = 小说`），叠加在内置对照表 `src/content/tags.ts` 之上。
`site_facts` / `site_facts_zh` 是首页信息栏：每行一条 `标签: 内容`（第一个 `:` 或 `：` 分隔，最多 6 条，标签 ≤ 40 字、内容 ≤ 200 字），格式不对返回 `400`；空 = 内置默认，`-` = 隐藏。`GET /api/site` 的 `facts` 是解析后的结果。
`*_zh` 是中文版本；某种语言没有覆盖值时使用 `src/content/site.ts` 里该语言的内置文案（不会跨语言回退）。保存的值等于默认值时会删除该覆盖。

### Notion webhook 接收端

`POST /api/webhooks/notion` 由 Notion 调用，不需要 admin token，靠签名认证。请求体上限 64 KB。

- `{ "verification_token": "…" }`（创建订阅时的一次性请求）：保存令牌，状态变为 `pending` → `200 { ok: true, outcome: "verification" }`。
  已启用或令牌由环境变量固定时返回 `409`。
- 事件：必须带 `X-Notion-Signature: sha256=<hex>`（用令牌对原始请求体做 HMAC-SHA256）。缺少或不匹配 → `401`（计入 `rejected`）。
  通过后返回 `200`，`outcome` 为 `synced`（`page.*` / `database.*` / `data_source.*`：约 4 秒后同步一次）、`ignored`（如 `comment.*`）或 `duplicate`（同一事件 id 的重试）。
  第一条签名正确的事件把状态从 `pending` 改为 `active`。

## 邮件订阅

`/api/newsletter/*`。Node 站点由 `src/pages/api/newsletter/[...path].ts` 提供，Netlify 静态站由 `netlify/functions/newsletter.mts` 提供，两者共用 `src/server/newsletter/http.ts`，行为相同。类型见 `contracts.ts` 的 `Newsletter*`。设计说明见 [NEWSLETTER.md](NEWSLETTER.md)。

所有响应 `Cache-Control: no-store`。公开的 POST 接口要求 `Content-Type: application/json`、同源 `Origin` / `Sec-Fetch-Site`（否则 `403`），请求体上限 **4 KB**（`413`）。

| 方法 | 路径 | 鉴权 | 说明 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/newsletter/status` | 公开 | 是否开放订阅（不暴露配置细节） | `{ enabled }` |
| POST | `/api/newsletter/subscribe` | 公开 | `{ email, locale?, source?, website? }`；`website` 是蜜罐，必须为空 | `202 { status: "check-inbox" }`——无论地址是新的、待确认、已订阅还是已退订都一样 |
| POST | `/api/newsletter/confirm` | 公开（token） | `{ token }` | `{ status: "confirmed" \| "already-confirmed" }` |
| POST | `/api/newsletter/unsubscribe` | 公开（token） | `{ token }`；幂等 | `{ status: "unsubscribed" }` |
| POST | `/api/newsletter/unsubscribe?token=…` | 公开（token） | RFC 8058 一键退订：请求体必须是 `List-Unsubscribe=One-Click`（表单），不检查 Origin | 同上 |
| GET | `/api/newsletter/unsubscribe?token=…` | — | 不执行退订（链接扫描器会预取），`303` 跳到 `/newsletter/unsubscribe#token=…` 由读者点击 | `303` |
| GET | `/api/newsletter/admin/subscribers?q=&status=&limit=&offset=` | admin | 搜索（邮箱包含 `q`）、筛选、分页（`limit` ≤ 200） | `{ subscribers, total, counts, delivery }` |
| GET | `/api/newsletter/admin/export?q=&status=` | admin | CSV（UTF-8 BOM）：`email,status,locale,source,created_at,confirmed_at,unsubscribed_at`；防公式注入 | `text/csv` 附件 |
| POST | `/api/newsletter/admin/subscribers/:id/resend` | admin | 给待确认地址重发确认信 | `{ status: "sent" }`；不是待确认 `409`，不存在 `404` |

错误：

| HTTP | 何时 |
| --- | --- |
| 400 | 邮箱格式不对（`details.field: "email"`）；token 无效或已被新链接替换（`details.reason: "invalid"`） |
| 410 | 确认链接过期（`details.reason: "expired"`） |
| 429 | 限流：每客户端 10 分钟 8 次；同一地址 10 分钟内只发一封确认信、24 小时最多 5 封（超出时仍返回 202 但不发信，以免暴露地址状态） |
| 502 | 邮件服务拒绝或不可达；`Nothing was activated`，可立即重试 |
| 503 | 邮件未配置（`not configured … Nothing was saved`）；发信上限用完（`details.reason` 为 `daily-limit` 或 `monthly-limit`，含 Resend 返回 `daily_quota_exceeded` / `monthly_quota_exceeded` 的情况）；或存储无法解密 |

admin 接口使用与其他后台接口相同的 `ADMIN_TOKEN` 和错误限流；`delivery` 为 `{ configured, provider, missing, storage, dailyLimit, monthlyLimit, sentToday, sentThisMonth }`，只列出缺少的**变量名**，从不返回值。响应里没有 token、token 哈希或任何密钥。

## 从 v1 迁移

| v1 | v2 |
| --- | --- |
| `GET /api/archive`、`/api/items/:kind`、`/api/items/:kind/:slug` | `GET /api/articles`、`/api/articles/:slug` |
| `/api/posts*`、`/api/markdown`、`/api/posts/:slug/revisions*`、`/api/trash*` | 删除（文章只在 Notion 里编辑） |
| `/api/backups*`、`/api/export`、`/api/import` | 删除（文章在 Notion；SQLite 仍存有站点设置和“更多”页面，需备份） |
| `/api/notion/:kind`（读列 / 写页面） | `GET /api/notion/schema`（只读） |
| `POST /api/sync?kind=` | `POST /api/sync?full=&bodies=` |
| `SearchResponse.posts / items` | `SearchResponse.articles` |
| `SettingKey` `NOTION_DB_WRITING/FILMS/MUSIC` | `NOTION_DATABASE_ID`（旧的 `NOTION_DB_WRITING` 仍作为后备读取） |
