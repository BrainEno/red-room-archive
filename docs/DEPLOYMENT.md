# 部署

本项目有两种部署方式，代码相同：

| | Netlify 静态站（当前生产） | Node 动态站 |
| --- | --- | --- |
| 构建 | `npm run build:static` → `static-dist/` | `npm run build && npm start` |
| 文章 | 构建时从 Notion 读取；更新文章需重新部署 | 运行时同步 Notion |
| 后台 `/admin` | 只有“订阅”模块（经 Netlify Function） | 全部模块 |
| 邮件订阅 | `netlify/functions/newsletter.mts` + Netlify Blobs | Astro 端点 + SQLite |
| 持久数据 | 只有订阅名单（Blobs，加密） | SQLite + 上传目录 |

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
| `ADMIN_TOKEN` | Functions | Production | 静态站 `/admin` 管理订阅 |
| `NEWSLETTER_SECRET` | Functions | **仅 Production** | 加密名单、退订链接 |
| `NEWSLETTER_EMAIL_PROVIDER`、`NEWSLETTER_EMAIL_API_KEY`、`NEWSLETTER_FROM` | Functions | **仅 Production** | 发信 |
| `NEWSLETTER_REPLY_TO`、`NEWSLETTER_DAILY_LIMIT`、`NEWSLETTER_TOKEN_TTL_HOURS`、`NEWSLETTER_SITE_NAME` | Functions | Production | 可选 |

- **不要把生产密钥给 Deploy Preview**：预览可能来自不可信的 PR，PR 自己的代码能读取注入的变量。只在 Production 设置 `NEWSLETTER_*` 和 `ADMIN_TOKEN` 后，预览站的订阅会显示“尚未开放”（503），这是预期行为。
- 预览和分支部署即使配置了密钥，也只会读写自己的 Blobs key（`subscribers-deploy-preview.json` 等），不会碰生产名单。
- 静态构建会去掉所有 `NEWSLETTER_*` 再启动构建用的临时服务器，并在发布前扫描 `static-dist/`：发现任何服务端密钥（Notion token、`ADMIN_TOKEN`、`NEWSLETTER_SECRET`、邮件 API key）或数据库文件就中止部署。

### 上线前准备（邮件订阅）

1. 在 Resend（或 Brevo）注册免费账号——不需要信用卡。
2. 在提供商后台添加并验证发信域名（按提示在 DNS 加 SPF / DKIM 记录，等待验证通过）。
3. **关闭点击（链接）追踪**：Resend 在域名设置中，Brevo 在交易邮件的追踪设置中（具体位置以提供商当前后台为准）。追踪会改写链接，可能丢掉 `#token=` 片段。
4. 创建只有发信权限的 API key。
5. 生成 `NEWSLETTER_SECRET`：`openssl rand -base64 48`。**离线保存一份**——丢失后名单无法解密，换掉会使所有退订链接失效。
6. 在 Netlify 设置上表变量，触发一次生产部署。

### 上线后验证

在生产站上用自己的邮箱：

1. `/subscribe` 页面没有显示“尚未开放” → 输入邮箱 → 显示“请查收邮件”。
2. 收到确认邮件；链接形如 `https://站点/newsletter/confirm#token=…` → 点击“确认订阅” → 显示订阅成功；收到欢迎邮件。
3. 再次点击同一确认链接 → 显示“已经确认过了”。
4. 欢迎邮件中的退订链接 → 点击“退订” → 已退订。Gmail 等客户端会显示原生的“退订”按钮（RFC 8058）。
5. `/admin` 用 `ADMIN_TOKEN` 登录 → 只显示“订阅”模块，计数正确；导出 CSV。
6. Netlify → Logs → Functions → `newsletter`：日志中只有打码的邮箱（`r***@example.com`），没有 token。

以上任何一步失败时，后台“订阅”模块顶部会显示缺少的变量或今日发信情况；函数日志会记录提供商返回的状态码（不含邮箱）。

### 免费额度

| 资源 | 额度 | 本项目的用量 |
| --- | --- | --- |
| Netlify 积分制免费套餐（2025-09-04 后创建的账号） | 每月 300 积分，**用尽后站点暂停** | 生产部署每次 15 积分是大头；订阅请求每次订阅约 2–3 次函数调用，按网页请求 2 积分/万次和极少的计算量计算，可忽略 |
| Netlify 旧版免费套餐 | Functions 每月 125k 次调用；Blobs 包含 | 远低于上限 |
| Netlify Blobs | 所有套餐都包含 | 一个加密 JSON 文档 |
| Netlify Functions | 免费套餐 10 秒超时 | 发信超时设为 6 秒 |
| Resend 免费 | 每月 3,000 封，每天 100 封 | 默认 `NEWSLETTER_DAILY_LIMIT=90` 留出余量；用尽后当天订阅暂停并明确提示 |
| Brevo 免费 | 每天 300 封 | 可把 `NEWSLETTER_DAILY_LIMIT` 调到 280 |

### 其他静态主机

Cloudflare Pages 等主机可以发布同一个 `static-dist/`，但没有 Netlify Function：订阅页面会显示“此页面暂时无法连接订阅服务”，后台登录会失败。服务层与存储接口是可移植的（`NewsletterStore`、`DocumentBackend`），要在别的平台运行需要为该平台写一个类似 `netlify/functions/newsletter.mts` 的入口和存储后端。

## Node 动态站

1. `npm ci && npm run build`，设置 `ADMIN_TOKEN`、`SITE_URL`、Notion 变量，`npm start`。
2. 订阅数据在同一个 SQLite 数据库（迁移 11 自动创建表）。设置同样的 `NEWSLETTER_*` 变量即可开放订阅。
3. 反向代理后的客户端无法可靠区分（不信任转发头），订阅限流会落到共享桶（10 分钟 60 次）；建议在代理层另设限流。
4. 备份：数据库与上传目录，见 README。

## 发布检查清单

- [ ] `npm run check` 通过（类型检查、单元测试、构建、渲染/静态导出测试）
- [ ] UI 改动跑过 `npm run test:ui`
- [ ] `static-dist/` 没有提交到 Git（已在 `.gitignore`）
- [ ] 生产环境变量的 Scope 和 Context 符合上表；预览没有生产密钥
- [ ] 部署后按“上线后验证”走一遍；未验证前不要宣称订阅已上线
