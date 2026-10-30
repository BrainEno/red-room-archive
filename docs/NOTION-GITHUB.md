# Notion 与 GitHub：后续发布自动化调研

调研日期：2026-10-30。本文是方案对比，**并未启用任何自动化**。用户提到的 “GitHub pull trigger” 没有看到具体界面或完整名称，无法确定是哪项功能；下列功能方向不同，不能把它们当成同一件事。若能提供该选项的截图（遮住凭据和隐私信息），可进一步对照。

## 当前项目如何发布

Node 模式是 **运行中的 Astro SSR + SQLite 缓存**，并非每篇文章都生成 Git 文件。静态快照模式则在构建时读取 Notion，更新后需要重新构建并部署；见 README「静态部署」。Notion 中 `Published` 勾选后，首次请求同步、访问触发的过期刷新或 `/admin → Articles → Sync now` 成功时，文章进入站点；取消勾选同样需要成功同步才能移除。默认 5 分钟只是缓存过期阈值，不是定时器：没有访问时不会自动更新。GitHub 的代码 PR / CI 与这条文章发布链路是两件事，正常发布文章不需要 GitHub PR 或重新部署代码。

## “GitHub Pull Requests” 连接属性

[Notion GitHub 集成](https://www.notion.com/help/github)可以将 GitHub PR 链接到 Notion 任务，展示和跟踪 PR 状态，也可根据 PR 打开、审核或合并自动更新关联任务的 Status。[Connected properties 文档](https://www.notion.com/help/connected-properties)称此属性需要 Business 或 Enterprise 计划，具体以当前工作区界面为准。用途是管理**代码开发任务**，例如把网站改版任务与代码 PR 关联；这不等于读取文章、自动勾选 Published、刷新本网站缓存或部署站点。不要让“代码 PR 合并”自动勾选文章的 `Published`，除非用户明确要求那种审核流程。

## 让 Notion 文章更新更快出现

1. **现有方案：手动 Sync now**。最简单、可控；依赖站点在线和手动操作。
2. **未来 Notion connection webhooks**：订阅 `page.properties_updated` 和 `page.content_updated` 等事件。事件只是变化信号，并非完整最新正文；服务端必须重新向 Notion 拉取、按 Published/Date 判断，不能信任事件内容直接发布。[事件类型与投递说明](https://developers.notion.com/reference/webhooks-events-delivery)指出有聚合、重试等行为，不能假定精确实时或事件顺序。实现时需要公网 HTTPS、订阅握手、使用原始请求体校验 `X-Notion-Signature` HMAC、去重/幂等、限流和合并刷新；做好断线后的定时或手动补偿。[签名文档](https://developers.notion.com/reference/webhooks)。不要把现有的管理员 token 暴露在 URL 或浏览器里。取消发布仍应由后续成功同步生效，CDN/浏览器已缓存的内容不能保证即时撤回。
3. **未来定时同步**：用可靠的定时器调用受保护的同步接口，减少无访问时的等待，但仍不是即时；要处理重试、密钥保管、任务重叠和服务不可达。GitHub Actions 的 [schedule / workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) 可用于调度，但 GitHub runner 上临时 SQLite 与线上实例的 SQLite 不是同一个文件；在 runner 上同步并不会自动更新正在运行的网站。需要调用正确的线上服务，且不能把管理 token 写进仓库或日志。

## 如果希望文章先通过 GitHub PR 审核

这需要额外设计 Notion → 受认证的桥接服务 → GitHub 事件（如 [repository_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch)）→ 导出/生成内容 → 创建 PR → 人工审核合并 → 构建/部署。它与当前 SSR 运行时读取 Notion 的模式不同：PR 审核是否决定公开、勾选 Published 的意义、撤稿、定时发布、Notion 文件授权和构建时泄露草稿都必须先确定。触发事件本身不会自动创建 PR；若内容仍由运行中的站点直接读取 Notion，PR 也不能天然阻止文章公开。最小权限、事件校验、幂等、并发、失败补偿和私密信息过滤都是实现前提。

**建议下一步**：先确认数据库连接及现有手动同步可靠；如果主要需求是“勾选后尽快上线”，优先评估 Notion webhook + 定时补偿，而非先引入 PR 流程。本文只做调研，没有新增 webhook、定时任务、GitHub 写权限或自动发布流程。
