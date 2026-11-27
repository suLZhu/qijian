import { useChatDisplay } from './ChatDisplay'
import { saveChatDisplay } from './chatDisplayPrefs.mjs'
import { useEffect, useState, type ReactNode } from 'react'
import { AppLockSettings } from './AppLockSettings'
import './AdvancedSettingsPreview.css'

type Panel = { id: string; title: string; note: string }

const toolPanels: Panel[] = [
  { id: 'mcp', title: 'MCP 服务', note: '连接配置、助手授权与连接状态' },
  { id: 'skills', title: '技能库', note: '已安装技能、调用权限、导入技能' },
  { id: 'web', title: '网页工具', note: '搜索和网页读取的可用状态' },
  { id: 'history', title: '工具调用记录', note: '查看工具的执行结果与异常' },
  { id: 'workspace', title: '助手工作区', note: '文件范围、读取与修改权限' },
]
const devicePanels: Panel[] = [
  { id: 'notify', title: '通知与铃声', note: '系统通知渠道、提示音与测试通知' },
  { id: 'background', title: '后台运行', note: '持续生成、电池优化与后台通知' },
  { id: 'lock', title: '应用锁', note: 'PIN、锁定名单与排除名单' },
  { id: 'backup', title: '备份与恢复', note: '导出、恢复及同步状态' },
]
export function AdvancedSettingsPreview({ kind, renderMcp, renderWorkspace, renderBackup, renderSystem, renderPanel }: { kind: 'tools' | 'device'; renderMcp?: () => ReactNode; renderWorkspace?: () => ReactNode; renderBackup?: () => ReactNode; renderSystem?: () => ReactNode; renderPanel?: (panel: string) => ReactNode }) {
  const prefs = useChatDisplay()
  const [weatherCity, setWeatherCity] = useState(prefs.weatherCity)
  const [panel, setPanel] = useState('')
  const items = kind === 'tools' ? toolPanels : devicePanels
  useEffect(() => { setPanel('') }, [kind])

  function row(label: string, detail: string, onClick: () => void, right = '›') {
    return <button type="button" className="qj-advanced-row" key={label} onClick={onClick}><span><b>{label}</b><small>{detail}</small></span><em>{right}</em></button>
  }
  return <div className="qj-advanced">
    <header className="qj-advanced-head">
      {panel && <button onClick={() => setPanel('')} aria-label="返回分类">‹ 返回分类</button>}
      <h2>{panel ? (items.find(x=>x.id===panel)?.title || '功能设置') : kind==='tools' ? '工具与扩展' : '应用与设备'}</h2>
    </header>
    {kind === 'tools' && !panel && <div className="qj-advanced-body">
      <label><input type="checkbox" checked={prefs.toolsEnabled} onChange={e => saveChatDisplay({ ...prefs, toolsEnabled: e.target.checked })}/> 聊天工具</label>
      <label><input type="checkbox" checked={prefs.timeEnabled} onChange={e => saveChatDisplay({ ...prefs, timeEnabled: e.target.checked })}/> 注入当前时间</label>
    </div>}
    {kind === 'tools' && !panel && <form className="qj-advanced-body" onSubmit={e => {
      e.preventDefault()
      saveChatDisplay({ ...prefs, weatherCity })
    }}>
      <label>天气城市 <input value={weatherCity} maxLength={80} onChange={e => setWeatherCity(e.target.value)} placeholder="留空关闭天气" /></label>
      <button type="submit">保存城市</button>
      {prefs.weatherCity && <small>已启用 · {prefs.weatherCity} · Open-Meteo</small>}
    </form>}
    {!panel && <div className="qj-advanced-list">{items.map(item => row(item.title,item.note,()=>setPanel(item.id)))}</div>}
    {panel === 'mcp' && <div className="qj-advanced-body">{renderMcp?.()}</div>}
    {['skills','web','history'].includes(panel) && <div className="qj-advanced-body">{renderPanel?.(panel)}</div>}
    {panel === 'workspace' && <div className="qj-advanced-body">{renderWorkspace?.()}</div>}
    {(panel === 'notify' || panel === 'background') && <div className="qj-advanced-body">{renderSystem?.()}</div>}
    {panel === 'lock' && <div className="qj-advanced-body">
      <AppLockSettings />
      <p className="qj-advanced-note">应用锁已接入原生真实应用列表、PIN 与无障碍服务状态。排除名单优先于锁定名单。</p>
    </div>}
    {panel === 'backup' && <div className="qj-advanced-body">{renderBackup?.()}</div>}
  </div>
}
