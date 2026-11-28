// Enforce the same per-assistant tool policy used by agent runs before a chat tool executes.
export async function authorizeChatTool({ person, tool, signal, fetchPolicy, confirm }) {
  signal?.throwIfAborted()
  const load = async () => {
    const response = await fetchPolicy('/api/agent/policies?person=' + encodeURIComponent(person), { credentials: 'include', signal })
    if (!response.ok) throw new Error('无法读取工具权限，已停止调用')
    const data = await response.json()
    if (!Array.isArray(data?.policies)) throw new Error('工具权限数据无效，已停止调用')
    const item = data.policies.find(policy => policy?.tool === tool)
    const mode = item?.mode ?? 'auto'
    if (!['auto', 'ask', 'deny'].includes(mode)) throw new Error('工具权限数据无效，已停止调用')
    return mode
  }
  let mode = await load()
  signal?.throwIfAborted()
  if (mode === 'deny') throw new Error('工具权限策略禁止了这次调用')
  if (mode === 'ask') {
    if (!await confirm(tool)) throw new Error('用户拒绝了这次工具调用')
    signal?.throwIfAborted()
    mode = await load()
    signal?.throwIfAborted()
    if (mode === 'deny') throw new Error('工具权限已改为禁止，已停止调用')
  }
}
