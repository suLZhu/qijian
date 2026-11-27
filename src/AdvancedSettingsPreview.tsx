import { useChatDisplay } from './ChatDisplay'
import { saveChatDisplay } from './chatDisplayPrefs.mjs'
import { useEffect, useState, type ReactNode } from 'react'
import { AppLockSettings } from './AppLockSettings'
import './AdvancedSettingsPreview.css'

type Panel = { id: string; title: string; note: string }
type Dialog = { title: string; description: string; destructive?: boolean }

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
export function AdvancedSettingsPreview({ kind, renderMcp, renderWorkspace, renderBackup, renderSystem }: { kind: 'tools' | 'device'; renderMcp?: () => ReactNode; renderWorkspace?: () => ReactNode; renderBackup?: () => ReactNode; renderSystem?: () => ReactNode }) {
  const prefs = useChatDisplay()
  const [weatherCity, setWeatherCity] = useState(prefs.weatherCity)
  const [panel, setPanel] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState('')
  const items = kind === 'tools' ? toolPanels : devicePanels
  useEffect(() => { setPanel(''); setDialog(null); setNotice('') }, [kind])

  function row(label: string, detail: string, onClick: () => void, right = '›') {
    return <button type="button" className="qj-advanced-row" key={label} onClick={onClick}><span><b>{label}</b><small>{detail}</small></span><em>{right}</em></button>
  }
  return <div className="qj-advanced">
    <header className="qj-advanced-head">
      {panel && <button onClick={() => setPanel('')} aria-label="返回分类">‹ 返回分类</button>}
      <h2>{panel ? (items.find(x=>x.id===panel)?.title || '功能设置') : kind==='tools' ? '工具与扩展' : '应用与设备'}</h2>
      {panel !== 'mcp' && <p>{kind==='tools' ? '连接、授权和调用记录统一管理。' : '系统能力和应用安全集中管理。'} · 布局演示</p>}
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
    {panel === 'skills' && <div className="qj-advanced-body">
      <div className="qj-advanced-toolbar"><strong>技能管理</strong><button onClick={()=>setDialog({title:'导入技能',description:'正式版将读取技能说明文件，确认来源与工具权限后添加。'})}>＋ 导入</button></div>
      <div className="qj-advanced-list">
        {row('已安装技能','按助手设置可用范围',()=>setDialog({title:'已安装技能',description:'实际技能清单将在接入原版数据后显示。'}))}
        {row('技能运行记录','调用次数、错误与最近使用',()=>setDialog({title:'技能运行记录',description:'正式版从真实日志中读取。'}))}
      </div>
    </div>}
    {panel === 'web' && <div className="qj-advanced-list">
      {row('联网搜索','配置已有的网络搜索工具',()=>setDialog({title:'联网搜索',description:'实际可用搜索方式依赖已连接的模型、服务与工具。'}))}
      {row('网页读取','网页打开与正文获取',()=>setDialog({title:'网页读取',description:'正式版沿用原有网页工具与浏览器能力。'}))}
    </div>}
    {panel === 'history' && <div className="qj-advanced-body">
      <div className="qj-advanced-empty">暂无演示调用记录。正式版按助手、工具与执行时间筛选。</div>
    </div>}
    {panel === 'workspace' && <div className="qj-advanced-body">{renderWorkspace?.()}</div>}
    {(panel === 'notify' || panel === 'background') && <div className="qj-advanced-body">{renderSystem?.()}</div>}
    {panel === 'lock' && <div className="qj-advanced-body">
      <AppLockSettings />
      <p className="qj-advanced-note">应用锁已接入原生真实应用列表、PIN 与无障碍服务状态。排除名单仍是下一步要补的原生能力。</p>
    </div>}
    {panel === 'backup' && <div className="qj-advanced-body">{renderBackup?.()}</div>}
    {notice && <p className="qj-advanced-notice" role="status">{notice}</p>}
    {dialog && <div className="qj-dialog-layer" onClick={()=>setDialog(null)}><div className="qj-dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onClick={e=>e.stopPropagation()}>
      <h3>{dialog.title}</h3><p>{dialog.description}</p>
      {dialog.destructive&&<p className="qj-dialog-warning">演示模式不会执行破坏性操作。</p>}
      <div className="qj-dialog-actions">
        <button className="qj-dialog-cancel" onClick={()=>setDialog(null)}>{dialog.destructive?'取消':'关闭'}</button>
        {dialog.destructive&&<button className="qj-dialog-danger" onClick={()=>{setNotice('演示确认完成，真实数据和权限没有改变。');setDialog(null)}}>确认操作</button>}
      </div>
    </div></div>}
  </div>
}
