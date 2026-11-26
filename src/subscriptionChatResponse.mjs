import { subscriptionProtocolConfig } from './server/subscriptionChat.mjs'

const json = (status, body) => Response.json(body, { status })

function subscriptionSink(controller, streaming) {
  const encoder = new TextEncoder()
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 }, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let text = ''
  let tools = []
  let finish = 'stop'
  const write = payload => {
    if (!streaming || !controller) return
    try { controller.enqueue(encoder.encode('data: ' + JSON.stringify(payload) + '\n\n')) } catch { /* 客户端已断开 */ }
  }
  return {
    text(delta) {
      const chunk = String(delta || '')
      if (!chunk) return
      text += chunk
      write({ choices: [{ index: 0, delta: { content: chunk } }] })
    },
    setTools(list, reason) {
      tools = Array.isArray(list) ? list.filter(tool => tool && tool.name) : []
      if (reason) finish = reason
      if (!tools.length) return
      write({ choices: [{ index: 0, delta: { tool_calls: tools.map((tool, i) => ({ index: i, id: tool.id || 'call_' + i, type: 'function', function: { name: tool.name, arguments: tool.args || '{}' } })) } }] })
    },
    setUsage(value) {
      if (!value) return
      if (value.prompt_tokens != null) usage.prompt_tokens = Number(value.prompt_tokens) || 0
      if (value.completion_tokens != null) usage.completion_tokens = Number(value.completion_tokens) || 0
      if (value.cached_tokens != null) usage.prompt_tokens_details.cached_tokens = Number(value.cached_tokens) || 0
      if (value.cache_creation_input_tokens != null) usage.cache_creation_input_tokens = Number(value.cache_creation_input_tokens) || 0
      if (value.cache_read_input_tokens != null) {
        usage.cache_read_input_tokens = Number(value.cache_read_input_tokens) || 0
        usage.prompt_tokens_details.cached_tokens = usage.cache_read_input_tokens
      }
      usage.total_tokens = value.total_tokens != null ? (Number(value.total_tokens) || 0) : usage.prompt_tokens + usage.completion_tokens
    },
    finish() {
      if (!streaming || !controller) return
      write({ choices: [{ index: 0, delta: {}, finish_reason: tools.length ? 'tool_calls' : finish }] })
      write({ choices: [], usage })
      try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) } catch { /* 已断开 */ }
    },
    result() {
      const message = { role: 'assistant', content: tools.length ? null : text }
      if (tools.length) message.tool_calls = tools.map((tool, i) => ({ index: i, id: tool.id || 'call_' + i, type: 'function', function: { name: tool.name, arguments: tool.args || '{}' } }))
      return {
        id: 'chatcmpl-local-sub', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: '',
        choices: [{ index: 0, message, finish_reason: tools.length ? 'tool_calls' : finish }],
        usage,
      }
    },
  }
}

export async function subscriptionChatResponse(b, init, fetchImpl) {
  const protocol = String(b.subscriptionProtocol || '')
  const config = subscriptionProtocolConfig(protocol, String(b.apiKey || ''), String(b.subscriptionAccountId || ''))
  if (!config) return json(400, { error: '未知的订阅聊天协议' })
  if (!b.body || typeof b.body !== 'object') return json(400, { error: '缺少请求体' })
  const request = config.build(b.body)
  const requestController = new AbortController()
  const abort = () => requestController.abort(init.signal.reason)
  if (init?.signal?.aborted) abort()
  else init?.signal?.addEventListener('abort', abort, { once: true })
  const cleanup = () => init?.signal?.removeEventListener('abort', abort)
  let upstream
  try {
    upstream = await fetchImpl(config.url, {
      method: 'POST', headers: config.headers, body: JSON.stringify(request), signal: requestController.signal,
    })
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text()).slice(0, 400)
      cleanup()
      return json(upstream.ok ? 502 : upstream.status, { error: '订阅接口返回 HTTP ' + upstream.status + (detail ? ' · ' + detail : '') })
    }
  } catch (error) {
    cleanup()
    if (init?.propagateNetworkFailure) throw error
    return json(502, { error: error.message || '订阅网络请求失败' })
  }
  async function* responseBytes() {
    const reader = upstream.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      cleanup()
    }
  }
  const stream = responseBytes()
  if (b.body.stream === false) {
    const sink = subscriptionSink(null, false)
    try { await config.convert(stream, sink); return json(200, sink.result()) }
    catch (error) { return json(502, { error: error instanceof Error ? error.message : '订阅接口返回错误' }) }
  }
  const encoder = new TextEncoder()
  const responseStream = new ReadableStream({
    start(controller) {
      const sink = subscriptionSink(controller, true)
      config.convert(stream, sink).then(() => {
        sink.finish()
        try { controller.close() } catch { /* 已断开 */ }
      }).catch(error => {
        try {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: error instanceof Error ? error.message : '订阅接口返回错误' }) + '\n\n'))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch { /* 已断开 */ }
        try { controller.close() } catch { /* 已断开 */ }
      })
    },
    cancel() { requestController.abort(); cleanup() },
  })
  return new Response(responseStream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store' } })
}
