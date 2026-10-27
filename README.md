# Red Room Archive

Astro 5（SSR / Node）+ Three.js + GSAP + Lenis + Canvas 2D 霓虹招牌 + Notion + SQLite

    npm install            # 与上一版相同的依赖，覆盖文件后不必重装；首次安装才需要
    cp .env.example .env   # 只需填 ADMIN_TOKEN；Notion 可以之后在 /admin 里配置
    npm run dev            # http://localhost:4321   后台：http://localhost:4321/admin

## 首页动画
招牌居中点亮（频闪）→ 向下滚动时沿弧线斜向缩小，停靠左上角作为 logo（点击回到顶部，仍持续闪烁）；
同一段滚动里雕像从地面升起，所以首屏招牌不会盖在 3D 模型上。BANG 右对齐并为辉光留了边距，G 完整。
招牌的几何/闪烁参数在 `src/scripts/neon.ts` 顶部 `defs`。

## /admin（输入 ADMIN_TOKEN 登录；token 只存在当前标签页的 sessionStorage，请务必用 HTTPS 部署）
登录走 `POST /api/auth`，失败次数按 IP 节流；token 用常量时间比较。
- **Entries**：选 Works / Music / Video，表单字段由你的 Notion 数据库“列定义”动态生成（select 带已有选项）。
  提交即在 Notion 新建页面（含正文）并回写缓存。下方列出已缓存的条目，可 **Edit（改属性、可选重写正文）** 与
  **Delete（在 Notion 归档，回收站可恢复）**。URL 列旁有“Upload file → fill URL”。
- **Posts**：发布站内文章，只存 SQLite；支持草稿（uncheck Published）、Tag、Excerpt、编辑与删除。
  访客可从公开的 `/journal` 索引浏览，再进入 `/journal/<slug>` 阅读。正文支持 Markdown，普通换行会保留，
  原始 HTML 不会被直接执行。
- **Files**：上传音频/视频/图片/pdf 到服务器 `data/uploads`（`/uploads/<name>`，支持 Range、ETag/304）；
  可重命名、删除，并显示占用空间。选 “Statue model” 上传 .glb，会替换 3D 雕像（优先级：上传 > `public/models/venus.glb` > 占位）。
- **Settings**：站点名称/邮箱/简介/首页引言（intro 段落的 lede），Notion token 与三个数据库 ID（优先于 .env），
  连接状态、缓存条数、上次同步时间与错误，“立即同步”或只同步某一个库。

## Notion 数据格式
我没能打开你给的 BrainEno/astro-notion 仓库（工具只能访问搜索结果里出现过的页面），所以这里不是照搬它的代码，而是做成“尽量自适应”：
- 标题列按**类型**识别（叫 Name / Page / Title 都行）
- 其余列按别名匹配（不区分大小写）：Slug；Date / Published Date → 年份；Summary / Excerpt / Description；Cover / FeaturedImage / Image；Type / Category / Tags（取第一个作为列表里的“类型”）；Published（复选框，或 select/status 值为 Published/Public/Done 才公开；没有这列则全部公开）
- 别名表在 `src/lib/notion.ts` 的 `ALIASES`，不够用就加。写入 Notion 时按列的实际类型编码（select/status/multi_select/date/number/url/checkbox/rich_text/email/phone）
- 正文写入支持 Markdown 子集：`# 标题`、`> 引用`、`- 列表`、`1. 编号`、` ``` ` 代码块、`---` 分隔线，其余按空行分段；超过 2000 字符的段落会自动分片
- 读回正文时会渲染段落、三级标题、引用、项目符号/编号列表、代码块、待办、折叠、图片、视频、音频、附件/PDF、书签与嵌入（URL 只放行 http/https/mailto/tel，原始 HTML 一律转义）
- 如果你的表结构和上面差得远，把列名与类型（或仓库里定义它的那个类型文件）贴给我，我对着改。

Music 表建议列：Title · Artist · Year · Duration · URL（以 .mp3/.m4a/.wav/.ogg/.flac 结尾则站内播放）；Films 表：Title · Director · Year · Rating · URL。

## 接口
写操作都需要 `Authorization: Bearer <ADMIN_TOKEN>`；标了“公开”的可以匿名访问。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/archive` | 公开 · 三类内容列表（不含正文，带缓存头） |
| GET | `/api/items/<kind>` | 公开 · 单类列表，支持 `?limit=&offset=`（kind = writing / films / music） |
| GET | `/api/items/<kind>/<slug>` | 公开 · 单条内容 + 正文 HTML（`?refresh=1` 强制重取） |
| GET | `/api/posts` | 公开 · 已发布文章；带 token 且 `?drafts=1` 时含草稿；支持 `?tag= &limit= &offset=` |
| POST | `/api/posts` | 新建文章（slug 冲突返回 409，不再静默覆盖） |
| GET | `/api/posts/<slug>` | 公开 · 单篇文章，`?format=html` 附带渲染后的 HTML；草稿仅登录可见 |
| PUT | `/api/posts/<slug>` | 局部更新（title/body/tags/published/excerpt/created/slug） |
| DELETE | `/api/posts/<slug>` | 删除文章 |
| GET | `/api/search?q=` | 公开 · 搜索已发布文章 + 已缓存的 Notion 条目 |
| GET | `/api/site` | 公开 · 站点名称/邮箱/简介/引言与缓存条数 |
| GET | `/api/health` | 公开 · 部署探针（数据库可用性、Notion 是否配置） |
| POST | `/api/auth` | 校验 token（后台登录用，失败按 IP 节流） |
| GET | `/api/sync` | 同步状态：上次时间、是否进行中、上次错误、缓存条数 |
| POST | `/api/sync` | 立即同步；`?kind=writing` 或 body `{ kind }` 只同步一个库 |
| GET | `/api/settings` · PUT | 后台设置（token 以掩码返回，空值 = 清除） |
| GET | `/api/notion/<kind>` | 该数据库的列定义（后台据此生成表单） |
| POST | `/api/notion/<kind>` | 在 Notion 新建页面并回写缓存 |
| PATCH | `/api/notion/<kind>/<pageId>` | 更新页面属性；带 `body` 时整页正文替换成新的 Markdown |
| DELETE | `/api/notion/<kind>/<pageId>` | 归档页面（`?purge=1` 只清本地缓存） |
| GET | `/api/upload` | 文件列表 + 占用（`?bare=1` 只要数组） |
| POST | `/api/upload` | 小文件用 multipart（`file=`，可选 `as=model`）；大文件直接把字节当 body，`?name=track.mp4`，服务端边收边写盘 |
| GET/PATCH/DELETE | `/api/upload/<name>` | 单个文件的信息 / 重命名（扩展名不变）/ 删除 |
| GET | `/uploads/<name>` | 公开 · 提供上传文件，支持 Range 与 ETag 304 |

错误统一返回 `{ "error": "..." }` 与合适的状态码（400/401/404/409/413/429/502/503）；未知异常只回 500，细节写日志。

## 环境变量
`ADMIN_TOKEN`（必填）· `NOTION_TOKEN` `NOTION_DB_*`（也可在后台填）· `SYNC_TTL_SECONDS`（默认 300）· `DB_PATH` · `UPLOAD_DIR` · `MAX_UPLOAD_MB`（默认 300）
读取顺序：`process.env` → 构建时注入的 `import.meta.env` → 运行目录的 `.env` / `.env.local`。
所以 `cp .env.example .env` 之后 `npm run dev` 和 `npm start` 都能直接读到；改完 `.env` 需要重启进程。

上传分两条路径：multipart 适合图片和小音频（会在内存里解析）；超过约 8MB 的文件由后台自动改用原始字节流上传，服务端逐块写盘、超限即中断并删除半成品，因此大视频不会把内存吃满。

## 部署
`npm run build && npm start`。SQLite 与上传文件都在磁盘上，需要带持久卷的 Node 环境（VPS / Fly.io / Railway 卷）。

## 开发与验证
`npm test` 运行 `tests/*.test.mjs`：Markdown 渲染与 XSS 回归、Notion 块渲染与写入编码（用假 fetch）、slug 规范化、文件名安全、HTTP 工具与 URL 白名单。
`npx tsc --noEmit` 做类型检查；`npm run build` 构建生产站点。CI 会依次执行测试与构建。

## 还没做
对象存储（R2/S3）直传、Notion webhook 增量刷新、多用户/多令牌、页面转场与后处理。
