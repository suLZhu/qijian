import test from 'node:test'
import assert from 'node:assert/strict'
import { subscriptionOperations } from '../src/subscriptionOperations.mjs'
const quota = subscriptionOperations.get('/api/subscription/quota')
test('按账号查询额度并保留零值、缺失值及上游错误', async () => {
  const get = (channelId, data) => quota({ channelId, token: 'test', accountId: 'acct' }, async (url, { headers }) => {
    assert.equal(headers.Authorization, 'Bearer test')
    if (channelId === 'gpt') assert.equal(headers['chatgpt-account-id'], 'acct')
    return Response.json(data)
  })
  assert.deepEqual((await get('gpt', { rate_limit: { primary_window: { used_percent: 100, reset_at: 1800000000 } } })).data.windows, [{ label: '主额度', remaining: 0, reset: new Date(1800000000000).toISOString() }])
  assert.deepEqual((await get('claude', { five_hour: { utilization: 0 }, seven_day: { utilization: null } })).data.windows, [{ label: '5 小时', remaining: 100, reset: null }])
  assert.equal((await get('grok', { config: { creditUsagePercent: 78 } })).data.windows[0].remaining, 22)
  assert.match((await quota({ channelId: 'claude', token: 'test' }, async () => new Response('', { status: 403 }))).data.error, /403/)
})
