import { performSubscriptionLogin } from './subscriptionLogin.mjs'
import { exchangeOAuthCode, refreshTokenRequest } from './subscriptionOAuth.mjs'

const result = (status, data) => ({ status, data })

async function login(b, subscriptionFetch) {
  try {
    const credentials = await performSubscriptionLogin({
      endpoint: b.endpoint, loginPath: b.loginPath, tokenPath: b.tokenPath,
      username: b.username, password: b.password, fetchImpl: subscriptionFetch,
    })
    return result(200, credentials)
  } catch (error) {
    return result(502, { error: error?.message || '订阅号登录失败' })
  }
}

async function exchange(b, subscriptionFetch) {
  try {
    const credentials = await exchangeOAuthCode({
      channelId: b.channelId, code: b.code, codeVerifier: b.codeVerifier,
      state: b.state, userAgent: 'anthropic', fetchImpl: subscriptionFetch,
    })
    return result(200, credentials)
  } catch (error) {
    return result(502, { error: error?.message || '授权码换令牌失败' })
  }
}

async function refresh(b, subscriptionFetch) {
  try {
    const { channelId, refreshToken } = b
    const request = refreshTokenRequest(channelId, refreshToken)
    const upstream = await subscriptionFetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(15000) })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok || !data?.access_token) return result(502, { error: '订阅续期失败 · ' + (data?.error || 'HTTP ' + upstream.status) })
    return result(200, { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in })
  } catch (error) {
    return result(502, { error: error.message || '订阅续期失败' })
  }
}

async function codexModels(b, subscriptionFetch) {
  try {
    const token = String(b.token || '').trim()
    if (!token) return result(400, { error: '缺少订阅令牌' })
    const accountId = String(b.accountId || '').trim()
    const headers = {
      Authorization: 'Bearer ' + token,
      originator: 'codex_cli_rs',
      'User-Agent': 'codex_cli_rs/0.167.1 (Qijian Android)',
      Accept: 'application/json',
    }
    if (accountId) headers['chatgpt-account-id'] = accountId
    const upstream = await subscriptionFetch('https://chatgpt.com/backend-api/codex/models?client_version=0.167.1', {
      headers, redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      return result(502, { error: 'Codex 模型目录 HTTP ' + upstream.status + (text ? ' · ' + text.slice(0, 180) : '') })
    }
    let data
    try { data = JSON.parse(text) } catch { return result(502, { error: 'Codex 模型目录返回的不是 JSON' }) }
    const rows = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : []
    const models = rows
      .filter(row => row && typeof row === 'object')
      .map(row => ({
        id: String(row.slug || row.id || '').trim(),
        visibility: String(row.visibility || '').trim().toLowerCase(),
        priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : Number.MAX_SAFE_INTEGER,
      }))
      .filter(row => row.id && row.visibility !== 'hide' && row.visibility !== 'hidden')
      .sort((a, b2) => a.priority - b2.priority || a.id.localeCompare(b2.id))
    if (!models.length) return result(502, { error: 'Codex 模型目录没有返回可用模型' })
    return result(200, { models: models.map(row => row.id) })
  } catch (error) {
    const msg = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || '请求失败')
    return result(502, { error: '无法连接 Codex 模型目录：' + msg })
  }
}

async function startDeviceLogin(b, subscriptionFetch) {
  try {
    if (String(b.channel || '') !== 'grok') return result(400, { error: '这个渠道不支持设备码' })
    const form = new URLSearchParams({
      client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
      scope: 'openid profile email offline_access grok-cli:access api:access',
    })
    const upstream = await subscriptionFetch('https://auth.x.ai/oauth2/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()
    let data
    try { data = JSON.parse(text) } catch { data = {} }
    if (!upstream.ok) return result(502, { error: 'xAI 设备码 HTTP ' + upstream.status + (text ? ' · ' + text.slice(0, 180) : '') })
    if (!data.device_code || !data.user_code) return result(502, { error: 'xAI 没有返回设备码' })
    return result(200, data)
  } catch (error) {
    const msg = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || '请求失败')
    return result(502, { error: '无法连接 xAI：' + msg })
  }
}

async function pollDeviceLogin(b, subscriptionFetch) {
  try {
    if (String(b.channel || '') !== 'grok') return result(400, { error: '这个渠道不支持设备码' })
    const deviceCode = String(b.deviceCode || '').trim()
    if (!deviceCode) return result(400, { error: '缺少设备码' })
    const form = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
      device_code: deviceCode,
    })
    const upstream = await subscriptionFetch('https://auth.x.ai/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()
    let data
    try { data = JSON.parse(text) } catch { data = {} }
    return result(upstream.status, data.error ? data : { ...data, status: upstream.status })
  } catch (error) {
    const msg = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || '请求失败')
    return result(502, { error: '无法连接 xAI：' + msg })
  }
}

async function claudeModels(b, subscriptionFetch) {
  try {
    const token = String(b.token || '').trim()
    if (!token) return result(400, { error: '缺少订阅令牌' })
    const betas = [
      'claude-code-20250219', 'oauth-2025-04-20', 'interleaved-thinking-2025-05-14',
      'redact-thinking-2026-02-12', 'context-management-2025-06-27',
      'prompt-caching-scope-2026-01-05', 'mid-conversation-system-2026-04-07',
      'advanced-tool-use-2025-11-20', 'effort-2025-11-24', 'extended-cache-ttl-2025-04-11',
    ].join(',')
    const upstream = await subscriptionFetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': betas,
        'anthropic-dangerous-direct-browser-access': 'true',
        'User-Agent': 'claude-cli/2.1.280 (external, cli)',
        'x-app': 'cli',
        Accept: 'application/json',
      },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()
    if (!upstream.ok) return result(502, { error: 'Claude 模型目录 HTTP ' + upstream.status + (text ? ' · ' + text.slice(0, 180) : '') })
    let data
    try { data = JSON.parse(text) } catch { return result(502, { error: 'Claude 模型目录返回的不是 JSON' }) }
    const rows = Array.isArray(data?.data) ? data.data : []
    const ids = rows.map(row => String(row?.id || '').trim()).filter(Boolean)
    if (!ids.length) return result(502, { error: 'Claude 模型目录没有返回可用模型' })
    return result(200, { models: ids })
  } catch (error) {
    const msg = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || '请求失败')
    return result(502, { error: '无法连接 Claude 模型目录：' + msg })
  }
}

async function grokModels(b, subscriptionFetch) {
  try {
    const token = String(b.token || '').trim()
    if (!token) return result(400, { error: '缺少订阅令牌' })
    const headers = {
      Authorization: 'Bearer ' + token,
      'X-XAI-Token-Auth': 'xai-grok-cli',
      Accept: 'application/json',
      'User-Agent': 'qijian/2.2',
    }
    const urls = ['https://cli-chat-proxy.grok.com/v1/models-v2', 'https://api.x.ai/v1/models']
    const results = await Promise.all(urls.map(async target => {
      try {
        const r = await subscriptionFetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) })
        const text = await r.text()
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + (text ? ' · ' + text.slice(0, 120) : '') }
        return { ok: true, data: JSON.parse(text) }
      } catch (error) { return { ok: false, error: error?.message || '请求失败' } }
    }))
    const ids = new Set()
    for (const result of results) {
      if (!result.ok) continue
      const rows = Array.isArray(result.data?.data) ? result.data.data : []
      for (const row of rows) {
        if (!row) continue
        if (typeof row === 'string') { ids.add(row); continue }
        if (row.hidden === true) continue
        const id = String(row.id || row.model || row.modelId || row.slug || '').trim()
        if (id) ids.add(id)
      }
    }
    if (!ids.size) {
      const reason = results.find(r => !r.ok)?.error || '没有返回可用模型'
      return result(502, { error: 'Grok 模型目录：' + reason })
    }
    return result(200, { models: [...ids] })
  } catch (error) {
    const msg = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || '请求失败')
    return result(502, { error: '无法连接 Grok 模型目录：' + msg })
  }
}

export const subscriptionOperations = new Map([
  ['/api/subscription/login', login],
  ['/api/subscription/oauth/exchange', exchange],
  ['/api/subscription/oauth/refresh', refresh],
  ['/api/codex/models', codexModels],
  ['/api/oauth/device/start', startDeviceLogin],
  ['/api/oauth/device/poll', pollDeviceLogin],
  ['/api/claude/models', claudeModels],
  ['/api/grok/models', grokModels],
])
