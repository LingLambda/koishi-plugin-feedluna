import { Context, icons } from '@koishijs/client'
import FeedLunaPage from './page.vue'
import RssIcon from './rss-icon.vue'

icons.register('feedluna:rss', RssIcon)

export default (ctx: Context) => {
  ctx.page({
    name: 'FeedLuna',
    desc: '管理 RSS 订阅和推送设置',
    path: '/feedluna',
    icon: 'feedluna:rss',
    order: 700,
    authority: 4,
    fields: ['config'],
    component: FeedLunaPage,
  })
}
