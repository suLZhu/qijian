// 验证 MCP 自定义请求头；凭据只用于请求或显式备份，不出现在普通列表。
export function normalizeMcpHeaders(raw) {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 30) throw new Error('MCP 自定义请求头格式无效')
  const headers = {}
  for (const [key,value] of Object.entries(raw)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || typeof value !== 'string' || value.length > 2048 || /[\r\n]/.test(value)) throw new Error('MCP 自定义请求头格式无效')
    headers[key] = value
  }
  return headers
}
