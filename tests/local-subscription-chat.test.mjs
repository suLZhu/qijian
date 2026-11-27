// 本地模式订阅聊天：原生流式桥 → 本地后端转换 → 前端拿到的 Chat Completions。
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { localHandle } from '../src/localBackend.mjs'
import { registerSystemHandlers } from '../src/nativeSystem.mjs'

registerSystemHandlers({})
after(() => { delete globalThis.AiHomeSystem })

function fakeBridge(sse) {
  globalThis.AiHomeSystem = {
    status: () => JSON.stringify({ sdk: 34, notifications: true, lockScreen: true, background: true, battery: true, overlay: true, exactAlarm: true, fullScreen: true, bootRestore: true, alarm: {} }),
    modelHttp: (id, policy, method) => {
      assert.equal(policy, 'subscription')
      assert.equal(method, 'POST')
      setTimeout(() => {
        globalThis.__aihomeHttpStream(id, JSON.stringify({ type: 'start', status: 200 }))
        globalThis.__aihomeHttpStream(id, JSON.stringify({ type: 'chunk', bytes: Buffer.from(sse).toString('base64') }))
        globalThis.__aihomeHttpStream(id, JSON.stringify({ type: 'done', status: 200 }))
      }, 0)
    },
  }
}

const sse = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'

test('本地模式：原生桥把 Anthropic SSE 转成 Chat Completions（非流式）', async () => {
  fakeBridge(sse)
  const res = await localHandle('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      subscriptionProtocol: 'anthropic', apiKey: 'token', body: {
        model: 'claude-test', stream: false, messages: [{ role: 'user', content: '你好' }],
      },
    }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.choices[0].message.content, '好')
})

test('本地模式：流式响应仍然逐段输出并以 [DONE] 结束', async () => {
  fakeBridge(sse)
  const res = await localHandle('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      subscriptionProtocol: 'anthropic', apiKey: 'token', body: {
        model: 'claude-test', stream: true, messages: [{ role: 'user', content: '你好' }],
      },
    }),
  })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.match(text, /"content":"好"/)
  assert.match(text, /data: \[DONE\]/)
})

test('本地模式没有原生桥时明确拒绝，而不是假装成功', async () => {
  delete globalThis.AiHomeSystem
  const res = await localHandle('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ subscriptionProtocol: 'claude', apiKey: 'token', body: { model: 'x', messages: [] } }),
  })
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.match(data.error, /原生网络桥/)
})

test('代理在响应头前失败时返回 502，同名模型在普通中转仍能直连', async () => {
  const policies = []
  globalThis.AiHomeSystem = {
    status: () => '{}',
    modelHttp(id, policy) {
      policies.push(policy)
      const emit = event => globalThis.__aihomeHttpStream(id, JSON.stringify(event))
      if (policy === 'subscription') return emit({ type: 'error', message: '未配置订阅代理' })
      emit({ type: 'start', status: 200 })
      emit({ type: 'chunk', bytes: Buffer.from('中转回复').toString('base64') })
      emit({ type: 'done' })
    },
  }
  const body = { model: 'same-model', stream: true, messages: [] }
  const post = params => localHandle('/api/chat', { method: 'POST', body: JSON.stringify({ apiKey: 'test', body, ...params }) })
  const subscription = await post({ subscriptionProtocol: 'anthropic' })
  assert.equal(subscription.status, 502)
  assert.match((await subscription.json()).error, /订阅代理/)
  const relay = await post({ endpoint: 'https://relay.example/v1' })
  assert.equal(await relay.text(), '中转回复')
  assert.deepEqual(policies, ['subscription', 'direct'])
})

test('设备码、续期和订阅模型目录全部通过策略桥，普通模型目录走直连', async () => {
  const calls = []
  globalThis.AiHomeSystem = {
    status: () => '{}',
    modelHttp(id, policy, method, url) {
      calls.push({ policy, method, url })
      const data = { models: [{ slug: 'z', priority: 3 }, { slug: 'hidden', visibility: 'hidden' }],
        data: [{ id: 'z' }], access_token: 'new-token', token: 'test-token-value',
        device_code: 'device', user_code: 'user', status: 200 }
      for (const event of [{ type: 'start', status: 200 },
        { type: 'chunk', bytes: Buffer.from(JSON.stringify(data)).toString('base64') }, { type: 'done' }]) {
        globalThis.__aihomeHttpStream(id, JSON.stringify(event))
      }
    },
  }
  for (const [path, body] of [
    ['/api/subscription/login', { endpoint: 'https://vendor.example', username: 'a', password: 'b' }],
    ['/api/subscription/oauth/exchange', { channelId: 'gpt', code: 'test', codeVerifier: 'verifier' }],
    ['/api/subscription/oauth/refresh', { channelId: 'gpt', refreshToken: 'test' }],
    ['/api/oauth/device/start', { channel: 'grok' }],
    ['/api/oauth/device/poll', { channel: 'grok', deviceCode: 'test' }],
    ...['codex', 'claude', 'grok'].map(name => ['/api/' + name + '/models', { token: 'test' }]),
    ['/api/models', { accountType: 'subscription', endpoint: 'https://vendor.example', apiKey: 'test' }],
    ['/api/models', { endpoint: 'https://vendor.example', apiKey: 'test' }],
  ]) {
    const response = await localHandle(path, { method: 'POST', body: JSON.stringify(body) })
    const data = await response.json()
    assert.equal(response.status, 200, path + ': ' + JSON.stringify(data))
    if (path.endsWith('/models')) assert.deepEqual(data.models, ['z'])
  }
  assert.deepEqual(calls.map(c => c.policy), [...Array(10).fill('subscription'), 'direct'])
})

test('旧版通用桥不承接订阅请求，取消请求会通知原生层', async () => {
  const { subscriptionModelFetch } = await import('../src/nativeSystem.mjs')
  globalThis.AiHomeSystem = { status: () => '{}', httpStream() { assert.fail('调用了旧桥') } }
  await assert.rejects(subscriptionModelFetch('https://example.org'), /网络桥/)
  let requestId, cancelled
  globalThis.AiHomeSystem.modelHttp = id => { requestId = id }
  globalThis.AiHomeSystem.httpStreamCancel = id => { cancelled = id }
  const controller = new AbortController()
  const pending = subscriptionModelFetch('https://example.org', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(requestId)
  assert.equal(cancelled, requestId)
})
