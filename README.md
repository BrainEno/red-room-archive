# Red Room Archive

把你的 **Notion 文章**发布成一个网站。首页是一间沉浸式的“红房间”：霓虹招牌、丝绒窗帘、大理石雕像。
文章以 Notion 为数据源：在 Notion 里写、勾选 Published，通过访问触发刷新或在后台手动同步后即可看到。站点设置和“更多”页面保存在本地。

Astro 7（SSR / Node）· Three.js · GSAP · Lenis · Canvas 2D · Notion API · SQLite（文章缓存与本地设置）

需要 Node.js **22.23.4 或更高版本**和 npm（至少 9.6.5）；CI 使用 Node.js 22.23.4。使用 nvm 的话可先在项目根目录执行 `nvm install && nvm use`。在项目根目录执行：

```bash
npm ci                 # 按 package-lock.json 安装依赖
cp .env.example .env   # 先填 ADMIN_TOKEN；Notion 可以之后在 /admin 里配置
npm run dev            # http://localhost:4321   后台：/admin
```

### 字体模块找不到？

如果启动时报 `Cannot find module '@fontsource-variable/archivo/wdth.css'`，先停止开发服务器，在包含 `package-lock.json` 的项目根目录运行 `npm ci`，然后重新运行 `npm run dev`。`npm ci` 会删除并重建 `node_modules`，**不会删除 `.env` 或 `data/`**；不要删除或重建锁文件。切换分支或更新代码后也可能需要重新安装依赖。

可以用 `node -p "require.resolve('@fontsource-variable/archivo/wdth.css')"` 检查当前安装是否能解析该文件。锁定的 Archivo 版本包含这个文件；它提供页面使用的可变字宽，不应改成默认的仅字重字体。如果重装失败，请先检查 npm 的安装错误；若解析成功但仍报错，请确认启动命令是在正确的项目目录中运行。

Windows PowerShell 可用 `Copy-Item .env.example .env` 创建配置文件。

没配置 Notion 时，网站显示 3 篇内置的演示文章（`src/content/site.ts`），方便先看效果。

## 访客能看到什么

| 路径 | 内容 |
| --- | --- |
| `/` | 开场动画 → 引言（逐词点亮）→ **Latest / 最新**（按 Notion 日期时间倒序）→ **Featured / 精选**（Rank）→ **Topics / 主题**（标签，中英合并）→ **More / 更多**（“了解更多”入口 + 小字邮箱） |
| `/articles` | 全部文章，按日期时间倒序（同一天内按具体时刻），分页；`?tag=` 按标签筛选 |
| `/articles/:slug` | 正文（由 Notion 块渲染）、封面、日期、阅读时长、标签、目录、上一篇/下一篇 |
| `/search?q=` | 搜索标题、标签、摘要和正文 |
| `/more` | 自印出版物（封面、规格、选读）与联系方式（邮箱、社交账号二维码），在后台 **More** 编辑，见下文 |
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
4. 回到 **Articles** 面板点 **Sync now**。之后文章列表缓存超过 `SYNC_TTL_SECONDS`（默认 5 分钟）时，下一次访问会触发后台刷新，当前请求先返回缓存；没有访问就不会自动刷新。需要立即更新可点击 **Sync now**。

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
- 读取用的是 Notion API `2022-06-28` 的 `databases/:id/query`；只支持单数据源的数据库；多数据源数据库暂不支持。

### 支持的 Notion 块

段落、标题 1–3（含可折叠标题）、有序/无序/待办列表（可嵌套）、引用、Callout（含图标）、Toggle、分隔线、代码（语言 + 说明）、
公式（目前显示 TeX 源码）、图片、视频（YouTube/Vimeo 嵌入或原生播放）、音频、文件、PDF、嵌入、书签、链接预览、
表格（列标题/行标题）、分栏、同步块、目录、页面链接与 @提及（只链接到已发布的文章）、文字颜色与背景色。
`child_page` / `child_database` 不会被展开（避免把私有子页面公开）。所有文本都转义，链接只放行 http/https/mailto/tel。

### 图片

Notion 里上传的图片和文件是带签名的临时地址（约 1 小时失效），不能直接写进缓存的 HTML。
网站改为输出 `/media/notion/<id>`：第一次被访问时向 Notion 重新取一个新地址、下载到 `MEDIA_CACHE_DIR`，之后直接从磁盘发；
文章在 Notion 里被编辑后，旧副本在下次同步时删除。只有已发布文章里出现的文件 id 才会被代理，其他一律 404。
文章没有封面时，列表以标题、日期、摘要和标签呈现，不显示占位图片；正文直接从文章头部进入。
搜索结果和首页本来就是文字列表；无封面文章不添加虚构的社交分享图或 RSS 附件。

外链图片（`external`）直接使用原地址。媒体缓存按 Notion 配置版本分目录；升级后旧格式的磁盘副本不会再被读取，
会在需要时重新下载。旧缓存可在停服后从 `MEDIA_CACHE_DIR` 清理（不要删除 `DB_PATH` 或 `UPLOAD_DIR`）。

### 中英文标签

Notion 只有一个标签列，中英文章混写时会出现 `Fiction` 和 `小说` 这样意思相同的两个标签。网站会把它们合并成**一个主题**：
中文界面只显示“小说”，英文界面只显示“Fiction”，文章数合并，`?tag=fiction` 与 `?tag=小说` 是同一个筛选。

- 常见写作主题（小说、随笔、诗歌、笔记、评论、翻译、电影、摄影……）已内置对照表：`src/content/tags.ts`。
- 自己的标签：后台 **Settings → Tag pairs**，一行一组，如 `Red Room = 红房间`、`Poetry, Poem = 诗歌, 诗`（逗号分隔多个别名，后台的优先于内置的）。
- 也可以直接在 Notion 里把标签写成 `Fiction / 小说`，网站会学到这一对，别的文章上单独的 `小说` 也会归进来。
- 显示名优先用你实际用过的写法（文章标的是 `Poem` 就显示 Poem，不会改成对照表里的 Poetry）。
- 没有对照的标签在两种语言里都按原样显示。

## “更多”页面 `/more`

在后台 **`/admin` → More** 编辑（不经过 Notion），保存后立即生效：

- **Intro**：页面开头的一两句话。
- **Publications**：自印出版物——书名、副标题、年份、印刷方式、页数、印量、尺寸、封面、选读、出处、购买链接与按钮文字。
  选读里**空一行 = 新段落**。有购买链接时按钮指向它；没有时按钮打开一封以书名为主题、写给站点邮箱的邮件。
  没有封面时页面会画一个和网站同风格的文字封面。
- **Contact channels**：社交账号——平台、账号、链接、二维码图片（正方形 PNG/JPG）、备注。
- 每个文字字段都是 **EN | 中文 左右并排**；只填一边时，另一种语言的页面会用这一边（中文书名在英文页面上照样显示）。
- 封面、二维码点 **Upload image…** 直接上传（存到 `UPLOAD_DIR`，地址 `/uploads/文件名`），也可以填 `/more/文件名`（放在 `public/more/`）或 `https://` 图片地址。
- 卡片右侧 **↑ ↓** 调整顺序（就是页面上的顺序），**×** 删除；**+ Add** 新增。所有改动在点 **Save**（或 ⌘/Ctrl + S）之前都不会发布，有未保存的改动时离开页面会提示。
- 链接只接受 `https://`、`http://`、`mailto:`；图片只接受站内路径或 `https://`。不合规的字段会标红，保存失败时自动定位到出错的字段。
- **Export JSON** 下载整页内容；**Import JSON…** 用导出的文件整体替换并发布；**Reset to samples** 删除保存的内容，回到 `src/content/more.ts` 里的示例。
- Files 页里被“更多”页面用到的文件会标 **on /more**；删除它们前会额外提醒，改名会自动更新页面里的地址。

还没保存过时，页面显示 `src/content/more.ts` 里的**示例条目**（二维码位置是空框占位），用来预览版式；第一次保存后就不再读这个文件。

邮箱默认 `nodeman24@outlook.com`（`src/content/site.ts`），后台 Settings 里的 Contact email 优先。

## 后台 `/admin`

输入 `ADMIN_TOKEN` 登录（只存在当前标签页的 sessionStorage；请用 HTTPS 部署）。

- **Articles**：已发布文章一览；**Sync now** / **Sync + fetch bodies**（同时预取所有正文，让搜索覆盖全文）/ **Full resync**（清空正文和图片缓存后重新同步）；单篇 **Refresh** 重新拉取正文。
- **Settings**：站点名称/邮箱；简介（meta description）与首页引言，英文、中文各一份（中文留空就用内置中文文案，不会回退到英文）；中英标签对照（Tag pairs）；Notion token 与数据库（优先于 `.env`）；**Check columns** 显示字段映射与警告。
- **More**：编辑 `/more` 页面（出版物、联系方式、二维码，中英并排），见上文。
- **Files**：上传音频/视频/图片/PDF；上传 `.glb` 并选择 “Statue model” 可替换首页雕像；“更多”页面用到的文件标 on /more。

网站**从不写回 Notion**（`tests/architecture.test.mjs` 会检查客户端里没有写请求）。

## 代码结构

UI 与 API 分离，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：

```
src/shared   API 契约类型 + 公开 URL 规则         src/server   SQLite 缓存、Notion 读取、媒体代理、服务、HTTP 端点
src/core     纯函数（Notion 块渲染、安全、文本）    src/ui       布局、组件、视图、浏览器脚本、样式
src/content  站点文案、演示文章                    src/pages    路由：只做取数 + 渲染，或转发到端点
```

- 首页动画参数：`src/ui/scripts/site/home.ts`（镜头关键帧）、`neon.ts`（招牌）、`scene.ts`（窗帘、雕像、灯光）。
- 首页文案（引言、facts、标语，中英两份）：`src/content/site.ts`；“更多”页面：后台 More（默认示例在 `src/content/more.ts`）；标签对照：`src/content/tags.ts`；界面文字（导航、区块标题、分页…）：`src/ui/i18n.ts`；名称/邮箱/简介/引言也可以在后台改。
- 中文显示字体：`public/fonts/display-sc/`，由 `scripts/fonts/build-display-sc.py` 生成，见 [docs/I18N.md](docs/I18N.md)。
- 接口约定见 **[docs/API.md](docs/API.md)**；为什么选择在本仓库实现、而不是回到旧仓库，见 [docs/NOTION-ONLY.md](docs/NOTION-ONLY.md)。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | — | **必填**。后台登录与所有管理接口 |
| `SITE_URL` | — | 站点公开地址（如 `https://archive.example`），用于 canonical、RSS、sitemap 的绝对链接 |
| `NOTION_TOKEN` | — | integration token（也接受旧名 `NOTION_API_SECRET`）。后台填写的优先 |
| `NOTION_DATABASE_ID` | — | 数据库 id 或链接（也接受 `DATABASE_ID`、旧的 `NOTION_DB_WRITING`）。后台填写的优先 |
| `SYNC_TTL_SECONDS` | 300 | 文章列表缓存超过此时间后，由下一次访问触发后台刷新 |
| `NOTION_TIMEOUT_MS` | 15000 | 单次 Notion 请求超时（429/5xx 会按 `Retry-After` 重试 2 次） |
| `MEDIA_CACHE_DIR` | `<DB 所在目录>/notion-media` | Notion 图片/文件的本地副本 |
| `MAX_MEDIA_MB` | 50 | 媒体代理单个文件上限 |
| `DB_PATH` | `data/archive.db` | SQLite 文件（文章缓存、站点设置和“更多”页面） |
| `UPLOAD_DIR` | `data/uploads` | 后台上传目录 |
| `MAX_UPLOAD_MB` | 300 | 单个上传文件上限 |
| `MAX_JSON_KB` | 256 | JSON 请求体上限 |
| `NOTION_API_BASE` | `https://api.notion.com/v1` | 仅用于测试或代理 |

读取顺序：`process.env` → 构建时注入的 `import.meta.env` → 运行目录的 `.env` / `.env.local`。改完 `.env` 需重启进程。
**切换已有 Notion 连接时，请在更改环境变量之前使用后台 Settings 保存新连接**：直接修改环境变量并重启不会自动清空旧文章缓存，可能继续显示旧内容。

## 部署

`npm run build && npm start`。需要可写磁盘的 Node 环境（VPS / Fly.io / Railway 卷）：SQLite 缓存、图片副本和上传文件都在磁盘上。
部署探针：`GET /api/health`。

**部署限制：**目前只支持单个 Node 进程操作同一份数据目录；不要使用多 worker 或多个实例共享 SQLite/媒体目录。
配置切换的跨进程旧任务防护已加入，但同步去重、媒体清理、后台限流等仍不是跨进程协调的。
媒体及文章可能已被浏览器或 CDN 缓存；撤回内容或切换数据库后，已缓存内容不会立即消失，请按部署环境清除缓存。

文章内容在 Notion 里，SQLite 里的文章只是缓存（删掉后下一次访问会重新同步）。
但**“更多”页面的内容只保存在 SQLite（`more_page` 表）里**，封面和二维码在 `UPLOAD_DIR`：请把 `data/archive.db`（`DB_PATH`）和 `UPLOAD_DIR` **一起备份**，
或者在后台 More 里点 **Export JSON** 留一份（JSON 里只有图片地址，图片文件仍需备份 `UPLOAD_DIR`）。
数据库使用 SQLite WAL 模式：运行时不要只复制主 `.db` 文件；请用 SQLite 在线备份工具，或先停止应用并确认没有其他进程使用数据库后再备份。
SQLite 还包含后台保存的站点设置和 Notion token（未加密），备份需限制访问权限并安全保存。
Notion 全量重新同步、修改 Notion token/数据库都**不会**清除“更多”页面。
从旧版本升级：数据库会自动迁移；旧的 `items` / `posts` / `post_revisions` 表原样保留但不再使用，确认不需要后可以手动删除。

## 开发与验证

```bash
npm test            # 渲染器、Notion 映射、接口契约（用假的 Notion）、架构边界（node:test）
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建
npm run check       # 以上三步
npm run test:render # 构建后检查有图/无图文章的 SSR 输出
node tests/fixtures/notion-mock.mjs 4999 [--showcase]   # 本地假 Notion：NOTION_API_BASE=http://127.0.0.1:4999/v1；--showcase 加几篇中英文章预览排版
```

CI（`.github/workflows/validate.yml`）依次执行类型检查、单元测试、构建和页面渲染测试。

## 还没做

公式用 KaTeX 渲染、代码高亮、书签卡片抓取标题/缩略图、Notion webhook 即时刷新、多个数据库、对象存储（R2/S3）。
音乐与影像模块已暂时移除，需要时可以作为新的 Notion 数据库重新接入。
