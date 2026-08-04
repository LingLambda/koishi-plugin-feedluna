<template>
  <k-layout>
    <template #header>FeedLuna RSS 管理</template>

    <k-content class="feedluna-page">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="订阅管理" name="subscriptions">
          <section class="toolbar">
            <el-input v-model="search" clearable placeholder="搜索 Feed、RSS 地址或频道" />
            <el-select v-model="targetFilter" clearable placeholder="全部推送目标">
              <el-option v-for="target in targets" :key="target" :label="target" :value="target" />
            </el-select>
            <el-button type="primary" @click="openCreate">新增订阅</el-button>
            <el-button :loading="loadingSubscriptions" @click="loadSubscriptions">刷新</el-button>
          </section>

          <k-card v-loading="loadingSubscriptions">
            <el-table :data="filteredSubscriptions" empty-text="暂无 RSS 订阅">
              <el-table-column label="Feed" min-width="220">
                <template #default="{ row }">
                  <strong>{{ row.feedTitle || '未命名 Feed' }}</strong>
                  <a class="rss-url" :href="row.url" target="_blank" rel="noreferrer">{{ row.url }}</a>
                </template>
              </el-table-column>
              <el-table-column label="平台名称" min-width="110">
                <template #default="{ row }">{{ row.platform || '待配置' }}</template>
              </el-table-column>
              <el-table-column label="机器人 ID" min-width="130">
                <template #default="{ row }">{{ row.selfId || '-' }}</template>
              </el-table-column>
              <el-table-column label="频道 ID" min-width="130">
                <template #default="{ row }">{{ row.targetChannelId || '待配置' }}</template>
              </el-table-column>
              <el-table-column label="群组 ID" min-width="130">
                <template #default="{ row }">{{ row.guildId || '-' }}</template>
              </el-table-column>
              <el-table-column label="监听" width="88">
                <template #default="{ row }">
                  <el-switch
                    :model-value="row.enabled"
                    :loading="updatingIds.has(row.id)"
                    @change="toggleSubscription(row, $event)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="已记录文章" width="110" align="center" prop="seenCount" />
              <el-table-column label="操作" width="190" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="preview(row.url)">预览</el-button>
                  <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
                  <el-button link type="danger" @click="removeSubscription(row)">取消订阅</el-button>
                </template>
              </el-table-column>
            </el-table>
          </k-card>
        </el-tab-pane>

        <el-tab-pane label="插件设置" name="settings">
          <div v-if="configDraft" class="settings-grid">
            <section class="setting-card request-settings">
              <div class="setting-heading">
                <span class="setting-index">01</span>
                <div>
                  <h2>请求设置</h2>
                  <p>控制 Feed 抓取频率、网络超时和请求标识。</p>
                </div>
              </div>
              <el-form label-position="top">
                <div class="field-grid">
                  <el-form-item label="检查间隔（毫秒）">
                    <el-input-number v-model="configDraft.pollInterval" :min="10000" :step="10000" :precision="0" controls-position="right" />
                  </el-form-item>
                  <el-form-item label="请求超时（毫秒）">
                    <el-input-number v-model="configDraft.requestTimeout" :min="1000" :step="1000" :precision="0" controls-position="right" />
                  </el-form-item>
                </div>
                <el-form-item label="User-Agent">
                  <el-input v-model="configDraft.userAgent" maxlength="256" show-word-limit />
                </el-form-item>
                <el-form-item label="最大 XML 实体数量">
                  <el-input-number v-model="configDraft.maxEntityExpansions" :min="100" :max="100000" :step="1000" :precision="0" controls-position="right" />
                  <div class="form-hint">限制单个 Feed 的 XML 实体处理数量，默认 10000。</div>
                </el-form-item>
              </el-form>
            </section>

            <section class="setting-card delivery-settings">
              <div class="setting-heading">
                <span class="setting-index">02</span>
                <div>
                  <h2>推送内容</h2>
                  <p>限制单轮消息规模，并决定是否携带文章摘要。</p>
                </div>
              </div>
              <el-form label-position="top">
                <div class="field-grid">
                  <el-form-item label="单次最多合并文章">
                    <el-input-number v-model="configDraft.maxItemsPerUpdate" :min="1" :max="50" :precision="0" controls-position="right" />
                  </el-form-item>
                  <el-form-item label="单篇摘要最大字符数">
                    <el-input-number v-model="configDraft.maxSummaryLength" :min="0" :max="5000" :precision="0" :disabled="!configDraft.includeSummary" controls-position="right" />
                  </el-form-item>
                </div>
                <div class="switch-row">
                  <div>
                    <strong>推送文章摘要</strong>
                    <span>关闭后消息只保留标题和原文链接。</span>
                  </div>
                  <el-switch v-model="configDraft.includeSummary" />
                </div>
              </el-form>
            </section>

            <section class="setting-card state-settings">
              <div class="setting-heading">
                <span class="setting-index">03</span>
                <div>
                  <h2>订阅状态</h2>
                  <p>设置首次订阅行为和已记录文章的保留数量。</p>
                </div>
              </div>
              <el-form label-position="top">
                <el-form-item label="每个订阅保留的文章 ID">
                  <el-input-number v-model="configDraft.maxSeenIds" :min="50" :max="5000" :precision="0" controls-position="right" />
                </el-form-item>
                <div class="switch-row warning-row">
                  <div>
                    <strong>首次订阅立即推送已有文章</strong>
                    <span>不建议开启，可能导致刷屏。</span>
                  </div>
                  <el-switch v-model="configDraft.pushInitialItems" />
                </div>
              </el-form>
            </section>

            <div class="settings-actions">
              <span>保存后 FeedLuna 将使用 Koishi 原生重载应用新配置。</span>
              <el-button type="primary" :loading="savingConfig" :disabled="!configEntry" @click="saveConfig">
                保存并重载
              </el-button>
            </div>
          </div>

          <k-card v-else>
            <template #header>
              <div class="settings-title">
                <span>正在读取当前 FeedLuna 配置</span>
              </div>
            </template>
            <el-skeleton :rows="5" animated />
          </k-card>
        </el-tab-pane>
      </el-tabs>
    </k-content>
  </k-layout>

  <el-dialog v-model="showEditor" :title="editingId ? '编辑 RSS 订阅' : '新增 RSS 订阅'" width="min(680px, calc(100vw - 32px))" destroy-on-close>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="RSS 地址" required>
        <div class="url-input">
          <el-input v-model="editor.url" placeholder="https://example.com/feed.xml" />
          <el-button :loading="previewing" @click="preview(editor.url)">文章预览</el-button>
        </div>
      </el-form-item>
      <el-form-item label="平台名称" required>
        <el-select v-model="editor.platform" filterable allow-create default-first-option placeholder="选择或输入平台名称" @change="selectPlatform">
          <el-option v-for="platform in platforms" :key="platform" :label="platform" :value="platform" />
        </el-select>
      </el-form-item>
      <el-form-item label="机器人 ID" required>
        <el-select v-model="editor.selfId" filterable allow-create default-first-option placeholder="选择或输入机器人 ID">
          <el-option v-for="bot in platformBots" :key="bot.selfId" :label="bot.selfId" :value="bot.selfId" />
        </el-select>
        <div class="form-hint">机器人必须处于运行状态，FeedLuna 会通过该机器人发送文章。</div>
      </el-form-item>
      <el-form-item label="频道 ID" required>
        <el-input v-model="editor.targetChannelId" placeholder="推送目标频道 ID" />
      </el-form-item>
      <el-form-item label="群组 ID">
        <el-input v-model="editor.guildId" placeholder="可选；频道与群组 ID 不同时填写" />
      </el-form-item>
      <el-form-item label="是否在此频道启用监听">
        <el-switch v-model="editor.enabled" active-text="启用" inactive-text="停用" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showEditor = false">取消</el-button>
      <el-button type="primary" :loading="savingSubscription" @click="saveSubscription">保存订阅</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="showPreview" title="文章预览" width="min(820px, calc(100vw - 32px))" destroy-on-close>
    <div v-loading="previewing" class="preview-list">
      <template v-if="previewFeed">
        <h2>{{ previewFeed.title }}</h2>
        <article v-for="item in previewFeed.items" :key="item.id" class="preview-item">
          <a v-if="item.link" :href="item.link" target="_blank" rel="noreferrer">{{ item.title }}</a>
          <strong v-else>{{ item.title }}</strong>
          <time v-if="item.publishedAt">{{ formatDate(item.publishedAt) }}</time>
          <p v-if="item.summary">{{ item.summary }}</p>
        </article>
        <el-empty v-if="!previewFeed.items.length" description="该 Feed 暂无文章" />
      </template>
      <el-empty v-else-if="!previewing" description="请输入 RSS 地址后预览" />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import type {} from '@koishijs/plugin-config'
import { message, messageBox, send, store } from '@koishijs/client'
import { computed, onMounted, ref, watch } from 'vue'

interface FeedItem {
  id: string
  title: string
  link: string
  summary: string
  publishedAt?: number
}

interface FeedSnapshot {
  title: string
  items: FeedItem[]
}

interface BotView {
  platform: string
  selfId: string
}

interface SubscriptionInput {
  url: string
  platform: string
  selfId: string
  targetChannelId: string
  guildId: string
  enabled: boolean
}

interface SubscriptionView extends SubscriptionInput {
  id: number
  feedTitle: string
  seenCount: number
  createdAt: string
  updatedAt: string
}

interface ConfigEntry {
  key: string
  parentPath: string
  config: Record<string, unknown>
}

interface FeedLunaConfig {
  pollInterval: number
  requestTimeout: number
  userAgent: string
  maxEntityExpansions: number
  maxItemsPerUpdate: number
  includeSummary: boolean
  maxSummaryLength: number
  pushInitialItems: boolean
  maxSeenIds: number
}

const activeTab = ref('subscriptions')
const search = ref('')
const targetFilter = ref('')
const subscriptions = ref<SubscriptionView[]>([])
const bots = ref<BotView[]>([])
const loadingSubscriptions = ref(false)
const savingSubscription = ref(false)
const updatingIds = ref(new Set<number>())
const showEditor = ref(false)
const editingId = ref<number>()
const showPreview = ref(false)
const previewing = ref(false)
const previewFeed = ref<FeedSnapshot>()
const savingConfig = ref(false)
const configDraft = ref<FeedLunaConfig>()

const emptyEditor = (): SubscriptionInput => ({
  url: '',
  platform: '',
  selfId: '',
  targetChannelId: '',
  guildId: '',
  enabled: true,
})

const editor = ref<SubscriptionInput>(emptyEditor())

function findConfigEntry(plugins: Record<string, any>, parentPath = ''): ConfigEntry | undefined {
  for (const [key, config] of Object.entries(plugins || {})) {
    if (key.startsWith('$')) continue
    const activeKey = key.startsWith('~') ? key.slice(1) : key
    const pluginName = activeKey.split(':', 1)[0]
    const path = activeKey.slice(pluginName.length + 1)
    if (pluginName === 'feedluna') return { key: activeKey, parentPath, config: config as Record<string, unknown> }
    if (pluginName === 'group') {
      const nested = findConfigEntry(config as Record<string, any>, path)
      if (nested) return nested
    }
  }
}

const configEntry = computed(() => findConfigEntry(store.config?.plugins))
const targets = computed(() => [...new Set(subscriptions.value.map(targetLabel))].sort())
const platforms = computed(() => [...new Set(bots.value.map(bot => bot.platform))].sort())
const platformBots = computed(() => bots.value.filter(bot => bot.platform === editor.value.platform))
const filteredSubscriptions = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return subscriptions.value.filter((subscription) => {
    const target = targetLabel(subscription)
    if (targetFilter.value && target !== targetFilter.value) return false
    if (!keyword) return true
    return [subscription.feedTitle, subscription.url, target, subscription.guildId]
      .join('\n')
      .toLowerCase()
      .includes(keyword)
  })
})

watch(configEntry, () => {
  void loadConfig()
}, { immediate: true })

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function targetLabel(target: Pick<SubscriptionInput, 'platform' | 'selfId' | 'targetChannelId' | 'guildId'>) {
  const source = target.platform && target.selfId ? `${target.platform}:${target.selfId}` : '待配置'
  const destination = target.targetChannelId || '待配置频道'
  return target.guildId ? `${source} -> ${destination} (${target.guildId})` : `${source} -> ${destination}`
}

function formatDate(value: string | number) {
  return new Date(value).toLocaleString()
}

async function loadSubscriptions() {
  loadingSubscriptions.value = true
  try {
    subscriptions.value = await send('feedluna/subscriptions/list')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取订阅失败')
  } finally {
    loadingSubscriptions.value = false
  }
}

async function loadBots() {
  try {
    bots.value = await send('feedluna/bots/list')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取机器人列表失败')
  }
}

async function loadConfig() {
  if (!configEntry.value) return
  try {
    configDraft.value = await send('feedluna/config/current')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取插件配置失败')
  }
}

function openCreate() {
  editingId.value = undefined
  editor.value = emptyEditor()
  showEditor.value = true
}

function openEdit(subscription: SubscriptionView) {
  editingId.value = subscription.id
  editor.value = {
    url: subscription.url,
    platform: subscription.platform,
    selfId: subscription.selfId,
    targetChannelId: subscription.targetChannelId,
    guildId: subscription.guildId,
    enabled: subscription.enabled,
  }
  showEditor.value = true
}

function selectPlatform(platform: string) {
  const [bot] = bots.value.filter(bot => bot.platform === platform)
  if (bot && !platformBots.value.some(item => item.selfId === editor.value.selfId)) {
    editor.value.selfId = bot.selfId
  }
}

async function saveSubscription() {
  savingSubscription.value = true
  try {
    if (editingId.value) {
      await send('feedluna/subscriptions/update', editingId.value, editor.value)
      message.success('订阅已更新')
    } else {
      await send('feedluna/subscriptions/create', editor.value)
      message.success('订阅已创建')
    }
    showEditor.value = false
    await loadSubscriptions()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存订阅失败')
  } finally {
    savingSubscription.value = false
  }
}

async function toggleSubscription(subscription: SubscriptionView, enabled: boolean) {
  updatingIds.value = new Set([...updatingIds.value, subscription.id])
  try {
    await send('feedluna/subscriptions/update', subscription.id, { ...subscription, enabled })
    subscription.enabled = enabled
  } catch (error) {
    message.error(error instanceof Error ? error.message : '更新监听状态失败')
  } finally {
    const next = new Set(updatingIds.value)
    next.delete(subscription.id)
    updatingIds.value = next
  }
}

async function removeSubscription(subscription: SubscriptionView) {
  try {
    await messageBox.confirm(`确定取消订阅“${subscription.feedTitle || subscription.url}”吗？`, '取消订阅', {
      confirmButtonText: '取消订阅',
      cancelButtonText: '保留',
      type: 'warning',
    })
    await send('feedluna/subscriptions/remove', subscription.id)
    subscriptions.value = subscriptions.value.filter(item => item.id !== subscription.id)
    message.success('已取消订阅')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      message.error(error instanceof Error ? error.message : '取消订阅失败')
    }
  }
}

async function preview(url: string) {
  showPreview.value = true
  previewFeed.value = undefined
  previewing.value = true
  try {
    previewFeed.value = await send('feedluna/preview', url)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'RSS 预览失败')
  } finally {
    previewing.value = false
  }
}

async function saveConfig() {
  if (!configEntry.value || !configDraft.value) return
  const validationError = validateConfig(configDraft.value)
  if (validationError) return message.error(validationError)

  savingConfig.value = true
  try {
    const nextConfig = { ...configEntry.value.config, ...configDraft.value }
    await send('manager/reload', configEntry.value.parentPath, configEntry.value.key, nextConfig)
    configDraft.value = cloneConfig(nextConfig) as FeedLunaConfig
    message.success('配置已保存并重载')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存配置失败')
  } finally {
    savingConfig.value = false
  }
}

function validateConfig(config: FeedLunaConfig) {
  const natural = (value: number) => Number.isSafeInteger(value) && value >= 0
  if (!natural(config.pollInterval) || config.pollInterval < 10000) return '检查间隔不能小于 10000 毫秒。'
  if (!natural(config.requestTimeout) || config.requestTimeout < 1000) return '请求超时不能小于 1000 毫秒。'
  if (!config.userAgent.trim() || config.userAgent.length > 256) return 'User-Agent 必须为 1 至 256 个字符。'
  if (!natural(config.maxEntityExpansions) || config.maxEntityExpansions < 100 || config.maxEntityExpansions > 100000) return '最大 XML 实体数量必须在 100 至 100000 之间。'
  if (!natural(config.maxItemsPerUpdate) || config.maxItemsPerUpdate < 1 || config.maxItemsPerUpdate > 50) return '单次最多合并文章必须在 1 至 50 之间。'
  if (!natural(config.maxSummaryLength) || config.maxSummaryLength > 5000) return '单篇摘要最大字符数必须在 0 至 5000 之间。'
  if (!natural(config.maxSeenIds) || config.maxSeenIds < 50 || config.maxSeenIds > 5000) return '保留文章 ID 数量必须在 50 至 5000 之间。'
}

onMounted(() => {
  void Promise.all([loadSubscriptions(), loadBots(), loadConfig()])
})
</script>

<style scoped lang="scss">
.feedluna-page {
  max-width: 100rem;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(16rem, 1fr) minmax(14rem, 18rem) auto auto;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.5rem;
}

.rss-url {
  display: block;
  margin-top: 0.35rem;
  color: var(--el-color-primary);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.settings-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.setting-card {
  border: 1px solid var(--k-color-divider);
  border-radius: 0.75rem;
  padding: 1.25rem;
  background: var(--k-card-bg);
}

.setting-card.state-settings {
  grid-column: span 2;
}

.setting-heading {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  margin-bottom: 1.25rem;
}

.setting-index {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border-radius: 0.55rem;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.setting-heading h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 1rem;
  line-height: 1.35;
}

.setting-heading p {
  margin: 0.25rem 0 0;
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.field-grid :deep(.el-input-number),
.request-settings :deep(.el-input-number),
.state-settings :deep(.el-input-number) {
  width: 100%;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--k-color-divider);
}

.switch-row strong,
.switch-row span {
  display: block;
}

.switch-row strong {
  color: var(--el-text-color-primary);
  font-size: 0.875rem;
}

.switch-row span {
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
  margin-top: 0.2rem;
}

.warning-row strong {
  color: var(--el-color-warning-dark-2);
}

.settings-actions {
  grid-column: span 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0;
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
}

.url-input {
  display: flex;
  width: 100%;
  gap: 0.75rem;
}

.form-hint {
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
  margin-top: 0.4rem;
}

.preview-list {
  min-height: 12rem;
}

.preview-list h2 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}

.preview-item {
  padding: 1rem 0;
  border-top: 1px solid var(--k-color-divider);
}

.preview-item a,
.preview-item strong {
  display: block;
  color: var(--el-color-primary);
  font-size: 1rem;
  line-height: 1.5;
}

.preview-item strong {
  color: var(--el-text-color-primary);
}

.preview-item time {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 0.8125rem;
  margin-top: 0.3rem;
}

.preview-item p {
  color: var(--el-text-color-regular);
  line-height: 1.65;
  margin: 0.65rem 0 0;
  white-space: pre-wrap;
}

@media screen and (max-width: 768px) {
  .toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .url-input {
    flex-direction: column;
  }

  .settings-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }

  .setting-card.state-settings,
  .settings-actions {
    grid-column: auto;
  }

  .settings-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
