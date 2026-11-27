import { buildUserContext } from '../../userSettings.mjs'

/**
 * 定时任务的私有执行指令与用户可见回复规则。
 * 不把任务描述当作要直接转述给用户的消息。
 * 只对主动聊天类任务采用对话输出；其他任务继续正常执行并报告结果。
 */
export function isScheduledConversationTask(prompt = '', title = '') {
  const text = String(title || '') + '\n' + String(prompt || '')
  return /提醒.{0,15}(?:我|用户|阿懒|顾惟|老婆|喝水|休息|走动|吃饭|睡觉)/.test(text) || /(?:主动|定时|每隔|每\s*\d+\s*(?:小时|分钟|天)|隔\s*\d+\s*(?:小时|分钟))?[\s\S]{0,25}(?:找|陪|和|跟|给|向)[\s\S]{0,10}(?:我|用户|阿懒|老婆|顾惟)[\s\S]{0,15}(?:聊|说话|问候|发消息)|(?:主动聊天|定时聊天|日常问候|定时问候|来找我聊天|问我在干什么|问问我在干什么|找我聊聊天)/i.test(text)
}

export function scheduledConversationInstructions() {
  return [
    '【定时聊天专用规则】这是一条后台定时任务，不是用户刚刚发来的聊天消息。',
    '任务的描述只是给你看的私有指令，绝不把它复述给用户，也不要谈论任务、周期、提醒、执行结果或系统。',
    '你现在就是在给用户发送一条新的聊天消息。请直接用你平时与她聊天的自然口吻开场，说你真正想对她说的话。',
    '可以根据当前时间轻松问候，例如“在干什么呀？”“今天忙不忙？”，但不必每次完全相同。',
    '结合最近会话及任务内容，完成用户需要的提醒，用自然口吻表达。',
    '只输出要发出的聊天正文，不要加标题、清单、任务说明、第三人称转述或“我将会……”等计划语句。',
    '不要虚构用户最近做过什么；如果没有最近会话上下文，就用不依赖事实的自然问候。',
  ].join('\n')
}

export function scheduledConversationContext(state, person, conversation) {
  const card = state?.characters?.[person] || {}
  const profile = [card.description, card.definition, card.language, state?.prompt?.[person], buildUserContext(state?.userSettings?.[person])]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.slice(0, 4000)).join('\n\n')
  const history = (Array.isArray(conversation?.messages) ? conversation.messages : [])
    .filter(message => (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
    .slice(-12)
    .map(message => ({ role: message.role, content: message.content.slice(0, 1200) }))
  return profile ? [{ role: 'system', content: '【助手与用户设定】\n' + profile }, ...history] : history
}

export function scheduledConversationAnswer(content, prompt) {
  const answer = typeof content === 'string' ? content.trim() : ''
  const comparable = text => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '')
  if (!comparable(answer)) throw new Error('模型没有返回提醒正文')
  if (comparable(answer) === comparable(String(prompt || ''))) throw new Error('模型复述了定时指令，未发送提醒')
  return answer
}
