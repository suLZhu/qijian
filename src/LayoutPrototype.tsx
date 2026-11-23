import { useLayoutEffect, useRef, useState } from 'react'
import { LEGACY_ASSISTANTS, migrateLocalStorage } from './assistantIdentity'
import './LayoutPrototype.css'
import { settingItems } from './layout/sections'
import { SubscriptionPreview, UsageLedgerPreview } from './ProviderUsagePreview'
import { RealProviderPreview } from './RealProviderPreview'
import { SettingsSectionsPreview } from './SettingsSectionsPreview'
import { ModelFunctionsPreview, ScheduledTasksPreview } from './FeaturePagesPreview'
import { AdvancedSettingsPreview } from './AdvancedSettingsPreview'
import { ContentSettingsPreview } from './ContentSettingsPreview'
import { RoomAssistantPreview } from './RoomAssistantPreview'

type View = 'home' | 'chat' | 'room' | 'settings' | 'theme' | 'profile'
type Person = string
type AssistantView = { id: string; name: string }
type MessageView = { role:string; content:string; id?:string; reasoning?:string }
type ConversationView = { id: string; title: string; messages: MessageView[]; updatedAt?:string }
type LayoutPrototypeProps = {
  assistants?: AssistantView[]
  conversations?: Record<string,ConversationView[]>
  activeIds?: Record<string,string>
  person?: string
  messages?: MessageView[]
  draft?: string
  sending?: boolean
  chatError?: string
  onPersonChange?: (id:string)=>void
  onConversationChange?: (id:string)=>void
  onCreateConversation?: ()=>void
  onDeleteConversation?: (id:string)=>void|Promise<void>
  onDraftChange?: (value:string)=>void
  onSend?: (text:string)=>void|Promise<unknown>
}
function stored<T>(key:string, fallback:T):T { try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback } }
function readAssistantState() {
  migrateLocalStorage()
  const assistants = stored<AssistantView[]>('ai-home.assistants', LEGACY_ASSISTANTS.map(a => ({...a})))
  const conversations = stored<Record<string,ConversationView[]>>('ai-home.conversations', {})
  const activeIds = stored<Record<string,string>>('ai-home.activeConversationIds', {})
  return { assistants: assistants.length ? assistants : LEGACY_ASSISTANTS.map(a=>({...a})), conversations, activeIds }
}


export default function LayoutPrototype(props:LayoutPrototypeProps = {}) {
  const [view, setView] = useState<View>('home')
  const [storedData] = useState(readAssistantState)
  const data = { assistants: props.assistants || storedData.assistants, conversations: props.conversations || storedData.conversations, activeIds: props.activeIds || storedData.activeIds }
  const people = data.assistants.map(a=>a.id)
  const [localPerson, setLocalPerson] = useState<Person>(()=>readAssistantState().assistants[0]?.id || LEGACY_ASSISTANTS[0].id)
  const person = props.person || localPerson
  const setPerson = (id:string) => { if(props.onPersonChange) props.onPersonChange(id); else setLocalPerson(id) }
  const displayName = (id:string)=>data.assistants.find(a=>a.id===id)?.name || id
  const [drawer, setDrawer] = useState(false)
  const [section, setSection] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [conversation, setConversation] = useState('')
  const availableConversations = data.conversations[person] || []
  const activeConversation = availableConversations.find(c=>c.id===conversation) || availableConversations.find(c=>c.id===data.activeIds[person]) || availableConversations[0]
  const actualMessages = props.messages || activeConversation?.messages || stored<Record<string,MessageView[]>>('ai-home.messages', {})[activeConversation?.id || ''] || []
  const draft = props.draft ?? ''
  const submit = async () => { const text=draft.trim(); if(!text || props.sending || !props.onSend)return; await props.onSend(text) }
  const [theme, setTheme] = useState('银杏奶灰')
  const mainRef = useRef<HTMLElement>(null)
  const settingsScrollRef = useRef(0)
  const previousNav = useRef({view: 'home' as View, section: null as string | null})
  useLayoutEffect(() => {
    const before = previousNav.current
    if (mainRef.current) {
      if (view === 'settings' && !section && before.view === 'settings' && before.section) {
        mainRef.current.scrollTop = settingsScrollRef.current
      } else if (view !== before.view || section !== before.section) {
        mainRef.current.scrollTop = 0
      }
    }
    previousNav.current = {view, section}
  }, [view, section])
  function openSection(name: string) {
    if (view === 'settings' && !section) settingsScrollRef.current = mainRef.current?.scrollTop || 0
    setSection(name)
  }

  function go(next: View) {
    setView(next)
    setSection(null)
    setDrawer(false)
    setToolsOpen(false)
  }
  const title = view === 'home' ? '栖间' : view === 'chat' ? displayName(person) : view === 'room' ? displayName(person) + '的房间' :
    view === 'settings' ? (section || '设置') :
    view === 'theme' ? '主题中心' : displayName(person) + '的资料'
  return <div className="qj-preview">
    <div className="qj-status" aria-hidden="true" />
    <header className="qj-topbar">
      {(view === 'chat' || view === 'home') ? <button className="qj-icon" aria-label="打开侧边栏" onClick={() => setDrawer(true)}>☰</button> :
       <button className="qj-icon" aria-label="返回" onClick={() => {
         if (section) setSection(null)
         else if (view === 'theme') go('settings')
         else go('home')
       }}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>}
      {view === 'chat' ? <button className="qj-chat-identity" aria-label="查看当前助手详情" onClick={() => go('profile')}><span className="qj-avatar">{person.slice(0,1)}</span><span className="qj-top-title"><strong>{title}</strong><small>{conversation}</small></span></button> : <div className="qj-top-title"><strong>{title}</strong></div>}
      {view === 'chat' && <div className="qj-chat-switch" aria-label="快速切换聊天助手">
        {people.map(p => <button key={p} className={p === person ? 'selected' : ''} onClick={() => setPerson(p)} aria-pressed={p === person}>{displayName(p)}</button>)}
      </div>}


    </header>
    <main className="qj-main" ref={mainRef}>
      {view === 'home' && <div className="qj-home">
        <div className="qj-home-hero"><strong>{new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</strong><span>{new Date().toLocaleDateString('zh-CN',{weekday:'long',month:'long',day:'numeric'})}</span><p>晚上好。家里很安静，说点什么吧。</p></div>
        <div className="qj-home-people">
          {people.map(p => <button key={p} className="qj-home-person" onClick={() => { setPerson(p); go('chat') }}>
            <span className="qj-home-avatar">{displayName(p).slice(0,1)}</span>
            <span className="qj-home-person-info"><b>{displayName(p)}</b><small>{data.conversations[p]?.[0]?.title || '暂无会话'}</small><em>{data.conversations[p]?.length || 0} 个会话</em></span>
            <span className="qj-home-chevron">›</span>
          </button>)}
        </div>
        <div className="qj-home-heading">今 天 的 事</div>
        <div className="qj-row-group">
          <button className="qj-row" onClick={() => go('profile')}><span>认识的日子</span><small>从第一次聊天算起</small><i>›</i></button>
          <button className="qj-row" onClick={() => go('room')}><span>日程与约定</span><small>查看助手房间中的日常</small><i>›</i></button>
          <button className="qj-row" onClick={() => go('settings')}><span>记忆与记录</span><small>在设置中查看管理</small><i>›</i></button>
        </div>
      </div>}
      {view === 'chat' && <div className="qj-chat">
        <div className="qj-chat-date">{activeConversation?.title || '暂无会话'}</div>
        {actualMessages.map((m,i)=><div key={i} className={'qj-message '+(m.role==='user'?'mine':'from')}>{m.role!=='user'&&<span className="qj-avatar">{displayName(person).slice(0,1)}</span>}<p>{m.content}</p></div>)}
      </div>}
      {view === 'room' && <div className="qj-page">
        <div className="qj-room-hero"><div className="qj-room-art"><div className="qj-window">☀</div><div className="qj-shelf">▤ ▤ ▤</div><div className="qj-sofa">▰</div><div className="qj-floor"/></div>
          <b>{displayName(person)}的小空间</b><span>自由布置 · 图片 · 视频 · 小组件</span></div>
        <h3 className="qj-label">房间入口</h3>
        <div className="qj-row-group">
          <button className="qj-row" onClick={() => {setView('settings');setSection('房间与助手')}}><span>房间布置</span><small>进入房间与助手设置</small><i>›</i></button>
          <button className="qj-row" onClick={() => setSection('我的作品')}><span>我的作品</span><small>图片、视频、音乐</small><i>›</i></button>
        </div>
        {section === '我的作品' && <div className="qj-inline-note">「我的作品」归入后续的栖间图库项目，本轮不制作假页面。</div>}
      </div>}
      {view === 'settings' && <div className="qj-page">
        {section ? <>
          {section === '供应商' ? <RealProviderPreview /> :
            section === '订阅' ? <SubscriptionPreview /> :
            section === 'AI 用量账本' ? <UsageLedgerPreview /> :
            section === '模型功能' ? <ModelFunctionsPreview /> :
            section === '定时任务' ? <ScheduledTasksPreview /> :
            section === '工具与扩展' ? <AdvancedSettingsPreview kind="tools" /> :
            section === '应用与设备' ? <AdvancedSettingsPreview kind="device" /> :
            section === '记忆与上下文' ? <ContentSettingsPreview type="memory" /> :
            section === '聊天与消息' ? <ContentSettingsPreview type="chat" /> :
            section === '诊断与维护' ? <ContentSettingsPreview type="diagnostic" /> :
            section === '房间与助手' ? <RoomAssistantPreview /> :
            <SettingsSectionsPreview section={section} onTheme={() => go('theme')} />}
        </> : <>
          <div className="qj-section-head"><h2>设置中心</h2><p>常用功能在前，其他功能集中管理。</p></div>
          <div className="qj-row-group">{settingItems.map(([name, desc]) => <button key={name} className="qj-row" onClick={() => openSection(name)}>
            <span>{name}</span><small>{desc}</small><i>›</i></button>)}</div>
        </>}
      </div>}
      {view === 'theme' && <div className="qj-page">
        <h3 className="qj-label">一键主题包</h3>
        <div className="qj-theme-list">{['银杏奶灰','月影浅紫','夜幕星雾'].map(name => <button key={name} className={'qj-theme-tile ' + (theme === name ? 'selected' : '')} onClick={() => setTheme(name)}><span className={'qj-swatch '+(name==='月影浅紫'?'lavender':name==='夜幕星雾'?'night':'')} /><b>{name}</b><small>{theme === name ? '已选择' : '预览样式'}</small></button>)}</div>
        <p className="qj-inline-note">主题包应用功能留待页面验收后接入。</p>
      </div>}
      {view === 'profile' && <div className="qj-page">
        <div className="qj-profile"><div className="qj-large-avatar">{displayName(person).slice(0, 1)}</div><h2>{displayName(person)}</h2><p>独立助手资料与专属设置</p></div>
        <div className="qj-row-group"><button className="qj-row" onClick={() => go('room')}><span>进入房间</span><i>›</i></button><button className="qj-row" onClick={() => {go('settings');setSection('房间与助手')}}><span>专属设置</span><i>›</i></button></div>
      </div>}
    </main>
    {view === 'chat' && <div className="qj-composer"><button className="qj-icon" aria-label="添加附件" onClick={() => setToolsOpen(v=>!v)}>＋</button><textarea className="qj-compose-input" value={draft} onChange={e=>props.onDraftChange?.(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} placeholder="输入消息…" rows={1}/><button className="qj-send" aria-label="发送" disabled={!draft.trim()||props.sending} onClick={()=>void submit()}>{props.sending?'…':'➤'}</button></div>}
    {view === 'chat' && props.chatError && <div className="qj-chat-error" role="status">{props.chatError}</div>}
    <nav className="qj-bottom" aria-label="主要导航">
      <button className={view === 'home'||view === 'chat'?'active':''} onClick={() => go('home')}><span>▤</span>主页</button>
      <button className={view === 'room'?'active':''} onClick={() => go('room')}><span>⌂</span>房间</button>
      <button className={view === 'settings'||view==='theme'?'active':''} onClick={() => go('settings')}><span>⚙</span>设置</button>
    </nav>
    {toolsOpen && <div className="qj-tool-tray"><strong>聊天工具（占位）</strong><p>以后在这里添加图片、附件和网页功能；不改变聊天页面框架。</p><button onClick={() => setToolsOpen(false)}>收起</button></div>}
    {drawer && <div className="qj-drawer-layer"><button className="qj-scrim" aria-label="关闭菜单" onClick={() => setDrawer(false)} /><aside className="qj-drawer">
      <div className="qj-drawer-title"><b>栖间</b><button className="qj-icon" aria-label="关闭侧边栏" onClick={()=>setDrawer(false)}>×</button></div>
      <h3 className="qj-label">我的助手</h3>
      {people.map(p => <button className={'qj-assistant '+(p === person?'selected':'')} key={p} onClick={()=>{setPerson(p);setConversation('');setDrawer(false);setView('chat')}}><span className="qj-avatar">{displayName(p).slice(0,1)}</span><span>{displayName(p)}</span><small>›</small></button>)}
      <h3 className="qj-label">当前会话</h3>
      {availableConversations.map(item => { const c=item.title; return <button className={'qj-drawer-conv '+(activeConversation?.id===item.id?'selected':'')} key={c} onClick={()=>{setConversation(item.id);props.onConversationChange?.(item.id);setView('chat');setDrawer(false)}}>{c}</button>})}
      <button className="qj-new" onClick={()=>{props.onCreateConversation?.();setConversation('');setView('chat');setDrawer(false)}}>＋ 新建会话</button>
      <div className="qj-drawer-spacer" />
      <button className="qj-drawer-settings" onClick={()=>go('settings')}>⚙　设置</button>
    </aside></div>}
    
  </div>
}
