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
| `/` | 开场动画 → 引言（逐词点亮）→ **Latest / 最新**（最多 10 篇，按 Notion 日期时间倒序）→ **Featured / 精选**（最多 10 篇，Rank > 0 并按数值降序，同 Rank 按日期降序）→ **Topics / 主题**（全部文章入口与标签，中英合并）→ **More / 更多**（“了解更多”入口 + 小字邮箱） |
| `/articles` · `/articles/page/:n` | 全部文章，按日期时间倒序（同一天内按具体时刻），每页 20 篇 |
| `/articles/:slug` | 正文（由 Notion 块渲染）、封面、日期、阅读时长、标签（链接到主题页）、目录、上一篇/下一篇 |
| `/topics` | 全部主题（中英同义标签已合并）及文章数，按数量倒序 |
| `/topics/:slug` · `/topics/:slug/page/:n` | 某个主题下的文章；主题的任一名称都能找到它（`/topics/小说` 301 到 `/topics/fiction`） |
| `/archive` | 全部文章一页列完，按年份分组，顶部有年份索引 |
| `/search?q=` | 搜索标题、标签、摘要和正文 |
| `/more` | 自印出版物（封面、规格、选读）与联系方式（邮箱、社交账号二维码），在后台 **More** 编辑，见下文 |
| `/subscribe` | 邮件订阅（双重确认）。文章末尾、页脚和首页信息栏的入口**默认隐藏**，开启方法见下文“邮件订阅” |
| `/newsletter/confirm` · `/newsletter/unsubscribe` | 确认订阅 / 退订页（来自邮件链接，不被索引） |
| `/rss.xml` · `/sitemap.xml` · `/robots.txt` | 订阅与搜索引擎 |
| `/media/notion/:id` | Notion 里上传的图片/文件的本地副本（见下文“图片”） |

**语言**：英文 / 简体中文，导航栏右侧 `EN / 中文` 切换（在首页切换会停在原来的位置，不重播开场）。
每个页面在两种语言下各有一个地址：英文不带前缀，中文加 `/zh-CN`（`/topics/fiction` ↔ `/zh-CN/topics/fiction`），
可以直接分享、被搜索引擎分别收录。切换的选择会记在 `lang` cookie 里（一年），之后访问不带前缀的页面会跳到中文地址；
第一次访问首页 `/` 时按浏览器的 `Accept-Language`。旧的 `?lang=zh-CN` 链接仍然有效（跳到对应的路径）。详见 **[docs/I18N.md](docs/I18N.md)**。
界面文字在 `src/ui/i18n.ts`，首页文案在 `src/content/site.ts`；文章本身不翻译，按标题自动标注 `lang`。
中文字体的做法见 **[docs/I18N.md](docs/I18N.md)**。

旧地址都会 301 跳转（`/zh-CN/…` 下的旧地址保留中文前缀）：`/works/*`、`/writing/*`、`/journal/*` → `/articles/*`；
旧博客 astro-notion 的 `/posts/:slug` → `/articles/:slug`，`/posts/tag/:tag` → `/topics/:slug`；
本站以前的查询地址 `/articles?page=2` → `/articles/page/2`，`/articles?tag=x&page=2` → `/topics/x/page/2`。

## 连接 Notion

### 1. 创建连接并授权

1. 在 <https://www.notion.so/my-integrations> 创建与文章所在工作区对应的 **Internal integration**，启用读取内容权限（Read content），复制 token。不要把 token 发给别人或提交到 Git。
2. 在 Notion 中打开**文章数据库本身**，而不是只打开包含表格的普通页面。右上角 `•••` → **Connections / 添加连接** → 找到并添加刚创建的 integration。必要时检查包含数据库的父页面是否也已授权；授权给其他 integration 不算。Notion 的 404 既可能是 ID 错，也可能是无权限。

### 2. 在你的截图里从哪里复制？

截图中封面和大字 **Bottom Think** 是外层页面；下方同名表格是嵌在页面里的数据库视图。**不要复制右上角 Share 旁的链条图标**（那是外层页面链接），也不要复制某一篇文章行的链接。

将鼠标移到表格右上方工具栏，点击**放大为整页的双向斜箭头 `⤢`**：在截图里它位于放大镜右边、滑杆图标左边，`New` 按钮的左侧。打开后从浏览器地址栏复制数据库页面 URL，或者在打开的数据库页面通过 Share/Copy link 复制。若这是其他数据库的**链接视图**，要转到**原始数据库**再复制和授权。如果界面版本按钮名称不同，也可以悬停表格左侧的 `⋮⋮`，按 Notion 菜单打开或复制数据库链接；使用 **Check columns** 核实。仅凭截图无法判断这个视图是否是原始数据库，也无法看到真实 ID。

数据库 URL 的示例（仅示意，并非你的 ID）：

```text
https://www.notion.so/workspace/0123456789abcdef0123456789abcdef?v=ffffffffffffffffffffffffffffffff
                                └──────── 数据库 ID ────────┘  └── 视图 ID ──┘
```

填写**整条数据库 URL**或路径里 `?` 前的 32 位数据库 ID；`?v=` 后面是视图 ID，不能当数据库 ID。不要使用某篇文章、外层普通页面、数据源 ID 或分享链接的短链。详细区别可见 [Notion 的 ID 说明](https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03)。

### 3. 保存并检查

1. 打开**同一个正在运行的站点** `/admin → Settings`，填入 token 和数据库链接，点击 **Save**（检查使用的是已保存的配置；切换数据库会清空旧文章缓存）。
2. 点击 **Check columns**：确认数据库名称和各字段的映射，特别是 `Published → Published / checkbox`。如提示 page, not a database，通常复制了外层页面或文章链接；按上面的 `⤢` 打开数据库本身重新复制。若仍是 404，也请核对连接所在工作区、Read content 权限及数据库的 Connections 授权。不要把 token、完整数据库链接或敏感报错公开发给别人。
3. 回到 **Articles → Sync now**。之后缓存超过 `SYNC_TTL_SECONDS`（默认 5 分钟）时，下一次访问触发后台刷新，当前请求先返回缓存；没有访问就不会自动刷新。需要立即更新可点击 **Sync now**。取消勾选后也要等下一次成功同步才会从网站移除。

如果 Check columns 显示多数据源错误，目前仅支持**单数据源**数据库（Notion 2022-06-28 API）；需要先使用单数据源，或等待后续 API 升级。截图无法判断你的数据库有几个数据源。
### Webhook 即时更新（可选）

不设置 webhook 时，网站在缓存超过 `SYNC_TTL_SECONDS` 后的下一次访问才刷新。设置后，Notion 会在页面或数据库改动后约 1 分钟内（最多 5 分钟）通知网站，网站随即同步一次。
需要公开的 HTTPS 地址，所以要先设置 `SITE_URL`；静态部署没有服务器，用不了 webhook。

1. 打开 [notion.so/my-integrations](https://www.notion.so/my-integrations) → 你的集成 → **Webhooks** → **Create a subscription**。
   URL 填后台 **设置 → Notion → Webhook** 里显示的地址（即 `https://你的域名/api/webhooks/notion`），事件至少勾选页面和数据库相关事件。
2. Notion 会向这个地址发送一次验证令牌。刷新后台，Webhook 区域会显示 **已收到令牌** 和令牌本身，概览页也会提示；点 **复制**。
3. 回到 Notion，点 **Verify**，粘贴令牌。之后收到第一条签名正确的事件，状态就变成 **已启用**。

安全：每条事件都用这个令牌校验 `X-Notion-Signature`（原始请求体的 HMAC-SHA256，常量时间比较），签名不对一律拒绝并计数。
启用后不再接受新的验证令牌，避免别人替换；要重新订阅时先在后台点 **重置 webhook**。也可以在服务器设置 `NOTION_WEBHOOK_TOKEN` 直接固定令牌，跳过上面的握手。
事件只当作“有变化”的信号：网站不信任事件内容，而是像普通同步一样重新向 Notion 读取（是否发布、日期、最后编辑时间），所以乱序、重复（按事件 id 去重）或伪造的事件都不会发布任何东西。
评论事件会被忽略。同一时间的多条事件合并为一次同步（约 4 秒防抖）。本站不会主动调用部署钩子；静态站点仍需按原方式重新构建。

### 数据库列

必须有**标题列和可识别的发布列**，其余列可选。列按**名称（不区分大小写/空格）+ 类型**一起识别，所以叫 “Date” 的文本列不会被当成日期。
默认名称沿用旧博客 astro-notion，那个数据库可以原样使用：

| 字段 | 识别的列名（节选） | 列类型 | 没有这列时 |
| --- | --- | --- | --- |
| 标题 | 任意名称（Page / Name / Title…） | Title | — |
| Slug | Slug | Text / Formula | 由标题生成；重名的第二篇得到 `-2` |
| 日期 | Date, Publish Date, 发布日期 | Date / Created time / Formula（日期） | 网站首次同步发现文章公开时的服务器本地日期 |
| 发布 | Published, Public, Status, 发布 | Checkbox，Status/Select 为 Published/Public/Done/已发布，或 Formula 返回 true/对应文本 | **全部隐藏**（Check columns 会警告） |
| 标签 | Tags, Category, 标签 | Multi-select / Select | 无标签 |
| 摘要 | Excerpt, Summary, Description, 摘要 | Text | 无摘要 |
| 封面 | FeaturedImage, Cover, Image, 封面 | Files / URL | 用页面自身的封面 |
| 精选 | Rank, Featured, 权重 | Number / Checkbox | 不显示精选 |

- **草稿**：你的 `Published` 复选框为未勾选时是草稿，不会进入文章列表、正文或搜索；勾选后，成功同步才公开。没有可识别的发布列，或单个页面缺少可识别的发布值时，**该页面不会公开**。升级前依赖“无发布列即全部公开”的站点需要先在 Notion 添加发布列并检查勾选状态。
- **Date 留空**：网站首次同步发现该文章公开时，记录**服务器本地时区的当天日期**到本地 SQLite；以后同步、全文重同步、取消后重新勾选或更换 token 都沿用它。Notion 中填写的 Date 优先；清空后如果已有空日期记录则恢复，否则首次记下清空后的同步日期；不会写回 Notion。若网站没运行，日期是之后首次成功同步的日期，不一定是真正勾选日；服务器时区和你所在地不同时，跨午夜的日期可能不同（本地运行使用电脑的时区）。首次接入时，旧文章若 Date 为空也会记首次同步日期。需要精确或历史日期时请在 Notion 手动填写 Date。记录随 `data/archive.db` 备份；删除或更换该数据库会丢失记录。
- **定时发布**：日期在未来的文章不会出现，到期后的下一次同步自动出现（只有日期没有时间时按 UTC 零点）。
- 完整别名表在 `src/server/notion/mapper.ts` 的 `FIELDS`，想加自己的列名改这里即可。
- 读取用的是 Notion API `2022-06-28` 的 `databases/:id/query`；只支持单数据源的数据库；多数据源数据库暂不支持。

### 支持的 Notion 块

段落、标题 1–3（含可折叠标题）、有序/无序/待办列表（可嵌套）、引用、Callout（含图标）、Toggle、分隔线、代码（语言 + 说明，带高亮和复制按钮）、
公式（行内与块级）、图片、视频（YouTube/Vimeo 嵌入或原生播放）、音频、文件、PDF、嵌入、书签、链接预览、
表格（列标题/行标题）、分栏、同步块、目录、页面链接与 @提及（只链接到已发布的文章）、文字颜色与背景色。
`child_page` / `child_database` 不会被展开（避免把私有子页面公开）。所有文本都转义，链接只放行 http/https/mailto/tel。

### 公式、代码与书签

- **公式**：Notion 的行内公式和公式块在服务器端用 [Temml](https://temml.org) 转成浏览器原生的 MathML，不加载脚本、样式表或字体，符合本站的 CSP。
  单字母变量用普通字母的斜体显示，没有数学字体的设备也看得到。不支持的命令（以及出于安全禁用的 `\href`、`\url` 等）会退回显示 TeX 源码。
  `\color` 等需要内联样式的效果会被去掉。
- **代码**：服务器端用 highlight.js 高亮约 30 种常用语言（JavaScript/TypeScript、Python、Go、Rust、C/C++、Java、Shell、SQL、HTML/CSS、JSON、YAML 等），
  输出只带 class，颜色由站点样式表决定；不认识的语言（以及 Plain Text）只做转义。文章页的代码块右上角有 **复制 / Copy** 按钮（需要 JavaScript 和剪贴板权限）。
- **书签**：重新渲染正文时，服务器读取书签网页 `<head>` 里的标题、简介和站点名（Open Graph / Twitter / `<title>`），显示在书签卡片上。
  只取文字，**不取也不外链第三方图片**，访客的浏览器在点击之前不会访问那些网站。结果存进 SQLite：成功的保存 14 天，失败的 1 天后重试，
  刷新失败时保留上一次的好结果。每篇文章最多同时请求 4 个网页，总共最多等 6 秒，没取到的先显示普通卡片，下次渲染时再取。
  出站请求只允许 http/https 的默认端口，拒绝内网、回环、链路本地等非公网地址（DNS 解析结果和每一次重定向都会检查），最多读 256 KB，单次 5 秒超时。
  不想让服务器访问外部网站时设 `LINK_PREVIEWS=off`。静态构建同样在构建时抓取；演示文章不抓取。

### 阅读与朗读

文章页采用适合长文的单栏、行距和段落留白，保留 Notion 段落、列表等富文本中的手动换行以及空段落；有三个以上标题时桌面显示侧栏目录，手机可展开目录；不会擅自把作者的长段落拆成短段。升级后旧缓存正文会在首次阅读时重新渲染；如果 Notion 暂时不可用，先显示旧缓存，恢复后会再次尝试。

支持 Web Speech 语音合成且启用 JavaScript 的浏览器会显示 **朗读 / Listen**，点击后朗读标题与正文，可暂停、继续、停止、调整语速（从下一段生效）；朗读时按钮变红，下方说明文字显示状态与进度百分比，分隔线上的红线表示已读部分。会读取折叠内容及图片说明，跳过目录、音视频播放器和书签的网址；离开页面时停止。功能使用浏览器/设备可用的语音，并按段落尝试匹配中文或英文，混合语言和没有相应语音的设备可能读得不准确。浏览器可能使用本地或联网语音服务，具体隐私及网络要求由浏览器和设备决定；本站不生成或保存音频。关闭 JavaScript、不支持该 API 或没有可朗读正文时，入口不显示。

### 图片

Notion 里上传的图片和文件是带签名的临时地址（约 1 小时失效），不能直接写进缓存的 HTML。
网站改为输出 `/media/notion/<id>`：第一次被访问时向 Notion 重新取一个新地址、下载到 `MEDIA_CACHE_DIR`，之后直接从磁盘发；
文章在 Notion 里被编辑后，旧副本在下次同步时删除。只有已发布文章里出现的文件 id 才会被代理，其他一律 404。
文章没有封面时，列表以标题、日期、摘要和标签呈现，不显示占位图片；正文直接从文章头部进入。
搜索结果和首页本来就是文字列表；无封面文章不添加虚构的社交分享图。RSS 不再推测封面的 MIME 类型和大小，因此暂不输出封面 enclosure。

外链图片（`external`）直接使用原地址。媒体缓存按 Notion 配置版本分目录；升级后旧格式的磁盘副本不会再被读取，
会在需要时重新下载。旧缓存可在停服后从 `MEDIA_CACHE_DIR` 清理（不要删除 `DB_PATH` 或 `UPLOAD_DIR`）。

### 中英文标签

Notion 只有一个标签列，中英文章混写时会出现 `Fiction` 和 `小说` 这样意思相同的两个标签。网站会把它们合并成**一个主题**：
中文界面只显示“小说”，英文界面只显示“Fiction”，文章数合并，主题页只有一个地址 `/topics/fiction`（`/topics/小说` 会跳过去）。

- 常见写作主题（小说、随笔、诗歌、笔记、评论、翻译、电影、摄影……）已内置对照表：`src/content/tags.ts`。
- 自己的标签：后台 **Settings → Tag pairs**，一行一组，如 `Red Room = 红房间`、`Poetry, Poem = 诗歌, 诗`（逗号分隔多个别名，后台的优先于内置的）。
- 也可以直接在 Notion 里把标签写成 `Fiction / 小说`，网站会学到这一对，别的文章上单独的 `小说` 也会归进来。
- 显示名优先用你实际用过的写法（文章标的是 `Poem` 就显示 Poem，不会改成对照表里的 Poetry）。
- 没有对照的标签在两种语言里都按原样显示。

### 分享卡片与结构化数据

每个页面都有 Open Graph 和 Twitter 卡片信息。文章用自己的封面，其他页面用默认卡片 `public/og/card.jpg`（1200×630，首页霓虹招牌截图；想换就替换这个文件，尺寸保持不变）。
文章页另有 `article:published_time` / `article:modified_time` / `article:tag`；设置了 `SITE_URL` 时，还会输出 schema.org JSON-LD：首页是 `WebSite` 和站内搜索，文章页是 `BlogPosting` 和面包屑，主题页是面包屑。
JSON-LD 是浏览器不会执行的数据块，不受 CSP 影响，所有 `<` 都会转义。

封面图加载失败（外链失效、过期）时，脚本会移除破图，列表和文章页回到无封面的纯文字版式。

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

首页的霓虹招牌（“The INK / NEW / PRINT”）是一幅固定的装饰插画，不是根据站点名生成的 Logo；招牌右侧（手机上在招牌下方）有一块小告示（新书付印、接受预购），文案在 `src/content/site.ts` 的 `announce`，中英文各一份，把 `title` 设为空字符串即可隐藏；告示上的链接会打开写给站点邮箱的邮件（主题为 `subject`），没设邮箱时改为链接到“更多”页面。站点名显示在导航和首页底部。后台保存后，同一浏览器、同一来源（协议、域名、端口）的已打开站点页面会自动刷新；不同浏览器或设备请手动刷新。中文、英文文案各自独立，切换语言时请填写相应字段。

Notion 和 GitHub 联动、发布自动化的调研见 [docs/NOTION-GITHUB.md](docs/NOTION-GITHUB.md)。

## 后台 `/admin`

输入 `ADMIN_TOKEN` 登录（只存在当前标签页的 sessionStorage；请用 HTTPS 部署）。

后台界面支持 **English / 中文**：右上角 `EN / 中文` 切换，选择保存在浏览器（localStorage `rra.admin.lang`）；没选过时跟随浏览器语言，其余情况用英文。服务器返回的错误信息仍是英文，中文界面会在前面加一句中文说明（按错误码翻译）。下文用英文按钮名，中文界面里对应为“概览 / 文章 / 更多页 / 设置 / 文件”。

- **Overview（概览）**：登录后的第一页。文章来源（Notion / 示例）与上次同步时间；文章、精选、主题、已缓存正文、出版物、联系渠道、上传文件的数量；**需要处理**的事项（未配置 Notion、同步失败、从未同步、没有已发布文章、正文未缓存、未设置 `SITE_URL`、没有联系邮箱、无标签文章、“更多”页仍是示例），每条都带直达按钮；最新文章与每年文章数；快捷操作：立即同步、查看英文/中文网站、下载内容包、进入设置。数据来自 `GET /api/overview`，每次切到该标签都会刷新。
- **Articles**：已发布文章一览；**Sync now** / **Sync + fetch bodies**（同时预取所有正文，让搜索覆盖全文）/ **Full resync**（清空正文和图片缓存后重新同步）；单篇 **Refresh** 重新拉取正文。
- **Settings**：分为 **Site / Homepage copy / Topics / Newsletter / Notion / Backup & static sites** 六组，顶部有分组导航，底部固定的保存栏显示是否有未保存的修改（`Ctrl/⌘ + S` 也可保存；有未保存修改时离开页面会提示）。首页文案的英文、中文左右并排（窄屏上下排列）。内容：站点名称/邮箱；简介（首页、meta description、RSS）、首页引言与标语、首页信息栏（Homepage facts：每行一条 `标签: 内容`，最多 6 条；内置默认为空，显示为 `-`，即不显示这一栏），英文、中文各一份（中文留空就用内置中文文案，不会回退到英文）；中英标签对照（Tag pairs）；**Newsletter**：是否在公开页面显示订阅入口（默认关闭，保存后立即生效）；Notion token 与数据库（优先于 `.env`）；**Settings** 显示 Notion 配置是否存在（包括从环境变量读取），但这不代表连接有效；**Check columns** 实际验证权限与字段映射。**Export site profile** 导出已保存的非机密站点文字和标签对照；**Import site profile** 验证后立即替换这些字段，不修改 Notion 配置。导入会丢弃尚未保存的表单编辑。**Download content bundle (.zip)** 下载静态部署用的内容包（见下文）。
- **More**：编辑 `/more` 页面（出版物、联系方式、二维码，中英并排），见上文。
- **Newsletter（订阅）**：订阅总数 / 已订阅 / 待确认 / 已退订、邮件服务状态与今日发信量；按邮箱搜索、按状态筛选；待确认地址可重发确认；**导出 CSV**（只含邮箱、状态、语言、来源和时间，不含 token、哈希或密钥）。静态 Netlify 站点的 `/admin` 也能用同一个 `ADMIN_TOKEN` 登录，但只显示这一模块。
- **Files**：上传音频/视频/图片/PDF；上传 `.glb` 并选择 “Statue model” 可替换首页雕像（首页只请求实际存在的那一个模型：上传的或仓库内置的 `public/models/venus.glb`；建议先用 `npx gltfpack -i in.glb -o out.glb -cc` 压缩，内置模型就是这样从 11.7 MB 压到约 0.8 MB 的，三角面减半后肉眼无差别）；“更多”页面用到的文件标 on /more。

网站**从不写回 Notion**（`tests/architecture.test.mjs` 会检查客户端里没有写请求）。

## 邮件订阅

读者在站内订阅（替代 Substack），名单属于本项目：**双重确认**（提交后只发确认信，点击邮件链接才生效）、一键退订（含 RFC 8058 邮件头）、不暴露某邮箱是否已订阅、限流与蜜罐、后台管理与 CSV 导出。

- **Netlify 静态站**：`/api/newsletter/*` 由 `netlify/functions/newsletter.mts`（Netlify Function）处理，数据加密存放在 **Netlify Blobs**——都包含在 Netlify 免费套餐里，不需要新的数据库账号。
- **Node 站点**：同一套服务，数据在 SQLite（迁移 11）。
- **发信**：Resend（免费每天 100 封）或 Brevo（免费每天 300 封），均无需绑卡，需要验证发信域名。

**订阅入口默认隐藏**（首页、文章末尾、页脚和 sitemap 都不出现），功能本身不受影响：`/subscribe`（不被索引）、确认 / 退订链接和后台“订阅”模块照常可用。重新开启：Node 站点在 `/admin → 设置 → 邮件订阅` 勾选，立即生效；Netlify 静态站设置构建变量 `SHOW_NEWSLETTER_SIGNUP=1` 后重新部署。详见 [docs/NEWSLETTER.md](docs/NEWSLETTER.md#显示--隐藏订阅入口)。

未配置邮件服务时，订阅表单会明确显示“尚未开放”，不保存任何数据，也不会假装发送成功。配置、数据结构、安全设计、备份与故障恢复见 **[docs/NEWSLETTER.md](docs/NEWSLETTER.md)**，上线步骤见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。

## 代码结构

UI 与 API 分离，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：

```
src/shared   API 契约类型 + 公开 URL 规则         src/server   SQLite 缓存、Notion 读取、媒体代理、服务、HTTP 端点
src/core     纯函数（Notion 块渲染、安全、文本）    src/ui       布局、组件、视图、浏览器脚本、样式
src/content  站点文案、演示文章                    src/pages    路由：只做取数 + 渲染，或转发到端点
```

- 首页动画参数：`src/ui/scripts/site/home.ts`（镜头关键帧）、`neon.ts`（招牌）、`scene.ts`（窗帘、雕像、灯光）。
- 首页默认文案（facts、招牌旁的新书告示 `announce` 等）：`src/content/site.ts`；“更多”页面：后台 More（默认示例在 `src/content/more.ts`）；标签对照：`src/content/tags.ts`；界面文字（导航、区块标题、分页…）：`src/ui/i18n.ts`；名称/邮箱/简介/引言/标语在后台改。
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
| `MAX_UPLOAD_MB` | 300 | 单个上传文件上限；multipart 单文件另限 8 MiB，较大文件使用 `?name=` 原始流上传 |
| `MAX_JSON_KB` | 256 | JSON 请求体上限 |
| `NOTION_API_BASE` | `https://api.notion.com/v1` | 仅用于测试或代理 |
| `LINK_PREVIEWS` | 开 | 设为 `off` / `0` / `false` 时不抓取书签网页的标题和简介 |
| `NOTION_WEBHOOK_TOKEN` | — | 可选。固定 Notion webhook 的验证令牌，跳过后台握手（见“Webhook 即时更新”） |
| `NEWSLETTER_SECRET` · `NEWSLETTER_EMAIL_PROVIDER` · `NEWSLETTER_EMAIL_API_KEY` · `NEWSLETTER_FROM` | — | 邮件订阅（四个都设置才会开放）。可选 `NEWSLETTER_REPLY_TO`、`NEWSLETTER_DAILY_LIMIT`（90）、`NEWSLETTER_MONTHLY_LIMIT`（2800）、`NEWSLETTER_TOKEN_TTL_HOURS`（48）、`NEWSLETTER_SITE_NAME`。见 [docs/NEWSLETTER.md](docs/NEWSLETTER.md#2-环境变量)；静态构建不会使用也不会输出它们 |
| `SHOW_NEWSLETTER_SIGNUP` | 关闭 | `1` 时显示公开的订阅入口（首页、文章末尾、页脚、sitemap）。Node 站点上后台“设置 → 邮件订阅”的选择优先；静态构建只读这个变量，改动后需重新部署 |
| `FRAME_ANCESTORS` | `'self'` | 允许哪些页面用 iframe 嵌入本站（CSP `frame-ancestors`）：如 `*`、`'none'` 或空格分隔的 `https://` 来源；格式不合法时回退默认值。静态构建写进 `_headers` |

读取顺序：`process.env` → 构建时注入的 `import.meta.env` → 运行目录的 `.env` / `.env.local`。改完 `.env` 需重启进程。
**Notion 来源变化**：有效 token、数据库 ID 或 `NOTION_API_BASE` 变化会隔离并清除旧文章缓存、重置同步状态；后台设置仍优先于环境变量。首次升级此安全机制时，旧缓存也会被清除并重新同步，若 Notion 离线可能暂时没有文章。SQLite 中保存加盐的来源指纹，不把 token 作为指纹明文保存；原先由后台保存的 Notion token 仍会以明文存入 SQLite，应保护数据库和备份。来源变化不会清除站点设置、More 或首次发现发布日期。

## 部署

上线检查清单（Netlify 静态站 + 订阅函数、Node 站点、环境变量作用域）见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。

### Node 动态部署

`npm run build && npm start`。需要可写磁盘的 Node 环境（VPS / Fly.io / Railway 卷）：SQLite 缓存、图片副本和上传文件都在磁盘上。
部署探针：`GET /api/health`。

**安全响应头**：所有 HTML 页面带 `Content-Security-Policy`（脚本、样式只允许同源文件，没有 `unsafe-inline`；图片/音视频允许 `https:`，嵌入允许 `https:` iframe）、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy`；`/admin` 另加 `Cache-Control: no-store`。页面因此不含任何内联脚本、内联样式或 `onload` 之类的属性（`astro.config.mjs` 关闭了内联，`tests/security-headers.test.mjs` 和静态导出测试会检查）；改模板时请保持这一点。`astro dev` 下不发送 CSP（Vite 会注入内联代码）。静态构建把同一组响应头写入 `static-dist/_headers`（Netlify、Cloudflare 都会读取）。

**部署限制：**目前只支持单个 Node 进程操作同一份数据目录；不要使用多 worker 或多个实例共享 SQLite/媒体目录。
配置切换的跨进程旧任务防护已加入，但同步去重、媒体清理、后台限流等仍不是跨进程协调的。
后台限流不信任任何转发 IP 头：带 `X-Forwarded-For`、`X-Real-IP` 或 `Forwarded` 的请求统一共用一个限流桶（每桶 10 分钟 12 次失败，另有进程级 1200 次失败上限）；代理后多个用户可能互相影响，且本进程重启会重置计数。建议代理层另设限流并限制后台访问。
媒体及文章可能已被浏览器或 CDN 缓存；撤回内容或切换数据库后，已缓存内容不会立即消失，请按部署环境清除缓存。

文章内容在 Notion 里，SQLite 里的文章只是缓存（删掉后下一次访问会重新同步）。单篇正文最多 5000 块、根块以下 8 层；超过限制或分页异常时不会保存截断结果。Node 模式会尽量回退同来源的旧正文；升级后旧缓存会重新抓取，若抓取失败，回退内容可能仍是此前不完整的版本。
但**“更多”页面的内容只保存在 SQLite（`more_page` 表）里**，封面和二维码在 `UPLOAD_DIR`：请把 `data/archive.db`（`DB_PATH`）和 `UPLOAD_DIR` **一起备份**，
或者在后台 More 里点 **Export JSON** 留一份（JSON 里只有图片地址，图片文件仍需备份 `UPLOAD_DIR`）。
数据库使用 SQLite WAL 模式：运行时不要只复制主 `.db` 文件；请用 SQLite 在线备份工具，或先停止应用并确认没有其他进程使用数据库后再备份。
SQLite 还包含后台保存的站点设置和 Notion token（未加密），备份需限制访问权限并安全保存。
Notion 全量重新同步、修改 Notion token/数据库都**不会**清除“更多”页面。文件重命名先建立新名称再提交 More 引用，失败保留原文件；中途崩溃可能留下两个同内容名称或隐藏的 `.part` 文件，可停服并确认引用后手动清理；上传目录所在文件系统必须支持同目录硬链接。
从旧版本升级：数据库会自动迁移；旧的 `items` / `posts` / `post_revisions` 表原样保留但不再使用，确认不需要后可以手动删除。

#### Node 站点的完整迁移（与公开资料 JSON 不同）

站点资料 JSON 只包含公开文字；完整迁移还需要 SQLite 数据库和**整个**上传目录，包括 More 的封面/二维码、文件和 `venus.glb`。先停止源站所有 Node 实例并确认没有写入；在源站项目目录（已安装依赖）用 SQLite 备份 API 生成一致的单文件快照，再复制上传目录。以下是 Linux/macOS 示例，替换路径后运行；备份目录的父目录必须事先存在且受保护：

```sh
set -eu
umask 077
backup=/secure/location/red-room-backup-unique   # 新目录，不能已存在
mkdir "$backup"
DB_PATH=/absolute/path/archive.db BACKUP_DB="$backup/archive.db" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
const db = new Database(process.env.DB_PATH, { readonly: true, fileMustExist: true });
try { await db.backup(process.env.BACKUP_DB); } finally { db.close(); }
NODE
cp -a /absolute/path/uploads "$backup/uploads"
```

复制整个备份到目标 Node 主机上的私有目录，在**目标服务尚未启动且目标路径为空**时，将 `archive.db` 和 `uploads` 分别放到目标的 `DB_PATH` 和 `UPLOAD_DIR`，在目标的安全环境中配置 `ADMIN_TOKEN`、`SITE_URL` 和所需 Notion 环境变量，再启动并检查设置、More、文件及文章；验证后再切流和保留旧站回滚。`DB_PATH`/`UPLOAD_DIR` 不一定在默认目录，须按源站配置替换；没有上传目录时应检查是否另设了 `UPLOAD_DIR`。仅在源站完全停止后备份文件与数据库，避免两者版本不一致。文章缓存和 Notion 媒体缓存可重新同步；空 Date 的首次发现日期在数据库中。迁移时数据库若发生 Notion 来源变化，文章缓存会重置，空 Date 的日期记录不会清除。

**数据库可能包含明文 Notion token 和私有信息**；这不是上面不含密钥的 JSON 导出。备份与传输需限制权限、使用可信的加密方式并妥善保存密钥，绝不能提交到 Git、静态发布目录或发送给他人。`.env` 与平台环境变量不在这份备份里，应在目标安全重设；保留旧站并实际测试恢复后才能确认迁移成功。此方法仅适用于有持久磁盘的 Node 动态部署，无法直接恢复到静态 Netlify/Cloudflare。

### 静态部署：Netlify / Cloudflare

`npm run build:static` 在**构建时**读取 Notion，导出可直接托管的 `static-dist/`；它不是 SSR 的无服务器适配器。已有 Node 模式不受影响。

1. 在平台的构建环境中设置 `NOTION_TOKEN` 和 `NOTION_DATABASE_ID`。Netlify 未设置 `SITE_URL` 时，静态构建自动使用 Netlify 内置的 `URL`（站点主地址）；Cloudflare 和其他环境必须设置 `SITE_URL`。如需指定自定义域名，可显式设置 `SITE_URL`（公开站点的完整 origin，例如 `https://archive.example`），它优先于 Netlify 的 `URL`。此地址用于 canonical、RSS、sitemap 等，必须是不含路径的 HTTP(S) origin；设置自定义域名或地址改变后需重新构建。token 是服务端构建密钥，不要提交或放在 `PUBLIC_` 变量中；使用独立的只读 Notion integration 并仅授权需要发布的数据库。
2. 数据库必须有可识别的标题列和 Published 列（checkbox、status/select 或 formula），构建会拒绝缺少发布列的数据库，避免将全部页面意外公开。先在 Notion 确认草稿未发布，再触发构建。
3. Netlify 自动读取仓库的 `netlify.toml`。Cloudflare Workers 的 **Static Assets** 或 Cloudflare Pages 选择 Git 仓库后，将构建命令设为 `npm run build:static`、输出目录设为 `static-dist`、Node 版本设为 **22.23.4**（可用构建环境变量 `NODE_VERSION`）。不需要绑定 D1/R2 或安装 Astro Workers adapter。
4. Netlify 的 Deploy Preview 和分支部署默认也使用站点主地址 `URL`，而不是临时预览地址；要使用其他 canonical 地址可按构建上下文设置 `SITE_URL`。Deploy Preview 若两个 Notion 变量都未提供，会生成明显标注 **DEMO PREVIEW**、禁止索引的演示站点；只设置其中一个仍会失败，设置 `STATIC_DEMO=0` 可关闭预览回退。有完整凭据时预览构建真实文章。生产环境不会因缺少凭据自动使用演示内容。检查 Notion 密钥的构建作用域和上下文，**不要向不可信的 PR/预览构建提供生产凭据**；即使生成演示内容，也无法阻止 PR 自己的构建脚本读取已注入的密钥。
5. 更新、撤回或定时发布文章后，**必须重新构建并部署**（可手动触发平台构建或由你自行配置安全的构建钩子）；撤回后旧部署、浏览器/CDN 缓存可能仍留有内容，敏感内容不应发布。Notion 不可用、正文/媒体获取失败或发布列缺失时构建失败，不发布不完整的新快照。

#### 内容包：把后台编辑的内容带到静态站点

静态站点没有后台，但可以从 Node 版后台带走内容：`/admin → Settings → Download content bundle (.zip)` 下载 `red-room-content-日期.zip`，内含

| 文件 | 内容 |
| --- | --- |
| `site-profile.json` | 站点名、邮箱、中英文简介/引言/标语、首页信息栏、标签对照（与下文的站点资料 JSON 相同格式） |
| `more.json` | “更多”页面（仅当后台保存过；没有就继续用内置示例） |
| `uploads/…` | “更多”页面用到的封面、二维码，以及上传过的雕像模型 `venus.glb` |
| `README.txt` | 使用说明 |

**解压到仓库根目录的 `site-content/` 文件夹**（即 `site-content/site-profile.json`、`site-content/more.json`、`site-content/uploads/`），提交后重新构建即可。构建会把这些内容导入隔离的临时数据库，“更多”页面和首页按后台里的样子生成；页面实际引用到的上传文件复制到产物的 `/uploads/`，没被引用的不会发布。其中任何内容校验失败都会让构建失败（错误信息会写明原因），不会悄悄回到默认值。可用 `SITE_CONTENT_DIR` 指定其他文件夹（指定后不存在会报错）。内容包不含文章（文章始终来自 Notion）、Notion token 或后台 token；里面的一切都会公开，公开仓库里的文件本身也是公开的。

站点资料的优先级：`SITE_PROFILE_PATH` > `site-content/site-profile.json` > 根目录 `site-profile.json`。

#### 内置默认资料

没有导入站点资料（也没有在后台保存过）时，网站使用 `src/content/site.ts` 和 `src/content/tags.ts` 里的内置默认值，现已是本站的资料：站点名 **SureShot Studio**、邮箱 `nodeman24@outlook.com`、中英文引言（首页大字；句末的“——作者”会单独排成右对齐的署名行，见 `src/core/quote.ts`）、标语“小说、诗歌以及其他 / Fiction, poetry and other writings”，以及标签对照 Fiction = 小说、Else / Other = 其他、Poetry = 诗歌。首页简介段落和信息栏默认**不显示**（没有占位文字）；需要时在 Node 后台填写，或在站点资料 JSON 里填写后重新部署。因此静态站不放 `site-profile.json` 也会显示正确的资料。“更多”页面不在站点资料里，仍需用内容包或修改 `src/content/more.ts`。

#### 可迁移的站点资料 JSON

动态 Node 版 `/admin → Settings → Export site profile` 下载 `site-profile.json`（导出的是上次保存的值，不含 Notion token、数据库 ID、后台 token、More 内容或上传文件）。在另一 Node 版的 Settings 选择 **Import site profile** 可直接保存，空字段回退到目标环境变量或内置默认值；Notion 凭据仍须在目标环境安全配置。

静态 Netlify/Cloudflare **没有在线后台**。可访问 `/profile-editor.html` 在浏览器本地导入、编辑和下载相同格式的 JSON；它不会保存到网站。将导出的 `site-profile.json` 放到 Git 仓库根目录（不是 `public/`），提交后触发部署；构建时自动导入到隔离的临时数据库，每次构建都会读取。迁移时将同一文件带到新站点仓库根目录，再分别设置平台构建所需的 `SITE_URL`（Netlify 可自动检测）、Notion token 和数据库 ID。也可通过构建环境变量 `SITE_PROFILE_PATH` 指定相对于仓库根目录的其他文件路径，建议同时设置 `SITE_PROFILE_PATH=site-profile.json`，这样文件意外缺失时会让构建失败，而不是悄悄回到默认值；指定文件格式错误也会让构建失败。文件本身不会被复制到站点产物，但字段内容会显示在公开页面/RSS 中；不要放任何密码或私人内容，公开仓库中根目录文件本身也是公开的。备份原文件；更改 JSON 后仍须重新构建，不能实时更新。

该 JSON 仅覆盖网站名、联系邮箱、中英文简介/引言/标语、首页信息栏和标签对照，**不包含** More 内容、文章、上传文件、雕像模型或任何凭据，不是完整站点备份（静态部署要带上 More 和图片请用上文的内容包）。格式版本为 2（新增首页信息栏）；旧的版本 1 文件仍可导入，信息栏视为留空（使用内置默认）。Node 动态版仍应同时备份数据库与上传目录。

静态版有中英文页面（英文根路径、中文 `/zh-CN/`）、文章、标签/分页、RSS、sitemap、浏览器搜索和朗读；搜索需要 JavaScript。公开文章正文会进入下载到浏览器的搜索索引。Notion 上传的图片和常见音视频/PDF 在构建时复制到公开产物，外链媒体仍依赖外部地址；不支持的媒体类型会使构建失败。构建过程使用隔离的临时 SQLite，不复制数据库或 token。仅生成公开站点，**没有文章/设置管理 API、上传或实时同步**（`/admin` 只是一个外壳，在 Netlify 上用于管理邮件订阅，见“邮件订阅”）；后台保存的设置、More 内容和上传不会自动带入，需通过上述内容包（或单独的站点资料 JSON）显式导入；未导入时使用默认值，More 使用代码内示例内容。页面地址与 Node 版完全相同（同一套路径，由 SSR 直接渲染后写出）；语言切换是普通链接，静态主机上没有 cookie 记忆和 `Accept-Language` 协商，也不支持 `?lang=` 和旧查询地址/旧博客重定向。

注意：静态构建的临时数据库不会跨构建保留；**Date 留空的文章每次构建都会使用当次构建日期**，请在 Notion 填写 Date 以保持日期稳定。构建期间修改或撤回文章可能造成快照不一致，应等待更改完成后重新构建。静态快照会读取图片文件头，为 `<img>` 写入 width/height（防止图片晚到时正文跳动）：本地图片直接读取，外部图片只请求前 64 KiB、每张最多等 8 秒；设置 `STATIC_IMAGE_PROBE=0` 可跳过外部图片。只想预览演示内容时可显式设置 `STATIC_DEMO=1`（不能同时设置 Notion 凭据）；非 Netlify 环境仍需设置 `SITE_URL`。生产构建及普通本地构建缺少 Notion 配置不会自动切换成演示内容，以免误部署；Netlify Deploy Preview 的无凭据演示回退见上文。本地命令示例：

```bash
SITE_URL=https://archive.example NOTION_TOKEN=... NOTION_DATABASE_ID=... npm run build:static
# 仅演示：SITE_URL=https://example.invalid STATIC_DEMO=1 npm run build:static
```

部署产物只应包含准备公开的文章和媒体；`static-dist/` 已加入 `.gitignore`。请在首次上线前检查平台部署预览与实际域名配置。

## 开发与验证

```bash
npm test            # 渲染器、Notion 映射、接口契约（用假的 Notion）、架构边界（node:test）
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建
npm run check       # typecheck、单元测试、生产构建、SSR 与静态导出集成测试
npm run test:render # 构建后检查有图/无图文章的 SSR 输出
npm run test:ui     # Chromium / Firefox / WebKit 多视口与无障碍回归（需先安装 Playwright 浏览器）
npm run test:visual:candidates # 生成供审阅的演示截图（尚非像素基线）
node tests/fixtures/notion-mock.mjs 4999 [--showcase]   # 本地假 Notion：NOTION_API_BASE=http://127.0.0.1:4999/v1；--showcase 加几篇中英文章预览排版
```

CI（`.github/workflows/validate.yml`）运行类型检查、单元测试、构建、页面渲染及浏览器 UI 测试。设计与响应式规则见 [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)，测试安装及限制见 [docs/UI-TESTING.md](docs/UI-TESTING.md)，Agent 工作约定见 [AGENTS.md](AGENTS.md)。

## 版权与许可

本仓库**不是开源项目**。代码、设计和站点内容归 SureShot Studio 所有，保留所有权利，条款见 [LICENSE](LICENSE)（中英双语）。`package.json` 标为 `"license": "UNLICENSED"`，第三方素材及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。首页雕像模型按 CC BY 4.0 使用，必须保留署名。

网站上对应的设置：

- `/copyright`（中文 `/zh-CN/copyright`）是对访客的版权声明，涵盖版权归属、转载与引用、申请授权、AI 与数据挖掘、源代码以及第三方署名。文案在 `src/content/copyright.ts`，权利人名称和邮箱取自站点资料。
- 页脚显示“© 年份 站点名. 保留所有权利。”和“版权声明”链接；每篇文章末尾有一行“未经作者许可，请勿转载”及链接；首页最后一行的 © 也链接到该页。
- `<meta name="copyright">`，TDMRep 的 `tdm-reservation` / `tdm-policy`（保留文本与数据挖掘权），文章 JSON-LD 的 `copyrightHolder` / `copyrightYear` / `license`，RSS 的 `<copyright>`。
- `robots.txt` 拒绝收集 AI 训练数据的爬虫（GPTBot、ClaudeBot、CCBot、Google-Extended 等，名单在 `src/ui/feeds.ts`），不影响搜索引擎。静态站直接使用服务器生成的同一份 robots.txt。

这些措施表明权利、方便维权，但阻止不了别人看到公开仓库里的代码。若要防止代码被复制部署，最有效的办法是把仓库设为私有，Netlify 照常可以从私有仓库构建。

## 还没做

多个数据库、对象存储（R2/S3）、Notion API 新版本（`2025-09-03` 的数据源）、webhook 触发静态站点重新部署、书签缩略图（目前刻意不取第三方图片）。
音乐与影像模块已暂时移除，需要时可以作为新的 Notion 数据库重新接入。
