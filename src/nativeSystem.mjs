// Android 原生系统能力桥的 JS 侧通道（与 AiHomeOAuth 同一套 WebView JS 接口）。
// 桌面浏览器没有原生层：所有调用都安静返回 false / null，绝不伪造权限状态或通知。
// 390×844 探针可以注入同名 mock 桥来验证完整链路。

import { systemSettingTarget } from './systemCapabilities.mjs'
import { genDebug } from './generationDebug.mjs'

const BRIDGE = 'AiHomeSystem'
const CALLBACKS = {
  open: '__aihomeNotificationOpen',
  task: '__aihomeTaskFire',
  status: '__aihomeSystemStatusChanged',
}

function bridge() {
  try {
    const b = globalThis[BRIDGE]
    return b && typeof b.status === 'function' ? b : null
  } catch { return null }
}

export function systemBridgeAvailable() { return !!bridge() }

function parse(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return null }
}

export function readSystemCapabilities() { return parse(bridge()?.status?.()) }

/** 只把「要跳哪个系统页」告诉原生层；目标 token 在 Java 侧有白名单，不接受任意 Intent。 */
export function openSystemSetting(id, ok = false, sdk = 0) {
  const b = bridge()
  if (!b || typeof b.open !== 'function') return false
  const action = systemSettingTarget(id, ok, sdk)
  try { b.open(JSON.stringify({ key: String(id), action, ok: !!ok })); return true } catch { return false }
}

export function nativeHttpStreamAvailable() {
  const b = bridge()
  return !!b && typeof b.modelHttp === 'function'
}

export function directModelFetch(url, options = {}) {
  return bridge() ? fetchThroughBridge('direct', url, options) : fetch(url, options)
}

export function subscriptionModelFetch(url, options = {}) {
  return fetchThroughBridge('subscription', url, options)
}

async function fetchThroughBridge(policy, url, { method = 'GET', headers, body, signal } = {}) {
  const b = bridge()
  if (!nativeHttpStreamAvailable()) throw new Error('需要支持模型网络分流的 App 原生网络桥，请更新 APK 或连接栖间服务器')
  signal?.throwIfAborted()
  install()
  const id = 'model-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  return new Promise((resolve, reject) => {
    let controller
    const cleanup = () => {
      streamCallbacks.delete(id)
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const stop = () => {
      cleanup()
      try { b.httpStreamCancel(id) } catch { /* 请求可能已结束 */ }
    }
    const fail = error => {
      stop()
      controller.error(error)
      reject(error)
    }
    const abort = () => fail(signal.reason || new DOMException('请求已取消', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('等待模型接口响应超时')), 30000)
    const stream = new ReadableStream({ start(c) { controller = c }, cancel: stop })
    signal?.addEventListener('abort', abort, { once: true })
    streamCallbacks.set(id, event => {
      try {
        if (event.type === 'start') {
          const status = Number(event.status)
          const noBody = [204, 205, 304].includes(status)
          resolve(new Response(noBody ? null : stream, { status, headers: event.headers }))
          clearTimeout(timer)
        } else if (event.type === 'chunk') {
          controller.enqueue(Uint8Array.from(atob(event.bytes), ch => ch.charCodeAt(0)))
        } else if (event.type === 'done') {
          cleanup()
          controller.close()
        } else if (event.type === 'error') {
          fail(new Error(event.message || '原生网络请求失败'))
        }
      } catch (error) { fail(error) }
    })
    try {
      b.modelHttp(id, policy, method, String(url), JSON.stringify(Object.fromEntries(new Headers(headers))), String(body ?? ''))
    } catch (error) { fail(error) }
  })
}

export function nativeHttpPost(url, headers = {}, body = '') {
  const b = bridge()
  if (!b || typeof b.httpPost !== 'function') return null
  try { return parse(b.httpPost(String(url || ''), JSON.stringify(headers || {}), String(body || ''))) } catch { return null }
}

export function openNativeWebView(url, title = '') {
  const b = bridge()
  if (!b || typeof b.openWebView !== 'function') return false
  try { return b.openWebView(String(url || ''), String(title || '')) === true } catch { return false }
}

export function openExternalUrl(url) {
  const b = bridge()
  if (!b || typeof b.openUrl !== 'function') return false
  try { b.openUrl(String(url || '')); return true } catch { return false }
}

export function appVersion() {
  const b = bridge()
  if (b && typeof b.appVersion === 'function') {
    try { return String(b.appVersion() || '') } catch { /* 回退 */ }
  }
  return '3.8'
}

export async function readClipboardText() {
  const b = bridge()
  if (b && typeof b.readClipboard === 'function') {
    try {
      const text = String(b.readClipboard() || '')
      if (text) return text
    } catch { /* 原生剪贴板不可用，退回 Web API */ }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      return String(await navigator.clipboard.readText() || '')
    }
  } catch { /* 需要用户手势或权限 */ }
  return ''
}

export function nativeHttpGet(url, headers = {}) {
  const b = bridge()
  if (!b || typeof b.httpGet !== 'function') return null
  try { return parse(b.httpGet(String(url || ''), JSON.stringify(headers || {}))) } catch { return null }
}

export function setGenerationForeground(payload) {
  const b = bridge()
  if (!b || typeof b.generation !== 'function') return false
  // 真机证据：FGS 请求（实际启动由原生 onStartCommand 记 Log.i "AiHome:gen"）。
  if (payload && payload.action === 'start') genDebug('fgs_requested', { assistantId: payload.assistantId, conversationId: payload.conversationId, messageId: payload.messageId })
  try { return b.generation(JSON.stringify(payload || {})) === true } catch { return false }
}

/** 原生 WebView textZoom：系统字号 × App 内倍数，整站文字等比缩放（微信式「字体大小」）。 */
export function nativeTextZoomAvailable() {
  const b = bridge()
  return !!b && typeof b.textZoom === 'function'
}

export function setAppTextZoom(scalePercent) {
  const b = bridge()
  if (!b || typeof b.textZoom !== 'function') return false
  const factor = Number(scalePercent) / 100
  if (!Number.isFinite(factor) || factor <= 0) return false
  try { return b.textZoom(JSON.stringify({ factor })) === true } catch { return false }
}

// ── 备份文件：固定写手机「下载/栖间/」（原生 MediaStore / 文件） ─────────────
export function backupFilesAvailable() {
  const b = bridge()
  return !!b && typeof b.saveBackup === 'function' && typeof b.listBackups === 'function'
}

export function saveBackupFile(name, content) {
  const b = bridge()
  if (!b || typeof b.saveBackup !== 'function') return null
  try { return parse(b.saveBackup(String(name || ''), String(content || ''))) } catch { return null }
}

export function listBackupFiles() {
  const b = bridge()
  if (!b || typeof b.listBackups !== 'function') return []
  try {
    const data = parse(b.listBackups())
    return Array.isArray(data?.files) ? data.files.filter(f => f && typeof f.name === 'string') : []
  } catch { return [] }
}

export function readBackupFile(name) {
  const b = bridge()
  if (!b || typeof b.readBackup !== 'function') return null
  try { return parse(b.readBackup(String(name || ''))) } catch { return null }
}

export function deleteBackupFile(name) {
  const b = bridge()
  if (!b || typeof b.deleteBackup !== 'function') return false
  try { return parse(b.deleteBackup(String(name || '')))?.ok === true } catch { return false }
}

export function showSystemNotification(payload) {
  const b = bridge()
  if (!b || typeof b.notify !== 'function' || !payload || !payload.key) return false
  try { return b.notify(JSON.stringify(payload)) === true } catch { return false }
}

export function clearConversationNotifications(person, conversationId = '') {
  const b = bridge()
  if (!b || typeof b.clearConversationNotifications !== 'function' || !person) return false
  try { b.clearConversationNotifications(String(person), String(conversationId || '')); return true } catch { return false }
}

export function syncSystemChannels(channels) {
  const b = bridge()
  if (!b || typeof b.syncChannels !== 'function') return false
  try { b.syncChannels(JSON.stringify({ channels: Array.isArray(channels) ? channels : [] })); return true } catch { return false }
}

export function syncSystemAlarms(plan) {
  const b = bridge()
  if (!b || typeof b.syncAlarms !== 'function') return null
  try { return parse(b.syncAlarms(JSON.stringify({ tasks: Array.isArray(plan) ? plan : [] }))) } catch { return null }
}

/** 冷启动：通知点击时 WebView 还没起来，原生层把 payload 存住，等页面来取。 */
export function consumePendingOpen() {
  if (unhandledOpen) {
    const payload = unhandledOpen
    unhandledOpen = null
    return payload
  }
  const b = bridge()
  if (!b || typeof b.pendingOpen !== 'function') return null
  try { return parse(b.pendingOpen()) } catch { return null }
}

export function readNativeDelivered() {
  const b = bridge()
  if (!b || typeof b.deliveredKeys !== 'function') return []
  try {
    const value = parse(b.deliveredKeys())
    return Array.isArray(value) ? value.map(String) : []
  } catch { return [] }
}

// ── 原生 → JS 的三个回调：允许多个订阅者（App 与设置页各注册一份） ───────────
const handlers = new Set()
const streamCallbacks = new Map()
let installed = false
// 原生 onResume 可能早于 React 挂载：没人接住的通知点击先存在这里，
// App 挂载时 consumePendingOpen() 会优先取走，绝不丢一次点击。
let unhandledOpen = null

function emit(type, payload) {
  let handled = false
  for (const h of [...handlers]) {
    try {
      if (type === 'open') { if (h.onOpen) { h.onOpen(payload); handled = true } }
      else if (type === 'task') h.onTaskFire?.(payload)
      else h.onStatusChanged?.()
    } catch { /* 单个订阅者出错不影响其它 */ }
  }
  if (type === 'open' && !handled && payload) unhandledOpen = payload
}

function install() {
  if (installed) return
  installed = true
  try {
    globalThis[CALLBACKS.open] = (payload) => emit('open', parse(payload) || payload)
    globalThis[CALLBACKS.task] = (runId) => emit('task', String(runId ?? ''))
    globalThis[CALLBACKS.status] = () => emit('status')
    globalThis.__aihomeHttpStream = (id, payload) => {
      const callback = streamCallbacks.get(String(id || ''))
      if (callback) callback(parse(payload) || payload)
    }
    // 部分 ROM 从通知回前台不派发 visibilitychange：onResume 由原生补调一次，
    // 这里主动取走冷启动 / 热启动期间攒下的通知点击，只路由一次。
    globalThis.__aihomeSystemResume = () => {
      const pending = consumePendingOpen()
      if (pending) emit('open', pending)
    }
  } catch { /* 桌面无 window 时忽略 */ }
}

export function registerSystemHandlers(handler) {
  install()
  handlers.add(handler)
  return () => handlers.delete(handler)
}
