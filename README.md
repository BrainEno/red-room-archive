# Red Room Archive

把你的 **Notion 文章**发布成一个网站。首页是一间沉浸式的“红房间”：霓虹招牌、丝绒窗帘、大理石雕像。
**Notion 是唯一的数据源**，网站只负责展示：在 Notion 里写、勾选 Published，几分钟后网站上就能看到。

Astro 5（SSR / Node）· Three.js · GSAP · Lenis · Canvas 2D · Notion API · SQLite（只用作本地缓存）

```bash
npm install
cp .env.example .env   # 先填 ADMIN_TOKEN；Notion 可以之后在 /admin 里配置
npm run dev            # http://localhost:4321   后台：/admin
```

没配置 Notion 时，网站显示 3 篇内置的演示文章（`src/content/site.ts`），方便先看效果。

## 访客能看到什么

| 路径 | 内容 |
| --- | --- |
| `/` | 开场动画 → 引言（逐词点亮）→ **Latest / 最新**（按 Notion 日期时间倒序）→ **Featured / 精选**（Rank）→ **Topics / 主题**（标签，中英合并）→ **More / 更多**（“了解更多”入口 + 小字邮箱） |
| `/articles` | 全部文章，按日期时间倒序（同一天内按具体时刻），分页；`?tag=` 按标签筛选 |
| `/articles/:slug` | 正文（由 Notion 块渲染）、封面、日期、阅读时长、标签、目录、上一篇/下一篇 |
| `/search?q=` | 搜索标题、标签、摘要和正文 |
| `/more` | 自印出版物（封面、规格、选读）与联系方式（邮箱、社交账号二维码），内容在 `src/content/more.ts`，见下文 |
| `/rss.xml` · `/sitemap.xml` · `/robots.txt` | 订阅与搜索引擎 |
| `/media/notion/:id` | Notion 里上传的图片/文件的本地副本（见下文“图片”） |

**语言**：英文 / 简体中文，导航栏右侧 `EN / 中文` 切换（在首页切换会停在原来的位置，不重播开场）。
每个页面都可以加 `?lang=zh-CN` 或 `?lang=en`；选择会记在 `lang` cookie 里（一年），第一次访问按浏览器的 `Accept-Language`。
界面文字在 `src/ui/i18n.ts`，首页文案在 `src/content/site.ts`；文章本身不翻译，按标题自动标注 `lang`。
中文字体的做法见 **[docs/I18N.md](docs/I18N.md)**。

旧地址都会 301 跳转：`/works/*`、`/writing/*`、`/journal/*` → `/articles/*`（跳转不带 `?lang`，语言由 cookie 保持）；
旧博客 astro-notion 的 `/posts/:slug` → `/articles/:slug`，`/posts/tag/:tag` → `/articles?tag=`。

## 连接 Notion

1. 在 <https://www.notion.so/my-integrations> 新建一个 **Internal integration**，复制 token。
2. 打开你的文章数据库 → 右上角 `•••` → **Connections** → 添加这个 integration。
3. 在 `/admin → Settings` 填 token 和数据库（直接粘贴数据库链接即可），保存后点 **Check columns**，看每个字段对应到了哪一列。
4. 回到 **Articles** 面板点 **Sync now**。之后网站每 `SYNC_TTL_SECONDS`（默认 5 分钟）自动在后台刷新。

### 数据库列

只有**标题列**是必需的，其余都可选。列按**名称（不区分大小写/空格）+ 类型**一起识别，所以叫 “Date” 的文本列不会被当成日期。
默认名称沿用旧博客 astro-notion，那个数据库可以原样使用：

| 字段 | 识别的列名（节选） | 列类型 | 没有这列时 |
| --- | --- | --- | --- |
| 标题 | 任意名称（Page / Name / Title…） | Title | — |
| Slug | Slug | Text / Formula | 由标题生成；重名的第二篇得到 `-2` |
| 日期 | Date, Publish Date, 发布日期 | Date / Created time | 用页面创建时间 |
| 发布 | Published, Public, Status, 发布 | Checkbox，或 Status/Select 值为 Published/Public/Done/已发布 | **全部公开**（Check columns 会警告） |
| 标签 | Tags, Category, 标签 | Multi-select / Select | 无标签 |
| 摘要 | Excerpt, Summary, Description, 摘要 | Text | 无摘要 |
| 封面 | FeaturedImage, Cover, Image, 封面 | Files / URL | 用页面自身的封面 |
| 精选 | Rank, Featured, 权重 | Number / Checkbox | 不显示精选 |

- **定时发布**：日期在未来的文章不会出现，到期后的下一次同步自动出现（只有日期没有时间时按 UTC 零点）。
- 完整别名表在 `src/server/notion/mapper.ts` 的 `FIELDS`，想加自己的列名改这里即可。
- 读取用的是 Notion API `2022-06-28` 的 `databases/:id/query`；只支持单数据源的数据库（普通数据库都是）。

### 支持的 Notion 块

段落、标题 1–3（含可折叠标题）、有序/无序/待办列表（可嵌套）、引用、Callout（含图标）、Toggle、分隔线、代码（语言 + 说明）、
公式（目前显示 TeX 源码）、图片、视频（YouTube/Vimeo 嵌入或原生播放）、音频、文件、PDF、嵌入、书签、链接预览、
表格（列标题/行标题）、分栏、同步块、目录、页面链接与 @提及（只链接到已发布的文章）、文字颜色与背景色。
`child_page` / `child_database` 不会被展开（避免把私有子页面公开）。所有文本都转义，链接只放行 http/https/mailto/tel。

### 图片

Notion 里上传的图片和文件是带签名的临时地址（约 1 小时失效），不能直接写进缓存的 HTML。
网站改为输出 `/media/notion/<id>`：第一次被访问时向 Notion 重新取一个新地址、下载到 `MEDIA_CACHE_DIR`，之后直接从磁盘发；
文章在 Notion 里被编辑后，旧副本在下次同步时删除。只有已发布文章里出现的文件 id 才会被代理，其他一律 404。
外链图片（`external`）直接使用原地址。

### 中英文标签

Notion 只有一个标签列，中英文章混写时会出现 `Fiction` 和 `小说` 这样意思相同的两个标签。网站会把它们合并成**一个主题**：
中文界面只显示“小说”，英文界面只显示“Fiction”，文章数合并，`?tag=fiction` 与 `?tag=小说` 是同一个筛选。

- 常见写作主题（小说、随笔、诗歌、笔记、评论、翻译、电影、摄影……）已内置对照表：`src/content/tags.ts`。
- 自己的标签：后台 **Settings → Tag pairs**，一行一组，如 `Red Room = 红房间`、`Poetry, Poem = 诗歌, 诗`（逗号分隔多个别名，后台的优先于内置的）。
- 也可以直接在 Notion 里把标签写成 `Fiction / 小说`，网站会学到这一对，别的文章上单独的 `小说` 也会归进来。
- 显示名优先用你实际用过的写法（文章标的是 `Poem` 就显示 Poem，不会改成对照表里的 Poetry）。
- 没有对照的标签在两种语言里都按原样显示。

## “更多”页面 `/more`

内容写在 `src/content/more.ts`（不经过 Notion），每段文字可以是一个字符串，或 `{ en, 'zh-CN' }` 两种语言：

- **publications**：自印出版物——书名、副标题、年份、形式、页数、印量、尺寸、封面、选读段落、出处；
  有 `link` 时按钮指向购买页，没有时按钮打开一封以书名为主题、写给站点邮箱的邮件。
- **channels**：社交账号——平台、账号、链接、二维码图片。
- 图片放进 `public/more/`，写成 `/more/文件名`；或在后台 Files 上传后写 `/uploads/文件名`。
  没有封面时页面会画一个和网站同风格的文字封面；`qr: ''` 显示空的二维码框（占位），删掉 `qr` 就只显示文字。
- 文件里现在是**示例条目**，用来预览版式，请替换成你的出版物和账号。

邮箱默认 `nodeman24@outlook.com`（`src/content/site.ts`），后台 Settings 里的 Contact email 优先。

## 后台 `/admin`

输入 `ADMIN_TOKEN` 登录（只存在当前标签页的 sessionStorage；请用 HTTPS 部署）。

- **Articles**：已发布文章一览；**Sync now** / **Sync + fetch bodies**（同时预取所有正文，让搜索覆盖全文）/ **Full resync**（清空正文和图片缓存后重新同步）；单篇 **Refresh** 重新拉取正文。
- **Settings**：站点名称/邮箱；简介（meta description）与首页引言，英文、中文各一份（中文留空就用内置中文文案，不会回退到英文）；中英标签对照（Tag pairs）；Notion token 与数据库（优先于 `.env`）；**Check columns** 显示字段映射与警告。
- **Files**：上传音频/视频/图片/PDF；上传 `.glb` 并选择 “Statue model” 可替换首页雕像。

网站**从不写回 Notion**（`tests/architecture.test.mjs` 会检查客户端里没有写请求）。

## 代码结构

UI 与 API 分离，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：

```
src/shared   API 契约类型 + 公开 URL 规则         src/server   SQLite 缓存、Notion 读取、媒体代理、服务、HTTP 端点
src/core     纯函数（Notion 块渲染、安全、文本）    src/ui       布局、组件、视图、浏览器脚本、样式
src/content  站点文案、演示文章                    src/pages    路由：只做取数 + 渲染，或转发到端点
```

- 首页动画参数：`src/ui/scripts/site/home.ts`（镜头关键帧）、`neon.ts`（招牌）、`scene.ts`（窗帘、雕像、灯光）。
- 首页文案（引言、facts、标语，中英两份）：`src/content/site.ts`；“更多”页面：`src/content/more.ts`；标签对照：`src/content/tags.ts`；界面文字（导航、区块标题、分页…）：`src/ui/i18n.ts`；名称/邮箱/简介/引言也可以在后台改。
- 中文显示字体：`public/fonts/display-sc/`，由 `scripts/fonts/build-display-sc.py` 生成，见 [docs/I18N.md](docs/I18N.md)。
- 接口约定见 **[docs/API.md](docs/API.md)**；为什么选择在本仓库实现、而不是回到旧仓库，见 [docs/NOTION-ONLY.md](docs/NOTION-ONLY.md)。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | — | **必填**。后台登录与所有管理接口 |
| `SITE_URL` | — | 站点公开地址（如 `https://archive.example`），用于 canonical、RSS、sitemap 的绝对链接 |
| `NOTION_TOKEN` | — | integration token（也接受旧名 `NOTION_API_SECRET`）。后台填写的优先 |
| `NOTION_DATABASE_ID` | — | 数据库 id 或链接（也接受 `DATABASE_ID`、旧的 `NOTION_DB_WRITING`）。后台填写的优先 |
| `SYNC_TTL_SECONDS` | 300 | 文章列表多久后在后台刷新 |
| `NOTION_TIMEOUT_MS` | 15000 | 单次 Notion 请求超时（429/5xx 会按 `Retry-After` 重试 2 次） |
| `MEDIA_CACHE_DIR` | `<DB 所在目录>/notion-media` | Notion 图片/文件的本地副本 |
| `MAX_MEDIA_MB` | 50 | 媒体代理单个文件上限 |
| `DB_PATH` | `data/archive.db` | SQLite 缓存文件 |
| `UPLOAD_DIR` | `data/uploads` | 后台上传目录 |
| `MAX_UPLOAD_MB` | 300 | 单个上传文件上限 |
| `MAX_JSON_KB` | 256 | JSON 请求体上限 |
| `NOTION_API_BASE` | `https://api.notion.com/v1` | 仅用于测试或代理 |

读取顺序：`process.env` → 构建时注入的 `import.meta.env` → 运行目录的 `.env` / `.env.local`。改完 `.env` 需重启进程。

## 部署

`npm run build && npm start`。需要可写磁盘的 Node 环境（VPS / Fly.io / Railway 卷）：SQLite 缓存、图片副本和上传文件都在磁盘上。
部署探针：`GET /api/health`。

文章内容在 Notion 里，SQLite 只是**可以随时丢弃的缓存**（删掉后下一次访问会重新同步）；需要备份的只有 `UPLOAD_DIR`（如果用过上传）。
从旧版本升级：数据库会自动迁移；旧的 `items` / `posts` / `post_revisions` 表原样保留但不再使用，确认不需要后可以手动删除。

## 开发与验证

```bash
npm test            # 渲染器、Notion 映射、接口契约（用假的 Notion）、架构边界（node:test）
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建
npm run check       # 以上三步
node tests/fixtures/notion-mock.mjs 4999 [--showcase]   # 本地假 Notion：NOTION_API_BASE=http://127.0.0.1:4999/v1；--showcase 加几篇中英文章预览排版
```

CI（`.github/workflows/validate.yml`）依次执行类型检查、测试与构建。

## 还没做

公式用 KaTeX 渲染、代码高亮、书签卡片抓取标题/缩略图、Notion webhook 即时刷新、多个数据库、对象存储（R2/S3）。
音乐与影像模块已暂时移除，需要时可以作为新的 Notion 数据库重新接入。
