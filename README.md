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
- **Entries**：选 Works / Music / Video，表单字段由你的 Notion 数据库“列定义”动态生成（select 带已有选项），提交即在 Notion 新建页面（含正文）并回写缓存。URL 列旁有“Upload file → fill URL”。
- **Posts**：写站内文章，只存 SQLite，访问 `/journal/<slug>`。
- **Files**：上传音频/视频/图片/pdf 到服务器 `data/uploads`（`/uploads/<name>`，支持 Range 拖动进度）；选 “Statue model” 上传 .glb，会替换 3D 雕像（优先级：上传 > `public/models/venus.glb` > 占位）。
- **Settings**：站点名称/邮箱/简介，Notion token 与三个数据库 ID（优先于 .env），连接状态、缓存条数，“立即同步”。

## Notion 数据格式
我没能打开你给的 BrainEno/astro-notion 仓库（工具只能访问搜索结果里出现过的页面），所以这里不是照搬它的代码，而是做成“尽量自适应”：
- 标题列按**类型**识别（叫 Name / Page / Title 都行）
- 其余列按别名匹配（不区分大小写）：Slug；Date / Published Date → 年份；Summary / Excerpt / Description；Cover / FeaturedImage / Image；Type / Category / Tags（取第一个作为列表里的“类型”）；Published（复选框，或 select/status 值为 Published/Public/Done 才公开；没有这列则全部公开）
- 别名表在 `src/lib/notion.ts` 的 `ALIASES`，不够用就加。写入 Notion 时按列的实际类型编码（select/multi_select/status/date/number/url/checkbox/rich_text）
- 如果你的表结构和上面差得远，把列名与类型（或仓库里定义它的那个类型文件）贴给我，我对着改。

Music 表建议列：Title · Artist · Year · Duration · URL（以 .mp3/.m4a/.wav/.ogg/.flac 结尾则站内播放）；Films 表：Title · Director · Year · Rating · URL。

## 接口（均需 `Authorization: Bearer <ADMIN_TOKEN>`，除公开的 GET）
`GET /api/archive`（公开） · `POST /api/sync` · `GET|POST /api/notion/<writing|films|music>`（列定义 / 新建） · `GET|PUT /api/settings` · `GET|POST|DELETE /api/upload` · `GET /api/posts`（公开）/ `POST /api/posts`

## 环境变量
`ADMIN_TOKEN`（必填）· `NOTION_TOKEN` `NOTION_DB_*`（也可在后台填）· `SYNC_TTL_SECONDS`（默认 300）· `DB_PATH` · `UPLOAD_DIR` · `MAX_UPLOAD_MB`（默认 300；上传走内存，超大视频建议放对象存储）

## 部署
`npm run build && npm start`。SQLite 与上传文件都在磁盘上，需要带持久卷的 Node 环境（VPS / Fly.io / Railway 卷）。

## 还没做
编辑/删除已有条目、博客列表页与 Markdown 渲染、对象存储（R2/S3）直传、Notion webhook、页面转场与后处理。
