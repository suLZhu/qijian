// 在本机和服务器之间恢复时转换记忆、密钥，保留当前连接模式。
const MEMORY_KEY = 'ai-home.local.memoryRecords'
const KEY_KEY = 'ai-home.apiKey'
const BASE_KEY = 'ai-home.apiBaseOverride'
const validPerson = x => typeof x === 'string' && /^assistant-[a-zA-Z0-9-]{4,}$/.test(x) && x.length <= 64
const validId = x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)
function parseObject(raw, fallback) {
  if (raw == null) return fallback
  try { return JSON.parse(raw) } catch { throw new Error('备份中的本机数据格式无效') }
}
export function backupStorageMode(payload, kind) {
  const mode = payload?.data?.storageMode
  if (mode === 'local' || mode === 'server') return mode
  const server = payload?.data?.server
  if (server && ['keys','memory','attachments','mcp'].some(key=>Object.hasOwn(server,key))) return 'server'
  if (['full','memory','models','mcp'].includes(kind)) return 'local'
  return ''
}
export function prepareBackupStorage(payload, kind, local, targetLocal) {
  const out = {...local}, sourceMode = backupStorageMode(payload, kind), targetMode = targetLocal ? 'local' : 'server'
  const crossMode = !!sourceMode && sourceMode !== targetMode
  const server = {...(payload?.data?.server || {})}
  if (!crossMode) return {local:out,server,crossMode}
  delete out[BASE_KEY]
  // 另一模式的内部快照不能覆盖刚恢复的会话与设置。
  delete out['ai-home.local.state']
  delete out['ai-home.local.stateUpdatedAt']
  if (kind === 'full' || kind === 'memory') {
    const own = parseObject(out[MEMORY_KEY], [])
    if (!Array.isArray(own)) throw new Error('本机记忆备份格式无效')
    const remote = server.memory ?? {}
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('服务器记忆备份格式无效')
    const rows = new Map()
    function add(record, owner) {
      if (!record || !validPerson(owner) || !validId(record.id) || (record.person && record.person !== owner) || typeof record.title !== 'string' || !record.title.trim() || record.title.length > (targetLocal ? 160 : 120) || typeof record.content !== 'string' || !record.content.trim() || record.content.length > 4000 || !['candidate','active','archived','rejected'].includes(record.lifecycle) || !['world','private','ops'].includes(record.scope)) throw new Error('备份记忆格式不兼容当前模式，未恢复')
      if (record.embedding != null && (!Array.isArray(record.embedding) || !record.embedding.length || record.embedding.length > 4096 || !record.embedding.every(Number.isFinite))) throw new Error('备份记忆向量无效')
      const old=rows.get(record.id)
      if (old) {
        const fields = ['person','title','content','lifecycle','scope','keywords','category','sourceConversationId','sourceRunId','occurredAt','createdBy','sourceMessageIds']
        if (fields.some(key => old[key] !== undefined && record[key] !== undefined && JSON.stringify(old[key]) !== JSON.stringify(record[key])) || old.person !== owner) throw new Error('备份中记忆编号冲突，未恢复')
        if (old.embedding && record.embedding && (JSON.stringify(old.embedding) !== JSON.stringify(record.embedding) || (old.embedModel && record.embedModel && old.embedModel !== record.embedModel))) throw new Error('备份中记忆向量冲突，未恢复')
      }
      rows.set(record.id,{...(old || {}),...record,person:owner,embedding:record.embedding ?? old?.embedding,embedModel:record.embedding ? record.embedModel : old?.embedModel})
    }
    for (const record of own) add(record,record?.person)
    for (const [person,list] of Object.entries(remote)) {
      if (!validPerson(person) || !Array.isArray(list)) throw new Error('服务器记忆备份格式无效')
      for (const record of list) add(record,person)
    }
    if (targetLocal) {
      if (rows.size > 2000) throw new Error('服务器记忆超过本机容量，不能安全迁移')
      out[MEMORY_KEY] = JSON.stringify([...rows.values()])
    } else {
      const memory = {}
      for (const record of rows.values()) (memory[record.person] ||= []).push(record)
      server.memory = memory
    }
  }
  if (kind === 'full' || kind === 'models') {
    const keys = parseObject(out[KEY_KEY], {})
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('本机密钥备份格式无效')
    const remote = server.keys ?? {}
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) throw new Error('服务器密钥备份格式无效')
    for (const [person,key] of Object.entries({...keys,...remote})) if (!validPerson(person) || typeof key !== 'string' || key.length > 8192) throw new Error('备份密钥格式无效')
    if (targetLocal) out[KEY_KEY] = JSON.stringify({...keys,...remote})
    else server.keys = {...keys,...remote}
  }
  return {local:out,server,crossMode}
}
