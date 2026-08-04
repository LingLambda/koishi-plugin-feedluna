import { Context, Schema } from 'koishi';
export declare const name = "feedluna";
export declare const inject: {
    required: string[];
    optional: string[];
};
export interface Config {
    pollInterval: number;
    requestTimeout: number;
    maxItemsPerUpdate: number;
    includeSummary: boolean;
    maxSummaryLength: number;
    pushInitialItems: boolean;
    maxSeenIds: number;
    userAgent: string;
    maxEntityExpansions: number;
}
export declare const Config: Schema<Config>;
export interface FeedSubscription {
    id: number;
    channelId: string;
    url: string;
    urlHash: string;
    feedTitle: string;
    seenIds: string;
    platform: string;
    selfId: string;
    targetChannelId: string;
    guildId: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}
declare module 'koishi' {
    interface Tables {
        'feedluna.subscription': FeedSubscription;
    }
}
export interface FeedItem {
    id: string;
    title: string;
    link: string;
    summary: string;
    publishedAt?: number;
}
export interface FeedSnapshot {
    title: string;
    items: FeedItem[];
}
export interface SubscriptionTarget {
    platform: string;
    selfId: string;
    targetChannelId: string;
    guildId: string;
    enabled: boolean;
}
export interface SubscriptionInput extends SubscriptionTarget {
    url: string;
}
export interface SubscriptionView extends SubscriptionTarget {
    id: number;
    url: string;
    feedTitle: string;
    seenCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface BotView {
    platform: string;
    selfId: string;
}
declare module '@koishijs/plugin-console' {
    interface Events {
        'feedluna/subscriptions/list'(): Promise<SubscriptionView[]>;
        'feedluna/subscriptions/create'(input: SubscriptionInput): Promise<SubscriptionView>;
        'feedluna/subscriptions/update'(id: number, input: SubscriptionInput): Promise<SubscriptionView>;
        'feedluna/subscriptions/remove'(id: number): Promise<void>;
        'feedluna/bots/list'(): BotView[];
        'feedluna/config/current'(): Config;
        'feedluna/preview'(url: string): Promise<FeedSnapshot>;
    }
}
export declare function parseFeed(xml: string, feedUrl: string, maxSummaryLength?: number, maxEntityExpansions?: number): FeedSnapshot;
export declare function normalizeUrl(source: string): string;
export declare function apply(ctx: Context, config: Config): void;
