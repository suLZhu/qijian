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
