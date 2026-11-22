// 上下文压缩：只压早段、摘要之后的消息必须全部保留、AI 能检索原文。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { initMemoryIndex, rebuildMemoryIndex, searchMemoryIndex } from '../src/memoryIndex.mjs'
import {
  applySummaryRefresh, planSummaryRefresh, updateSummaryMessages,
  CONTEXT_LIMITS, planCompaction, buildSummaryPrompt,
  buildSummarySystemMessage, searchHistory, searchMessageList,
} from '../src/contextCompression.mjs'

const messages = (n, role = 'user', text = '一段对话') =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : role, content: text + ' ' + (i + 1), at: new Date(Date.now() - (n - i) * 60000).toISOString(), id: 'm' + i }))

test('短对话不压缩', () => {
  assert.deepEqual(planCompaction(messages(10)), { needed: false, cut: 0 })
})

test('超过消息条数上限时保留配置的最近消息', () => {
  const plan = planCompaction(messages(40))
  assert.equal(plan.needed, true)
  assert.equal(plan.cut, 40 - CONTEXT_LIMITS.keepMessages)
})

test('条数没超但字数超预算，也会从最旧的开始压', () => {
  const long = messages(30, 'user', '字'.repeat(2000))
  const plan = planCompaction(long)
  assert.equal(plan.needed, true)
  assert.ok(plan.cut > 0)
  const kept = long.slice(plan.cut)
  assert.ok(kept.reduce((n, m) => n + m.content.length, 0) <= CONTEXT_LIMITS.maxChars)
  assert.ok(kept.length >= 1)
})

test('摘要提示词合并已有摘要与新增旧对话', () => {
  const prompt = buildSummaryPrompt('旧摘要：用户喜欢桂花茶。', messages(3))
  assert.equal(prompt[0].role, 'system')
  assert.match(prompt[0].content, /对话压缩器/)
  assert.match(prompt[1].content, /【已有摘要】/)
  assert.match(prompt[1].content, /用户喜欢桂花茶/)
  assert.match(prompt[1].content, /【新增旧对话】/)
  assert.match(prompt[1].content, /一段对话 3/)
})

test('前情提要消息告诉模型覆盖了多少条、可以回顾原文', () => {
  const text = buildSummarySystemMessage('摘要正文', 12)
  assert.match(text, /更早的 12 条对话已压缩/)
  assert.match(text, /摘要正文/)
  assert.match(text, /conversation_search/)
})



test('当前聊天窗旧原文召回优先找与本轮相关的细节', () => {
  const old = [
    { role: 'user', content: '周六去桂花茶店，下午三点见。', at: '2026-11-14T10:00:00.000Z' },
    { role: 'assistant', content: '记住了，三点到楼下等你。', at: '2026-11-14T10:01:00.000Z' },
    { role: 'user', content: '客厅的灯以后换成暖色。', at: '2026-11-14T10:02:00.000Z' },
  ]
  const hits = searchMessageList(old, '桂花茶三点那个安排还记得吗', 4)
  assert.ok(hits.length >= 1)
  assert.match(hits[0].content, /桂花茶|三点/)
  assert.ok(!hits.some(hit => /暖色/.test(hit.content) && hit.score >= hits[0].score))
})

test('当前聊天窗召回对空查询不返回内容', () => {
  assert.deepEqual(searchMessageList(messages(10), ''), [])
})

test('conversation_search 检索原始消息并隔离助手', () => {
  const conversations = {
    'assistant-yanweixi': [
      { id: 'c1', title: '桂花茶', messages: [
        { role: 'user', content: '周六去桂花茶店吧', at: '2026-11-14T10:00:00.000Z' },
        { role: 'assistant', content: '好呀，三点到楼下等你', at: '2026-11-14T10:01:00.000Z' },
      ] },
      { id: 'c2', title: '新家', messages: [{ role: 'user', content: '客厅的灯换成暖色', at: '2026-11-13T10:00:00.000Z' }] },
    ],
    'assistant-yanshuo': [{ id: 'c3', title: '别的助手', messages: [{ role: 'user', content: '桂花茶只有我知道', at: '2026-11-14T11:00:00.000Z' }] }],
  }
  const hits = searchHistory(conversations, 'assistant-yanweixi', '桂花茶')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].conversationId, 'c1')
  assert.ok(!JSON.stringify(hits).includes('别的助手'))
  assert.equal(searchHistory(conversations, 'assistant-yanweixi', '桂花茶', 1).length, 1)
  assert.deepEqual(searchHistory(conversations, 'assistant-yanweixi', ''), [])
})

test('长消息召回片段保留实际命中的原文', () => {
  const content = '背景信息'.repeat(300) + '约定周六下午三点去桂花茶店。'
  const [hit] = searchMessageList([{ role: 'user', content }], '桂花茶店')
  assert.match(hit.content, /周六下午三点去桂花茶店/)
  assert.ok(hit.content.length <= 900)
})

test('长会话增量摘要只推进实际覆盖的范围；旧数据无边界时从原文重建', () => {
  const conversation = { messages: messages(60), summary: '旧摘要' }
  const refresh = planSummaryRefresh(conversation.messages, -1, conversation.summary)
  assert.doesNotMatch(refresh.prompt[1].content, /旧摘要/)
  const next = applySummaryRefresh(conversation, refresh, '已整理八条', '2026-11-22')
  assert.equal(next.summaryThrough, 8)
  assert.equal(next.summaryThroughId, 'm7')
  const incremental = planSummaryRefresh(next.messages, 7, next.summary)
  assert.match(incremental.prompt[1].content, /已整理八条/)
  assert.equal(incremental.throughId, 'm15')
})

test('编辑、删除或重生覆盖范围内的消息会使摘要失效；晚到摘要不会重新写回', () => {
  const original = { messages: messages(40) }
  const plan = planSummaryRefresh(original.messages, -1)
  const summarized = applySummaryRefresh(original, plan, '摘要', '2026-11-22')
  const variants = [
    original.messages.map((m, i) => i === 0 ? { ...m, content: '已编辑' } : m),
    original.messages.filter((_, i) => i !== 2),
    original.messages.map((m, i) => i === 1 ? { ...m, content: '重新生成' } : m),
  ]
  for (const messages of variants) {
    const updated = updateSummaryMessages(summarized, messages)
    assert.equal(updated.summary, undefined)
    assert.equal(applySummaryRefresh(updated, plan, '晚到的摘要', '2026-11-22'), updated)
  }
  const appended = updateSummaryMessages(summarized, [...original.messages, { id: 'new', role: 'user', content: '是新消息' }])
  assert.equal(appended.summary, summarized.summary)
})

test('云端旧索引从权威快照补齐来源，缺失字段保留为空且删除后不再返回', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, payload TEXT)')
    const person = 'assistant-yanweixi'
    const source = { id: 'real', at: '2026-01-01T09:00:00Z', role: 'user', content: '桂花茶喝过' }
    const state = { conversations: { [person]: [{ id: 'conv', messages: [source, { role: 'assistant', content: '桂花茶真香' }] }] } }
    db.prepare('INSERT INTO app_state VALUES (1, ?)').run(JSON.stringify(state))
    initMemoryIndex(db)
    const results = searchMemoryIndex(db, { person, query: '桂花茶' })
    assert.equal(results.find(r => r.messageId === 'real').at, source.at)
    assert.equal(results.find(r => r.role === 'assistant').at, null)
    assert.deepEqual(searchMemoryIndex(db, { person: 'assistant-yanshuo', query: '桂花茶' }), [])
    rebuildMemoryIndex(db, { conversations: {} })
    assert.deepEqual(searchMemoryIndex(db, { person, query: '桂花茶' }), [])
  } finally {
    db.close()
  }
})

test('当前会话重复原文只保留最新命中', () => {
  const content = '之前买了桂花茶'
  const hits = searchMessageList([{role:'user', content}, {role:'user', content}], '桂花茶')
  assert.deepEqual(hits.map(hit => hit.index), [1])
})
