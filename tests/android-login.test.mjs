// Android 局域网登录链路验收：
// A) 客户端（apiBase.mjs）：token 存取、apiFetch 附加 Authorization、assetUrl 跨源拼 ?token=；
// B) 服务端（真实拉起 src/server.mjs 子进程）：三凭证通道（Cookie/Bearer/查询参数）、
//    跨域 CORS 放行与预检、注销即失效、错误 Origin 仍被 CSRF 拒绝。
// 与正式数据隔离：一次性 SQLite（AI_HOME_DB 指到临时目录），测完即删。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createDecipheriv } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiFetch, assetUrl, clearSessionToken, getSessionToken, setSessionToken } from '../src/apiBase.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PW = 'android-login-test-pw-123456'
const SECRET = 'ab'.repeat(32)
const WEBVIEW_ORIGIN = 'https://localhost'

// node 环境没有 localStorage：装一个最小桩（本文件独立进程，不影响其他套件）。
const store = new Map()
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: key => { store.delete(key) },
  clear: () => store.clear(),
}

// ── A) 客户端单测 ──────────────────────────────────────────────────────────

test('客户端：token 存取与清除', () => {
  clearSessionToken()
  assert.equal(getSessionToken(), '')
  setSessionToken('tok-abc')
  assert.equal(getSessionToken(), 'tok-abc')
  setSessionToken('')          // 空 token 不写入
  assert.equal(getSessionToken(), 'tok-abc')
  clearSessionToken()
  assert.equal(getSessionToken(), '')
})

test('客户端：apiFetch 有 token 时附加 Authorization，且不改写调用方 init', async () => {
  setSessionToken('tok-abc')
  const calls = []
  const stub = async (url, opts) => { calls.push({ url, opts }); return { ok: true } }

  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' }
  const snapshot = JSON.stringify(init)
  await apiFetch('/api/login', init, stub)
  assert.equal(JSON.stringify(init), snapshot, 'init 必须原样不被改')
  assert.equal(calls[0].url, '/api/login')
  assert.equal(calls[0].opts.credentials, 'include')
  assert.equal(calls[0].opts.headers.get('Authorization'), 'Bearer tok-abc')
  assert.equal(calls[0].opts.body, '{"a":1}')

  // 调用方已自带 Authorization：原样透传、不覆盖（此时不构造 Headers）
  await apiFetch('/api/x', { headers: { authorization: 'Bearer custom' } }, stub)
  assert.equal(calls[1].opts.headers.authorization, 'Bearer custom')

  // 无 token：请求与历史版本逐字节一致（不产生 headers）
  clearSessionToken()
  await apiFetch('/api/y', { method: 'GET' }, stub)
  assert.equal(calls[2].opts.headers, undefined)
  assert.equal(calls[2].opts.credentials, 'include')
})

test('客户端：assetUrl 跨源拼 ?token=，同源与 data: 不受影响', () => {
  setSessionToken('tok abc+/')   // 含特殊字符 → 必须 URL 编码
  const base = 'http://192.168.1.5:4180'
  assert.equal(
    assetUrl('/api/attachments/1', base),
    `${base}/api/attachments/1?token=tok%20abc%2B%2F`,
    '跨源 /api/ 路径要带查询参数凭证'
  )
  assert.equal(assetUrl('/api/attachments/1', ''), '/api/attachments/1', '同源仍走 Cookie，不加 token')
  assert.equal(assetUrl('data:image/png;base64,xx', base), 'data:image/png;base64,xx', 'data: 原样')
  assert.equal(assetUrl('https://cdn.example/a.png', base), 'https://cdn.example/a.png', '外部 URL 原样')
  clearSessionToken()
})

// ── B) 服务端集成（真实进程） ──────────────────────────────────────────────

let child = null
let dbDir = ''
let BASE = ''

function freePort() {
  return new Promise((res, rej) => {
    const probe = createServer()
    probe.once('error', rej)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close(() => res(port))
    })
  })
}

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'ai-home-lan-'))
  const port = await freePort()
  BASE = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      QIJIAN_SUBSCRIPTION_PROXY: '',
      AI_HOME_PASSWORD: PW,
      AI_HOME_SECRET_KEY: SECRET,
      AI_HOME_DB: join(dbDir, 'test.sqlite'),
      AI_HOME_ALLOWED_ORIGIN: WEBVIEW_ORIGIN,
      AI_HOME_PORT: String(port),
      AI_HOME_BIND: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const deadline = Date.now() + 30000
  let ready = false
  while (Date.now() < deadline && !ready) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${stderr}`)
    try {
      const res = await fetch(`${BASE}/api/session`)
      if (res.status) ready = true
    } catch { /* 还没监听 */ }
    if (!ready) await new Promise(r => setTimeout(r, 150))
  }
  if (!ready) throw new Error(`服务启动超时：${stderr}`)
})

after(() => {
  try { if (child) child.kill() } catch { /* 已退出 */ }
  try { if (dbDir) rmSync(dbDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

async function login(origin) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ password: PW }),
  })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

test('服务端：登录同时返回 Cookie 与 token（默认 SameSite=Strict 不变）', async () => {
  const { status, body, headers } = await login()
  assert.equal(status, 200)
  assert.equal(body.authenticated, true)
  assert.match(body.token, /^[0-9a-f]{64}$/, 'token 为 32 字节 hex')
  const setCookie = headers.get('set-cookie') || ''
  assert.match(setCookie, /ai_home_session=/)
  assert.match(setCookie, /SameSite=Strict/, '未配置时默认仍是 Strict（Web 历史行为）')
  assert.match(setCookie, /HttpOnly/)
})

test('服务端：Bearer 头可访问受保护接口，无凭证/坏 token 拒绝', async () => {
  const token = (await login()).body.token
  assert.equal((await fetch(`${BASE}/api/keys`, { headers: { Authorization: `Bearer ${token}` } })).status, 200)
  assert.equal((await fetch(`${BASE}/api/session`, { headers: { Authorization: `Bearer ${token}` } })).status, 200)
  assert.equal((await fetch(`${BASE}/api/keys`)).status, 401, '无凭证401')
  assert.equal((await fetch(`${BASE}/api/keys`, { headers: { Authorization: 'Bearer deadbeef' } })).status, 401, '坏 token401')
})

test('服务端：?token= 查询参数通道（EventSource / <img> 用）', async () => {
  const token = (await login()).body.token
  assert.equal((await fetch(`${BASE}/api/keys?token=${token}`)).status, 200)
  assert.equal((await fetch(`${BASE}/api/keys?token=deadbeef`)).status, 401)
})

test('服务端：Android WebView 源（https://localhost）跨域登录放行 + CORS 头', async () => {
  const { status, headers } = await login(WEBVIEW_ORIGIN)
  assert.equal(status, 200, 'Origin 命中 AI_HOME_ALLOWED_ORIGIN → 不再被 CSRF 拒绝')
  assert.equal(headers.get('access-control-allow-origin'), WEBVIEW_ORIGIN)
  assert.equal(headers.get('access-control-allow-credentials'), 'true')
})

test('服务端：预检含 Authorization 放行与私有网络许可头', async () => {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: WEBVIEW_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), WEBVIEW_ORIGIN)
  assert.match((res.headers.get('access-control-allow-headers') || '').toLowerCase(), /authorization/)
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true')
})

test('服务端：陌生 Origin 的写请求仍被403（CSRF 不因 CORS 放开）', async () => {
  const { status } = await login('https://evil.example')
  assert.equal(status, 403)
})

test('服务端：密码错误401（限流计数不误伤后续登录）', async () => {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'definitely-wrong-pw' }),
  })
  assert.equal(res.status, 401)
  assert.equal((await login()).status, 200)
})

test('服务端：Bearer 注销后同一 token 立即失效', async () => {
  const token = (await login()).body.token
  assert.equal((await fetch(`${BASE}/api/keys`, { headers: { Authorization: `Bearer ${token}` } })).status, 200)
  const out = await fetch(`${BASE}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(out.status, 200)
  assert.equal((await fetch(`${BASE}/api/keys`, { headers: { Authorization: `Bearer ${token}` } })).status, 401)
})

test('服务端 MCP 改名与换令牌保留同址服务、原有请求头和绑定 ID', async t => {
  const headers = { Authorization: 'Bearer ' + (await login()).body.token, 'Content-Type': 'application/json' }
  const request = (path, method, body) => fetch(BASE + '/api/mcp' + path, {
    method, headers, body: body && JSON.stringify(body),
  })
  const config = { name: 'Garden', url: 'https://example.org/mcp', headers: { 'X-Workspace': 'garden' } }
  const ids = []
  for (const token of ['alpha', 'beta']) {
    const res = await request('', 'POST', { ...config, token })
    assert.equal(res.status, 201)
    ids.push((await res.json()).connection.id)
  }
  t.after(async () => { for (const id of ids) await request('/' + id, 'DELETE') })
  const person = 'assistant-yanweixi'
  assert.equal((await request('/bindings', 'PUT', { person, connectionIds: [ids[1]] })).status, 200)
  assert.equal((await request('/' + ids[1], 'PUT', { name: 'B Garden' })).status, 200)
  assert.equal((await request('/' + ids[1], 'PUT', { token: 'new-beta' })).status, 200)
  assert.equal((await request('/' + ids[0], 'DELETE')).status, 200)
  assert.deepEqual((await (await request('/bindings?person=' + person, 'GET')).json()).connectionIds, [ids[1]])
  const db = new DatabaseSync(join(dbDir, 'test.sqlite'), { readOnly: true })
  try {
    const row = db.prepare('SELECT name, token_enc FROM mcp_connections WHERE id=?').get(ids[1])
    assert.equal(row.name, 'B Garden')
    const [iv, tag, ciphertext] = row.token_enc.split(':').map(value => Buffer.from(value, 'hex'))
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(SECRET, 'hex'), iv)
    cipher.setAuthTag(tag)
    const saved = JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString())
    assert.deepEqual(saved, { token: 'new-beta', headers: config.headers })
  } finally { db.close() }
})

test('服务端订阅续期与兼容目录缺代理时返回原因，普通目录仍能访问中转', async () => {
  const { createServer } = await import('node:http')
  const target = createServer((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'same-model' }] })) })
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
  try {
    const endpoint = 'http://127.0.0.1:' + target.address().port
    const headers = { Authorization: 'Bearer ' + (await login()).body.token, 'Content-Type': 'application/json' }
    const post = (path, args) => fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(args) })
    for (const [path, data] of [
      ['/api/subscription/oauth/refresh', { channelId: 'gpt', refreshToken: 'test-token' }],
      ['/api/models', { accountType: 'subscription', endpoint, apiKey: 'test-token' }],
    ]) {
      const response = await post(path, data)
      assert.equal(response.status, 502)
      assert.match((await response.json()).error, /订阅.*代理/)
    }
    const direct = await post('/api/models', { endpoint, apiKey: 'test-key' })
    assert.equal(direct.status, 200)
    assert.deepEqual((await direct.json()).models, ['same-model'])
  } finally { target.close() }
})

test('恢复事务遇到无效记忆时撤回已写入的 Key 和记忆', async () => {
  const person = 'assistant-yanweixi'
  const token = (await login()).body.token
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  const readKeys = async () => (await (await fetch(BASE + '/api/keys', { headers })).json()).keys
  const before = await readKeys()
  const restore = memory => fetch(BASE + '/api/backups/restore', {
    method: 'POST', headers,
    body: JSON.stringify({ keys: { [person]: 'restore-test-key' }, memory: { [person]: memory } }),
  })
  const record = { id: 'restore-rollback-test', title: '测试恢复', content: '事务测试' }
  assert.equal((await restore([record, {}])).status, 400)
  assert.deepEqual(await readKeys(), before)
  const readRecords = async () => (await (await fetch(BASE + '/api/memory/records?person=' + person, { headers })).json()).records
  assert.equal((await readRecords()).some(item => item.id === record.id), false)
  assert.equal((await restore([record])).status, 200)
  assert.equal((await readKeys())[person], 'restore-test-key')
  assert.equal((await readRecords()).some(item => item.id === record.id), true)
})

test('服务器附件备份恢复：鉴权、原 ID、字节校验和事务回滚', async () => {
  const headers = { Authorization: 'Bearer ' + (await login()).body.token, 'Content-Type': 'application/json' }
  const img='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  assert.equal((await fetch(BASE+'/api/backups/attachments')).status,401)
  const upload=await fetch(BASE+'/api/attachments',{method:'POST',headers,body:JSON.stringify({name:'测试.png',mime:'image/png',data:img})})
  assert.equal(upload.status,201)
  const {id}=await upload.json()
  const list=await (await fetch(BASE+'/api/backups/attachments',{headers})).json()
  const record={...list.attachments.find(x=>x.id===id),data:img}
  const keysBefore=(await (await fetch(BASE+'/api/keys',{headers})).json()).keys
  const bad=await fetch(BASE+'/api/backups/restore',{method:'POST',headers,body:JSON.stringify({keys:{'assistant-yanweixi':'should-rollback'},attachments:[{...record,sha256:'0'.repeat(64)}]})})
  assert.equal(bad.status,400)
  assert.deepEqual((await (await fetch(BASE+'/api/keys',{headers})).json()).keys,keysBefore)
  assert.equal((await fetch(BASE+'/api/attachments/'+id,{method:'DELETE',headers})).status,200)
  const restored=await fetch(BASE+'/api/backups/restore',{method:'POST',headers,body:JSON.stringify({attachments:[record]})})
  assert.equal(restored.status,200)
  assert.equal((await restored.json()).attachmentsRestored,1)
  assert.equal(Buffer.from(await (await fetch(BASE+'/api/attachments/'+id,{headers})).arrayBuffer()).toString('base64'),img)
})
