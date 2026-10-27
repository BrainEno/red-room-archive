# Red Room Archive

一个人的作品档案馆：**文字（Works）· 音乐（Music）· 影像（Video）· 随笔（Journal）**。
首页是一间沉浸式的“红房间”——霓虹招牌、丝绒窗帘与大理石雕像；内容来自你自己的 Notion 数据库，随笔直接在后台写。

Astro 5（SSR / Node）· Three.js · GSAP · Lenis · Canvas 2D · Notion API · SQLite

```bash
npm install
cp .env.example .env   # 只需填 ADMIN_TOKEN；Notion 可以之后在 /admin 里配置
npm run dev            # http://localhost:4321   后台：/admin
```

## 访客能看到什么

| 路径 | 内容 |
| --- | --- |
| `/` | 开场动画 → 引言（逐词点亮）→ Works / Music / Video 精选 → About → Contact |
| `/works` · `/music` · `/video` | 每个分类的完整索引，可按类型筛选（`?type=`） |
| `/works/:slug` · `/music/:slug` · `/video/:slug` | 条目详情：署名信息、正文（来自 Notion 页面）、播放器（音频/视频原生播放，YouTube·Vimeo·SoundCloud 嵌入）、上一条/下一条 |
| `/journal` | 随笔列表，标签筛选（`?tag=`）与分页 |
| `/journal/:slug` | 随笔正文（Markdown，保留诗歌换行）、阅读时长、标签、上一篇/下一篇 |
| `/search?q=` | 搜索随笔与所有已缓存的条目 |
| `/rss.xml` · `/sitemap.xml` · `/robots.txt` | 订阅与搜索引擎 |

旧地址 `/writing/:slug` 会 301 跳到 `/works/:slug`。

## 后台 `/admin`

输入 `ADMIN_TOKEN` 登录（只存在当前标签页的 sessionStorage；请用 HTTPS 部署）。

- **Entries**：选择分类，表单根据你的 Notion 数据库列自动生成；新建 / 编辑（可整页替换正文）/ 归档。URL 列旁可“上传文件并填入地址”。
- **Posts**：写随笔（Markdown），草稿、标签、摘要、改 slug；**预览**与公开页面使用同一渲染器。每篇都有 **History**：每次保存前的版本都会留下，可逐行对比当前文本并一键恢复（恢复本身也会留档，可以撤销）。
- **Files**：上传音频/视频/图片/PDF（大文件自动走流式上传）；上传 `.glb` 并选择 “Statue model” 可替换首页雕像。
- **Data**：数据库备份（自动 + 手动，可下载）；导出全部随笔为 Markdown ZIP；从 ZIP / `.md` 导入（先预览再执行）；**回收站**——删除的随笔可原地址恢复。
- **Settings**：站点名称/邮箱/简介/首页引言；Notion token 与三个数据库 ID（优先于 `.env`）；同步状态与手动同步。

## 代码结构

UI 与 API 彻底分离，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：

```
src/shared   API 契约类型（前后端共用）        src/server   数据库、Notion、存储、业务服务、HTTP 端点
src/core     纯函数工具                        src/ui       布局、组件、视图、浏览器脚本、样式
src/content  站点文案与默认值                  src/pages    路由：只做取数 + 渲染，或转发到端点
```

依赖方向由 `tests/architecture.test.mjs` 强制检查。

- 首页动画参数：`src/ui/scripts/site/home.ts`（镜头关键帧）、`neon.ts`（招牌几何/闪烁）、`scene.ts`（窗帘、雕像、灯光）。
- 首页文案（引言、facts、标语）：`src/content/site.ts`；名称/邮箱/简介/引言也可以在后台改。

## 接口

完整约定（鉴权、错误码、分页、每个端点的请求与响应）见 **[docs/API.md](docs/API.md)**；类型在 `src/shared/contracts.ts`。
重构前发现的接口冲突及其处理见 [docs/REVIEW.md](docs/REVIEW.md)。

## Notion 数据格式

尽量自适应你的表结构：

- 标题列按**类型**识别（叫 Name / Page / Title 都行）。
- 其余列按别名匹配（不区分大小写）：Slug；Date / Published Date → 年份；Summary / Excerpt / Description；Cover / FeaturedImage / Image；Type / Category；Tags；Published（复选框，或 select/status 值为 Published/Public/Done 才公开；没有这列则全部公开）。
- 别名表在 `src/server/notion/mapper.ts` 的 `ALIASES`。写入时按列的实际类型编码。
- 同一个库里标题相同的条目会得到 `title`、`title-2`… 不同的 slug。
- 正文写入支持 Markdown 子集（标题、引用、列表、代码块、分隔线、段落）；读回时渲染段落、标题、引用、列表、代码、待办、折叠、图片、视频、音频、附件、书签与嵌入（URL 只放行 http/https/mailto/tel，原始 HTML 一律转义）。

建议列 —— Music：Title · Artist · Year · Duration · URL（`.mp3/.m4a/.wav/.ogg/.flac` 站内播放；SoundCloud 链接自动嵌入）。
Video：Title · Director · Year · Rating · URL（`.mp4/.webm` 原生播放；YouTube / Vimeo 自动嵌入）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | — | **必填**。后台登录与所有写接口 |
| `SITE_URL` | — | 站点公开地址（如 `https://archive.example`），用于 canonical、RSS、sitemap 的绝对链接 |
| `NOTION_TOKEN` `NOTION_DB_WRITING` `NOTION_DB_FILMS` `NOTION_DB_MUSIC` | — | 也可以在后台填，后台优先 |
| `SYNC_TTL_SECONDS` | 300 | 缓存多久后在后台刷新 |
| `NOTION_TIMEOUT_MS` | 15000 | 单次 Notion 请求超时 |
| `DB_PATH` | `data/archive.db` | SQLite 文件 |
| `UPLOAD_DIR` | `data/uploads` | 上传目录 |
| `MAX_UPLOAD_MB` | 300 | 单个上传文件上限 |
| `MAX_JSON_KB` | 2048 | JSON 请求体上限 |
| `POST_REVISIONS_KEEP` | 50 | 每篇随笔保留的历史版本数 |
| `BACKUP_DIR` | `<DB 所在目录>/backups` | 数据库快照目录（放在持久卷上，最好与数据库不同盘） |
| `BACKUP_INTERVAL_HOURS` | 24 | 自动快照间隔；`0` 关闭自动备份 |
| `BACKUP_KEEP` | 14 | 保留的自动快照数（手动快照不会被自动清理） |
| `MAX_IMPORT_MB` | 50 | 导入文件上限 |

读取顺序：`process.env` → 构建时注入的 `import.meta.env` → 运行目录的 `.env` / `.env.local`。改完 `.env` 需重启进程。

## 部署

`npm run build && npm start`。SQLite 与上传文件都在磁盘上，需要带持久卷的 Node 环境（VPS / Fly.io / Railway 卷）。
部署探针：`GET /api/health`。

### 数据安全

随笔只存在于 SQLite 里（不在 Notion），所以内置了三层保护：

1. **历史版本**：每次编辑、删除、恢复、导入覆盖之前，先把旧版本写入 `post_revisions`。删除的随笔进回收站，可恢复。
2. **数据库快照**：`VACUUM INTO` 生成一致的完整副本（运行中也安全）。不需要定时器——请求中间件每分钟最多检查一次“最新快照是否超过 `BACKUP_INTERVAL_HOURS`”，进程重启也不会丢失计划。快照包含 Notion token，下载文件请妥善保管。
3. **开放格式导出**：ZIP 内是带 front matter 的 Markdown（`journal/<slug>.md`）、`site.json`（不含密钥）和 Notion 条目快照，脱离本站也能读，也能再导入。

上传的媒体是 `UPLOAD_DIR` 里的普通文件，不在快照与导出里，请用 rsync / 卷快照单独备份。

从快照恢复整个数据库：停止进程 → 用快照文件替换 `DB_PATH`（并删除同目录的 `-wal`、`-shm` 文件）→ 启动。

## 开发与验证

```bash
npm test            # 单元 + 接口契约 + 架构边界测试（node:test）
npm run typecheck   # tsc --noEmit
npm run build       # 生产构建
npm run check       # 以上三步
```

CI（`.github/workflows/validate.yml`）依次执行类型检查、测试与构建。

## 还没做

对象存储（R2/S3）直传、Notion webhook 增量刷新、多用户/多令牌、页面转场、在后台一键从快照恢复整个数据库。
