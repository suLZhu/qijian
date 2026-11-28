// 备份和恢复 IndexedDB 中的本地附件、主题素材。旧备份没有该字段时不修改现有数据。
import { exportLocalAttachments, applyLocalAttachments, rollbackLocalAttachments } from './localBackend.mjs'
import { readStoredCustomAssets, writeStoredCustomAssets } from './assetStore.mjs'
import { prepareBackupAttachments } from './backupAttachments.mjs'

const defaults = {exportLocalAttachments, applyLocalAttachments, rollbackLocalAttachments, readStoredCustomAssets, writeStoredCustomAssets}
export async function collectBackupIndexed(kind, ops = defaults) {
  const data = {}
  if (kind === 'full' || kind === 'chat') {
    const attachments = await ops.exportLocalAttachments()
    data.attachments = ops.normalizeAttachments ? await ops.normalizeAttachments(attachments) : (await prepareBackupAttachments('chat', {attachments}, null, true)).indexed.attachments
  }
  if (kind === 'full') data.customAssets = await ops.readStoredCustomAssets()
  return data
}
export async function applyBackupIndexed(kind, data, ops = defaults) {
  if (data == null) return async () => {}
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('附件与主题素材备份格式无效')
  const restoreAttachments = (kind === 'chat' || kind === 'full') && Object.hasOwn(data, 'attachments')
  const restoreAssets = kind === 'full' && Object.hasOwn(data, 'customAssets')
  if (restoreAttachments && !Array.isArray(data.attachments)) throw new Error('附件备份格式无效')
  if (restoreAssets && data.customAssets !== null && (typeof data.customAssets !== 'object' || Array.isArray(data.customAssets))) throw new Error('主题素材备份格式无效')
  let previousAttachments, previousAssets, assetsChanged = false
  const rollback = async () => {
    let failed = false
    if (previousAttachments) try { await ops.rollbackLocalAttachments(previousAttachments) } catch { failed = true }
    if (assetsChanged) try { await ops.writeStoredCustomAssets(previousAssets) } catch { failed = true }
    if (failed) throw new Error('附件或主题素材回滚失败，请保留备份并停止恢复')
  }
  try {
    if (restoreAssets) { previousAssets = await ops.readStoredCustomAssets(); await ops.writeStoredCustomAssets(data.customAssets); assetsChanged = true }
    if (restoreAttachments) previousAttachments = await ops.applyLocalAttachments(data.attachments)
    return rollback
  } catch (error) {
    await rollback()
    throw error
  }
}
