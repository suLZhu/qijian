// Local run lifecycle; the actual model executor is supplied by the app.
// A run is never reported as successful before that executor returns a result.
const KEY = 'ai-home.local.agentRuns'
const active = new Map()
const listeners = new Set()
let execute = null
let externalBusy = () => false

function storage() {
  if (typeof localStorage === 'undefined') throw new Error('本地运行记录存储不可用')
  return localStorage
}
function read() {
  const raw = storage().getItem(KEY)
  if (!raw) return []
  const rows = JSON.parse(raw)
  if (!Array.isArray(rows)) throw new Error('本地运行记录格式无效')
  return rows
}
function write(rows) { storage().setItem(KEY, JSON.stringify(rows)) }
function publish(type, run) {
  const event = { type, at: new Date().toISOString(), runId: run.id, assistantId: run.assistantId, status: run.status }
  for (const listener of [...listeners]) { try { listener(event) } catch { /* isolated listener */ } }
}
function update(id, changes) {
  const rows = read()
  const index = rows.findIndex(row => row.id === id)
  if (index < 0) throw new Error('运行记录不存在')
  const run = { ...rows[index], ...changes, updatedAt: new Date().toISOString() }
  rows[index] = run
  write(rows)
  return run
}

export function registerLocalAgentExecutor(handler, busy = () => false) {
  if (typeof handler !== 'function') throw new TypeError('执行器无效')
  execute = handler
  externalBusy = busy
  return () => { if (execute === handler) { execute = null; externalBusy = () => false } }
}
// Called only by the single Android main WebView after a restart. Never retry a
// request whose upstream outcome is unknown; retain partial usage and answer.
export function recoverInterruptedLocalAgentRuns() {
  const rows = read()
  const at = new Date().toISOString()
  const recovered = []
  const next = rows.map(run => {
    if (run?.status !== 'running' || active.has(run.id)) return run
    const interrupted = { ...run, status: 'failed', errorCode: 'INTERRUPTED', errorMessage: '应用上次运行中断，执行结果未知，请检查后手动重试。', updatedAt: at, finishedAt: at }
    recovered.push(interrupted)
    return interrupted
  })
  if (recovered.length) {
    write(next)
    for (const run of recovered) publish('run_finished', run)
  }
  return recovered.length
}
export function isLocalAgentBusy(person) {
  return [...active.values()].some(item => item.person === person) || !!externalBusy(person)
}
export function subscribeLocalAgentEvents(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function listLocalAgentRuns(person = '', limit = 30) {
  const count = Math.max(1, Math.min(500, Number(limit) || 30))
  return read().filter(row => !person || row.assistantId === person).slice(0, count)
}
export function getLocalAgentRun(id) { return read().find(row => row.id === id) || null }
export function localAgentUsageMessages(person) {
  return read().filter(run => run.assistantId === person && run.usage && Object.keys(run.usage).length > 0).map(run => ({ role: 'assistant', usage: run.usage }))
}
// Persist only usage actually reported by the provider, including partial failed runs.
export function reportLocalAgentUsage(id, usage) {
  const item = active.get(id)
  if (!item || !usage || typeof usage !== 'object') return false
  const run = update(id, { usage })
  publish('run_usage', run)
  return true
}
export function startLocalAgentRun({ person, prompt, source = 'manual', conversationId = '', internal = false }) {
  // Preserve the existing honest error until the app has registered its executor.
  if (!execute) throw new Error('本地 Agent 执行器尚未接入')
  person = String(person || '').trim()
  prompt = String(prompt || '').trim()
  if (!person || person.length > 120) throw new Error('人物身份无效')
  if (!prompt || prompt.length > 20000) throw new Error('任务内容需为 1 至 20000 字')
  if (source !== 'manual' && !(internal === true && ['proactive', 'scheduled', 'hearing'].includes(source))) throw new Error('不支持此运行来源')
  if ([...active.values()].some(item => item.person === person)) throw new Error('当前助手已有任务正在执行')
  const id = crypto.randomUUID(), at = new Date().toISOString()
  const run = { id, assistantId: person, source, conversationId: String(conversationId || ''), prompt, answer: '', rounds: 0, toolCalls: 0, status: 'running', usage: {}, model: '', createdAt: at, updatedAt: at, finishedAt: null }
  const rows = read()
  // Preserve historical runs: provider-reported usage is part of the ledger.
  write([run, ...rows])
  const controller = new AbortController()
  active.set(id, { controller, person })
  publish('run_created', run)
  const handler = execute
  Promise.resolve().then(() => {
    controller.signal.throwIfAborted()
    return handler(run, controller.signal)
  }).then(result => {
    if (controller.signal.aborted) throw controller.signal.reason || new DOMException('已取消', 'AbortError')
    if (!result || typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('执行器没有返回有效结果')
    const finished = update(id, { status: 'succeeded', answer: result.answer, usage: result.usage || {}, model: String(result.model || ''), rounds: Number(result.rounds) || 0, toolCalls: Number(result.toolCalls) || 0, finishedAt: new Date().toISOString() })
    publish('run_finished', finished)
  }).catch(error => {
    try {
      const cancelled = controller.signal.aborted
      const finished = update(id, { status: cancelled ? 'cancelled' : 'failed', errorCode: cancelled ? 'cancelled' : 'execution_failed', errorMessage: cancelled ? '运行已取消' : String(error?.message || error || '执行失败').slice(0, 500), finishedAt: new Date().toISOString() })
      publish('run_finished', finished)
    } catch { /* storage failure must not pretend the result was persisted */ }
  }).finally(() => active.delete(id))
  return run
}
export function cancelLocalAgentRun(id) {
  const run = getLocalAgentRun(id)
  if (!run) return null
  const item = active.get(id)
  if (item) item.controller.abort(new DOMException('运行已取消', 'AbortError'))
  return { ok: true, accepted: Boolean(item) || run.status !== 'running', status: run.status }
}
