// IndexedDB 和本地设置先写，服务器事务最后提交；任何失败时回滚本地更改。
export async function executeBackupRestore({storage, local, applyIndexed, syncServer, markPending}) {
  const keys = Object.keys(local)
  if (markPending && !keys.includes('ai-home.restorePending')) keys.push('ai-home.restorePending')
  const previous = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]))
  const rollbackIndexed = await applyIndexed()
  try {
    for (const [key,value] of Object.entries(local)) if (typeof value === 'string') storage.setItem(key,value)
    if (markPending) storage.setItem('ai-home.restorePending','1')
    await syncServer()
  } catch (error) {
    let failed = false
    for (const [key,value] of Object.entries(previous)) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key,value) } catch { failed = true }
    }
    try { await rollbackIndexed() } catch { failed = true }
    if (failed) throw new Error('恢复失败且本地回滚不完整，请保留备份并停止恢复')
    throw error
  }
}

// 部分恢复及跨模式恢复要先把恢复后的状态写入目标后端，避免旧快照重新盖回。
export function needsRestoredSnapshotSync(local, kind, localMode, crossMode) {
  if (!Object.keys(local).length) return false
  return !localMode || kind !== 'full' || crossMode || Object.hasOwn(local, 'ai-home.conversations')
}
