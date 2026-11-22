import { useState, useSyncExternalStore } from 'react'
import { notifyAppReady, resetToBuiltin } from './liveUpdate.mjs'

type Channel = 'stable' | 'beta'
type UpdateState = { status: string; message?: string; progress?: number; name?: string; code?: number; size?: number; notes?: string }
type UpdateBridge = { appUpdateVersion(): string; checkAppUpdate(channel: Channel): void; downloadAppUpdate(): void }

const channelKey = 'ai-home.apkUpdateChannel'
const autoKey = 'ai-home.autoApkUpdate'
const bridge = () => (window as Window & { AiHomeSystem?: UpdateBridge }).AiHomeSystem
let state: UpdateState = { status: 'idle' }
const subscribers = new Set<() => void>()
function publish(next: UpdateState) {
  state = next
  subscribers.forEach(listener => listener())
}
function subscribe(listener: () => void) {
  subscribers.add(listener)
  return () => { subscribers.delete(listener) }
}

window.addEventListener('qijian:app-update', event => {
  const next = (event as CustomEvent<UpdateState>).detail
  if (!next?.status) return
  publish(next.status === 'retry' || next.status === 'downloading' ? { ...state, ...next } : next)
})

function preference(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* Preferences are optional. */ }
}
function chosenChannel(): Channel {
  return preference(channelKey) === 'beta' ? 'beta' : 'stable'
}

export function startAppUpdateCheck() {
  void notifyAppReady()
  const timer = window.setTimeout(() => {
    const native = bridge()
    if (!native?.appUpdateVersion || preference(autoKey) === '0' || state.status !== 'idle') return
    const key = 'ai-home.apkUpdateLastCheck'
    const now = Date.now()
    if (now - Number(preference(key) || 0) < 86_400_000) return
    save(key, String(now))
    native.checkAppUpdate(chosenChannel())
  }, 5000)
  return () => window.clearTimeout(timer)
}

export function AppUpdateNotice() {
  const update = useSyncExternalStore(subscribe, () => state)
  return update.status === 'available'
    ? <p className="muted" role="status">栖间 {update.name} 可更新，前往设置 → 关于栖间。</p>
    : null
}

export function AppUpdateCard() {
  const update = useSyncExternalStore(subscribe, () => state)
  const [channel, setChannel] = useState(chosenChannel)
  const [auto, setAuto] = useState(() => preference(autoKey) !== '0')
  const [version] = useState(() => {
    try { return JSON.parse(bridge()?.appUpdateVersion?.() || '{}') } catch { return {} }
  })
  const busy = update.status === 'checking' || update.status === 'downloading'
  const check = () => {
    const native = bridge()
    if (!native?.appUpdateVersion) {
      publish({ status: 'checkError', message: '请在 Android App 内检查更新' })
      return
    }
    publish({ status: 'checking', message: '正在检查更新…' })
    native.checkAppUpdate(channel)
  }
  return <section className="setting-card settings-inner-card" aria-label="应用更新">
    <b>应用更新</b>
    <p className="muted">当前版本 {version.versionName || '—'}{version.versionCode ? `（${version.versionCode}）` : ''}</p>
    <label className="update-auto"><input type="checkbox" checked={auto} onChange={event => {
      setAuto(event.target.checked)
      save(autoKey, event.target.checked ? '1' : '0')
    }}/> 自动检查更新</label>
    <label>更新渠道 <select value={channel} disabled={busy} onChange={event => {
      const next = event.target.value as Channel
      save(channelKey, next)
      setChannel(next)
      publish({ status: 'idle' })
    }}><option value="stable">稳定版</option><option value="beta">测试版</option></select></label>
    <div className="settings-shortcuts"><div className="settings-shortcut-group"><div>
      <button type="button" onClick={check} disabled={busy}>检查更新</button>
      {(update.status === 'available' || update.status === 'retry') && <button type="button" onClick={() => bridge()?.downloadAppUpdate()}>下载更新</button>}
    </div></div></div>
    {update.name && <div><p>最新版本 {update.name}（{update.code}） · {((update.size || 0) / 1048576).toFixed(1)} MB</p>
      <p className="muted">{update.notes}</p></div>}
    {update.status === 'downloading' && <progress value={update.progress || 0} max={100} aria-label="APK 下载进度"/>}
    <p className="muted" role="status">{update.status === 'downloading' ? `正在下载 ${update.progress || 0}%` : update.message}</p>
    <details className="data-fold"><summary>界面资源</summary>
      <p className="muted">独立的界面资源更新暂未提供兼容版本渠道。</p>
      <button type="button" onClick={() => {
        if (window.confirm('恢复到 App 内置界面？')) void resetToBuiltin().catch(() => publish({ status: 'checkError', message: '恢复内置界面失败' }))
      }}>恢复内置界面</button>
    </details>
  </section>
}
