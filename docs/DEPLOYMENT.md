# 部署

本项目有两种部署方式，代码相同：

| | Netlify 静态站（当前生产） | Node 动态站 |
| --- | --- | --- |
| 构建 | `npm run build:static` → `static-dist/` | `npm run build && npm start` |
| 文章 | 构建时从 Notion 读取；更新文章需重新部署 | 运行时同步 Notion |
| 后台 `/admin` | 可用的“订阅”和“浏览数据”模块（分别探测 Netlify Function） | 全部模块 |
| 邮件订阅 | `netlify/functions/newsletter.mts` + Netlify Blobs | Astro 端点 + SQLite |
| 浏览统计 | `netlify/functions/analytics.mts` + Netlify Blobs 每日聚合 | Astro 端点 + SQLite 每日聚合 |
| 持久数据 | 订阅名单（Blobs，加密）+ 浏览聚合（Blobs） | SQLite + 上传目录 |

静态构建和 Node 部署的细节（内容包、站点资料 JSON、备份迁移、安全响应头）见 [README → 部署](../README.md#部署)。邮件订阅的设计见 [NEWSLETTER.md](NEWSLETTER.md)。

## Netlify 静态站

`netlify.toml` 已经配置好：

```toml
[build]
  command = "npm run build:static"
  publish = "static-dist"
[functions]
  directory = "netlify/functions"
```

### 环境变量

在 **Site configuration → Environment variables** 中设置。注意每个变量的 **Scopes**（Builds / Functions / Runtime）和 **Deploy contexts**：

| 变量 | Scope | Context | 用途 |
| --- | --- | --- | --- |
| `NOTION_TOKEN`、`NOTION_DATABASE_ID` | Builds | Production（预览按需） | 构建时读取文章 |
| `SITE_URL`（可选，默认用 Netlify 的 `URL`） | Builds + Functions | 全部 | canonical、RSS、邮件链接、同站校验 |
| `ADMIN_TOKEN` | Functions | Production | 静态站 `/admin` 管理订阅与浏览数据 |
| `NEWSLETTER_SECRET` | Functions | **仅 Production** | 加密名单、退订链接 |
| `NEWSLETTER_EMAIL_PROVIDER`、`NEWSLETTER_EMAIL_API_KEY`、`NEWSLETTER_FROM` | Functions | **仅 Production** | 发信 |
| `NEWSLETTER_REPLY_TO`、`NEWSLETTER_DAILY_LIMIT`、`NEWSLETTER_MONTHLY_LIMIT`、`NEWSLETTER_TOKEN_TTL_HOURS`、`NEWSLETTER_SITE_NAME` | Functions | Production | 可选 |
| `SHOW_NEWSLETTER_SIGNUP`（可选，默认关闭） | Builds | Production | `1` 时在首页、文章末尾、页脚和 sitemap 显示订阅入口；改动后需重新部署。不是密钥 |

- **不要把生产密钥给 Deploy Preview**：预览可能来自不可信的 PR，PR 自己的代码能读取注入的变量。只在 Production 设置 `NEWSLETTER_*` 和 `ADMIN_TOKEN` 后，预览站的订阅会显示“尚未开放”（503），这是预期行为。
- 预览和分支部署即使配置了密钥，也只会读写自己的 Blobs key（`subscribers-deploy-preview.json` 等），不会碰生产名单。
- **哪些变量勾选 “Contains secret values”**：只勾真正的密钥——`NEWSLETTER_SECRET`、`NEWSLETTER_EMAIL_API_KEY`、`ADMIN_TOKEN`、`NOTION_TOKEN`。不要勾 `DB_PATH`、`NEWSLETTER_FROM`、上限数字之类的普通值：Netlify 的密钥扫描会在仓库和构建产物里逐字搜索这些值，像 `data/archive.db` 或 `90` 这样的值到处都有，构建会因此失败。
- 静态构建会去掉所有 `NEWSLETTER_*` 再启动构建用的临时服务器，并在发布前扫描 `static-dist/`：发现任何服务端密钥（Notion token、`ADMIN_TOKEN`、`NEWSLETTER_SECRET`、邮件 API key）或数据库文件就中止部署。

### 构建报错 “Secrets scanning found secrets in build”

Netlify 会在仓库文件和构建产物里搜索每个**标记为 secret 的环境变量的值**。例：`DB_PATH` 被标记为 secret，值是 `data/archive.db`；这个默认路径写在 README、`.env.example` 和 `src/server/config.ts` 里，于是构建失败。

- `DB_PATH` 不是密钥，而且静态构建根本不用它（构建脚本使用临时数据库）。`netlify.toml` 已设置 `SECRETS_SCAN_OMIT_KEYS = "DB_PATH"` 跳过它；也可以直接在 Netlify 删除这个变量。
- 如果报的是别的变量：先确认它是不是真密钥。不是 → 取消 secret 标记；是 → 说明该值确实出现在了文件里，**不要**用 `SECRETS_SCAN_ENABLED=false` 关掉扫描，应该把它从文件里删掉并轮换密钥。

### 浏览统计（无需新增密钥）

`netlify/functions/analytics.mts` 会自动提供 `/api/analytics/*`。除上表的 `ADMIN_TOKEN` 和 `SITE_URL` 外不需要新的环境变量；统计数据写入 Netlify Blobs 的 `site-analytics` store，按 deploy context 隔离，不写入静态 HTML，也不需要重新部署来累积计数。

上线后用生产站打开几个公开页面，再进入 `/admin → Pageviews / 浏览数据` 检查数字、暂停开关和 CSV。首次验证前应确认 Functions 日志没有 Blobs 权限或存储错误；本地模拟测试不等于生产 Blobs 已验证。指标、90 天滚动窗口和 DNT/GPC 行为见 [ANALYTICS.md](ANALYTICS.md)。

### 上线前准备（邮件订阅）

1. 在 Resend（或 Brevo）注册免费账号——不需要信用卡。
2. 在提供商后台添加并验证发信域名（按提示在 DNS 加 SPF / DKIM 记录，等待验证通过）。
3. **关闭点击（链接）追踪**：Resend 在域名设置中，Brevo 在交易邮件的追踪设置中（具体位置以提供商当前后台为准）。追踪会改写链接，可能丢掉 `#token=` 片段。
4. 创建只有发信权限的 API key（Resend：API Keys → Create → Permission 选 **Sending access**，可限定到你的域名）。
5. 生成 `NEWSLETTER_SECRET`：`openssl rand -base64 48`。**离线保存一份**——丢失后名单无法解密，换掉会使所有退订链接失效。
6. 在 Netlify 设置上表变量，触发一次生产部署。
7. 订阅入口默认隐藏：验证通过后再加 `SHOW_NEWSLETTER_SIGNUP=1`（Builds）并重新部署，入口才会出现在公开页面。见 [NEWSLETTER.md → 显示 / 隐藏订阅入口](NEWSLETTER.md#显示--隐藏订阅入口)。

### 上线后验证

在生产站上用自己的邮箱：

1. `/subscribe` 页面没有显示“尚未开放” → 输入邮箱 → 显示“请查收邮件”。
2. 收到确认邮件；链接形如 `https://站点/newsletter/confirm#token=…` → 点击“确认订阅” → 显示订阅成功；收到欢迎邮件。
3. 再次点击同一确认链接 → 显示“已经确认过了”。
4. 欢迎邮件中的退订链接 → 点击“退订” → 已退订。Gmail 等客户端会显示原生的“退订”按钮（RFC 8058）。
5. `/admin` 用 `ADMIN_TOKEN` 登录 → 只显示“订阅”模块，计数正确；导出 CSV。
6. Netlify → Logs → Functions → `newsletter`：日志中只有打码的邮箱（`r***@example.com`），没有 token。

以上任何一步失败时，后台“订阅”模块顶部会显示缺少的变量或今日 / 本月发信情况；函数日志会记录提供商返回的状态码（不含邮箱）。

### 免费额度

| 资源 | 额度 | 本项目的用量 |
| --- | --- | --- |
| Netlify 积分制免费套餐（2025-09-04 后创建的账号） | 每月 300 积分，**用尽后站点暂停** | 生产部署每次 15 积分是大头；订阅请求每次订阅约 2–3 次函数调用，按网页请求 2 积分/万次和极少的计算量计算，可忽略 |
| Netlify 旧版免费套餐 | Functions 每月 125k 次调用；Blobs 包含 | 远低于上限 |
| Netlify Blobs | 所有套餐都包含 | 一个加密 JSON 文档 |
| Netlify Functions | 免费套餐 10 秒超时 | 发信超时设为 6 秒 |
| Resend 免费 | 每月 3,000 封，每天 100 封（UTC），收发都计入 | 默认 `NEWSLETTER_DAILY_LIMIT=90`、`NEWSLETTER_MONTHLY_LIMIT=2800` 留出余量，并以 Resend 返回的用量为准；用尽后订阅暂停到次日 / 下月并明确提示。见 [NEWSLETTER.md](NEWSLETTER.md#发信上限防止超出-resend-免费额度) |
| Brevo 免费 | 每天 300 封 | 可设 `NEWSLETTER_DAILY_LIMIT=280`、`NEWSLETTER_MONTHLY_LIMIT=8400` |

### 长期无访问、冷启动与整站暂停

**不需要为“长期不活跃”设置定时唤醒。** Netlify 静态页面不会因为没有访客而进入需要唤醒的休眠状态；函数冷启动只可能让订阅／统计 API 的某次请求变慢，不妨碍已部署的静态文章加载。本项目没有使用会按 inactivity sleep 的 Netlify Database。

真正需要防的是**额度用尽后的团队级暂停**：积分制免费套餐每月 300 积分为硬上限，耗尽后团队内项目不能接收网页请求，访客看到 `Site not available`。免费套餐不能 auto recharge；只能等下一计费周期自动恢复，或升级套餐。此时任何客户端代码、Service Worker 或 scheduled function 都无法保证站点继续在线。

因此本项目采用以下策略，而不是无效的 keep-alive：

1. 静态文章不依赖 Notion、Blobs 或 Function 才能阅读；公开统计失败不会阻塞正文。
2. 首屏 Three.js／模型延迟到首次滚动，减少首访资源请求与计算；不为“保活”增加 scheduled function、定时 ping 或第三方监控请求。
3. 已有离线副本的浏览器在断网或源站 5xx 时可继续阅读；这不是整站暂停的替代方案，首次访客仍需要可用的托管服务。
4. 合并内容更新后再做生产部署，避免无意义的重复生产部署；部署预览不计生产部署的 15 积分，但网页请求、带宽和 Functions 仍应按实际用量观察。
5. 在 **Team → Usage & billing** 每月检查积分、带宽和请求量，并确保 Netlify 的 50%／75%／90%／100% 用量通知能发送到站主邮箱。接近上限时先减少部署和非必要 API 请求，不要等到整站暂停才处理。

官方说明：[How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) 与 [Resume paused projects](https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/)。如果业务要求即使免费额度耗尽也不能离线，只能准备额外托管／付费额度或外部故障切换；仓库内的功能不能诚实承诺这一点。

### 其他静态主机

Cloudflare Pages 等主机可以发布同一个 `static-dist/`，但没有 Netlify Function：订阅页面会显示“此页面暂时无法连接订阅服务”，统计后台也无法登录／读取。服务层与存储接口是可移植的（`NewsletterStore`、`AnalyticsStore`、`DocumentBackend`），要在别的平台运行需要为该平台写类似 `netlify/functions/newsletter.mts` / `analytics.mts` 的入口和存储后端。

## Node 动态站

1. `npm ci && npm run build`，设置 `ADMIN_TOKEN`、`SITE_URL`、Notion 变量，`npm start`。
2. 订阅数据在同一个 SQLite 数据库（迁移 11 自动创建表）。设置同样的 `NEWSLETTER_*` 变量即可开放订阅；公开入口在 `/admin → 设置 → 邮件订阅` 开关，立即生效（也可用 `SHOW_NEWSLETTER_SIGNUP=1` 作为默认值）。
3. 浏览统计在迁移 12 的 `analytics_daily` 表中，默认开启；`/admin → Pageviews / 浏览数据` 可暂停、导出或清除。它只保存每日聚合，备份数据库即可一并备份。
4. 反向代理后的客户端无法可靠区分（不信任转发头），订阅限流会落到共享桶（10 分钟 60 次）；建议在代理层另设限流。
5. 备份：数据库与上传目录，见 README。

## 发布检查清单

- [ ] `npm run check` 通过（类型检查、单元测试、构建、渲染/静态导出测试）
- [ ] UI 改动跑过 `npm run test:ui`
- [ ] `static-dist/` 没有提交到 Git（已在 `.gitignore`）
- [ ] 生产环境变量的 Scope 和 Context 符合上表；预览没有生产密钥
- [ ] Usage & billing 用量通知可送达；没有为了“保活”增加定时请求，本月生产部署和流量不会耗尽免费额度
- [ ] 部署后按“上线后验证”走一遍；未验证前不要宣称订阅已上线
- [ ] 生产站实际打开几页后，后台能看到统计；验证暂停、CSV、清除和 DNT/GPC，不把本地模拟当成 Blobs 验证
- [ ] 在线打开文章后断网重载，确认离线副本和未缓存回退；检查 `/sitemap.xml`、`/llms.txt` 与版权／TDM 声明
