var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  normalizeUrl: () => normalizeUrl,
  parseFeed: () => parseFeed
});
module.exports = __toCommonJS(src_exports);
var import_node_crypto = require("node:crypto");
var import_node_path = require("node:path");
var import_koishi = require("koishi");
var import_fast_xml_parser = require("fast-xml-parser");
var name = "feedluna";
var inject = {
  required: ["database", "http"],
  optional: ["console"]
};
var SUBSCRIPTION_TABLE = "feedluna.subscription";
var PREVIEW_ITEM_LIMIT = 20;
var PREVIEW_SUMMARY_LENGTH = 1e3;
var Config = import_koishi.Schema.intersect([
  import_koishi.Schema.object({
    pollInterval: import_koishi.Schema.natural().role("ms").min(import_koishi.Time.second * 10).default(import_koishi.Time.minute * 5).description("检查 RSS 更新的间隔，最短为 10 秒。"),
    requestTimeout: import_koishi.Schema.natural().role("ms").min(import_koishi.Time.second).default(import_koishi.Time.second * 30).description("请求 RSS 地址的超时时间。"),
    userAgent: import_koishi.Schema.string().min(1).max(256).default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36").description("请求 RSS 时使用的 User-Agent，默认模拟桌面 Chrome 浏览器。")
  }).description("请求设置"),
  import_koishi.Schema.object({
    maxItemsPerUpdate: import_koishi.Schema.natural().min(1).max(50).default(8).description("单次检查最多合并推送的文章数量。"),
    includeSummary: import_koishi.Schema.boolean().default(true).description("是否在推送消息中附带文章摘要。"),
    maxSummaryLength: import_koishi.Schema.natural().min(0).max(5e3).default(500).description("单篇文章摘要的最大字符数，设为 0 时不发送摘要。")
  }).description("推送内容"),
  import_koishi.Schema.object({
    pushInitialItems: import_koishi.Schema.boolean().default(false).description("首次订阅时是否立即推送当前 Feed 中的文章（不建议开启，可能导致刷屏）。"),
    maxSeenIds: import_koishi.Schema.natural().min(50).max(5e3).default(500).description("每个订阅保留的已推送文章 ID 数量。")
  }).description("订阅状态").collapse()
]);
var parser = new import_fast_xml_parser.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  trimValues: true,
  processEntities: { maxTotalExpansions: 1e4 }
});
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
__name(asObject, "asObject");
function asArray(value) {
  if (value === void 0 || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
__name(asArray, "asArray");
function readValue(value) {
  if (value === void 0 || value === null) return "";
  if (Array.isArray(value)) return value.map(readValue).filter(Boolean).join(" ");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const object = asObject(value);
  if (!object) return "";
  return readValue(object["#text"] ?? object.__cdata);
}
__name(readValue, "readValue");
function decodeEntity(entity) {
  if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
    const code = Number.parseInt(entity.slice(3, -1), 16);
    return Number.isNaN(code) ? entity : String.fromCodePoint(code);
  }
  if (entity.startsWith("&#")) {
    const code = Number.parseInt(entity.slice(2, -1), 10);
    return Number.isNaN(code) ? entity : String.fromCodePoint(code);
  }
  return {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  }[entity] ?? entity;
}
__name(decodeEntity, "decodeEntity");
function toPlainText(value) {
  return readValue(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&(?:#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity).replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
__name(toPlainText, "toPlainText");
function readFirst(object, keys) {
  for (const key of keys) {
    const value = toPlainText(object[key]);
    if (value) return value;
  }
  return "";
}
__name(readFirst, "readFirst");
function readLink(value) {
  for (const item of asArray(value)) {
    const object = asObject(item);
    if (object) {
      const href = readValue(object["@_href"]);
      const rel = readValue(object["@_rel"]);
      if (href && (!rel || rel === "alternate")) return href;
      continue;
    }
    const link = readValue(item);
    if (link) return link;
  }
  return "";
}
__name(readLink, "readLink");
function resolveLink(link, baseUrl) {
  if (!link) return "";
  try {
    return new URL(link, baseUrl).toString();
  } catch {
    return link;
  }
}
__name(resolveLink, "resolveLink");
function limitText(value, length) {
  if (!length) return "";
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}
__name(limitText, "limitText");
function itemId(title, date, guid, link) {
  if (guid) return guid;
  if (link) return link;
  return (0, import_node_crypto.createHash)("sha256").update(`${title}
${date}`).digest("hex");
}
__name(itemId, "itemId");
function parseFeed(xml, feedUrl, maxSummaryLength = 500) {
  const document = parser.parse(xml);
  const rss = asObject(document.rss);
  const atom = asObject(document.feed);
  const rdf = asObject(document["rdf:RDF"]);
  const rssChannel = asObject(rss?.channel);
  const rdfChannel = asObject(rdf?.channel);
  const channel = rssChannel ?? rdfChannel ?? atom;
  const rawItems = rssChannel?.item ?? rdf?.item ?? atom?.entry;
  if (!channel || !rss && !atom && !rdf) {
    throw new Error("不是受支持的 RSS 或 Atom Feed");
  }
  const title = toPlainText(channel.title) || feedUrl;
  const items = [];
  for (const rawItem of asArray(rawItems)) {
    const item = asObject(rawItem);
    if (!item) continue;
    const itemTitle = readFirst(item, ["title"]) || "无标题文章";
    const date = readFirst(item, ["pubDate", "published", "updated", "dc:date"]);
    const guid = readFirst(item, ["guid", "id"]);
    const link = resolveLink(readLink(item.link), feedUrl);
    const summary = limitText(readFirst(item, ["description", "summary", "content:encoded", "content"]), maxSummaryLength);
    const publishedAt = Date.parse(date);
    items.push({
      id: itemId(itemTitle, date, guid, link),
      title: itemTitle,
      link,
      summary,
      publishedAt: Number.isNaN(publishedAt) ? void 0 : publishedAt
    });
  }
  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
  return { title, items: uniqueItems };
}
__name(parseFeed, "parseFeed");
function normalizeUrl(source) {
  const url = new URL(source.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RSS 地址必须使用 http 或 https 协议");
  }
  url.hash = "";
  return url.toString();
}
__name(normalizeUrl, "normalizeUrl");
function hashUrl(url) {
  return (0, import_node_crypto.createHash)("sha256").update(url).digest("hex");
}
__name(hashUrl, "hashUrl");
function subscriptionTargetKey(target) {
  return (0, import_node_crypto.createHash)("sha256").update(JSON.stringify([target.platform, target.selfId, target.targetChannelId, target.guildId])).digest("hex");
}
__name(subscriptionTargetKey, "subscriptionTargetKey");
function normalizeTarget(source) {
  const platform = source.platform?.trim();
  const selfId = source.selfId?.trim();
  const targetChannelId = source.targetChannelId?.trim();
  const guildId = source.guildId?.trim() ?? "";
  if (!platform || !selfId || !targetChannelId) {
    throw new Error("平台名称、机器人 ID 和频道 ID 均不能为空");
  }
  return {
    platform,
    selfId,
    targetChannelId,
    guildId,
    enabled: source.enabled !== false
  };
}
__name(normalizeTarget, "normalizeTarget");
function parseSeenIds(value) {
  try {
    const result = JSON.parse(value);
    if (!Array.isArray(result)) return [];
    return result.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}
__name(parseSeenIds, "parseSeenIds");
function appendSeenIds(seenIds, newIds, maxSeenIds) {
  return [.../* @__PURE__ */ new Set([...seenIds, ...newIds])].slice(-maxSeenIds);
}
__name(appendSeenIds, "appendSeenIds");
function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.publishedAt === void 0 || b.publishedAt === void 0) return 0;
    return a.publishedAt - b.publishedAt;
  });
}
__name(sortItems, "sortItems");
function formatUpdate(feed, items, includeSummary) {
  const entries = items.map((item) => {
    const lines = [item.title];
    if (item.link) lines.push(item.link);
    if (includeSummary && item.summary) lines.push(item.summary);
    return lines.join("\n");
  });
  return [`【${feed.title}】有 ${items.length} 条新文章`, ...entries].join("\n\n");
}
__name(formatUpdate, "formatUpdate");
function toSubscriptionView(subscription) {
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
    updatedAt: subscription.updatedAt.toISOString()
  };
}
__name(toSubscriptionView, "toSubscriptionView");
function apply(ctx, config) {
  ctx.model.extend(SUBSCRIPTION_TABLE, {
    id: "unsigned",
    channelId: "string",
    url: "text",
    urlHash: "string",
    feedTitle: "string",
    seenIds: "text",
    platform: "string",
    selfId: "string",
    targetChannelId: "string",
    guildId: "string",
    enabled: { type: "boolean", initial: true },
    createdAt: "timestamp",
    updatedAt: "timestamp"
  }, {
    autoInc: true,
    unique: [["channelId", "urlHash"]],
    indexes: ["channelId", "urlHash", ["platform", "selfId", "targetChannelId"]]
  });
  const logger = ctx.logger(name);
  async function fetchFeed(url, maxSummaryLength = config.maxSummaryLength) {
    const xml = await ctx.http.get(url, {
      responseType: "text",
      timeout: config.requestTimeout,
      headers: {
        "User-Agent": config.userAgent
      }
    });
    return parseFeed(String(xml), url, maxSummaryLength);
  }
  __name(fetchFeed, "fetchFeed");
  function getBot(target) {
    const bot = ctx.bots.find((bot2) => bot2.platform === target.platform && bot2.selfId === target.selfId);
    if (!bot) {
      throw new Error(`未找到运行中的机器人：${target.platform}:${target.selfId}`);
    }
    return bot;
  }
  __name(getBot, "getBot");
  async function sendToTarget(target, content) {
    const messageIds = await getBot(target).sendMessage(
      target.targetChannelId,
      content,
      target.guildId || void 0
    );
    if (!messageIds.length) throw new Error("机器人未返回消息 ID");
  }
  __name(sendToTarget, "sendToTarget");
  async function createSubscription(source, pushInitialItems = config.pushInitialItems, sendInitial = sendToTarget) {
    const url = normalizeUrl(source.url);
    const target = normalizeTarget(source);
    if (target.enabled) getBot(target);
    const urlHash = hashUrl(url);
    const channelId = subscriptionTargetKey(target);
    const existing = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId, urlHash });
    if (existing.length) {
      throw new Error(`该目标已经订阅了 ${existing[0].feedTitle || url}`);
    }
    const feed = await fetchFeed(url);
    const initialItems = pushInitialItems && target.enabled ? sortItems(feed.items).slice(-config.maxItemsPerUpdate) : [];
    if (initialItems.length) {
      await sendInitial(target, formatUpdate(feed, initialItems, config.includeSummary));
    }
    const now = /* @__PURE__ */ new Date();
    const subscription = await ctx.database.create(SUBSCRIPTION_TABLE, {
      channelId,
      url,
      urlHash,
      feedTitle: feed.title,
      seenIds: JSON.stringify(feed.items.map((item) => item.id).slice(-config.maxSeenIds)),
      ...target,
      createdAt: now,
      updatedAt: now
    });
    return { subscription, initialItemCount: initialItems.length };
  }
  __name(createSubscription, "createSubscription");
  async function updateSubscription(id, source) {
    const [existing] = await ctx.database.get(SUBSCRIPTION_TABLE, id);
    if (!existing) throw new Error("订阅不存在");
    const url = normalizeUrl(source.url);
    const target = normalizeTarget(source);
    if (target.enabled) getBot(target);
    const urlHash = hashUrl(url);
    const channelId = subscriptionTargetKey(target);
    const conflicts = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId, urlHash });
    if (conflicts.some((subscription) => subscription.id !== id)) {
      throw new Error("该目标已经订阅这个 RSS");
    }
    const urlChanged = existing.urlHash !== urlHash;
    const feed = urlChanged ? await fetchFeed(url) : void 0;
    const updatedAt = /* @__PURE__ */ new Date();
    await ctx.database.set(SUBSCRIPTION_TABLE, id, {
      channelId,
      url,
      urlHash,
      feedTitle: feed?.title ?? existing.feedTitle,
      seenIds: feed ? JSON.stringify(feed.items.map((item) => item.id).slice(-config.maxSeenIds)) : existing.seenIds,
      ...target,
      updatedAt
    });
    return {
      ...existing,
      channelId,
      url,
      urlHash,
      feedTitle: feed?.title ?? existing.feedTitle,
      seenIds: feed ? JSON.stringify(feed.items.map((item) => item.id).slice(-config.maxSeenIds)) : existing.seenIds,
      ...target,
      updatedAt
    };
  }
  __name(updateSubscription, "updateSubscription");
  async function migrateLegacySubscriptions() {
    const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, {});
    for (const subscription of subscriptions) {
      const isLegacy = !subscription.platform && !subscription.targetChannelId;
      const wasEnabled = subscription.enabled !== false;
      const legacySeparator = subscription.channelId.indexOf(":");
      const legacyPlatform = legacySeparator >= 0 ? subscription.channelId.slice(0, legacySeparator) : "";
      const legacyChannelId = legacySeparator >= 0 ? subscription.channelId.slice(legacySeparator + 1) : "";
      const platform = subscription.platform || legacyPlatform;
      const targetChannelId = subscription.targetChannelId || legacyChannelId;
      const candidates = ctx.bots.filter((bot) => bot.platform === platform);
      const selfId = subscription.selfId || (candidates.length === 1 ? candidates[0].selfId : "");
      if (!platform || !targetChannelId || !selfId) {
        await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
          enabled: false,
          updatedAt: /* @__PURE__ */ new Date()
        });
        logger.warn("disabled legacy RSS subscription %d because its target bot cannot be identified", subscription.id);
        continue;
      }
      const target = {
        platform,
        selfId,
        targetChannelId,
        guildId: subscription.guildId || "",
        enabled: isLegacy ? wasEnabled : subscription.enabled
      };
      const channelId = subscriptionTargetKey(target);
      if (subscription.channelId === channelId && subscription.platform === target.platform && subscription.selfId === target.selfId && subscription.targetChannelId === target.targetChannelId && subscription.enabled === target.enabled) continue;
      try {
        await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
          channelId,
          ...target,
          updatedAt: /* @__PURE__ */ new Date()
        });
      } catch (error) {
        logger.warn("failed to migrate RSS subscription %d: %s", subscription.id, error instanceof Error ? error.message : error);
      }
    }
  }
  __name(migrateLegacySubscriptions, "migrateLegacySubscriptions");
  ctx.command("feedluna.sub <url:string>", "订阅 RSS 更新").example("feedluna.sub https://example.com/feed.xml").action(async ({ session }, sourceUrl) => {
    if (!session.channelId || session.isDirect) {
      return "RSS 订阅只能在群聊中使用。";
    }
    try {
      const target = normalizeTarget({
        platform: session.platform,
        selfId: session.selfId,
        targetChannelId: session.channelId,
        guildId: session.guildId || "",
        enabled: true
      });
      const { subscription, initialItemCount } = await createSubscription(
        { ...target, url: sourceUrl },
        config.pushInitialItems,
        async (_target, content) => {
          const messageIds = await session.send(content);
          if (!messageIds.length) throw new Error("没有可用的机器人可以发送消息");
        }
      );
      const initialMessage = initialItemCount ? `
已推送 ${initialItemCount} 篇当前文章。` : "";
      return `已订阅 RSS：${subscription.feedTitle}
后续更新会自动推送到本群。${initialMessage}`;
    } catch (error) {
      return `订阅失败：${error instanceof Error ? error.message : "RSS 地址无效"}`;
    }
  });
  ctx.command("feedluna.unsub <url:string>", "取消订阅 RSS 更新").alias("feedluna.unsubscribe").example("feedluna.unsub https://example.com/feed.xml").action(async ({ session }, sourceUrl) => {
    if (!session.channelId || session.isDirect) {
      return "RSS 订阅只能在群聊中管理。";
    }
    try {
      const target = normalizeTarget({
        platform: session.platform,
        selfId: session.selfId,
        targetChannelId: session.channelId,
        guildId: session.guildId || "",
        enabled: true
      });
      const url = normalizeUrl(sourceUrl);
      const [subscription] = await ctx.database.get(SUBSCRIPTION_TABLE, {
        channelId: subscriptionTargetKey(target),
        urlHash: hashUrl(url)
      });
      if (!subscription) return "本群没有订阅这个 RSS。";
      await ctx.database.remove(SUBSCRIPTION_TABLE, subscription.id);
      return `已取消订阅：${subscription.feedTitle || url}`;
    } catch (error) {
      return `取消订阅失败：${error instanceof Error ? error.message : "RSS 地址无效"}`;
    }
  });
  ctx.command("feedluna.list", "查看当前群聊的 RSS 订阅").alias("feedluna.ls").action(async ({ session }) => {
    if (!session.channelId || session.isDirect) {
      return "RSS 订阅只能在群聊中查看。";
    }
    const target = normalizeTarget({
      platform: session.platform,
      selfId: session.selfId,
      targetChannelId: session.channelId,
      guildId: session.guildId || "",
      enabled: true
    });
    const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, { channelId: subscriptionTargetKey(target) });
    if (!subscriptions.length) return "本群当前没有 RSS 订阅。";
    const lines = subscriptions.map((subscription, index) => {
      return `${index + 1}. ${subscription.feedTitle || "未命名 Feed"}
${subscription.url}`;
    });
    return ["本群当前订阅：", ...lines].join("\n\n");
  });
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const subscriptions = await ctx.database.get(SUBSCRIPTION_TABLE, { enabled: true });
      for (const subscription of subscriptions) {
        try {
          const feed = await fetchFeed(subscription.url);
          const seenIds = parseSeenIds(subscription.seenIds);
          const seen = new Set(seenIds);
          const newItems = sortItems(feed.items.filter((item) => !seen.has(item.id))).slice(0, config.maxItemsPerUpdate);
          if (!newItems.length) {
            if (feed.title !== subscription.feedTitle) {
              await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
                feedTitle: feed.title,
                updatedAt: /* @__PURE__ */ new Date()
              });
            }
            continue;
          }
          await sendToTarget(subscription, formatUpdate(feed, newItems, config.includeSummary));
          await ctx.database.set(SUBSCRIPTION_TABLE, subscription.id, {
            feedTitle: feed.title,
            seenIds: JSON.stringify(appendSeenIds(seenIds, newItems.map((item) => item.id), config.maxSeenIds)),
            updatedAt: /* @__PURE__ */ new Date()
          });
          logger.info("sent %d RSS updates to %s:%s", newItems.length, subscription.platform, subscription.targetChannelId);
        } catch (error) {
          logger.warn("failed to poll %s: %s", subscription.url, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      logger.error("failed to load RSS subscriptions: %s", error instanceof Error ? error.message : error);
    } finally {
      polling = false;
    }
  }
  __name(poll, "poll");
  ctx.inject(["console"], (ctx2) => {
    ctx2.console.addEntry({
      dev: (0, import_node_path.resolve)(__dirname, "../client/index.ts"),
      prod: (0, import_node_path.resolve)(__dirname, "../dist")
    });
    ctx2.console.addListener("feedluna/subscriptions/list", async () => {
      const subscriptions = await ctx2.database.get(SUBSCRIPTION_TABLE, {});
      return subscriptions.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()).map(toSubscriptionView);
    }, { authority: 4 });
    ctx2.console.addListener("feedluna/subscriptions/create", async (input) => {
      const { subscription } = await createSubscription(input);
      return toSubscriptionView(subscription);
    }, { authority: 4 });
    ctx2.console.addListener("feedluna/subscriptions/update", async (id, input) => {
      return toSubscriptionView(await updateSubscription(id, input));
    }, { authority: 4 });
    ctx2.console.addListener("feedluna/subscriptions/remove", async (id) => {
      const result = await ctx2.database.remove(SUBSCRIPTION_TABLE, id);
      if (!result.removed) throw new Error("订阅不存在");
    }, { authority: 4 });
    ctx2.console.addListener("feedluna/bots/list", () => {
      return ctx2.bots.map(({ platform, selfId }) => ({ platform, selfId })).sort((left, right) => `${left.platform}:${left.selfId}`.localeCompare(`${right.platform}:${right.selfId}`));
    }, { authority: 4 });
    ctx2.console.addListener("feedluna/config/current", () => ({ ...config }), { authority: 4 });
    ctx2.console.addListener("feedluna/preview", async (sourceUrl) => {
      const url = normalizeUrl(sourceUrl);
      const feed = await fetchFeed(url, PREVIEW_SUMMARY_LENGTH);
      return {
        title: feed.title,
        items: sortItems(feed.items).slice(-PREVIEW_ITEM_LIMIT).reverse()
      };
    }, { authority: 4 });
  });
  ctx.on("ready", async () => {
    await migrateLegacySubscriptions();
    await poll();
  });
  ctx.setInterval(() => {
    void poll();
  }, config.pollInterval);
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  normalizeUrl,
  parseFeed
});
