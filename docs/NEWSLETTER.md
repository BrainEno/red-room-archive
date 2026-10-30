# 邮件订阅（Newsletter）

读者在站内订阅，替代 Substack；订阅名单属于本项目。只做订阅、确认、退订和后台管理——不做付费、会员等级、营销自动化。

## 一句话架构

| 部署 | 页面 | `/api/newsletter/*` | 数据 | 发信 |
| --- | --- | --- | --- | --- |
| **Netlify 静态站（生产）** | `static-dist/` 里的静态页 | `netlify/functions/newsletter.mts`（Netlify Function） | Netlify Blobs，一个 AES-256-GCM 加密的 JSON 文档 | Resend 或 Brevo HTTP API |
| Node 动态站 | Astro SSR | `src/pages/api/newsletter/[...path].ts` | SQLite（迁移 11） | 同上 |

两种部署跑的是**同一套**服务层（`src/server/services/newsletter.ts`）和 HTTP 处理（`src/server/newsletter/http.ts`），只有存储后端不同（`NewsletterStore` 接口：`sqlite` / `document`）。

### 为什么是 Netlify Functions + Blobs

生产站发布的是 `static-dist`，没有服务器；SQLite 不能放进静态目录，Function 的文件系统也不持久。要求零月费、不绑卡、复用现有 Netlify 项目：

- **Netlify Blobs**：所有套餐（含旧版 Legacy 套餐）都包含，无需新账号、无需绑卡；支持强一致读取和 ETag 条件写入（`onlyIfNew` / `onlyIfMatch`），足以做无锁的“读-改-条件写”事务。
- **Netlify Functions**：免费套餐可用，10 秒超时，内置平台级限流（`config.rateLimit`）。
- 未采用 **Netlify Database**（Neon Postgres）：只对新的积分制套餐开放、与部署共用积分、存储价格未公布；对一个几百人的名单来说是过度设计。
- 未采用其他托管数据库：都会引入新的第三方账号，且免费层往往要求绑卡或会休眠。

**积分提醒（2025-09-04 之后创建的 Netlify 账号）**：免费套餐每月 300 积分，用完整个站点会暂停。订阅相关请求很少（每次订阅约 2–3 次函数调用，网页请求按 2 积分/万次计），远小于部署（每次生产部署 15 积分）。文章页**不会**在加载时调用函数，只有读者第一次聚焦输入框时才检查一次可用性。旧账号（Legacy 套餐）按原有额度计算。

## 流程（双重确认）

1. 读者提交邮箱 → 服务器校验并规范化（小写、去空白、拒绝 CRLF/非法域名），创建或复用 `pending` 记录，生成 32 字节 CSPRNG token，**只保存 SHA-256 哈希**，有效期 48 小时（`NEWSLETTER_TOKEN_TTL_HOURS`）。
2. **提交后**发送确认邮件（事务提交之后才发信）。返回 202，回答对所有情况都相同（新地址 / 待确认 / 已订阅 / 已退订），**不暴露某邮箱是否已订阅**。已订阅的地址收到一封“你已经订阅了”的提示（每 24 小时最多一封），而不是确认链接。
3. 读者打开邮件中的链接 `/newsletter/confirm#token=…`。token 在 URL **片段**中，浏览器不会把它发给任何服务器（不进访问日志、不进 Referer）；页面立即用 `history.replaceState` 把它从地址栏移除。
4. 读者**点击按钮**才会确认（邮件安全扫描器只会打开页面，不会点击）。token 被消耗（单次有效），状态变为 `active`，再发一封欢迎邮件（带退订链接）。
5. 重复点击同一链接：返回“已确认”，不报错；过期：410；无效或已被新链接替换：400。

从未在“提交”这一步激活订阅。

### 状态

`pending` → `active` → `unsubscribed`；退订后重新订阅需要再次确认（回到 `pending`）。状态是字符串列，以后可以扩展，但不做会员等级。

### 退订

- 每封欢迎/提示邮件带退订链接 `/newsletter/unsubscribe#token=…`，以及 RFC 8058 一键退订头：
  `List-Unsubscribe: <https://站点/api/newsletter/unsubscribe?token=…>` 和 `List-Unsubscribe-Post: List-Unsubscribe=One-Click`（Resend 和 Brevo 都支持自定义邮件头）。
- 退订 token 是无状态的 `HMAC-SHA256(NEWSLETTER_SECRET, 订阅者 id + 邮箱)`，长期有效、幂等：重复退订仍返回成功。
- 退订保留历史（`unsubscribed_at`），不删除记录；已退订地址不会再收到任何邮件（发送前检查状态）。
- 确认邮件**不带**退订头（那时还没有订阅）。

> 本项目目前只负责订阅名单，**不包含**群发新文章的功能。群发时请使用 CSV 导出的 `active` 名单，并为每封邮件带上退订链接——退订链接的生成函数是 `unsubscribeToken()`（`src/server/newsletter/crypto.ts`）。

## 安全

| 风险 | 处理 |
| --- | --- |
| CSRF | 公开 JSON 接口要求 `Content-Type: application/json`，并校验 `Origin`（本站或 `SITE_URL`）与 `Sec-Fetch-Site`（`same-origin`）；跨站请求一律 403；一键退订（邮件客户端发起的 POST）只接受 `List-Unsubscribe=One-Click` 表单体 + 有效 token。后台接口需要 `Authorization: Bearer ADMIN_TOKEN`（不使用 cookie）。 |
| XSS | 页面不插入用户 HTML；后台表格全部转义；邮件模板转义所有插值。CSP 维持 `'self'`。 |
| 重放 / 过期 | token 单次有效、48 小时过期；新确认邮件会使旧 token 失效；已消耗、已过期的 token 7 天后清理。 |
| 枚举 | 订阅接口对所有地址返回同一个 202；确认/退订只看 token。 |
| 重复 | `normalized_email` 唯一约束；Blobs 文档内同样检查。 |
| 滥用 | ① Netlify 平台限流：每 IP 每分钟 40 次；② 应用限流：每客户端 10 分钟 8 次（无法区分客户端时共享 60 次）；③ 每个地址 10 分钟内最多一封确认信、24 小时最多 5 封；④ 全站发信上限：每天（UTC）默认 90 封、每月默认 2,800 封，低于 Resend 免费层的每天 100 封、每月 3,000 封（见下文“发信上限”）；⑤ 蜜罐字段 `website`（填写即静默丢弃）；⑥ 请求体上限 4 KB。限流键是地址/IP 的 HMAC，不存明文。 |
| CSV 注入 | 以 `= + - @` 制表符、回车开头的单元格前加 `'`；只导出最少字段。 |
| 日志 | 不记录完整邮箱（只记 `r***@example.com`）和 token。 |
| 密钥 | 所有密钥只在服务器端环境变量中；静态构建会去掉 `NEWSLETTER_*`，并扫描 `static-dist/`，发现任何服务端密钥就中止发布。 |

### 失败与恢复

- **发信失败**（提供商报错、超时 6 秒、网络错误）：本次 token 立即作废、记录 `last_error = send_failed`，返回 502，页面明确写“订阅没有生效”。没有冷却期——读者可以马上重试；后台的“重发确认”按钮也可以补发。
- **数据库/存储失败**：SQLite 用事务；Blobs 用 ETag 条件写，冲突时重读重试（最多 6 次），绝不覆盖别人的写入。写入失败时不发信。
- **发信与存储不一致**：先提交再发信。若提交成功而发信失败，记录会停在 `pending` 并带 `send_failed` 标记，可在后台重发；若发信后进程崩溃，最坏情况是读者收到一封有效的确认信——不会出现“已激活却没确认”。
- **未配置邮件**：订阅接口返回 503，“邮件发送尚未配置……没有保存任何信息”，**不写入任何数据**；页面在加载（/subscribe）或第一次聚焦（文章页）时就显示“尚未开放”并禁用输入框。不会假装发送成功。
- **静态站上没有函数**（例如 Cloudflare Pages 或本地静态预览）：接口 404，页面显示“此页面暂时无法连接订阅服务”。
- **密钥丢失或更换**：Blobs 文档无法解密时返回 503，**绝不覆盖**原文档。换回原密钥即可恢复。更换 `NEWSLETTER_SECRET` 会使旧的退订链接失效，并且需要先用旧密钥导出 CSV——请不要随意更换。

## 数据结构

### SQLite（Node 站点，迁移 11）

```text
newsletter_subscribers(id, email, normalized_email UNIQUE, status, source, locale,
                       created_at, updated_at, confirmed_at, unsubscribed_at,
                       last_error, last_error_at, notice_sent_at)
newsletter_tokens(id, subscriber_id → subscribers ON DELETE CASCADE, token_hash UNIQUE,
                  token_type, expires_at, consumed_at, created_at)
newsletter_send_counts(period PRIMARY KEY, count)    -- 发信计数：period 为 UTC 日（YYYY-MM-DD）或月（YYYY-MM），保留本月和上月
newsletter_rate_limits(key PRIMARY KEY, window_start, count)  -- key 为 HMAC
```

时间全部是 UTC ISO 8601。不保存 IP、User-Agent、姓名。

### Netlify Blobs（静态站点）

- store：`newsletter`（站点级，强一致读取）；key：`subscribers-<部署上下文>.json`，生产为 `subscribers-production.json`。预览和分支部署使用各自的 key，不会碰生产名单。
- 内容：同样的字段（`red-room-newsletter-state` v1），整体用 `NEWSLETTER_SECRET` 派生的密钥 AES-256-GCM 加密。即使有人拿到了 Blob，也读不到邮箱。
- 规模：一个文档适合几千人以内的名单；每次写入都是整个文档，并发写由 ETag 保证正确。

## API

见 [API.md → 邮件订阅](API.md#邮件订阅)。

## 配置

### 1. 选择邮件服务（免费、无需绑卡）

| 服务 | 免费额度 | 设置 |
| --- | --- | --- |
| **Resend**（推荐） | 每月 3,000 封，**每天 100 封** | `NEWSLETTER_EMAIL_PROVIDER=resend` |
| Brevo | 每天 300 封 | `NEWSLETTER_EMAIL_PROVIDER=brevo` |

都需要验证一个你拥有的发信域名（在 DNS 里添加 SPF/DKIM 记录，提供商后台会给出具体记录）。**请在提供商后台关闭点击追踪**：追踪会改写链接，`#token=` 片段可能丢失，并让追踪服务器看到链接。

其他服务（Mailjet、SMTP2GO 等）可以按 `Mailer` 接口（`src/server/newsletter/mailer.ts`）再加一个适配器。

### 2. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NEWSLETTER_SECRET` | ✔ | 至少 32 个字符的随机串（`openssl rand -base64 48`）。用于加密 Blobs 文档、生成退订链接和限流键。**丢失 = 名单无法解密。请离线备份。** |
| `NEWSLETTER_EMAIL_PROVIDER` | ✔ | `resend` 或 `brevo` |
| `NEWSLETTER_EMAIL_API_KEY` | ✔ | 提供商 API key（只给发信权限即可） |
| `NEWSLETTER_FROM` | ✔ | `Red Room Archive <letters@你的域名>`，域名须已在提供商验证 |
| `SITE_URL` | ✔ | 站点源（如 `https://archive.example`）。Netlify 上未设置时使用内置的 `URL`。用于邮件链接和同站校验。 |
| `ADMIN_TOKEN` | 后台 | 与 Node 站点相同的后台 token；静态站后台用它管理订阅。 |
| `NEWSLETTER_REPLY_TO` |  | 回复地址 |
| `NEWSLETTER_DAILY_LIMIT` |  | 每天（UTC）最多发几封，默认 90（Resend 免费层每天 100） |
| `NEWSLETTER_MONTHLY_LIMIT` |  | 每月（UTC 自然月）最多发几封，默认 2800（Resend 免费层每月 3,000） |
| `NEWSLETTER_TOKEN_TTL_HOURS` |  | 确认链接有效期，默认 48 |
| `NEWSLETTER_SITE_NAME` |  | 邮件里的站点名，默认 `Red Room Archive` |

缺少任何一个必填变量，订阅都会保持关闭（503），后台会列出缺少的变量名（不显示值）。

### 发信上限（防止超出 Resend 免费额度）

Resend 免费层：**每天 100 封**（按 UTC 自然日，UTC 午夜重置）、**每月 3,000 封**；发出和收到的邮件都计入；超出时 API 返回 429（`daily_quota_exceeded` / `monthly_quota_exceeded`），免费层不会扣费，只是发不出去。本项目的保护：

1. **自己计数**：确认信、欢迎信、“你已订阅”提醒、后台重发，**每一封**都计入当天和当月的计数。
2. **发信前检查**：任一上限用完，新的订阅请求直接返回 503（`details.reason` = `daily-limit` / `monthly-limit`），不保存地址、不调用 Resend；页面显示“今日订阅已暂停，请明天再试”或“本月订阅已暂停，请下个月再试”。确认链接照常可用，只是不再发欢迎信。
3. **以 Resend 的数字为准**：Resend 每次响应都带 `x-resend-daily-quota`（仅免费层）和 `x-resend-monthly-quota`（已用数量）。若它比本站的计数大（例如你用同一个 Resend 账号发了别的邮件），本站计数会提高到这个数，只升不降。
4. **Resend 拒绝时立即停下**：收到 `daily_quota_exceeded` / `monthly_quota_exceeded` 后，本站把当天（或当月）计数直接记满，之后的请求不再调用 Resend；这位访客的地址保持“待确认”，后台会标记“发送失败”，可在恢复后“重发确认”。

调整方法：在 Netlify 环境变量里设置 `NEWSLETTER_DAILY_LIMIT` / `NEWSLETTER_MONTHLY_LIMIT`（正整数；无效值回到默认值），重新部署生效。后台“订阅”模块顶部显示“今日已发送 x / 90 · 本月 y / 2800”，用完时会标红。

- 本站按 **UTC 自然月**计月；Resend 的月度额度可能按你的账单周期重置（在 Resend → Settings → Usage 查看）。第 3 点会让本站在两者不一致时偏保守（宁可提前停，不会超）。如果 Resend 账号还用于别的项目，请把两个值调低，为它们留出余量。
- 想暂时停止所有发信：删掉 `NEWSLETTER_EMAIL_API_KEY` 并重新部署，订阅会显示“尚未开放”，已有名单不受影响。
- Brevo 免费层每天 300 封、没有月度上限，可设 `NEWSLETTER_DAILY_LIMIT=280`、`NEWSLETTER_MONTHLY_LIMIT=8400`。Brevo 不返回用量头，只靠本站计数。

### 3. Netlify 上的设置

1. Site configuration → Environment variables：添加上表变量，**Scopes 选 Functions**，**Deploy contexts 只选 Production**。这样 Deploy Preview（可能来自不可信的 PR）拿不到生产密钥，预览站的订阅会显示“尚未开放”。
2. 重新部署。`netlify.toml` 已声明 `[functions] directory = "netlify/functions"`；Blobs 无需另外开通。
3. 打开 `https://站点/subscribe` 用自己的邮箱走一遍：订阅 → 收信 → 确认 → 退订。
4. 打开 `https://站点/admin`，用 `ADMIN_TOKEN` 登录——静态站后台只显示“订阅”模块。

详见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 后台

`/admin → 订阅`（Node 站点和静态站点都有；使用现有的 `ADMIN_TOKEN`，没有新的登录方式）：

- 总数 / 已订阅 / 待确认 / 已退订；邮件服务状态、今日和本月已发送数量（达到上限时标红）；
- 按邮箱搜索、按状态筛选、分页；创建时间、确认时间、退订时间、来源、语言；
- 待确认地址可“重发确认”（受同样的冷却和每日 / 每月上限限制）；
- **导出 CSV**：`email,status,locale,source,created_at,confirmed_at,unsubscribed_at`，UTF-8 BOM（Excel 可直接打开）。不含 id、token、哈希、错误信息或任何密钥；防公式注入。

## 备份

- **CSV 导出**是主要备份方式，建议每月导出一次，保存在私密的地方（它包含邮箱）。
- Netlify 上的原始文档可以用 Netlify CLI 读取：`netlify blobs:get newsletter subscribers-production.json --output backup.json`；它是加密的，必须配合 `NEWSLETTER_SECRET` 才能解开（`unseal()`，`src/server/newsletter/crypto.ts`）。
- Node 站点：备份 SQLite 文件（与文章缓存同一个数据库）。
- 目前没有“从 CSV 导入”的功能；如需迁移，请在 issue 中提出。

## 测试

- `tests/newsletter.test.mjs`：规范化、配置、迁移、两种存储（唯一性、单次 token、回滚、ETag 竞争、加密）、服务层（双重确认、过期、枚举、冷却、限流、每日 / 每月发信上限与 Resend 用量同步、蜜罐、未配置、发信失败与重发、退订）、后台列表与 CSV、HTTP（CSRF、413、401、一键退订）、Netlify 接线（按上下文隔离）、函数打包图（不含 SQLite / Astro / UI）、提供商请求体。
- `tests/integration/static-export.test.mjs`：静态构建包含订阅页面和后台外壳，不含数据库、订阅数据或任何密钥。
- `tests/ui/newsletter.spec.mjs`：真实的“未配置”和“无函数”状态、模拟后端下的完整流程、确认/退订页、入口、后台（Node 与静态）。

**没有在测试中覆盖的**：真实的 Netlify Function 运行时、真实的 Blobs、真实的邮件投递。这些需要在配置好生产环境变量后，按上面的第 3 步手动验证一次。
