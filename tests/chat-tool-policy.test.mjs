import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeChatTool } from '../src/chatToolPolicy.mjs'

const reply = policies => new Response(JSON.stringify({ policies }), { headers: { 'Content-Type': 'application/json' } })
test('工具策略 auto 放行、deny 拒绝，按助手读取', async () => {
  let url = ''
  const options = { person: 'assistant/a', tool: 'ledger_add_entry', fetchPolicy: async path => { url = path; return reply([]) }, confirm: async () => { throw Error('不应询问') } }
  await authorizeChatTool(options)
  assert.match(url, /assistant%2Fa/)
  options.fetchPolicy = async () => reply([{ tool: 'ledger_add_entry', mode: 'deny' }])
  await assert.rejects(authorizeChatTool(options), /禁止/)
})
test('ask 必须确认且确认后重新检查权限', async () => {
  let reads = 0
  const options = { person: 'a', tool: 'web_search', fetchPolicy: async () => reply([{ tool: 'web_search', mode: ++reads === 1 ? 'ask' : 'deny' }]), confirm: async () => true }
  await assert.rejects(authorizeChatTool(options), /改为禁止/)
  assert.equal(reads, 2)
  options.fetchPolicy = async () => reply([{ tool: 'web_search', mode: 'ask' }])
  options.confirm = async () => false
  await assert.rejects(authorizeChatTool(options), /拒绝/)
})
test('权限读取异常或确认后取消不能执行', async () => {
  const controller = new AbortController()
  const options = { person: 'a', tool: 'x', signal: controller.signal, fetchPolicy: async () => reply([{ tool: 'x', mode: 'ask' }]), confirm: async () => { controller.abort(); return true } }
  await assert.rejects(authorizeChatTool(options), { name: 'AbortError' })
  await assert.rejects(authorizeChatTool({ ...options, signal: undefined, fetchPolicy: async () => new Response('', { status: 500 }) }), /无法读取/)
})
