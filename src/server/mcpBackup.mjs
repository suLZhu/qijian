import { normalizeMcpHeaders } from '../mcpCredentials.mjs'

// MCP 备份包含原始服务编号、绑定与凭据；密钥仅在导出文件中明文，目标服务端重新加密。
export function exportMcpBackup(db, readCredentials) {
  const services = db.prepare('SELECT * FROM mcp_connections ORDER BY id').all().map(row => ({
    id:row.id, name:row.name, url:row.url, transport:row.transport, enabled:!!row.enabled,
    credentials:(() => { const c=readCredentials(row); return {token:c.token,headers:normalizeMcpHeaders(c.headers)} })(), updatedAt:row.updated_at,
  }))
  const bindings = db.prepare('SELECT person,connection_id,created_at FROM mcp_bindings ORDER BY person,connection_id').all()
    .map(row => ({person:row.person,connectionId:row.connection_id,createdAt:row.created_at}))
  return {version:1,services,bindings}
}

// 调用方负责总事务，任何坏条目或编号冲突都令整次恢复回滚。
export function restoreMcpBackup(db, backup, {encrypt, validateUrl, validPerson}) {
  if (!backup || backup.version !== 1 || !Array.isArray(backup.services) || !Array.isArray(backup.bindings) || backup.services.length > 2000 || backup.bindings.length > 100000) throw new Error('MCP 备份格式无效')
  const ids=new Set(), normalized=[]
  for (const item of backup.services) {
    if (!item || !/^[0-9a-f-]{36}$/i.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || item.transport !== 'httpStream' || typeof item.enabled !== 'boolean') throw new Error('MCP 服务备份无效')
    ids.add(item.id)
    const remote=validateUrl(String(item.url || '')).toString(), credentials=item.credentials
    if (!credentials || typeof credentials !== 'object' || typeof credentials.token !== 'string' || credentials.token.length > 8192) throw new Error('MCP 凭据备份无效')
    const headers=normalizeMcpHeaders(credentials.headers)
    const existing=db.prepare('SELECT url FROM mcp_connections WHERE id=?').get(item.id)
    if (existing && existing.url !== remote) throw new Error('MCP 服务编号冲突')
    normalized.push({ ...item, url:remote, credentials:{token:credentials.token,headers}, updatedAt:Number.isFinite(Date.parse(item.updatedAt || '')) ? item.updatedAt : new Date().toISOString() })
  }
  const bindingKeys=new Set()
  for (const item of backup.bindings) {
    if (!item || !validPerson(item.person) || !/^[0-9a-f-]{36}$/i.test(item.connectionId) || (!ids.has(item.connectionId) && !db.prepare('SELECT id FROM mcp_connections WHERE id=?').get(item.connectionId))) throw new Error('MCP 助手绑定备份无效')
    const key=item.person+'\0'+item.connectionId
    if (bindingKeys.has(key)) throw new Error('MCP 助手绑定重复')
    bindingKeys.add(key)
  }
  const put=db.prepare('INSERT INTO mcp_connections (id,name,url,transport,enabled,token_enc,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,transport=excluded.transport,enabled=excluded.enabled,token_enc=excluded.token_enc,updated_at=excluded.updated_at')
  for (const item of normalized) put.run(item.id,item.name,item.url,item.transport,item.enabled?1:0,encrypt(JSON.stringify(item.credentials)),item.updatedAt)
  const bind=db.prepare('INSERT OR IGNORE INTO mcp_bindings (person,connection_id,created_at) VALUES (?,?,?)')
  for (const item of backup.bindings) bind.run(item.person,item.connectionId,Number.isFinite(Date.parse(item.createdAt || '')) ? item.createdAt : new Date().toISOString())
  return normalized.map(item=>item.id)
}
