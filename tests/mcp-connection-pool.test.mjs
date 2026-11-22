import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpConnectionPool } from '../src/server/mcpConnectionPool.mjs'

test('MCP 复用同一连接，并发首次初始化只连接一次', async () => {
  let opens = 0
  let closes = 0
  const pool = createMcpConnectionPool({ createClient: async () => {
    opens++
    await Promise.resolve()
    return { client: { listTools: async () => ['示例工具'], close: async () => { closes++ } } }
  } })
  const both = await Promise.all([
    pool.use('one','v1',{}, c => c.listTools()),
    pool.use('one','v1',{}, c => c.listTools()),
  ])
  assert.deepEqual(both, [['示例工具'],['示例工具']])
  assert.equal(opens,1)
  await pool.close()
  assert.equal(closes,1)
})

test('更新配置后清理旧连接、后续重新连接', async () => {
  let opens=0, closes=0
  const pool=createMcpConnectionPool({ createClient: async () => ({ client: {
    id: ++opens, close: async () => { closes++ },
  } }) })
  assert.equal(await pool.use('x','v1',{},c=>c.id),1)
  assert.equal(await pool.use('x','v2',{},c=>c.id),2)
  assert.equal(closes,1)
  await pool.drop('x')
  assert.equal(closes,2)
  await pool.close()
})

test('失败的调用不自动重试，但下一次可重建连接', async () => {
  let opens=0
  const pool=createMcpConnectionPool({ createClient: async () => ({client:{
    id: ++opens, close: async () => {},
  }}) })
  await assert.rejects(() => pool.use('x','v1',{},async()=>{throw new Error('断开')}), /断开/)
  assert.equal(opens,1)
  assert.equal(await pool.use('x','v1',{},c=>c.id),2)
  await pool.close()
})

test('配置替换时并发请求共享新连接，旧调用失败不关闭新连接', async () => {
  let opens = 0
  let finishOldClose
  const oldClose = new Promise(resolve => { finishOldClose = resolve })
  let failOldOperation
  const oldOperation = new Promise((_, reject) => { failOldOperation = reject })
  const pool = createMcpConnectionPool({ createClient: async () => {
    const id = ++opens
    return { client: { id, close: async () => { if (id === 1) await oldClose } } }
  } })
  const first = pool.use('one', 'old', {}, () => oldOperation)
  const rejected = assert.rejects(first, /旧调用失败/)
  await Promise.resolve()
  const replacements = await Promise.all([
    pool.use('one', 'new', {}, client => client.id),
    pool.use('one', 'new', {}, client => client.id),
  ])
  assert.deepEqual(replacements, [2, 2])
  failOldOperation(new Error('旧调用失败'))
  await rejected
  assert.equal(await pool.use('one', 'new', {}, client => client.id), 2)
  finishOldClose()
  await pool.close()
})
