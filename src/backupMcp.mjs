import { normalizeMcpHeaders } from './mcpCredentials.mjs'

// 跨模式时显式转换目录和助手绑定，遇到不兼容或冲突的数据停止恢复。
export function prepareBackupMcp(converted, kind, targetLocal) {
  if (!converted.crossMode || !['full', 'mcp'].includes(kind)) return converted
  const local = {...converted.local}, server = {...converted.server}
  const parse = (key, fallback) => { try { return local[key] == null ? fallback : JSON.parse(local[key]) } catch { throw new Error('MCP 本机备份格式无效') } }
  const own = parse('ai-home.local.mcp', []), ownBindings = parse('ai-home.local.mcpBindings', {})
  const remote = server.mcp ?? {version:1, services:[], bindings:[]}
  if (!Array.isArray(own) || !ownBindings || typeof ownBindings !== 'object' || Array.isArray(ownBindings) || remote.version !== 1 || !Array.isArray(remote.services) || !Array.isArray(remote.bindings)) throw new Error('MCP 备份格式无效')
  const services = new Map(), bindings = new Map()
  const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
  const validPerson = p => typeof p === 'string' && /^assistant-[a-zA-Z0-9-]{4,}$/.test(p) && p.length <= 64
  function add(item, source) {
    if (!item || !validId(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || (item.transport && item.transport !== 'httpStream') || typeof item.url !== 'string') throw new Error('MCP 服务备份格式无效')
    let url
    try { url = new URL(item.url) } catch { throw new Error('MCP 服务地址无效') }
    if (!['http:', 'https:'].includes(url.protocol) || (!targetLocal && url.protocol !== 'https:')) throw new Error('服务器模式仅支持 HTTPS MCP 地址，未恢复')
    const credentials = source === 'local' ? {token:item.token ?? '', headers:item.headers} : item.credentials
    if (!credentials || typeof credentials.token !== 'string' || credentials.token.length > 8192) throw new Error('MCP 凭据备份格式无效')
    const service = {id:item.id, name:item.name, url:url.toString(), transport:'httpStream', enabled:item.enabled !== false, credentials:{token:credentials.token, headers:normalizeMcpHeaders(credentials.headers)}, updatedAt:item.updatedAt ?? item.updated_at}
    const old = services.get(item.id)
    if (old && JSON.stringify({...old,updatedAt:undefined}) !== JSON.stringify({...service,updatedAt:undefined})) throw new Error('MCP 服务编号冲突，未恢复')
    services.set(item.id, service)
    if (item.person) bind(item.person,item.id)
  }
  function bind(person,id) {
    if (!validPerson(person) || !validId(id)) throw new Error('MCP 助手绑定备份无效')
    bindings.set(person+'\0'+id,{person,connectionId:id})
  }
  for (const item of own) add(item,'local')
  for (const item of remote.services) add(item,'server')
  for (const [person, ids] of Object.entries(ownBindings)) {
    if (!Array.isArray(ids)) throw new Error('MCP 助手绑定备份无效')
    for (const id of ids) bind(person,id)
  }
  for (const item of remote.bindings) bind(item?.person,item?.connectionId)
  for (const item of bindings.values()) if (!services.has(item.connectionId)) throw new Error('MCP 绑定的服务不存在，未恢复')
  if (targetLocal) {
    if (services.size > 200) throw new Error('MCP 服务超过本机容量，未恢复')
    local['ai-home.local.mcp'] = JSON.stringify([...services.values()].map(({credentials,updatedAt,...item}) => ({...item,...credentials,updated_at:updatedAt})))
    const result = {}
    for (const {person,connectionId} of bindings.values()) (result[person] ||= []).push(connectionId)
    local['ai-home.local.mcpBindings'] = JSON.stringify(result)
  } else server.mcp = {version:1,services:[...services.values()],bindings:[...bindings.values()]}
  return {...converted,local,server}
}
