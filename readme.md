# koishi-plugin-feedluna

订阅 RSS 更新并合并推送到指定群聊频道。

在群聊中发送：

```text
feedluna.sub https://example.com/feed.xml
```

默认情况下，插件首次订阅时只记录当前已有文章，不会立即推送历史内容。之后检测到新文章时，会将同一轮轮询中的更新合并后发送到订阅群。可通过 `pushInitialItems` 调整首次订阅行为。

查看当前群聊的订阅：

```text
feedluna.list
```

取消当前群聊中的订阅：

```text
feedluna.unsub https://example.com/feed.xml
```

`feedluna.list` 和 `feedluna.unsub` 也分别支持别名 `feedluna.ls` 和 `feedluna.unsubscribe`。

## WebUI

启用 Koishi Console 后，侧边栏会出现 FeedLuna RSS 图标。页面提供：

- 所有订阅的查看、搜索、编辑、取消订阅和监听开关。
- RSS/Atom/RDF Feed 的文章预览；预览不会写入订阅记录、改变已读文章或发送消息。
- 手动配置推送目标：平台名称、机器人 ID、频道 ID、可选群组 ID，以及是否在该频道启用监听。
- 直接在页面编辑请求设置、推送内容和订阅状态，并通过 Koishi 原生配置重载保存。

WebUI 使用选定机器人的 `sendMessage(channelId, content, guildId)` 推送。因此机器人 ID 必须对应运行中的机器人，频道 ID 与群组 ID 由管理员按目标平台填写。一个 RSS Feed 推送到多个目标时，为每个目标分别建立订阅。

群聊命令创建的订阅会自动使用当前会话的平台、机器人、频道和群组信息；首次文章仍发送至输入指令的当前会话。

## 配置

所有配置项都可在 FeedLuna 侧边栏页面的“插件设置”中调整，也可在 Koishi 控制台的插件配置页面调整，无需手动编辑 `koishi.yml`。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `pollInterval` | `300000` | RSS 检查间隔，单位为毫秒，最短 10 秒。 |
| `requestTimeout` | `30000` | RSS 请求超时时间，单位为毫秒，最短 1 秒。 |
| `userAgent` | 桌面 Chrome User-Agent | 请求 RSS 时使用的 User-Agent，默认模拟桌面 Chrome 浏览器。 |
| `maxItemsPerUpdate` | `8` | 单次检查合并推送的最大文章数，范围为 1 至 50。 |
| `includeSummary` | `true` | 是否在推送中包含文章摘要。 |
| `maxSummaryLength` | `500` | 单篇摘要的最大字符数；设为 `0` 时不发送摘要。 |
| `pushInitialItems` | `false` | 是否在首次订阅时立即推送当前 Feed 的文章（不建议开启，可能导致刷屏）。 |
| `maxSeenIds` | `500` | 每个订阅保留的已推送文章 ID 数量，范围为 50 至 5000。 |
