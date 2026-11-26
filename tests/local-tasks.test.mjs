// 本地模式定时任务：纯函数状态机 + LocalBackend 路由（不依赖云端 / 常驻进程）。
// node 环境没有 localStorage —— 注入内存实现（localBackend 按需读取，不依赖 import 时机）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLocalTask, makeLocalTask, dueLocalTasks, nextRunAt, advanceLocalTask } from '../src/localTasks.mjs'
import { localHandle } from '../src/localBackend.mjs'

function memStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)) },
    removeItem: k => { m.delete(String(k)) },
    clear: () => { m.clear() },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
globalThis.localStorage = memStorage()

const call = async (path, init) => {
  const res = await localHandle(path, init)
  return { status: res.status, data: await res.json() }
}
const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (path, body) => call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const del = (path, body) => call(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const T0 = Date.parse('2026-11-11T19:00:00.000Z')
const iso = ms => new Date(ms).toISOString()
const base = { person: 'assistant-001', title: '提醒洗衣服', prompt: '该洗衣服啦' }

test('makeLocalTask 校验必填与时间，字段与云端 scheduled_tasks 同构', () => {
  assert.equal(makeLocalTask({ ...base, runAt: '不是时间' }, 'x'), null)
  assert.equal(makeLocalTask({ ...base, title: '', runAt: iso(T0) }, 'x'), null)
  const t = makeLocalTask({ ...base, runAt: iso(T0), recurrence: 'weekly', conversationId: 'conv-1' }, 't1', T0)
  assert.equal(t.id, 't1')
  assert.equal(t.run_at, iso(T0))
  assert.equal(t.recurrence, 'weekly')
  assert.equal(t.status, 'scheduled')
  assert.equal(t.conversation_id, 'conv-1')
  assert.equal(t.last_run_at, null)
  assert.equal(t.created_by, 'assistant-001')
  assert.equal(normalizeLocalTask({ id: 'bad', run_at: 'oops' }), null)
  assert.equal(normalizeLocalTask({ id: 'ok', run_at: iso(T0), recurrence: '别的' }).recurrence, 'once')
})

test('dueLocalTasks 只挑已到期且启用的，按时间升序', () => {
  const tasks = [
    { id: 'late', run_at: iso(T0 + 60000), status: 'scheduled', title: '', person: 'a' },
    { id: 'paused', run_at: iso(T0 - 60000), status: 'paused', title: '', person: 'a' },
    { id: 'done', run_at: iso(T0 - 30000), status: 'completed', title: '', person: 'a' },
    { id: 'first', run_at: iso(T0 - 120000), status: 'scheduled', title: '', person: 'a' },
    { id: 'second', run_at: iso(T0), status: 'scheduled', title: '', person: 'a' },
  ]
  assert.deepEqual(dueLocalTasks(tasks, T0).map(t => t.id), ['first', 'second'])
  assert.deepEqual(dueLocalTasks(undefined, T0), [])
})

test('nextRunAt 把过期重复任务直接递推到未来的下一次，不会补发历史提醒', () => {
  const daily = { run_at: iso(T0 - 3 * 86_400_000 - 3600_000), recurrence: 'daily' }
  assert.equal(nextRunAt(daily, T0), iso(T0 - 3600_000 + 86_400_000))
  const weekly = { run_at: iso(T0 - 7_000_000), recurrence: 'weekly' }
  assert.equal(nextRunAt(weekly, T0), iso(T0 - 7_000_000 + 604_800_000))
  assert.equal(nextRunAt({ run_at: iso(T0), recurrence: 'once' }, T0), null)
  assert.equal(nextRunAt({ run_at: 'oops', recurrence: 'daily' }, T0), null)
  // 离线很久也不能死循环
  assert.ok(Date.parse(nextRunAt({ run_at: iso(0), recurrence: 'daily' }, T0)) > T0)
})

test('advanceLocalTask：重复任务继续启用，一次性任务标记完成', () => {
  const repeating = normalizeLocalTask({ id: 'r', person: 'a', title: 't', run_at: iso(T0 - 1000), recurrence: 'daily', status: 'scheduled' })
  const next = advanceLocalTask(repeating, T0)
  assert.equal(next.status, 'scheduled')
  assert.ok(Date.parse(next.run_at) > T0)
  assert.equal(next.last_run_at, iso(T0))
  const once = normalizeLocalTask({ id: 'o', person: 'a', title: 't', run_at: iso(T0 - 1000), recurrence: 'once', status: 'scheduled' })
  const done = advanceLocalTask(once, T0)
  assert.equal(done.status, 'completed')
  assert.equal(done.run_at, iso(T0 - 1000))
})

test('LocalBackend：创建 → 列表 → 结算 → 会话提醒 → 重复任务排下一次', async () => {
  localStorage.clear()
  const created = await post('/api/tasks', { ...base, runAt: iso(T0 - 1000), recurrence: 'daily' })
  assert.equal(created.status, 201)
  assert.equal(created.data.task.status, 'scheduled')
  assert.equal((await call('/api/tasks?person=assistant-001')).data.tasks.length, 1)
  assert.equal((await call('/api/tasks?person=assistant-002')).data.tasks.length, 0)

  const run = await post('/api/tasks/run', { now: iso(T0) })
  assert.equal(run.status, 200)
  assert.equal(run.data.fired.length, 1)
  assert.equal(run.data.fired[0].person, 'assistant-001')
  assert.ok(run.data.fired[0].answer.includes('提醒洗衣服'))
  assert.ok(run.data.fired[0].runId.startsWith('local-'))
  // 重复任务推进到未来，第二次结算不会重复触发
  assert.ok(Date.parse(run.data.tasks[0].run_at) > T0)
  assert.equal(run.data.tasks[0].status, 'scheduled')
  assert.equal((await post('/api/tasks/run', { now: iso(T0) })).data.fired.length, 0)
  // 收件箱留一条，前台横幅轮询会弹出
  const inbox = (await call('/api/inbox')).data.messages
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].kind, 'task_notice')
})

test('LocalBackend：暂停不触发，恢复后触发，一次性任务结算后完成', async () => {
  localStorage.clear()
  const c = await post('/api/tasks', { ...base, runAt: iso(T0 - 1000), recurrence: 'once' })
  const id = c.data.task.id
  assert.equal((await put('/api/tasks/' + id, { person: 'assistant-001', status: 'paused' })).status, 200)
  assert.equal((await post('/api/tasks/run', { now: iso(T0) })).data.fired.length, 0)
  assert.equal((await put('/api/tasks/' + id, { person: 'assistant-001', status: 'scheduled' })).status, 200)
  const run = await post('/api/tasks/run', { now: iso(T0) })
  assert.equal(run.data.fired.length, 1)
  assert.equal(run.data.tasks[0].status, 'completed')
  assert.equal((await post('/api/tasks/run', { now: iso(T0 + 86_400_000) })).data.fired.length, 0)
  assert.equal((await del('/api/tasks/' + id, { person: 'assistant-001' })).status, 200)
  assert.equal((await call('/api/tasks?person=assistant-001')).data.tasks.length, 0)
})

test('LocalBackend：助手工具调用走 /api/workflows/manage，本地也能创建与管理', async () => {
  localStorage.clear()
  const c = await post('/api/workflows/manage', {
    person: 'assistant-001', action: 'create', title: '定时喝水', prompt: '喝一杯水',
    runAt: iso(T0 + 60_000), recurrence: 'once', temporary: true, conversationId: 'conv-2',
  })
  assert.equal(c.status, 201)
  assert.equal(c.data.task.created_by, 'assistant-001')
  assert.equal(c.data.task.conversation_id, 'conv-2')
  const id = c.data.task.id
  assert.equal((await post('/api/workflows/manage', { person: 'assistant-001', action: 'pause', id })).data.ok, true)
  assert.equal((await call('/api/tasks?person=assistant-001')).data.tasks[0].status, 'paused')
  assert.equal((await post('/api/workflows/manage', { person: 'assistant-001', action: 'resume', id })).data.ok, true)
  assert.equal((await post('/api/workflows/manage', { person: 'assistant-001', action: 'delete', id })).data.ok, true)
  assert.equal((await call('/api/tasks?person=assistant-001')).data.tasks.length, 0)
})

test('LocalBackend：无效创建返回 400，且不再出现「需要云端」的降级文案', async () => {
  localStorage.clear()
  const bad = await post('/api/tasks', { ...base, runAt: 'nope' })
  assert.equal(bad.status, 400)
  const bad2 = await post('/api/workflows/manage', { person: 'assistant-001', action: 'create', title: '', prompt: '', runAt: iso(T0) })
  assert.equal(bad2.status, 400)
  assert.ok(!JSON.stringify([bad.data, bad2.data]).includes('配置云服务器'))
})


test('绑定会话已删除时保留本地任务，恢复会话后才能结算', async () => {
  localStorage.clear()
  const created = await post('/api/tasks', { ...base, runAt: iso(T0 - 1000), conversationId: 'original' })
  assert.equal(created.status, 201)
  const skipped = await post('/api/tasks/run', { now: iso(T0), conversationIds: { 'assistant-001': ['other'] } })
  assert.equal(skipped.data.fired.length, 0)
  assert.equal((await call('/api/tasks?person=assistant-001')).data.tasks[0].status, 'scheduled')
  const resumed = await post('/api/tasks/run', { now: iso(T0), conversationIds: { 'assistant-001': ['original'] } })
  assert.equal(resumed.data.fired.length, 1)
  assert.equal(resumed.data.fired[0].conversationId, 'original')
})


test('十分钟重复任务在本地保存并按十分钟推进', async () => {
  localStorage.clear()
  const created = await post('/api/tasks', { ...base, runAt: iso(T0 - 1000), intervalMinutes: 10 })
  assert.equal(created.data.task.interval_minutes, 10)
  const result = await post('/api/tasks/run', { now: iso(T0) })
  assert.equal(result.data.tasks[0].status, 'scheduled')
  assert.equal(Date.parse(result.data.tasks[0].run_at), T0 - 1000 + 600000)
})

test('本地自然提醒调用真实聊天入口并持久化结果后删除一次性临时任务', async () => {
  localStorage.clear()
  const person = 'assistant-001'
  await put('/api/state', { state: { conversations: { [person]: [{ id: 'c1', messages: [{ role: 'user', content: '今天上班有点累' }] }] }, characters: { [person]: { definition: '温柔说话' } }, userSettings: { [person]: { callName: '阿懒' } } } })
  localStorage.setItem('ai-home.modelConfig', JSON.stringify({ [person]: { endpoint: 'https://relay.example/v1', model: 'test-model' } }))
  localStorage.setItem('ai-home.apiKey', JSON.stringify({ [person]: 'test-key' }))
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: '阿懒，辛苦啦，起来喝口水吧。' } }] }), { status: 200 })
  }
  try {
    const created = await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '十分钟后提醒阿懒喝水，起来走动', runAt: iso(T0 - 1000), recurrence: 'once', temporary: true, conversationId: 'c1' })
    assert.equal(created.status, 201)
    const result = await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    assert.equal(result.status, 200)
    assert.equal(result.data.fired.length, 0)
    assert.ok(sent.messages.some(message => message.content === '今天上班有点累'))
    assert.ok(sent.messages.some(message => message.content.includes('温柔说话') && message.content.includes('阿懒')))
    const inbox = await call('/api/inbox')
    const envelope = JSON.parse(inbox.data.messages[0].content)
    assert.equal(envelope.answer, '阿懒，辛苦啦，起来喝口水吧。')
    assert.equal(envelope.prompt, '十分钟后提醒阿懒喝水，起来走动')
    assert.equal((await call('/api/tasks?person=' + person)).data.tasks[0].status, 'completed')
    await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    assert.equal((await call('/api/inbox')).data.messages.length, 1)
    assert.equal((await post('/api/inbox/read', { id: inbox.data.messages[0].id })).status, 200)
    assert.equal((await call('/api/tasks?person=' + person)).data.tasks.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('本地自然提醒模型失败时暂停任务并保留错误', async () => {
  localStorage.clear()
  const person = 'assistant-001'
  await put('/api/state', { state: { conversations: { [person]: [{ id: 'c1', messages: [] }] } } })
  localStorage.setItem('ai-home.modelConfig', JSON.stringify({ [person]: { endpoint: 'https://relay.example/v1', model: 'test-model' } }))
  localStorage.setItem('ai-home.apiKey', JSON.stringify({ [person]: 'test-key' }))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  try {
    await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '提醒阿懒喝水', runAt: iso(T0 - 1000), temporary: true, conversationId: 'c1' })
    await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    const tasks = (await call('/api/tasks?person=' + person)).data.tasks
    assert.equal(tasks[0].status, 'paused')
    assert.match(tasks[0].last_error, /503/)
    assert.equal((await call('/api/inbox')).data.messages.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('本地提醒生成中暂停任务，不投递也不覆盖暂停状态', async () => {
  localStorage.clear()
  const person = 'assistant-001'
  await put('/api/state', { state: { conversations: { [person]: [{ id: 'c1', messages: [] }] } } })
  localStorage.setItem('ai-home.modelConfig', JSON.stringify({ [person]: { endpoint: 'https://relay.example/v1', model: 'test-model' } }))
  localStorage.setItem('ai-home.apiKey', JSON.stringify({ [person]: 'test-key' }))
  const originalFetch = globalThis.fetch
  let release
  let started
  const startedPromise = new Promise(resolve => { started = resolve })
  globalThis.fetch = async () => {
    started()
    await new Promise(resolve => { release = resolve })
    return new Response(JSON.stringify({ choices: [{ message: { content: '来喝水吧。' } }] }), { status: 200 })
  }
  try {
    const created = await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '提醒阿懒喝水', runAt: iso(T0 - 1000), temporary: true, conversationId: 'c1' })
    const running = post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    await startedPromise
    const overlap = await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    assert.equal(overlap.data.fired.length, 0)
    await put('/api/tasks/' + created.data.task.id, { person, status: 'paused' })
    release()
    await running
    assert.equal((await call('/api/inbox')).data.messages.length, 0)
    assert.equal((await call('/api/tasks?person=' + person)).data.tasks[0].status, 'paused')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('本地提醒结果已入收件箱但任务未结算时，恢复不重复请求模型', async () => {
  localStorage.clear()
  const person = 'assistant-001'
  await put('/api/state', { state: { conversations: { [person]: [{ id: 'c1', messages: [] }] } } })
  const created = await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '提醒阿懒喝水', runAt: iso(T0 - 1000), temporary: true, conversationId: 'c1' })
  const task = created.data.task
  const runId = 'local-' + task.id + '-' + Date.parse(task.run_at)
  const existing = { id: 'task-' + runId, person, kind: 'task_result', content: JSON.stringify({ runId, taskId: task.id, conversationId: 'c1', title: task.title, prompt: task.prompt, answer: '喝点水吧。' }), created_at: iso(T0), read_at: null }
  localStorage.setItem('ai-home.local.inbox', JSON.stringify([existing]))
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('不应重复调用模型') }
  try {
    const result = await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['c1'] } })
    assert.equal(result.status, 200)
    assert.equal(requests, 0)
    assert.equal((await call('/api/tasks?person=' + person)).data.tasks[0].status, 'completed')
    assert.equal((await call('/api/inbox')).data.messages.length, 1)
    await post('/api/inbox/read', { id: existing.id })
    assert.equal((await call('/api/tasks?person=' + person)).data.tasks.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('到期提醒使用原助手的订阅令牌，代理错误时保留任务', async t => {
  localStorage.clear()
  const person = 'assistant-001'
  const save = (key, value) => localStorage.setItem('ai-home.' + key, JSON.stringify(value))
  await put('/api/state', { state: { conversations: { [person]: [{ id: 'work', messages: [{ role: 'user', content: '刚开完会' }] }] } } })
  save('modelConfig', { [person]: { model: 'shared-model', vendorId: 'shared', endpoint: '' } })
  save('vendors', [{ id: 'shared', subscription: true, keys: [{ id: 'api', value: 'ordinary' }, { id: 'oauth', value: 'subscriber' }] }])
  save('subscriptions', [{ id: 'sub', channelId: 'claude', vendorId: 'shared', vendorKeyId: 'oauth', loggedIn: true }])
  let request
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected direct request') })
  globalThis.AiHomeSystem = {
    status: () => '{}',
    modelHttp(id, policy, method, url, headers, body) {
      request = { policy, headers: JSON.parse(headers), body }
      globalThis.__aihomeHttpStream(id, JSON.stringify({ type: 'error', message: '订阅代理不可用' }))
    },
  }
  t.after(() => { delete globalThis.AiHomeSystem })
  await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '提醒我喝水', runAt: iso(T0 - 1000), temporary: true, conversationId: 'work' })
  await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['work'] } })
  assert.equal(request?.policy, 'subscription')
  assert.equal(request.headers.authorization, 'Bearer subscriber')
  assert.match(request.body, /刚开完会/)
  const [task] = (await call('/api/tasks?person=' + person)).data.tasks
  assert.equal(task.status, 'paused')
  assert.match(task.last_error, /订阅代理不可用/)
  assert.equal((await call('/api/inbox')).data.messages.length, 0)
  assert.equal(globalThis.fetch.mock.callCount(), 0)
})


test('自然提醒绑定会话消失时暂停并保留任务，不向其他会话投递', async () => {
  localStorage.clear()
  const person = 'assistant-001'
  await put('/api/state', { state: { conversations: { [person]: [] } } })
  const created = await post('/api/workflows/manage', { person, action: 'create', title: '提醒喝水', prompt: '提醒阿懒喝水', runAt: iso(T0 - 1000), temporary: true, conversationId: 'missing' })
  assert.equal(created.status, 201)
  await post('/api/tasks/run', { now: iso(T0), conversationIds: { [person]: ['missing'] } })
  const tasks = (await call('/api/tasks?person=' + person)).data.tasks
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].status, 'paused')
  assert.match(tasks[0].last_error, /绑定会话不可用/)
  assert.equal((await call('/api/inbox')).data.messages.length, 0)
})
