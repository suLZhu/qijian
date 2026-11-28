import {apiFetch, isLocalMode} from './apiBase.mjs'
import {backupKind, collectBackupLocal, makeBackupEnvelope, backupFileName} from './backups.mjs'
import {collectBackupIndexed} from './backupIndexed.mjs'
import {backupFilesAvailable, saveBackupFile, readBackupFile} from './nativeSystem.mjs'

const MAX_SERVER_ATTACHMENT_BYTES = 36 * 1024 * 1024
async function collectServerAttachments(fetchApi) {
  const response = await fetchApi('/api/backups/attachments', {credentials:'include'})
  if (!response.ok) throw new Error('服务器不支持附件备份，请更新服务器后重试')
  const list = await response.json()
  if (list?.version !== 1 || !Array.isArray(list.attachments)) throw new Error('服务器附件列表无效')
  let total = 0
  const records = []
  for (const item of list.attachments) {
    if (!item || !/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isSafeInteger(item.size) || item.size <= 0 || !/^[0-9a-f]{64}$/.test(item.sha256 || '')) throw new Error('服务器附件信息无效')
    total += item.size
    if (total > MAX_SERVER_ATTACHMENT_BYTES) throw new Error('服务器附件超过单次备份上限，请先备份服务器数据库')
    const file = await fetchApi('/api/attachments/' + encodeURIComponent(item.id), {credentials:'include'})
    if (!file.ok) throw new Error('服务器附件读取失败，备份未保存')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length !== item.size) throw new Error('服务器附件长度不一致，备份未保存')
    if (!globalThis.crypto?.subtle) throw new Error('当前环境无法校验服务器附件，请使用安全连接')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
    if (hash !== item.sha256) throw new Error('服务器附件校验失败，备份未保存')
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    records.push({...item, data:btoa(binary)})
  }
  return records
}

// 统一手动备份与更新前备份的数据收集，读取失败即终止，不生成缺项的成功备份。
export async function buildBackupPayload(kindId, people, options = {}) {
  const kind = backupKind(kindId)
  if (!kind) throw new Error('未知备份类型')
  const storage = options.storage || localStorage
  const fetchApi = options.fetchApi || apiFetch
  const localMode = options.localMode ?? isLocalMode()
  const server = {}
  if (!localMode && kind.serverKeys) {
    const response = await fetchApi('/api/keys', {credentials:'include'})
    if (!response.ok) throw new Error('服务器 API Key 读取失败，备份未保存')
    const data = await response.json()
    if (!data?.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) throw new Error('服务器 API Key 数据无效，备份未保存')
    server.keys = data.keys
  }
  if (!localMode && kindId === 'full') {
    const response = await fetchApi('/api/backups/records', {credentials:'include'})
    if (!response.ok) throw new Error('服务器不支持任务、账本和日记备份，请更新服务器后重试')
    const records = await response.json()
    if (records?.version !== 1 || !records.tables || ['scheduled_tasks','ledger_entries','ledger_operations','diary_entries'].some(key => !Array.isArray(records.tables[key]))) throw new Error('服务器记录备份数据无效')
    server.records = records
  }
  if (!localMode && kind.serverMcp) {
    const response = await fetchApi('/api/backups/mcp', {credentials:'include'})
    if (!response.ok) throw new Error('服务器不支持 MCP 完整备份，请更新服务器后重试')
    const mcp = await response.json()
    if (mcp?.version !== 1 || !Array.isArray(mcp.services) || !Array.isArray(mcp.bindings)) throw new Error('服务器 MCP 备份数据无效')
    server.mcp = mcp
  }
  if (!localMode && kind.serverMemory) {
    const memory = {}
    await Promise.all((people || []).map(async person => {
      const records = []
      for (let offset = 0; ; offset += 500) {
        if (offset > 1000000) throw new Error('记忆数量超出备份上限')
        const response = await fetchApi('/api/memory/records?person=' + encodeURIComponent(person) + '&includeEmbedding=1&limit=500&offset=' + offset, {credentials:'include'})
        if (!response.ok) throw new Error('助手记忆读取失败，备份未保存')
        const data = await response.json()
        if (!Array.isArray(data?.records)) throw new Error('助手记忆数据无效，备份未保存')
        if (data.records.some(record => record?.hasEmbedding && (!Array.isArray(record.embedding) || !record.embedding.length || record.embedding.length > 4096 || !record.embedding.every(Number.isFinite)))) throw new Error('服务器未提供有效的记忆向量，请更新服务器后备份')
        records.push(...data.records)
        if (data.records.length < 500) break
      }
      memory[person] = records
    }))
    server.memory = memory
  }
  if (!localMode && (kindId === 'full' || kindId === 'chat')) server.attachments = await collectServerAttachments(fetchApi)
  if (new TextEncoder().encode(JSON.stringify(server)).length > 60 * 1024 * 1024) throw new Error('服务器数据超过单次恢复上限，请先备份服务器数据库')
  const payload = makeBackupEnvelope(kindId, collectBackupLocal(storage, kindId), server)
  payload.data.storageMode = localMode ? 'local' : 'server'
  if (kindId === 'full' || kindId === 'chat') payload.data.indexed = await (options.collectIndexed || collectBackupIndexed)(kindId)
  return payload
}

export async function savePreUpdateBackup(people, options = {}) {
  if (!(options.available || backupFilesAvailable)()) throw new Error('本机备份服务不可用，已取消更新')
  const payload = await (options.build || buildBackupPayload)('full', people)
  if (options.requiredState?.conversations && payload.data?.local?.['ai-home.conversations'] !== JSON.stringify(options.requiredState.conversations)) throw new Error('最新聊天尚未保存到本机，已取消更新，请稍后重试')
  if (options.verify && !options.verify()) throw new Error('备份期间数据发生变化，已取消更新，请重试')
  const content = JSON.stringify(payload)
  const unique = globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))
  const name = backupFileName('full').replace(/\.json$/, '-更新前-' + unique + '.json')
  const saved = (options.save || saveBackupFile)(name, content)
  if (!saved?.ok) throw new Error(saved?.error || '更新前备份写入失败')
  const actualName = saved.name || name
  const read = (options.read || readBackupFile)(actualName)
  if (!read?.ok || read.content !== content) throw new Error('更新前备份校验失败，已取消更新')
  if (options.verify && !options.verify()) throw new Error('备份期间数据发生变化，已取消更新，请重试')
  return actualName
}
