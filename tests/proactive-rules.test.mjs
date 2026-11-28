import test from 'node:test'
import assert from 'node:assert/strict'
import { decideProactiveWake } from '../src/proactiveRules.mjs'

const config = { enabled: 1, allow_chat: 1, quiet_start: 23, quiet_end: 8, interval_hours: 72, daily_wake_limit: 3, daily_token_limit: 1000, mode: 'natural' }
const now = new Date('2026-11-28T02:00:00Z')
const decide = extra => decideProactiveWake({ config, now, timeZone: 'Asia/Shanghai', ...extra })

test('跨夜免打扰按指定时区判断，手动唤醒也遵守', () => {
  assert.equal(decide({ now: new Date('2026-11-28T16:00:00Z'), manual: true }).reason, 'quiet_hours')
  assert.equal(decide({ timeZone: 'America/Los_Angeles', manual: true }).queued, true)
  assert.equal(decide({ manual: true }).queued, true)
})

test('每日数量、未知用量、额度和助手忙碌均阻止自动唤醒', () => {
  const events = Array.from({ length: 3 }, () => ({ created_at: now.toISOString(), status: 'done' }))
  assert.equal(decide({ events }).reason, 'daily_limit')
  assert.equal(decide({ usage: { tokens: 0, unknown: 1 } }).reason, 'usage_unavailable')
  assert.equal(decide({ usage: { tokens: 1000, unknown: 0 } }).reason, 'token_limit')
  assert.equal(decide({ isBusy: () => true }).reason, 'assistant_busy')
})

test('历史待处理事件和超过两天的冷却期不能遗漏', () => {
  const old = new Date(now.getTime() - 60 * 3600000).toISOString()
  assert.equal(decide({ events: [{ created_at: old, status: 'pending' }] }).reason, 'pending_exists')
  assert.equal(decide({ events: [{ created_at: old, status: 'done' }] }).reason, 'cooldown')
  assert.equal(decide({ events: [{ created_at: old, status: 'done' }], manual: true }).queued, true)
})

test('自主消息提示与沉默判断可由本地和服务端共用', async () => {
  const { proactivePrompt, isProactiveSilence } = await import('../src/proactivePrompt.mjs')
  assert.match(proactivePrompt('小晏', ''), /没有用户在和你说话/)
  assert.match(proactivePrompt('小晏', '读书'), /读书/)
  assert.equal(isProactiveSilence('沉默'), true)
  assert.equal(isProactiveSilence('[错误] 请求失败'), true)
  assert.equal(isProactiveSilence('你今天忙不忙？'), false)
})
