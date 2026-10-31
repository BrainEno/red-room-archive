# 第一方浏览数据

站点提供一套不依赖第三方 analytics 的页面浏览统计。它回答的是“哪些公开页面被看了多少次、来自哪些来源主机”，**不是访客画像或独立访客统计**。

## 站主怎么查看

1. Node 站打开 `/admin`，输入 `ADMIN_TOKEN`，切换到 **Pageviews / 浏览数据**。
2. Netlify 静态站也打开 `/admin`。后台会分别探测 Analytics 和 Newsletter Function，只显示实际可用的模块；静态站不需要 Node 的 `/api/settings`。
3. 选择最近 **7 / 30 / 90 天**，查看每日浏览量、热门公开路径、来源主机和界面语言。
4. **Export CSV / 导出 CSV** 下载当前范围的每日聚合；**Clear data / 清除数据** 删除全部聚合，但保留收集开关状态。
5. 取消 **Collect pageviews / 收集页面浏览量** 可暂停收集，已有数据仍可查看和导出；重新勾选后恢复。

报表按 **UTC 日期**汇总。“今日”也是 UTC，不是站主所在时区；日均值是当前选择范围内的 pageview 平均值。

## 收集什么、不收集什么

每次完整页面导航最多发送一个 beacon，请求体只有：

```json
{ "path": "/articles/example", "referrer": "news.example" }
```

- `path` 只接受公开路径白名单；中文路径保留 `/zh-CN` 前缀，去掉末尾斜杠。查询字符串不会发送，所以搜索词不会进入统计。
- `referrer` 只保留来源主机；站内导航记为 `(internal)`，没有来源记为 `(direct)`。不会接受或保存完整 Referer URL。
- 每日保存总计、路径、界面语言和来源主机的计数。报表使用 **90 天**滚动窗口；过期聚合在后续收集写入时清理（没有独立定时删除任务），每天最多 200 个路径和 100 个来源，超出部分并入 `(other)`，避免异常流量无限扩大存储。
- 不保存 IP、User-Agent、cookie、访客 ID、会话 ID、设备指纹、事件时间戳、搜索词、完整 referrer、地理位置或跨站跟踪标识。
- 因此没有“独立访客”“回访用户”“停留时长”“转化率”等虚构指标；同一读者多次打开页面就是多次 pageview。
- 浏览器或请求带 **DNT: 1** / **Sec-GPC: 1** 时静默不收集；客户端也识别 Global Privacy Control。即使旧页面仍发出 beacon，服务端也会再次检查并忽略。

本站仍保留语言选择等原有功能性 cookie；统计本身不新增 cookie，也不使用 localStorage / sessionStorage 保存访客标识。Netlify 等平台为自己的安全和计费功能处理网络元数据，不属于本应用的统计数据存储。

## 两种部署的存储

| 部署 | 存储 | 说明 |
| --- | --- | --- |
| Node SSR | 同一个 SQLite 数据库的 `analytics_daily` 表（迁移 12） | 随 `DB_PATH` 一起备份；只存每日计数，不存原始事件 |
| Netlify 静态站 | Netlify Blobs，store `site-analytics` | 一个带 ETag 条件写的有界 JSON 文档；并发写入冲突会重试 |

静态站的 key 按 deploy context 隔离，例如 `pageviews-production.json`、`pageviews-deploy-preview.json`。预览不会读写生产计数。无需新增数据库账号或第三方 analytics 服务。

**Netlify 设置：**

- `ADMIN_TOKEN` 只放在 Production 的 Functions scope，用于登录和报表 API；不要把生产 token 给 Deploy Preview。
- `SITE_URL` 按部署文档配置到 Builds + Functions，用于 canonical 和同站校验。
- Analytics Function 已随 `netlify/functions/analytics.mts` 提供，无需额外开启第三方插件。Netlify 侧有每 IP／域名 60 秒 120 次的代码限流。
- 静态 HTML 仍由构建生成；浏览数据是运行时 Function + Blobs，不会把浏览计数写回 HTML，也不会触发重新部署。

这套实现已在本地用 Node SQLite 和模拟 Blobs 验证；**尚未代替你在真实 Netlify 项目上验证 Blobs 权限、Functions 日志和生产 token**。

## API 契约

公开收集：

| 方法 | 路径 | 请求 | 成功 |
| --- | --- | --- | --- |
| POST | `/api/analytics/collect` | JSON `{ path, referrer }`，最多 2 KiB；要求 `Content-Type: application/json` 和同站 Origin / Fetch-Site | `204`，无响应体 |

管理接口都需要 `Authorization: Bearer <ADMIN_TOKEN>`，响应均 `Cache-Control: no-store`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/analytics/admin/summary?days=7\|30\|90` | 汇总、每日序列、路径／来源／语言计数、开关和存储类型 |
| PATCH | `/api/analytics/admin/settings` | `{ "enabled": true \| false }`，暂停或恢复收集 |
| DELETE | `/api/analytics/admin/data` | 清除全部聚合，保留开关 |
| GET | `/api/analytics/admin/export?days=7\|30\|90` | 下载带 UTF-8 BOM 的 CSV，单元格防公式注入 |

路径非法、请求体超限、跨站写入、缺少管理 token 等分别返回约定错误；DNT/GPC 是例外，直接返回 `204` 且不写入。完整类型见 `src/shared/contracts.ts`，共用 HTTP 实现见 `src/server/analytics/http.ts`。

## 备份与故障

- Node 的 SQLite 备份会包含 `analytics_daily`；恢复后统计数据一并恢复。若只备份文章而排除数据库，统计数据不会存在别处。
- 静态站可用 Netlify Blobs CLI 导出对应 context 的 JSON 作为额外备份；不要用生产 key 在预览环境测试。
- Function／Blobs 暂时不可用时会返回明确错误，不会把数据伪装成已保存；公开阅读不依赖统计成功。
- 清除数据不可逆，先导出 CSV；暂停收集不会清除历史数据。
