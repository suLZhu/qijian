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

test('更新配置时并发请求共用新连接，即使旧连接仍在关闭', async () => {
  let finishClose
  let opens = 0
  const closed = new Promise(resolve => { finishClose = resolve })
  const pool = createMcpConnectionPool({ createClient: async () => {
    const id = ++opens
    return { client: { id, close: async () => { if (id === 1) await closed } } }
  } })
  await pool.use('x', 'old', {}, c => c.id)
  const ids = await Promise.all([pool.use('x', 'new', {}, c => c.id), pool.use('x', 'new', {}, c => c.id)])
  finishClose()
  await pool.close()
  assert.deepEqual(ids, [2, 2])
})
