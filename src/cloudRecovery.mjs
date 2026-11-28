// 云端恢复链的纯决策层（第八阶段：数据安全）。
// 原则：有数据的一侧不能被空数据的一侧覆盖；不实现双向逐消息合并。
// App 启动流程 loadCloudState() 的每个分支都由 decideCloudLoadAction 判定，
// 覆盖前的本地备份由 shouldBackupBeforeApply + buildRecoveryBackup 决策。

// 覆盖前备份的 localStorage 键：云端优先恢复时，若本地存在云端没有的消息
// （典型是上次会话末尾保存失败的窗口），先把本地快照整体备份到这里再覆盖。
export const RECOVERY_BACKUP_KEY = 'ai-home.recoveryBackup.v1'

// HTTP 错误分类：401/403 是凭证问题（必须重新登录）；其余（网络断开、5xx、
// DNS 失败等）视为「云端暂不可用」——本地数据照常可用，云同步暂停等待重连。
export function classifyCloudLoadError(status) {
  return status === 401 || status === 403 ? 'auth' : 'network'
}

// conversations（Record<assistantId, Conversation[]>）里是否存在真实消息。
export function conversationsHaveData(convs) {
  if (!convs || typeof convs !== 'object') return false
  for (const key of Object.keys(convs)) {
    const list = convs[key]
    if (!Array.isArray(list)) continue
    if (list.some(c => c && Array.isArray(c.messages) && c.messages.length > 0)) return true
  }
  return false
}

// 全部助手的消息总数（备份差异判定用）。
export function countConversationMessages(convs) {
  if (!convs || typeof convs !== 'object') return 0
  let total = 0
  for (const key of Object.keys(convs)) {
    const list = convs[key]
    if (!Array.isArray(list)) continue
    for (const c of list) if (c && Array.isArray(c.messages)) total += c.messages.length
  }
  return total
}

// 启动决策：云端 GET /state 的结果 + 本地状态 → 唯一动作。
//   sign-out            凭证失效，回登录页（唯一允许打断进入的分支）
//   offline-keep-local  云端暂不可用：进入本地模式，cloudReady 保持 false，
//                       所有云写入路径被门控关闭，本地数据原样保留
//   apply-cloud         云端有快照：逐字段覆盖本地（云端优先，既有产品行为）
//   upload-local        云端无快照：把本机状态首次迁移上去
// 关键安全性质：cloudState 非空时永远不会返回 upload-local——
// 空本地/初始状态没有任何路径可以覆盖非空云端。
export function decideCloudLoadAction({ error, cloudState, _localHasData }) {
  if (error) return classifyCloudLoadError(error.status) === 'auth' ? 'sign-out' : 'offline-keep-local'
  // 云端有快照（哪怕只有主题配置）：走 apply-cloud，applySnapshot 逐字段
  // 「有才设」，缺 conversations/messages 的字段不会清掉本地对应部分。
  if (cloudState && typeof cloudState === 'object' && !Array.isArray(cloudState)) return 'apply-cloud'
  // 云端无快照：上传本机（新设备首次迁移 / 服务器空）。空云端本来就没有
  // 可覆盖的数据，本机即使是初始空状态也无害。
  return 'upload-local'
}

// 覆盖前备份判定：仅当本地有消息、且本地持有云端没有的内容时备份。
// 「本地消息更多」或「存在云端没有的会话」都算持有——宁可多备份，不静默丢。
export function shouldBackupBeforeApply(localConvs, cloudConvs) {
  if (!conversationsHaveData(localConvs)) return false
  for (const [person, localList] of Object.entries(localConvs || {})) {
    const cloudList = Array.isArray(cloudConvs?.[person]) ? cloudConvs[person] : []
    for (const conversation of Array.isArray(localList) ? localList : []) {
      if (!Array.isArray(conversation?.messages) || !conversation.messages.length) continue
      const counterpart = cloudList.find(c => c && c.id === conversation.id)
      if (!counterpart || !Array.isArray(counterpart.messages)) return true
      const cloudById = new Map(counterpart.messages.filter(m => m?.id).map(m => [m.id, m]))
      for (const message of conversation.messages) {
        if (!message?.id) return true
        const remote = cloudById.get(message.id)
        if (!remote || JSON.stringify(message) !== JSON.stringify(remote)) return true
      }
    }
  }
  return false
}

export function backupBeforeCloudApply(storage, localConvs, localActiveIds, cloudConvs) {
  if (!shouldBackupBeforeApply(localConvs, cloudConvs)) return false
  try { storage.setItem(RECOVERY_BACKUP_KEY, JSON.stringify(buildRecoveryBackup(localConvs, localActiveIds))) }
  catch { throw new Error('本地聊天备份失败，已停止覆盖；请先释放空间后重试') }
  return true
}

// 打包本地备份（整体快照，不做裁剪）：恢复工具/人工取回时数据完整。
export function buildRecoveryBackup(localConvs, localActiveIds) {
  return {
    version: 1,
    backedUpAt: new Date().toISOString(),
    conversations: localConvs,
    activeConversationIds: localActiveIds || {},
  }
}

// Recover each owner's conversation list independently. An explicit empty list is authoritative.
export function restoreConversationLists({ conversations, messages }, previous = {}, now = new Date().toISOString()) {
  const lists = { ...previous }
  const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []
  for (const [person, history] of entries(messages)) {
    if (!Array.isArray(history) || Array.isArray(conversations?.[person])) continue
    const id = person === 'assistant-yanweixi' ? 'legacy-yanweixi' : person === 'assistant-yanshuo' ? 'legacy-yanshu' : 'legacy-' + person
    lists[person] = [{ id, title: '旧聊天', messages: history, updatedAt: now }]
  }
  for (const [person, list] of entries(conversations)) {
    if (Array.isArray(list)) lists[person] = list
  }
  return lists
}

// 云端快照 → 各助手活跃会话 id（不存在则回退该助手第一个会话）。
export function pickActiveConversationIds(convs, activeIds) {
  const source = convs && typeof convs === 'object' ? convs : {}
  const ids = activeIds && typeof activeIds === 'object' ? activeIds : {}
  const result = {}
  for (const key of Object.keys(source)) {
    const list = Array.isArray(source[key]) ? source[key] : []
    result[key] = list.some(c => c && !c.archived && c.id === ids[key]) ? ids[key] : list.find(c => c && !c.archived)?.id || ''
  }
  return result
}

// 云端快照 → 各助手视图消息。用回退后的活跃 id 取消息，
// 保证视图与会话列表高亮一致（快照里 active id 失效时不再出现「空视图」）。
// 消息对象原样返回：message id / assetId / 稳定 URL 全部不改写。
export function pickActiveMessagesFromSnapshot(convs, activeIds) {
  const source = convs && typeof convs === 'object' ? convs : {}
  const picked = pickActiveConversationIds(source, activeIds)
  const result = {}
  for (const key of Object.keys(source)) {
    const list = Array.isArray(source[key]) ? source[key] : []
    const found = list.find(c => c && c.id === picked[key])
    result[key] = (found && Array.isArray(found.messages) ? found.messages : [])
  }
  return result
}

// 恢复后的本地快照只有确认上传成功后才能清掉待同步标记；失败或网络中断保留标记以便下次重试。
export async function syncRestoredSnapshot(storage, snapshot, send) {
  const response = await send(snapshot)
  if (!response.ok) throw new Error('HTTP ' + response.status)
  storage.removeItem('ai-home.restorePending')
}
