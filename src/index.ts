import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { Context, Schema, Time } from 'koishi'
import { XMLParser } from 'fast-xml-parser'
import type {} from '@koishijs/plugin-console'

export const name = 'feedluna'
export const inject = {
  required: ['database', 'http'],
  optional: ['console'],
}
const SUBSCRIPTION_TABLE = 'feedluna.subscription' as const
const PREVIEW_ITEM_LIMIT = 20
const PREVIEW_SUMMARY_LENGTH = 1000
const DEFAULT_MAX_XML_ENTITY_EXPANSIONS = 20000

export interface Config {
  pollInterval: number
  requestTimeout: number
  maxItemsPerUpdate: number
  includeSummary: boolean
  maxSummaryLength: number
  pushInitialItems: boolean
  pushAllInitialItems: boolean
  maxSeenIds: number
  userAgent: string
  maxXmlEntityExpansions: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    pollInterval: Schema.natural()
      .role('ms')
      .min(Time.second * 10)
      .default(Time.minute * 5)
      .description('检查 RSS 更新的间隔，最短为 10 秒。'),
    requestTimeout: Schema.natural()
      .role('ms')
      .min(Time.second)
      .default(Time.second * 30)
      .description('请求 RSS 地址的超时时间。'),
    userAgent: Schema.string()
      .min(1)
      .max(256)
      .default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
      .description('请求 RSS 时使用的 User-Agent，默认模拟桌面 Chrome 浏览器。'),
    maxXmlEntityExpansions: Schema.natural()
      .min(100)
      .default(DEFAULT_MAX_XML_ENTITY_EXPANSIONS)
      .description('用于兼容内容较复杂的订阅源，默认值为 20000；提高该值会增加解析异常内容时的资源消耗。'),
  }).description('请求设置'),
  Schema.object({
    maxItemsPerUpdate: Schema.natural()
      .min(1)
      .max(50)
      .default(8)
      .description('单次检查最多合并推送的文章数量。'),
    includeSummary: Schema.boolean()
      .default(true)
      .description('是否在推送消息中附带文章摘要。'),
    maxSummaryLength: Schema.natural()
      .min(0)
      .max(5000)
      .default(500)
      .description('单篇文章摘要的最大字符数，设为 0 时不发送摘要。'),
  }).description('推送内容'),
  Schema.object({
    pushInitialItems: Schema.boolean()
      .default(false)
      .description('是否在首次订阅后立即推送最新的一篇文章。'),
    pushAllInitialItems: Schema.boolean()
      .default(false)
      .description('是否在首次订阅时推送订阅源返回的所有历史文章。'),
    maxSeenIds: Schema.natural()
      .min(50)
      .max(5000)
      .default(500)
      .description('每个订阅保留的已推送文章 ID 数量。'),
  }).description('订阅状态').collapse(),
])

export interface FeedSubscription {
  id: number
  // This is a hashed target key retained for the original unique constraint.
  channelId: string
  url: string
  urlHash: string
  feedTitle: string
  seenIds: string
  platform: string
  selfId: string
  targetChannelId: string
  guildId: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

declare module 'koishi' {
  interface Tables {
    'feedluna.subscription': FeedSubscription
  }
}

interface XmlObject {
  [key: string]: unknown
}

export interface FeedItem {
  id: string
  title: string
  link: string
  summary: string
  publishedAt?: number
}

export interface FeedSnapshot {
  title: string
  items: FeedItem[]
}

export interface SubscriptionTarget {
  platform: string
  selfId: string
  targetChannelId: string
  guildId: string
  enabled: boolean
}

export interface SubscriptionInput extends SubscriptionTarget {
  url: string
}

export interface SubscriptionView extends SubscriptionTarget {
  id: number
  url: string
  feedTitle: string
  seenCount: number
  createdAt: string
  updatedAt: string
}

export interface BotView {
  platform: string
  selfId: string
}

declare module '@koishijs/plugin-console' {
  interface Events {
    'feedluna/subscriptions/list'(): Promise<SubscriptionView[]>
    'feedluna/subscriptions/create'(input: SubscriptionInput): Promise<SubscriptionView>
    'feedluna/subscriptions/update'(id: number, input: SubscriptionInput): Promise<SubscriptionView>
    'feedluna/subscriptions/remove'(id: number): Promise<void>
    'feedluna/bots/list'(): BotView[]
    'feedluna/config/current'(): Config
    'feedluna/preview'(url: string): Promise<FeedSnapshot>
  }
}

function asObject(value: unknown): XmlObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlObject : undefined
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function readValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(readValue).filter(Boolean).join(' ')
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  const object = asObject(value)
  if (!object) return ''
  return readValue(object['#text'] ?? object.__cdata)
}

function decodeEntity(entity: string): string {
  let code: number | undefined
  if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
    code = Number.parseInt(entity.slice(3, -1), 16)
  } else if (entity.startsWith('&#')) {
    code = Number.parseInt(entity.slice(2, -1), 10)
  }
  if (code !== undefined) return Number.isNaN(code) || code > 0x10ffff ? entity : String.fromCodePoint(code)

  return {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }[entity] ?? entity
}

function toPlainText(value: unknown): string {
  return readValue(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function readFirst(object: XmlObject, keys: string[]): string {
  for (const key of keys) {
    const value = toPlainText(object[key])
    if (value) return value
  }
  return ''
}

function readLink(value: unknown): string {
  for (const item of asArray(value)) {
    const object = asObject(item)
    if (object) {
      const href = readValue(object['@_href'])
      const rel = readValue(object['@_rel'])
      if (href && (!rel || rel === 'alternate')) return href
      continue
    }

    const link = readValue(item)
    if (link) return link
  }
  return ''
}

function resolveLink(link: string, baseUrl: string): string {
  if (!link) return ''
  try {
    return new URL(link, baseUrl).toString()
  } catch {
    return link
  }
}

function limitText(value: string, length: number): string {
  if (!length) return ''
  if (value.length <= length) return value
  return length <= 3 ? value.slice(0, length) : `${value.slice(0, length - 3)}...`
}

function itemId(title: string, date: string, guid: string, link: string): string {
  if (guid) return guid
  if (link) return link
  return createHash('sha256').update(`${title}\n${date}`).digest('hex')
}

export function parseFeed(
  xml: string,
  feedUrl: string,
  maxSummaryLength = 500,
  maxXmlEntityExpansions = DEFAULT_MAX_XML_ENTITY_EXPANSIONS,
): FeedSnapshot {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '__cdata',
    trimValues: true,
    processEntities: { maxTotalExpansions: maxXmlEntityExpansions },
  })
  const document = parser.parse(xml) as XmlObject
  const rss = asObject(document.rss)
  const atom = asObject(document.feed)
  const rdf = asObject(document['rdf:RDF'])
  const rssChannel = asObject(rss?.channel)
  const rdfChannel = asObject(rdf?.channel)
  const channel = rssChannel ?? rdfChannel ?? atom
  const rawItems = rssChannel?.item ?? rdf?.item ?? atom?.entry

  if (!channel || (!rss && !atom && !rdf)) {
    throw new Error('不是受支持的 RSS 或 Atom 订阅源')
  }

  const title = toPlainText(channel.title) || feedUrl
  const items: FeedItem[] = []

  for (const rawItem of asArray(rawItems)) {
    const item = asObject(rawItem)
    if (!item) continue

    const itemTitle = readFirst(item, ['title']) || '无标题文章'
    const date = readFirst(item, ['pubDate', 'published', 'updated', 'dc:date'])
    const guid = readFirst(item, ['guid', 'id'])
    const link = resolveLink(readLink(item.link), feedUrl)
    const summary = limitText(readFirst(item, ['description', 'summary', 'content:encoded', 'content']), maxSummaryLength)
    const publishedAt = Date.parse(date)

    items.push({
      id: itemId(itemTitle, date, guid, link),
      title: itemTitle,
      link,
      summary,
      publishedAt: Number.isNaN(publishedAt) ? undefined : publishedAt,
    })
  }

  const uniqueItems = [...new Map(items.map(item => [item.id, item])).values()]
  return { title, items: uniqueItems }
}

export function normalizeUrl(source: string): string {
  const url = new URL(source.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RSS 地址必须使用 http 或 https 协议')
  }
  url.hash = ''
  return url.toString()
}

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

function subscriptionTargetKey(target: SubscriptionTarget): string {
  return createHash('sha256')
    .update(JSON.stringify([target.platform, target.selfId, target.targetChannelId, target.guildId]))
    .digest('hex')
}

function normalizeTarget(source: SubscriptionTarget): SubscriptionTarget {
  const platform = source.platform?.trim()
  const selfId = source.selfId?.trim()
  const targetChannelId = source.targetChannelId?.trim()
  const guildId = source.guildId?.trim() ?? ''

  if (!platform || !selfId || !targetChannelId) {
    throw new Error('平台名称、机器人 ID 和频道 ID 均不能为空')
  }

  return {
    platform,
    selfId,
    targetChannelId,
    guildId,
    enabled: source.enabled !== false,
  }
}

function parseSeenIds(value: string): string[] {
  try {
    const result = JSON.parse(value)
    if (!Array.isArray(result)) return []
    return result.filter(item => typeof item === 'string')
  } catch {
    return []
  }
}

function appendSeenIds(seenIds: string[], newIds: string[], maxSeenIds: number): string[] {
  return [...new Set([...seenIds, ...newIds])].slice(-maxSeenIds)
}

function sortItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
}

function getLatestItem(items: FeedItem[]): FeedItem | undefined {
  let latest: FeedItem | undefined
  for (const item of items) {
    if (!latest || (item.publishedAt !== undefined && (latest.publishedAt === undefined || item.publishedAt > latest.publishedAt))) {
      latest = item
    }
  }
  return latest
}

function formatUpdate(feed: FeedSnapshot, items: FeedItem[], includeSummary: boolean, heading = `有 ${items.length} 条新文章`): string {
  const entries = items.map(item => {
    const lines = [item.title]
    if (item.link) lines.push(item.link)
    if (includeSummary && item.summary) lines.push(item.summary)
    return lines.join('\n')
  })

  return [`【${feed.title}】${heading}`, ...entries].join('\n\n')
}

function toSubscriptionView(subscription: FeedSubscription): SubscriptionView {
  return {
    id: subscription.id,
    url: subscription.url,
    feedTitle: subscription.feedTitle,
    platform: subscription.platform,
    selfId: subscription.selfId,
    targetChannelId: subscription.targetChannelId,
    guildId: subscription.guildId,
    enabled: subscription.enabled,
    seenCount: parseSeenIds(subscription.seenIds).length,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.model.extend(SUBSCRIPTION_TABLE, {
    id: 'unsigned',
    channelId: 'string',
    url: 'text',
    urlHash: 'string',
    feedTitle: 'string',
    seenIds: 'text',
    platform: 'string',
    selfId: 'string',
    targetChannelId: 'string',
    guildId: 'string',
    enabled: { type: 'boolean', initial: true },
    createdAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    autoInc: true,
    unique: [['channelId', 'urlHash']],
    indexes: ['channelId', 'urlHash', ['platform', 'selfId', 'targetChannelId']],
  })

  const logger = ctx.logger(name)

  async function fetchFeed(url: string, maxSummaryLength = config.maxSummaryLength): Promise<FeedSnapshot> {
    const xml = await ctx.http.get(url, {
      responseType: 'text',
      timeout: config.requestTimeout,
      headers: {
        'User-Agent': config.userAgent,
      },
    })
    return parseFeed(String(xml), url, maxSummaryLength, config.maxXmlEntityExpansions)
  }

  function getBot(target: SubscriptionTarget) {
    const bot = ctx.bots.find(bot => bot.platform === target.platform && bot.selfId === target.selfId)
    if (!bot) {
      throw new Error(`未找到运行中的机器人：${target.platform}:${target.selfId}`)
    }
    return bot
  }

  async function sendToTarget(target: SubscriptionTarget, content: string) {
    const messageIds = await getBot(target).sendMessage(
      target.targetChannelId,
      content,
      target.guildId || undefined,
    )
    if (!messageIds.length) throw new Error('机器人未返回消息 ID')
  }

  async function createSubscription(
    source: SubscriptionInput,
    sendInitial = sendToTarget,
  ) {
    const url = normalizeUrl(source.url)
    const target = normalizeTarget(source)
    if (target.enabled) getBot(target)

    const urlHash = hashUrl(url)
    const channelId = subscriptionTargetKey(target)
    const existing = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId, urlHash })
    if (existing.length) {
      throw new Error(`该目标已经订阅了 ${existing[0].feedTitle || url}`)
    }

    const feed = await fetchFeed(url)
    let initialItems: FeedItem[] = []
    if (target.enabled) {
      if (config.pushAllInitialItems) {
        initialItems = sortItems(feed.items)
      } else if (config.pushInitialItems) {
        const latestItem = getLatestItem(feed.items)
        if (latestItem) initialItems = [latestItem]
      }
    }

    if (initialItems.length) {
      const heading = config.pushAllInitialItems
        ? `共有 ${initialItems.length} 篇历史文章`
        : '最新文章'
      await sendInitial(target, formatUpdate(feed, initialItems, config.includeSummary, heading))
    }

    const now = new Date()
    const subscription = await ctx.database.create(SUBSCRIPTION_TABLE, {
      channelId,
      url,
      urlHash,
      feedTitle: feed.title,
      seenIds: JSON.stringify(feed.items.map(item => item.id).slice(-config.maxSeenIds)),
      ...target,
      createdAt: now,
      updatedAt: now,
    })
    return { subscription, initialItemCount: initialItems.length }
  }

  async function updateSubscription(id: number, source: SubscriptionInput) {
    const [existing] = await ctx.database.get(SUBSCRIPTION_TABLE, id)
    if (!existing) throw new Error('订阅不存在')

    const url = normalizeUrl(source.url)
    const target = normalizeTarget(source)
    if (target.enabled) getBot(target)

    const urlHash = hashUrl(url)
    const channelId = subscriptionTargetKey(target)
    const conflicts = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId, urlHash })
    if (conflicts.some(subscription => subscription.id !== id)) {
      throw new Error('该目标已经订阅这个 RSS')
    }

    const urlChanged = existing.urlHash !== urlHash
    const feed = urlChanged ? await fetchFeed(url) : undefined
    const updatedAt = new Date()
    await ctx.database.set(SUBSCRIPTION_TABLE, id, {
      channelId,
      url,
      urlHash,
      feedTitle: feed?.title ?? existing.feedTitle,
      seenIds: feed
        ? JSON.stringify(feed.items.map(item => item.id).slice(-config.maxSeenIds))
        : existing.seenIds,
      ...target,
      updatedAt,
    })

    return {
      ...existing,
      channelId,
      url,
      urlHash,
      feedTitle: feed?.title ?? existing.feedTitle,
      seenIds: feed
        ? JSON.stringify(feed.items.map(item => item.id).slice(-config.maxSeenIds))
        : existing.seenIds,
      ...target,
      updatedAt,
    }
  }

  async function migrateLegacySubscriptions() {
    const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, {})
    for (const subscription of subscriptions) {
      const isLegacy = !subscription.platform && !subscription.targetChannelId
      const wasEnabled = subscription.enabled !== false
      const legacySeparator = subscription.channelId.indexOf(':')
      const legacyPlatform = legacySeparator >= 0 ? subscription.channelId.slice(0, legacySeparator) : ''
      const legacyChannelId = legacySeparator >= 0 ? subscription.channelId.slice(legacySeparator + 1) : ''
      const platform = subscription.platform || legacyPlatform
      const targetChannelId = subscription.targetChannelId || legacyChannelId
      const candidates = ctx.bots.filter(bot => bot.platform === platform)
      const selfId = subscription.selfId || (candidates.length === 1 ? candidates[0].selfId : '')

      if (!platform || !targetChannelId || !selfId) {
        await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
          enabled: false,
          updatedAt: new Date(),
        })
        logger.warn('disabled legacy RSS subscription %d because its target bot cannot be identified', subscription.id)
        continue
      }

      const target: SubscriptionTarget = {
        platform,
        selfId,
        targetChannelId,
        guildId: subscription.guildId || '',
        enabled: isLegacy ? wasEnabled : subscription.enabled,
      }
      const channelId = subscriptionTargetKey(target)
      if (
        subscription.channelId === channelId
        && subscription.platform === target.platform
        && subscription.selfId === target.selfId
        && subscription.targetChannelId === target.targetChannelId
        && subscription.enabled === target.enabled
      ) continue

      try {
        await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
          channelId,
          ...target,
          updatedAt: new Date(),
        })
      } catch (error) {
        logger.warn('failed to migrate RSS subscription %d: %s', subscription.id, error instanceof Error ? error.message : error)
      }
    }
  }

  ctx.command('feedluna.sub <url:string>', '订阅 RSS 更新')
    .example('feedluna.sub https://example.com/feed.xml')
    .action(async ({ session }, sourceUrl) => {
      if (!session.channelId || session.isDirect) {
        return 'RSS 订阅只能在群聊中使用。'
      }

      try {
        const target = normalizeTarget({
          platform: session.platform,
          selfId: session.selfId,
          targetChannelId: session.channelId,
          guildId: session.guildId || '',
          enabled: true,
        })
        const { subscription, initialItemCount } = await createSubscription(
          { ...target, url: sourceUrl },
          async (_target, content) => {
            const messageIds = await session.send(content)
            if (!messageIds.length) throw new Error('没有可用的机器人可以发送消息')
          },
        )
        const initialMessage = initialItemCount ? `\n已推送 ${initialItemCount} 篇文章。` : ''
        return `已订阅 RSS：${subscription.feedTitle}\n后续更新会自动推送到本群。${initialMessage}`
      } catch (error) {
        return `订阅失败：${error instanceof Error ? error.message : 'RSS 地址无效'}`
      }
    })

  ctx.command('feedluna.unsub <url:string>', '取消订阅 RSS 更新')
    .alias('feedluna.unsubscribe')
    .example('feedluna.unsub https://example.com/feed.xml')
    .action(async ({ session }, sourceUrl) => {
      if (!session.channelId || session.isDirect) {
        return 'RSS 订阅只能在群聊中管理。'
      }

      try {
        const target = normalizeTarget({
          platform: session.platform,
          selfId: session.selfId,
          targetChannelId: session.channelId,
          guildId: session.guildId || '',
          enabled: true,
        })
        const url = normalizeUrl(sourceUrl)
        const [subscription] = await ctx.database.get(SUBSCRIPTION_TABLE, {
          channelId: subscriptionTargetKey(target),
          urlHash: hashUrl(url),
        })
        if (!subscription) return '本群没有订阅这个 RSS。'

        await ctx.database.remove(SUBSCRIPTION_TABLE, subscription.id)
        return `已取消订阅：${subscription.feedTitle || url}`
      } catch (error) {
        return `取消订阅失败：${error instanceof Error ? error.message : 'RSS 地址无效'}`
      }
    })

  ctx.command('feedluna.list', '查看当前群聊的 RSS 订阅')
    .alias('feedluna.ls')
    .action(async ({ session }) => {
      if (!session.channelId || session.isDirect) {
        return 'RSS 订阅只能在群聊中查看。'
      }

      const target = normalizeTarget({
        platform: session.platform,
        selfId: session.selfId,
        targetChannelId: session.channelId,
        guildId: session.guildId || '',
        enabled: true,
      })
      const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId: subscriptionTargetKey(target) })
      if (!subscriptions.length) return '本群当前没有 RSS 订阅。'

      const lines = subscriptions.map((subscription, index) => {
        return `${index + 1}. ${subscription.feedTitle || '未命名订阅源'}\n${subscription.url}`
      })
      return ['本群当前订阅：', ...lines].join('\n\n')
    })

  let polling = false

  async function poll() {
    if (polling) return
    polling = true

    try {
      const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, { enabled: true })
      for (const subscription of subscriptions) {
        try {
          const feed = await fetchFeed(subscription.url)
          const seenIds = parseSeenIds(subscription.seenIds)
          const seen = new Set(seenIds)
          const newItems = sortItems(feed.items.filter(item => !seen.has(item.id)))
            .slice(0, config.maxItemsPerUpdate)

          if (!newItems.length) {
            if (feed.title !== subscription.feedTitle) {
              await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
                feedTitle: feed.title,
                updatedAt: new Date(),
              })
            }
            continue
          }

          await sendToTarget(subscription, formatUpdate(feed, newItems, config.includeSummary))

          await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
            feedTitle: feed.title,
            seenIds: JSON.stringify(appendSeenIds(seenIds, newItems.map(item => item.id), config.maxSeenIds)),
            updatedAt: new Date(),
          })
          logger.info('sent %d RSS updates to %s:%s', newItems.length, subscription.platform, subscription.targetChannelId)
        } catch (error) {
          logger.warn('failed to poll %s: %s', subscription.url, error instanceof Error ? error.message : error)
        }
      }
    } catch (error) {
      logger.error('failed to load RSS subscriptions: %s', error instanceof Error ? error.message : error)
    } finally {
      polling = false
    }
  }

  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })

    ctx.console.addListener('feedluna/subscriptions/list', async () => {
      const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, {})
      return subscriptions
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map(toSubscriptionView)
    }, { authority: 4 })

    ctx.console.addListener('feedluna/subscriptions/create', async (input) => {
      const { subscription } = await createSubscription(input)
      return toSubscriptionView(subscription)
    }, { authority: 4 })

    ctx.console.addListener('feedluna/subscriptions/update', async (id, input) => {
      return toSubscriptionView(await updateSubscription(id, input))
    }, { authority: 4 })

    ctx.console.addListener('feedluna/subscriptions/remove', async (id) => {
      const result = await ctx.database.remove(SUBSCRIPTION_TABLE, id)
      if (!result.removed) throw new Error('订阅不存在')
    }, { authority: 4 })

    ctx.console.addListener('feedluna/bots/list', () => {
      return ctx.bots
        .map(({ platform, selfId }) => ({ platform, selfId }))
        .sort((left, right) => `${left.platform}:${left.selfId}`.localeCompare(`${right.platform}:${right.selfId}`))
    }, { authority: 4 })

    ctx.console.addListener('feedluna/config/current', () => ({ ...config }), { authority: 4 })

    ctx.console.addListener('feedluna/preview', async (sourceUrl) => {
      const url = normalizeUrl(sourceUrl)
      const feed = await fetchFeed(url, PREVIEW_SUMMARY_LENGTH)
      return {
        title: feed.title,
        items: sortItems(feed.items).slice(-PREVIEW_ITEM_LIMIT).reverse(),
      }
    }, { authority: 4 })
  })

  ctx.on('ready', async () => {
    await migrateLegacySubscriptions()
    await poll()
  })
  ctx.setInterval(() => {
    void poll()
  }, config.pollInterval)
}
