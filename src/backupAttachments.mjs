// 备份可以跨本地和服务器模式恢复。附件编号不改写，冲突或损坏则拒绝恢复。
export async function prepareBackupAttachments(kind, indexed, server, localMode) {
  if (kind !== 'full' && kind !== 'chat') return {indexed, serverAttachments:undefined}
  const localItems = indexed?.attachments, remoteItems = server?.attachments
  if (localItems === undefined && remoteItems === undefined) return {indexed, serverAttachments:undefined}
  if ((localItems !== undefined && !Array.isArray(localItems)) || (remoteItems !== undefined && !Array.isArray(remoteItems))) throw new Error('附件备份格式无效')
  const records = new Map()
  let total = 0
  for (const item of [...(localItems || []), ...(remoteItems || [])]) {
    if (!item || !/^[0-9a-f-]{36}$/i.test(item.id) || typeof item.data !== 'string' || !item.data || item.data.length > (localMode ? 32 : 20) * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data) || item.data.length % 4 !== 0 || !/^image\/[a-z0-9.+-]+$/i.test(item.mime || '') || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200) throw new Error('图片附件备份格式无效')
    let binary
    try { binary = atob(item.data) } catch { throw new Error('图片附件数据无效') }
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    if (!globalThis.crypto?.subtle) throw new Error('当前环境无法校验附件，请使用安全连接')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
    if ((item.sha256 && item.sha256 !== hash) || (item.size !== undefined && item.size !== bytes.length)) throw new Error('图片附件校验失败')
    const existing = records.get(item.id)
    if (existing && existing.sha256 !== hash) throw new Error('备份中图片附件编号冲突')
    if (existing) continue
    total += bytes.length
    if (!localMode && total > 36 * 1024 * 1024) throw new Error('恢复到服务器的图片超过单次上限，请使用服务器数据库备份')
    const rawDate = item.created_at || item.createdAt
    const created = Number.isFinite(Date.parse(rawDate || '')) ? new Date(rawDate).toISOString() : new Date().toISOString()
    records.set(item.id,{id:item.id,name:item.name,mime:item.mime,size:bytes.length,sha256:hash,data:item.data,created_at:created,createdAt:created})
  }
  const attachments = [...records.values()]
  if (localMode) return {indexed:{...(indexed || {}),attachments}, serverAttachments:undefined}
  return {indexed, serverAttachments:attachments}
}
