// 分类备份与恢复：模型 / 记忆 / 聊天 / 整体。
// 固定保存到手机「下载/栖间/」：有原生桥用 MediaStore，浏览器环境退回普通下载。
import { useEffect, useRef, useState } from 'react'
import './BackupCenter.css'
import { apiFetch, isLocalMode } from './apiBase.mjs'
import { applyBackupIndexed } from './backupIndexed.mjs'
import { buildBackupPayload } from './backupService.mjs'
import { executeBackupRestore, needsRestoredSnapshotSync } from './backupRestore.mjs'
import { prepareBackupAttachments } from './backupAttachments.mjs'
import { prepareBackupStorage } from './backupStorage.mjs'
import { prepareBackupMcp } from './backupMcp.mjs'
import { confirmDialog } from './uiDialog'
import {
  BACKUP_DIR_LABEL, BACKUP_KINDS, backupKind, backupFileName, kindFromFileName,
  localKeysForRestore, parseBackup, summarizeBackup,
} from './backups.mjs'
import { backupFilesAvailable, deleteBackupFile, listBackupFiles, readBackupFile, saveBackupFile } from './nativeSystem.mjs'
import { syncVendorProfiles, type Vendor } from './vendors.mjs'
import { parseKelivoModelConfigs, kelivoConfigsToVendors, kelivoImportSummary } from './kelivoImport.mjs'
import type { ModelProfile } from './resourceBindings.mjs'
import { IconTrash } from './icons'

type BackupFile = { name: string; size: number; modifiedAt: number }

function formatSize(bytes: number): string {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

function formatDate(timestamp: number): string {
  const date = new Date(Number(timestamp) || 0)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function BackupCenter({ people, vendors, setVendors, setModelProfiles }: {
  people: string[]
  vendors: Vendor[]
  setVendors: React.Dispatch<React.SetStateAction<Vendor[]>>
  setModelProfiles: React.Dispatch<React.SetStateAction<ModelProfile[]>>
}) {
  const [files, setFiles] = useState<BackupFile[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)

  const native = backupFilesAvailable()

  async function refreshFiles() {
    if (!native) return
    const list = listBackupFiles() as BackupFile[]
    if (!mounted.current) return
    setFiles(list.slice().sort((a, b) => Number(b.modifiedAt) - Number(a.modifiedAt)))
  }

  useEffect(() => {
    mounted.current = true
    void refreshFiles()
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createBackup(kindId: string) {
    if (busy) return
    const kind = backupKind(kindId)
    if (!kind) return
    setBusy(kindId)
    setError('')
    setMessage('')
    try {
      const payload = await buildBackupPayload(kindId, people)
      const content = JSON.stringify(payload, null, 2)
      const name = backupFileName(kindId)
      if (native) {
        const saved = saveBackupFile(name, content)
        if (!saved?.ok) throw new Error(saved?.error || '写入下载目录失败')
        setMessage('已保存到 ' + BACKUP_DIR_LABEL + (saved.name || name))
        await refreshFiles()
      } else {
        const blob = new Blob([content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name
        anchor.click()
        URL.revokeObjectURL(url)
        setMessage('当前环境没有本机目录桥，已交给浏览器下载：' + name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBusy('')
    }
  }

  async function applyRestore(payload: any, kindId: string, sourceName: string) {
    const kind = backupKind(kindId)
    if (!kind) throw new Error('未知的恢复类型')
    const restoreLocalMode = isLocalMode()
    const converted = prepareBackupMcp(prepareBackupStorage(payload, kindId, localKeysForRestore(payload, kindId), restoreLocalMode), kindId, restoreLocalMode)
    const local = converted.local
    if (restoreLocalMode && converted.crossMode && converted.server.records !== undefined) {
      const records = converted.server.records
      if (records?.version !== 1 || !records.tables || ['scheduled_tasks','ledger_entries','ledger_operations','diary_entries'].some(key => !Array.isArray(records.tables[key]))) throw new Error('服务器记录备份数据无效')
      if (Object.values(records.tables).some((rows: any) => rows.length)) throw new Error('此备份包含服务器任务、账本或日记，本机模式尚不支持迁移；请在服务器模式恢复')
    }
    const summary = summarizeBackup(payload)
    const details = [
      Object.keys(local).length ? Object.keys(local).length + ' 项本地设置' : '',
      summary.memoryCount ? summary.memoryCount + ' 条记忆' : '',
      summary.apiKeys ? summary.apiKeys + ' 把 API Key' : '',
    ].filter(Boolean).join(' · ') || '空内容'
    const ok = await confirmDialog({
      title: '恢复' + kind.label,
      message: '用「' + sourceName + '」覆盖当前' + kind.label + '？\n包含：' + details + (restoreLocalMode ? '' : '\n服务器上的对应数据也会被写回。') + (converted.crossMode ? '\n跨模式恢复会保留当前连接模式，并迁移记忆、图片和 MCP 配置。' : ''),
      confirmLabel: '恢复',
      danger: true,
    })
    if (!ok) return
    const prepared = await prepareBackupAttachments(kindId, payload.data?.indexed, converted.server, restoreLocalMode)
    await executeBackupRestore({
      storage: localStorage,
      local,
      markPending: needsRestoredSnapshotSync(local, kindId, restoreLocalMode, converted.crossMode),
      applyIndexed: () => applyBackupIndexed(kindId, prepared.indexed),
      syncServer: async () => {
        if (restoreLocalMode) return
        const server = converted.server
        const keys = kind.serverKeys ? server.keys : undefined
        const memory = kind.serverMemory ? server.memory : undefined
        const mcp = kind.serverMcp ? server.mcp : undefined
        const records = kindId === 'full' ? server.records : undefined
        const attachments = prepared.serverAttachments
        if (attachments !== undefined) {
          const capability = await apiFetch('/api/backups/attachments', {credentials:'include'})
          const data = await capability.json().catch(() => ({}))
          if (!capability.ok || data.version !== 1) throw new Error('服务器不支持附件恢复，请更新服务器')
        }
        if (mcp !== undefined) {
          const capability = await apiFetch('/api/backups/mcp', {credentials:'include'})
          const data = await capability.json().catch(() => ({}))
          if (!capability.ok || data.version !== 1) throw new Error('服务器不支持 MCP 恢复，请更新服务器')
        }
        if (records !== undefined) {
          const capability = await apiFetch('/api/backups/records', {credentials:'include'})
          const data = await capability.json().catch(() => ({}))
          if (!capability.ok || data.version !== 1) throw new Error('服务器不支持任务、账本和日记恢复，请更新服务器')
        }
        if (keys !== undefined || memory !== undefined || attachments !== undefined || mcp !== undefined || records !== undefined) {
          let response: Response
          try {
            response = await apiFetch('/api/backups/restore', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys, memory, attachments, mcp, records }),
            })
          } catch { throw new Error('服务器恢复结果未确认，服务器可能已更改，请检查；本机数据将回滚') }
          const result = await response.json().catch(() => ({}))
          if (!response.ok || (attachments !== undefined && result.attachmentsRestored !== attachments.length) || (mcp !== undefined && result.mcpRestored !== mcp.services.length) || (records !== undefined && result.recordsRestored !== Object.values(records.tables).reduce((n: number, rows: any) => n + rows.length, 0))) throw new Error('服务器恢复未确认，请检查服务器状态；本机数据已回滚')
        }
      },
    })
    // 恢复需要整页刷新才能让所有 useState 从新的 localStorage / 快照重新初始化。
    // 刷新前把用户当前所在的设置页记到 sessionStorage，避免每次恢复都被默认首页接管。
    try {
      sessionStorage.setItem('ai-home.afterRestorePage', 'settings')
      sessionStorage.setItem('ai-home.afterRestoreSection', 'data')
    } catch { /* sessionStorage 不可用时仍可正常恢复，只是回到默认页 */ }
    setMessage('已恢复' + kind.label + '，正在刷新…')
    window.setTimeout(() => location.reload(), 800)
  }

  async function importKelivoConfigs(configs: any[], sourceName: string) {
    const converted = kelivoConfigsToVendors(configs, vendors)
    if (!converted.length) throw new Error('这个文件里没有可导入的供应商（需要接口地址、Key 或模型名）')
    const summary = kelivoImportSummary(converted)
    const ok = await confirmDialog({
      title: '导入 Kelivo 模型配置',
      message: '识别到 ' + configs.length + ' 条配置，可导入 ' + summary.vendors + ' 个供应商、' + summary.models + ' 个模型。\n'
        + '文件：' + sourceName + '\n'
        + 'API Key 会一起保存到这台设备；导入后到「设置 → 供应商」查看，聊天模型面板里可以直接选。',
      confirmLabel: '导入',
    })
    if (!ok) return
    const next = [...vendors, ...converted]
    setVendors(next)
    setModelProfiles(old => syncVendorProfiles(next, old))
    setMessage('已导入 ' + summary.vendors + ' 个供应商、' + summary.models + ' 个模型。到「供应商」或聊天模型面板选用即可。')
  }

  async function handleRestoreText(text: string, kindId: string, sourceName: string) {
    try {
      const payload = parseBackup(text)
      await applyRestore(payload, kindId || payload.kind, sourceName)
      return
    } catch (err) {
      // 不是栖间的备份：尝试识别 Kelivo / 同类客户端的模型配置数组。
      const configs = parseKelivoModelConfigs(text)
      if (configs) { await importKelivoConfigs(configs, sourceName); return }
      throw err
    }
  }

  async function restoreFromText(text: string, kindId: string, sourceName: string) {
    if (busy) return
    setBusy(kindId)
    setError('')
    setMessage('')
    try {
      await handleRestoreText(text, kindId, sourceName)
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy('')
    }
  }

  async function restoreFromFile(input: HTMLInputElement, kindId: string) {
    const file = input.files && input.files[0]
    if (!file) return
    try { await restoreFromText(await file.text(), kindId, file.name) }
    finally { input.value = '' }
  }

  async function restoreListed(file: BackupFile) {
    if (busy) return
    const kindId = kindFromFileName(file.name)
    setBusy(kindId || 'file')
    setError('')
    setMessage('')
    try {
      const read = readBackupFile(file.name)
      if (!read?.ok) throw new Error(read?.error || '读取备份失败')
      await handleRestoreText(String(read.content || ''), kindFromFileName(file.name), file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy('')
    }
  }

  async function removeListed(file: BackupFile) {
    if (!(await confirmDialog({ title: '删除备份', message: '删除「' + file.name + '」？', confirmLabel: '删除', danger: true }))) return
    if (!deleteBackupFile(file.name)) { setError('删除失败'); return }
    setFiles(old => old.filter(item => item.name !== file.name))
  }

  return <section className="backup-center">
    <p className="backup-path">备份固定保存到 <b>{BACKUP_DIR_LABEL}</b>。可以只备份其中一类，恢复时按类覆盖，不会动其它数据。</p>
    <div className="backup-kind-list">
      {BACKUP_KINDS.map(kind => <div className="backup-kind" key={kind.id}>
        <span className="backup-kind-text"><b>{kind.label}</b><small>{kind.desc}</small></span>
        <span className="backup-kind-actions">
          <button type="button" className="backup-save" disabled={!!busy} onClick={() => void createBackup(kind.id)}>{busy === kind.id ? '备份中…' : '备份'}</button>
          <label className={'backup-restore' + (busy ? ' disabled' : '')}>恢复
            <input type="file" accept="application/json,.json" aria-label={'从文件恢复' + kind.label} disabled={!!busy}
              onChange={event => void restoreFromFile(event.currentTarget, kind.id)}/>
          </label>
        </span>
      </div>)}
    </div>
    {native && <div className="backup-files">
      <div className="backup-files-head"><b>本机备份</b><span>{files.length ? files.length + ' 个' : '还没有'}</span></div>
      {files.slice(0, 12).map(file => <div className="backup-file" key={file.name}>
        <span className="backup-file-text"><b>{file.name}</b><small>{formatDate(file.modifiedAt)} · {formatSize(file.size)}</small></span>
        <button type="button" className="backup-file-restore" disabled={!!busy} onClick={() => void restoreListed(file)}>恢复</button>
        <button type="button" className="backup-file-delete" aria-label={'删除 ' + file.name} onClick={() => void removeListed(file)}><IconTrash size={14}/></button>
      </div>)}
    </div>}
    {!native && <p className="backup-hint">当前环境没有本机存储桥：备份会走浏览器下载；恢复请用各分类右侧的「恢复」选文件。</p>}
    {error && <p className="mcp-error" role="alert">{error}</p>}
    {message && <p className="mcp-notice" role="status">{message}</p>}
    <p className="backup-warning">模型 / MCP / 整体备份可能包含 API Key、MCP 令牌等敏感配置，请只留在自己的设备上，不要把文件发给别人。</p>
  </section>
}
