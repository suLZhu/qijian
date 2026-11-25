import test from 'node:test'
import assert from 'node:assert/strict'
import { outboundPolicy, checkOutboundPolicy } from '../src/server/outboundPolicy.mjs'

test('subscription protocols use the subscription proxy route regardless of model name', () => {
  for (const subscriptionProtocol of ['codex', 'anthropic', 'grok']) {
    assert.equal(outboundPolicy({ subscriptionProtocol }), 'subscription-proxy')
  }
  assert.equal(outboundPolicy({ subscription: true }), 'subscription-proxy')
})

test('normal relay and domestic model endpoints stay direct', () => {
  assert.equal(outboundPolicy({}), 'direct')
  assert.equal(outboundPolicy({ subscriptionProtocol: '' }), 'direct')
})

test('missing proxy does not silently downgrade subscription to direct', () => {
  assert.equal(checkOutboundPolicy({ policy: 'subscription-proxy', proxyReady: false }).allowed, false)
  assert.equal(checkOutboundPolicy({ policy: 'subscription-proxy', proxyReady: true }).allowed, true)
  assert.equal(checkOutboundPolicy({ policy: 'direct', proxyReady: false }).allowed, true)
})

test('真实 HTTP 出口：订阅仅走 CONNECT，代理失效时直连服务仍能独立使用', async t => {
  const { createServer } = await import('node:http')
  const { connect } = await import('node:net')
  const { once } = await import('node:events')
  const { directFetch, subscriptionFetch } = await import('../src/server/outboundFetch.mjs')
  const previous = process.env.QIJIAN_SUBSCRIPTION_PROXY
  const sockets = new Set()
  const hits = []
  const origin = createServer((req, res) => { hits.push(req.url); res.end('ok') })
  const proxy = createServer()
  const tunnels = []
  let refuse = false
  proxy.on('connect', (req, client, head) => {
    tunnels.push(req.url)
    if (refuse) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const upstream = connect(origin.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client).pipe(upstream)
    })
    sockets.add(upstream)
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
  })
  t.after(() => {
    if (previous === undefined) delete process.env.QIJIAN_SUBSCRIPTION_PROXY
    else process.env.QIJIAN_SUBSCRIPTION_PROXY = previous
    for (const socket of sockets) socket.destroy()
    origin.close(); proxy.close()
  })
  for (const server of [origin, proxy]) {
    server.on('connection', socket => sockets.add(socket))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
  }
  const target = 'http://127.0.0.1:' + origin.address().port
  process.env.QIJIAN_SUBSCRIPTION_PROXY = 'http://127.0.0.1:' + proxy.address().port
  assert.equal(await (await subscriptionFetch(target + '/sub')).text(), 'ok')
  assert.deepEqual(tunnels, [new URL(target).host])
  assert.equal(await (await directFetch(target + '/api')).text(), 'ok')
  assert.equal(tunnels.length, 1)
  // Change proxy origin to force a new connection for the rejection case.
  process.env.QIJIAN_SUBSCRIPTION_PROXY += '/'
  refuse = true
  await assert.rejects(subscriptionFetch(target + '/blocked'), /订阅代理/)
  assert.equal(await (await directFetch(target + '/api-again')).text(), 'ok')
  delete process.env.QIJIAN_SUBSCRIPTION_PROXY
  await assert.rejects(subscriptionFetch(target + '/unconfigured'), /代理/)
  assert.deepEqual(hits, ['/sub', '/api', '/api-again'])
})
