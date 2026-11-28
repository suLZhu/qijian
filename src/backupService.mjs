import {apiFetch, isLocalMode} from './apiBase.mjs'
import {backupKind, collectBackupLocal, makeBackupEnvelope, backupFileName} from './backups.mjs'
import {collectBackupIndexed} from './backupIndexed.mjs'
import {backupFilesAvailable, saveBackupFile, readBackupFile} from './nativeSystem.mjs'

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
  if (!localMode && kind.serverMemory) {
    const memory = {}
    await Promise.all((people || []).map(async person => {
      const records = []
      for (let offset = 0; ; offset += 500) {
        if (offset > 1000000) throw new Error('记忆数量超出备份上限')
        const response = await fetchApi('/api/memory/records?person=' + encodeURIComponent(person) + '&limit=500&offset=' + offset, {credentials:'include'})
        if (!response.ok) throw new Error('助手记忆读取失败，备份未保存')
        const data = await response.json()
        if (!Array.isArray(data?.records)) throw new Error('助手记忆数据无效，备份未保存')
        records.push(...data.records)
        if (data.records.length < 500) break
      }
      memory[person] = records
    }))
    server.memory = memory
  }
  const payload = makeBackupEnvelope(kindId, collectBackupLocal(storage, kindId), server)
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
