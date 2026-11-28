import test from 'node:test'
import assert from 'node:assert/strict'
import { registerLocalAgentExecutor, subscribeLocalAgentEvents } from '../src/localAgentRuns.mjs'
import { localHandle } from '../src/localBackend.mjs'

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
const request = async (path, body) => {
  const response = await localHandle(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  return { status: response.status, ...(await response.json()) }
}
const wait = () => new Promise(resolve => setTimeout(resolve, 0))

test('真实执行结果、用量和事件写入本地运行记录', async () => {
  values.clear()
  const events = []
  const unsubscribe = subscribeLocalAgentEvents(event => events.push(event))
  const unregister = registerLocalAgentExecutor(async (run, signal) => {
    assert.equal(run.prompt, '整理资料')
    assert.equal(signal.aborted, false)
    return { answer: '已经整理', usage: { promptTokens: 12, completionTokens: 3 }, model: 'test-model', rounds: 2, toolCalls: 1 }
  })
  try {
    const created = await request('/api/agent/runs', { person: 'a', prompt: '整理资料' })
    assert.equal(created.status, 201)
    await wait()
    const detail = await request('/api/agent/runs/' + created.run.id)
    assert.equal(detail.run.status, 'succeeded')
    assert.equal(detail.run.answer, '已经整理')
    assert.deepEqual(detail.run.usage, { promptTokens: 12, completionTokens: 3 })
    assert.deepEqual(events.map(e => e.type), ['run_created', 'run_finished'])
    assert.equal((await request('/api/agent/runs?person=other')).runs.length, 0)
  } finally { unregister(); unsubscribe() }
})

test('取消会中止信号，执行器返回后不能被误记为成功', async () => {
  values.clear()
  let release
  const unregister = registerLocalAgentExecutor((_run, signal) => new Promise(resolve => {
    signal.addEventListener('abort', () => { release = () => resolve({ answer: '迟到的结果' }) }, { once: true })
  }))
  try {
    const created = await request('/api/agent/runs', { person: 'a', prompt: '任务' })
    await wait()
    assert.equal((await request('/api/agent/runs/' + created.run.id + '/cancel', {})).accepted, true)
    release()
    await wait()
    assert.equal((await request('/api/agent/runs/' + created.run.id)).run.status, 'cancelled')
  } finally { unregister() }
})

test('失败和缺少执行器都不伪造成功', async () => {
  values.clear()
  const unregister = registerLocalAgentExecutor(async () => { throw new Error('模型出错') })
  const created = await request('/api/agent/runs', { person: 'a', prompt: '任务' })
  await wait()
  const run = (await request('/api/agent/runs/' + created.run.id)).run
  assert.equal(run.status, 'failed')
  assert.equal(run.errorMessage, '模型出错')
  unregister()
  assert.match((await request('/api/agent/runs', { person: 'a', prompt: '任务' })).error, /尚未接入/)
})

test('本地事件流会推送真实运行事件并在关闭时解除订阅', async () => {
  values.clear()
  let finish
  const unregister = registerLocalAgentExecutor(() => new Promise(resolve => { finish = resolve }))
  const response = await localHandle('/api/agent/events')
  const reader = response.body.getReader()
  try {
    assert.match(new TextDecoder().decode((await reader.read()).value), /: ping/)
    const created = await request('/api/agent/runs', { person: 'a', prompt: '事件测试' })
    const first = new TextDecoder().decode((await reader.read()).value)
    assert.match(first, /event: run_created/)
    assert.match(first, new RegExp(created.run.id))
    await wait()
    finish({ answer: '完成' })
    const last = new TextDecoder().decode((await reader.read()).value)
    assert.match(last, /event: run_finished/)
    assert.match(last, /succeeded/)
  } finally { await reader.cancel(); unregister() }
})

test('Agent 运行用量可由现有账本按供应商和模型汇总', async () => {
  values.clear()
  const { usageRows } = await import('../src/usageLedger.mjs')
  const unregister = registerLocalAgentExecutor(async () => ({ answer: '完成', usage: { at: '2026-11-28T01:00:00Z', rounds: [{ model:'m', vendorId:'v', vendor:'供应商', subscription:false, promptTokens:12, completionTokens:4 }] } }))
  try {
    const created = await request('/api/agent/runs', { person:'a', prompt:'统计' })
    await wait()
    const run = (await request('/api/agent/runs/' + created.run.id)).run
    const rows = usageRows([{ messages:[{ role:'assistant', usage:run.usage }] }])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].tokens, 16)
    assert.equal(rows[0].calls, 1)
    assert.equal(rows[0].vendor, '供应商')
  } finally { unregister() }
})

test('大量历史运行不因新建任务被截断，账本按助手统计全部记录', async () => {
  values.clear()
  const { localAgentUsageMessages } = await import('../src/localAgentRuns.mjs')
  const rows = Array.from({ length: 501 }, (_, i) => ({ id:'old-'+i, assistantId:'a', status:'succeeded', usage:{ model:'m', promptTokens:1, completionTokens:1 } }))
  values.set('ai-home.local.agentRuns', JSON.stringify(rows))
  const unregister = registerLocalAgentExecutor(async () => ({ answer:'完成', usage:{ model:'m', promptTokens:2, completionTokens:1 } }))
  try {
    const created = await request('/api/agent/runs', { person:'a', prompt:'新任务' })
    await wait()
    assert.equal((await request('/api/agent/runs/' + created.run.id)).run.status, 'succeeded')
    assert.equal(JSON.parse(values.get('ai-home.local.agentRuns')).length, 502)
    assert.equal(localAgentUsageMessages('a').length, 502)
    assert.equal(localAgentUsageMessages('b').length, 0)
  } finally { unregister() }
})

test('运行失败或取消后保留供应商已返回的用量，不虚构未返回的用量', async () => {
  values.clear()
  const { reportLocalAgentUsage, localAgentUsageMessages } = await import('../src/localAgentRuns.mjs')
  let finish
  const unregister = registerLocalAgentExecutor((run, signal) => new Promise((resolve, reject) => {
    reportLocalAgentUsage(run.id, { model:'m', promptTokens:12, completionTokens:3 })
    finish = () => reject(new Error('中断'))
    signal.addEventListener('abort', finish, { once:true })
  }))
  try {
    const created = await request('/api/agent/runs', { person:'a', prompt:'任务' })
    await wait()
    await request('/api/agent/runs/' + created.run.id + '/cancel', {})
    await wait()
    const run = (await request('/api/agent/runs/' + created.run.id)).run
    assert.equal(run.status, 'cancelled')
    assert.equal(run.usage.promptTokens, 12)
    assert.deepEqual(localAgentUsageMessages('a')[0].usage, run.usage)
  } finally { unregister() }
})
