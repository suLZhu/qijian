import { ChatDisplaySettings, useChatDisplay } from './ChatDisplay'
import { formatMessageTime } from './chatDisplayPrefs.mjs'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { assetUrl } from './apiBase.mjs'
import { RichText } from './RichText'
import { cleanupMessageText } from './messageCleanup.mjs'
import { readChatAttachment } from './chatAttachment'
import { LEGACY_ASSISTANTS, migrateLocalStorage } from './assistantIdentity'
import './AppLayout.css'
import { IconBook, IconPlug, IconBack, IconChevronRight, IconClose, IconHome, IconChat, IconMenu, IconPlus, IconSend, IconStop, IconSettings } from './icons'
import { settingItems } from './layout/sections'
import { SoftSelect } from './SoftSelect'
import { confirmDialog } from './uiDialog'
import { pushBackHandler } from './backStack.mjs'
import { RoomWidgets } from './RoomWidgets'

type View = 'home' | 'chat' | 'room' | 'settings' | 'theme' | 'profile'
type Person = string
type AssistantView = { id: string; name: string; avatar?:string }
type MessageView = { at?: string; usage?: { at?: string; promptTokens?: number; completionTokens?: number }; role:string; content:string; id?:string; reasoning?:string; taskRunId?:string; contextNote?:string; taskDetails?:string; attachments?:Attachment[] }
type ConversationView = { archived?: boolean; id: string; title: string; messages: MessageView[]; updatedAt?:string }
type Attachment = { name:string; type:string; size:number; preview?:string; dataUrl?:string; textContent?:string; assetId?:string }
type AppLayoutProps = {
  modelLabel?:string
  renderModelPicker?:(close:()=>void)=>ReactNode
  appearanceStyle?:CSSProperties
  chatBackground?:string
  bubbleStyle?:string
  chatBackgroundUrl?:string
  bubbleImageUrl?:string
  userAvatar?:string
  userName?:string
  onRenameConversation?:(id:string,title:string)=>void
  onTranslateReasoning?:(text:string)=>Promise<string>
  openChatSignal?:number
  openSettingsSignal?:number
  onViewChange?:(view:View)=>void
  renderSubscription?:()=>ReactNode
  renderTasks?:(person:string)=>ReactNode
  renderSystem?: () => ReactNode
  renderRoomScene?: (person: string, onAction: (action: string) => void) => ReactNode
  renderSettings?: (section: string, person: string) => ReactNode
  renderProfile?: (person: string) => ReactNode
  renderBackup?: () => ReactNode
  renderResource?:(kind:'world'|'mcp')=>ReactNode
  renderBinding?: (kind:'world'|'mcp')=>ReactNode
  assistants?: AssistantView[]
  conversations?: Record<string,ConversationView[]>
  activeIds?: Record<string,string>
  person?: string
  messages?: MessageView[]
  draft?: string
  sending?: boolean
  generationStage?: string
  pending?: {text:string;status:string;attachments?:{name?:string}[]}
  onCancelPending?:()=>void
  onEditPending?:(text:string)=>boolean
  onStop?:()=>void
  onEditMessage?:(id:string,text:string)=>boolean
  onDeleteMessages?:(ids:string[])=>void
  onRegenerateMessage?:(id:string)=>Promise<unknown>
  onConfirmPending?:()=>void
  chatError?: string
  onPersonChange?: (id:string)=>void
  onConversationChange?: (id:string)=>void
  onCreateConversation?: ()=>void
  onArchiveConversation?: (id: string, archived: boolean) => void
  onDeleteConversation?: (id:string)=>void|Promise<void>
  onDraftChange?: (value:string)=>void
  onSend?: (text:string,attachments:Attachment[])=>void|Promise<unknown>
}
function stored<T>(key:string, fallback:T):T { try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback } }
function readAssistantState() {
  migrateLocalStorage()
  const assistants = stored<AssistantView[]>('ai-home.assistants', LEGACY_ASSISTANTS.map(a => ({...a})))
  const conversations = stored<Record<string,ConversationView[]>>('ai-home.conversations', {})
  const activeIds = stored<Record<string,string>>('ai-home.activeConversationIds', {})
  return { assistants: assistants.length ? assistants : LEGACY_ASSISTANTS.map(a=>({...a})), conversations, activeIds }
}


export default function AppLayout(props:AppLayoutProps = {}) {
  const [view, setView] = useState<View>(()=>{try{return sessionStorage.getItem('ai-home.afterRestoreSection')==='data'?'settings':'home'}catch{return 'home'}})
  useEffect(() => { props.onViewChange?.(view) }, [view])
  useEffect(() => {
    if (!props.openChatSignal) return
    setView('chat')
    setSection(null)
    setDrawer(false)
    setToolsOpen(false)
    setBindingPanel(null)
  }, [props.openChatSignal])
  useEffect(() => {
    if (!props.openSettingsSignal) return
    setView('settings')
    setSection('数据与连接')
    setDrawer(false)
    setToolsOpen(false)
    setBindingPanel(null)
  }, [props.openSettingsSignal])
  const [storedData] = useState(readAssistantState)
  const data = { assistants: props.assistants || storedData.assistants, conversations: props.conversations || storedData.conversations, activeIds: props.activeIds || storedData.activeIds }
  const people = data.assistants.map(a=>a.id)
  const [localPerson, setLocalPerson] = useState<Person>(()=>readAssistantState().assistants[0]?.id || LEGACY_ASSISTANTS[0].id)
  const person = props.person || localPerson
  const [settingsAssistant,setSettingsAssistant]=useState('')
  const settingsPerson=people.includes(settingsAssistant)?settingsAssistant:people.includes(person)?person:people[0]||person
  const setPerson = (id:string) => { if(props.onPersonChange) props.onPersonChange(id); else setLocalPerson(id) }
  const displayName = (id:string)=>data.assistants.find(a=>a.id===id)?.name || id
  const avatar=(id:string)=>{const src=(data.assistants.find(a=>a.id===id) as AssistantView|undefined)?.avatar;return src?<img src={assetUrl(src)} alt=""/>:displayName(id).slice(0,1)}
  const [modelOpen,setModelOpen]=useState(false)
  const [rename,setRename]=useState<{id:string;title:string}|null>(null)
  const [translations,setTranslations]=useState<Record<string,string>>({})
  const [clock,setClock]=useState(()=>new Date())
  useEffect(()=>{const timer=window.setInterval(()=>setClock(new Date()),15000);return()=>window.clearInterval(timer)},[])
  const [drawer, setDrawer] = useState(false)
  const [section, setSection] = useState<string | null>(()=>{try{if(sessionStorage.getItem('ai-home.afterRestoreSection')==='data'){sessionStorage.removeItem('ai-home.afterRestoreSection');return '数据与连接'}}catch{}return null})
  const [subsection,setSubsection]=useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [pendingEdit,setPendingEdit]=useState<{scope:string;text:string}|null>(null)
  const [bindingPanel,setBindingPanel]=useState<'world'|'mcp'|null>(null)
  const scope=JSON.stringify([person,data.activeIds[person]||''])
  const [attachmentDrafts,setAttachmentDrafts]=useState<Record<string,Attachment[]>>({})
  const attachments=attachmentDrafts[scope]||[]
  const [messageAction,setMessageAction]=useState<{scope:string;id:string}|null>(null)
  const [messageEdit,setMessageEdit]=useState<{scope:string;id:string;text:string}|null>(null)
  const [selection,setSelection]=useState<{scope:string;ids:string[]}|null>(null)
  const selected=selection?.scope===scope?selection.ids:[]
  const pressTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const pressStart=useRef({x:0,y:0})
  const cancelPress=()=>{if(pressTimer.current!==null){clearTimeout(pressTimer.current);pressTimer.current=null}}
  useLayoutEffect(()=>()=>cancelPress(),[scope,view])
  const toggleSelected=(id:string)=>setSelection(old=>({scope,ids:old?.scope===scope&&old.ids.includes(id)?old.ids.filter(x=>x!==id):[...(old?.scope===scope?old.ids:[]),id]}))
  const setAttachments=(update:Attachment[]|((old:Attachment[])=>Attachment[]))=>setAttachmentDrafts(old=>({...old,[scope]:typeof update==='function'?update(old[scope]||[]):update}))
  const [attachmentError,setAttachmentError] = useState('')
  const [readingFiles,setReadingFiles] = useState(false)
  const imagePicker=useRef<HTMLInputElement>(null)
  const filePicker=useRef<HTMLInputElement>(null)
  const cameraPicker=useRef<HTMLInputElement>(null)
  async function addFiles(list:FileList|null){
    if(!list)return
    setReadingFiles(true);setAttachmentError('')
    const added:Attachment[]=[]
    try {
      for(const file of Array.from(list).slice(0,8-attachments.length)){
        try { added.push(await readChatAttachment(file)) }
        catch (error) { setAttachmentError(file.name + ' · ' + (error instanceof Error ? error.message : '附件读取失败')) }
      }
      setAttachments(old=>[...old,...added].slice(0,8))
    }catch(error){setAttachmentError(error instanceof Error?error.message:'附件读取失败')}
    finally{setReadingFiles(false);if(imagePicker.current)imagePicker.current.value='';if(filePicker.current)filePicker.current.value='';if(cameraPicker.current)cameraPicker.current.value=''}
  }
  const [conversation, setConversation] = useState('')
  const availableConversations = data.conversations[person] || []
  const activeConversation = availableConversations.find(c=>!c.archived && c.id===data.activeIds[person]) || availableConversations.find(c=>!c.archived && c.id===conversation) || availableConversations.find(c=>!c.archived)
  const actualMessages = props.messages || activeConversation?.messages || stored<Record<string,MessageView[]>>('ai-home.messages', {})[activeConversation?.id || ''] || []
  const draft = props.draft ?? ''
  const submit = async () => { const text=draft.trim(); if((!text&&!attachments.length)||readingFiles||!props.onSend)return; const result=await props.onSend(text,attachments);if(result==='ok')setAttachments(old=>old.filter(attachment=>!attachments.includes(attachment))) }
  const mainRef = useRef<HTMLElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const prependPosition = useRef<{ scope: string; height: number; top: number } | null>(null)
  const [historyWindow, setHistoryWindow] = useState({ scope: '', limit: 40 })
  const historyLimit = historyWindow.scope === scope ? historyWindow.limit : 40
  const display = useChatDisplay()
  const stage = props.generationStage
  const showGeneration = props.sending && stage !== 'streaming'
  const generationLabel = stage === 'tools' ? '调用工具' : stage === 'connecting' ? '连接中' : '准备中'

  const historyStart = Math.max(0, actualMessages.length - historyLimit)

  function loadOlderMessages() {
    const main = mainRef.current
    if (!main) return
    followLatest.current = false
    prependPosition.current = { scope, height: main.scrollHeight, top: main.scrollTop }
    setHistoryWindow({ scope, limit: historyLimit + 40 })
  }

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
  useLayoutEffect(() => {
    if (view !== 'chat' || !mainRef.current || !chatRef.current) return
    const main = mainRef.current
    followLatest.current = true
    prependPosition.current = null
    const scrollToLatest = () => {
      if (followLatest.current) main.scrollTop = main.scrollHeight
    }
    scrollToLatest()
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(chatRef.current)
    return () => observer.disconnect()
  }, [scope, view])

  useLayoutEffect(() => {
    const anchor = prependPosition.current
    const main = mainRef.current
    if (!anchor || !main || anchor.scope !== scope) return
    prependPosition.current = null
    main.scrollTop = anchor.top + main.scrollHeight - anchor.height
  }, [historyLimit, scope])

  function openSection(name: string) {
    if (view === 'settings' && !section) settingsScrollRef.current = mainRef.current?.scrollTop || 0
    setSubsection('')
    setSection(name)
  }

  function go(next: View) {
    setModelOpen(false)
    setView(next)
    setSection(null)
    setDrawer(false)
    setToolsOpen(false)
    setBindingPanel(null)
  }
  const backState = useRef<()=>boolean>(()=>false)
  backState.current=()=>{
    if(modelOpen){setModelOpen(false);return true}
    if(rename){setRename(null);return true}
    if(messageEdit){setMessageEdit(null);return true}
    if(messageAction){setMessageAction(null);return true}
    if(selection){setSelection(null);return true}
    if(pendingEdit){setPendingEdit(null);return true}
    if(bindingPanel){setBindingPanel(null);return true}
    if(toolsOpen){setToolsOpen(false);return true}
    if(drawer){setDrawer(false);return true}
    if(section){setSection(null);return true}
    if(view!=='home'){go('home');return true}
    return false
  }
  useEffect(()=>pushBackHandler(()=>backState.current()),[])
  const title = view === 'home' ? '栖间' : view === 'chat' ? displayName(person) : view === 'room' ? displayName(person) + '的房间' :
    view === 'settings' ? (section || '设置') :
    view === 'theme' ? '主题中心' : displayName(person) + '的资料'
  return <div className="qj-preview" style={props.appearanceStyle}>
    <div className="qj-status" aria-hidden="true" />
    <header className="qj-topbar">
      {(view === 'chat' || view === 'home') ? <button className="qj-icon" aria-label="打开侧边栏" onClick={() => setDrawer(true)}><IconMenu size={18}/></button> :
       <button className="qj-icon" aria-label="返回" onClick={() => {
         if (section) setSection(null)
         else if (view === 'theme') go('settings')
         else go('home')
       }}><IconBack size={18}/></button>}
      {view === 'chat' ? <button className="qj-chat-identity" aria-label="查看当前助手详情" onClick={() => go('profile')}><span className="qj-avatar">{avatar(person)}</span><span className="qj-top-title"><strong>{title}</strong><small>{activeConversation?.title||'新对话'}</small></span></button> : <div className="qj-top-title"><strong>{title}</strong></div>}
      {view === 'chat' && <div className="qj-chat-switch" aria-label="快速切换聊天助手">
        {people.map(p => <button key={p} className={p === person ? 'selected' : ''} onClick={() => setPerson(p)} aria-pressed={p === person}>{displayName(p)}</button>)}
      </div>}


    </header>
    <main className={view === 'chat' ? 'qj-main qj-chat-scroll' : 'qj-main'} ref={mainRef} onScroll={event => {
      if (view !== 'chat') return
      const main = event.currentTarget
      followLatest.current = main.scrollHeight - main.clientHeight - main.scrollTop < 48
    }}>
      {view === 'home' && <div className="qj-home">
        <div className="qj-home-hero"><strong>{clock.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</strong><span>{clock.toLocaleDateString('zh-CN',{weekday:'long',month:'long',day:'numeric'})}</span><p>{clock.getHours()<6?'夜深了':clock.getHours()<12?'早上好':clock.getHours()<18?'下午好':'晚上好'}。欢迎回家。</p></div>
        <div className="qj-home-people">
          {people.map(p => <button key={p} className="qj-home-person" onClick={() => { setPerson(p); go('chat') }}>
            <span className="qj-home-avatar">{avatar(p)}</span>
            <span className="qj-home-person-info"><b>{displayName(p)}</b><small>{data.conversations[p]?.[0]?.title || '暂无会话'}</small><em>{data.conversations[p]?.length || 0} 个会话</em></span>
            <span className="qj-home-chevron"><IconChevronRight size={16}/></span>
          </button>)}
        </div>
        <div className="qj-home-heading">今 天 的 事</div>
        <div className="qj-row-group">
          <button className="qj-row" onClick={() => go('profile')}><span>认识的日子</span><small>从第一次聊天算起</small><i><IconChevronRight size={15}/></i></button>
          <button className="qj-row" onClick={() => go('room')}><span>日程与约定</span><small>查看助手房间中的日常</small><i><IconChevronRight size={15}/></i></button>
          <button className="qj-row" onClick={() => go('settings')}><span>记忆与记录</span><small>在设置中查看管理</small><i><IconChevronRight size={15}/></i></button>
        </div>
      </div>}
      {view === 'chat' && <div className="qj-chat" ref={chatRef} data-background={props.chatBackground} data-bubble={props.bubbleStyle} style={{ fontSize: display.fontSize, backgroundImage:props.chatBackgroundUrl?`url(${assetUrl(props.chatBackgroundUrl)})`:undefined, ...(props.bubbleImageUrl?{"--qj-bubble-image":`url(${assetUrl(props.bubbleImageUrl)})`}:{}) } as CSSProperties}>
        <div className="qj-chat-date">{activeConversation?.title || '暂无会话'}</div>
        {historyStart > 0 && <button type="button" className="qj-history-more" onClick={loadOlderMessages}>加载更早消息</button>}
        {actualMessages.slice(historyStart).map((m,i)=><div key={m.id||historyStart+i} className={'qj-message '+(m.role==='user'?'mine':'from')+(m.id&&selected.includes(m.id)?' qj-message-selected':'')} onPointerDown={e=>{if(!m.id||selection?.scope===scope|| (e.target as HTMLElement).closest('button,input,textarea,summary'))return;cancelPress();pressStart.current={x:e.clientX,y:e.clientY};pressTimer.current=setTimeout(()=>{setMessageAction({scope,id:m.id!});pressTimer.current=null},500)}} onPointerMove={e=>{if(Math.hypot(e.clientX-pressStart.current.x,e.clientY-pressStart.current.y)>10)cancelPress()}} onPointerUp={cancelPress} onPointerCancel={cancelPress} onContextMenu={e=>{if(m.id){e.preventDefault();setMessageAction({scope,id:m.id})}}} onClick={()=>{if(m.id&&selection?.scope===scope)toggleSelected(m.id)}}>{m.role!=='user'&&display.assistantAvatar&&<span className="qj-avatar">{avatar(person)}</span>}<div className="qj-message-content">{(display.time || (m.role === 'user' ? display.userName : display.assistantName)) && <div className="qj-message-meta">
          {m.role==='user' ? (display.userName && (props.userName||'我')) : (display.assistantName && displayName(person))} {display.time && formatMessageTime(m)}
        </div>}{m.taskRunId&&<details className="reasoning"><summary>定时任务</summary><div className="reasoning-body">{m.taskDetails||m.contextNote||'定时任务'}</div></details>}{m.role==='assistant'&&display.showReasoning&&m.reasoning&&<details className="reasoning"><summary>思考过程</summary><div className="reasoning-body">{cleanupMessageText(m.reasoning)}{m.id&&props.onTranslateReasoning&&<><button onClick={async()=>{const key=scope+m.id;try{const result=await props.onTranslateReasoning!(m.reasoning!);setTranslations(old=>({...old,[key]:result}))}catch(error){setTranslations(old=>({...old,[key]:String(error)}))}}}>翻译</button>{translations[scope+m.id]&&<p>{translations[scope+m.id]}</p>}</>}</div></details>}{m.role==='assistant'?<RichText text={cleanupMessageText(m.content||'')}/>:<p>{m.content}</p>}{display.token && m.usage && <details className="reasoning"><summary>Token 用量</summary><div className="reasoning-body">输入 {m.usage.promptTokens ?? '—'} · 输出 {m.usage.completionTokens ?? '—'}</div></details>}{m.attachments?.map((a,j)=><div key={j} className="qj-message-attachment">{a.type?.startsWith('image/')&&(a.preview||a.dataUrl)?<img src={assetUrl(a.preview||a.dataUrl||'')} alt={a.name}/>:<span>{a.name}</span>}</div>)}{m.id&&messageAction?.scope===scope&&messageAction.id===m.id&&selection?.scope!==scope&&<div className="qj-message-actions"><button onClick={()=>{setMessageEdit({scope,id:m.id!,text:m.content});setMessageAction(null)}}>编辑</button><button onClick={()=>{setSelection({scope,ids:[m.id!]});setMessageAction(null)}}>多选</button>{m.role==='assistant'&&historyStart+i===actualMessages.length-1&&<button disabled={props.sending} onClick={()=>{setMessageAction(null);void props.onRegenerateMessage?.(m.id!)}}>重新生成</button>}<button onClick={()=>setMessageAction(null)}>关闭</button></div>}{m.id&&messageEdit?.scope===scope&&messageEdit.id===m.id&&<div className="qj-pending-edit"><textarea value={messageEdit.text} onChange={e=>setMessageEdit({...messageEdit,text:e.target.value})}/><button disabled={!messageEdit.text.trim()} onClick={()=>{if(props.onEditMessage?.(m.id!,messageEdit.text))setMessageEdit(null)}}>保存</button><button onClick={()=>setMessageEdit(null)}>取消</button></div>}</div>{m.role==='user'&&display.userAvatar&&<span className="qj-avatar">{props.userAvatar?<img src={assetUrl(props.userAvatar)} alt=""/>:(props.userName||'我').slice(0,1)}</span>}</div>)}
        {showGeneration && <span className="qj-generation-status" role="status">
          <span className="qj-generation-dot" aria-hidden="true"/>{generationLabel}
        </span>}
        {selection?.scope===scope&&<div className="qj-message-actions"><button disabled={!selected.length} onClick={async()=>{if(await confirmDialog({title:'删除消息',message:'删除选中的 '+selected.length+' 条消息？',danger:true,confirmLabel:'删除'})){props.onDeleteMessages?.(selected);setSelection(null)}}}>删除（{selected.length}）</button><button onClick={()=>setSelection(null)}>取消多选</button></div>}
      </div>}
      {view === 'room' && <div className="qj-page">
        {props.renderRoomScene?.(person,action=>{
          if(action==='chat') go('chat')
          else if(action==='settings') go('settings')
          else if(action==='world'||action==='mcp') {
            go('settings')
            setSection('世界书与 MCP'); setSubsection(action==='world'?'世界书':'MCP')
          }
        })}
        <button className="qj-row" onClick={() => go('profile')}><span>助手档案</span><i><IconChevronRight size={15}/></i></button>
        <RoomWidgets key={person} person={person}/>
      </div>}
      {view === 'settings' && <div className="qj-page">
        {section ? <>
          {
            section === '安卓原生设置' ? props.renderSystem?.() :
            <SettingsContent key={section} section={section} selected={subsection} onSelect={setSubsection} render={tab=>{
              if(tab==='中转') return props.renderSettings?.('中转',person)
              if(tab==='订阅账号') return props.renderSubscription?.()
              if(tab==='世界书'||tab==='MCP') return props.renderResource?.(tab==='世界书'?'world':'mcp')
              if(tab==='备份与恢复') return props.renderBackup?.()
              if(['定时任务','自主生活','记忆管理','工具看板','SKILL','助手主题'].includes(tab)) return <><div className="qj-settings-assistant"><span>选择助手</span><SoftSelect ariaLabel="选择助手" value={settingsPerson} options={people.map(id=>({value:id,label:displayName(id)}))} onChange={setSettingsAssistant}/></div><div key={tab+settingsPerson}>{tab==='定时任务'?props.renderTasks?.(settingsPerson):props.renderSettings?.(tab,settingsPerson)}</div></>
              if(tab==='聊天展示') return <ChatDisplaySettings compact/>
              return props.renderSettings?.(tab,person)
            }}/>}

        </> : <>
          
          <div className="qj-row-group">{settingItems.map(([name, desc]) => <button key={name} className="qj-row" onClick={() => openSection(name)}>
            <span>{name}</span><small>{desc}</small><i><IconChevronRight size={15}/></i></button>)}</div>
        </>}
      </div>}
      {view === 'profile' && <div className="qj-page">
        {props.renderProfile?.(person)}
        <button className="qj-row" onClick={() => go('room')}><span>进入房间</span><i><IconChevronRight size={15}/></i></button>
      </div>}
    </main>
    {view === 'chat' && props.renderBinding && <div className="qj-chat-resource-actions">{props.renderModelPicker&&<button className="qj-conversation-action" aria-label="选择模型" onClick={()=>{setBindingPanel(null);setToolsOpen(false);setModelOpen(true)}}>{props.modelLabel||'选择模型'}</button>}<button className="qj-icon" aria-label="世界书" onClick={()=>{setToolsOpen(false);setBindingPanel(v=>v==='world'?null:'world')}}><IconBook size={16}/></button><button className="qj-icon" aria-label="MCP" onClick={()=>{setToolsOpen(false);setBindingPanel(v=>v==='mcp'?null:'mcp')}}><IconPlug size={16}/></button></div>}
    {view === 'chat' && modelOpen && props.renderModelPicker?.(()=>setModelOpen(false))}
    {view === 'chat' && bindingPanel && <div className="qj-tool-tray" role="dialog" aria-label={bindingPanel==='world'?'世界书':'MCP'}><strong>{bindingPanel==='world'?'世界书':'MCP'} · {displayName(person)}</strong>{props.renderBinding?.(bindingPanel)}<button onClick={()=>setBindingPanel(null)}>关闭</button></div>}
    {view === 'chat' && props.pending && <div className="qj-attachment-list" aria-label="待发送消息"><span>{props.pending.status==='needs_review'?'等待确认':'待发送'}：{props.pending.text||'附件'}{props.pending.attachments?.map(a=>' · '+(a.name||'附件')).join('')}<button onClick={()=>setPendingEdit({scope,text:props.pending?.text||''})}>编辑</button><button onClick={()=>{setPendingEdit(null);props.onCancelPending?.()}}>撤回</button>{props.pending.status==='needs_review'&&<button disabled={props.sending} onClick={props.onConfirmPending}>发送</button>}</span></div>}
    {view === 'chat' && props.pending && pendingEdit?.scope===scope && <div className="qj-pending-edit"><textarea aria-label="编辑待发送消息" value={pendingEdit.text} onChange={e=>setPendingEdit({scope,text:e.target.value})}/><button onClick={()=>{if(props.onEditPending?.(pendingEdit.text))setPendingEdit(null)}} disabled={!pendingEdit.text.trim()&&!props.pending.attachments?.length}>保存</button><button onClick={()=>setPendingEdit(null)}>取消</button></div>}
    {view === 'chat' && attachments.length>0 && <div className="qj-attachment-list" aria-label="待发送附件">{attachments.map((a,i)=><span key={i}>{a.name}<button type="button" aria-label={'移除 '+a.name} onClick={()=>setAttachments(old=>old.filter((_,j)=>i!==j))}>×</button></span>)}</div>}
    {view === 'chat' && attachmentError && <div className="qj-chat-error" role="alert">{attachmentError}</div>}
    <input ref={imagePicker} hidden type="file" accept="image/*" multiple onChange={e=>void addFiles(e.target.files)}/>
    <input ref={filePicker} hidden type="file" multiple onChange={e=>void addFiles(e.target.files)}/>
    <input ref={cameraPicker} hidden type="file" accept="image/*" capture="environment" onChange={e=>void addFiles(e.target.files)}/>
    {view === 'chat' && <div className="qj-composer"><button className="qj-icon" aria-label="添加附件" onClick={() => {setBindingPanel(null);setToolsOpen(v=>!v)}}><IconPlus size={18}/></button><textarea className="qj-compose-input" value={draft} onChange={e=>props.onDraftChange?.(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit()}}} placeholder="输入消息…" rows={1}/>{props.sending&&!draft.trim()&&!attachments.length?<button className="qj-send" aria-label="停止生成" onClick={props.onStop}><IconStop size={16}/></button>:<button className="qj-send" aria-label="发送" disabled={(!draft.trim()&&!attachments.length)||readingFiles} onClick={()=>void submit()}><IconSend size={17}/></button>}</div>}
    {view === 'chat' && props.chatError && <div className="qj-chat-error" role="status">{props.chatError}</div>}
    <nav className="qj-bottom" aria-label="主要导航">
      <button className={view === 'home'||view === 'chat'?'active':''} onClick={() => go('home')}><span><IconHome size={19}/></span>主页</button>
      <button className={view === 'room'?'active':''} onClick={() => go('room')}><span><IconChat size={19}/></span>房间</button>
      <button className={view === 'settings'||view==='theme'?'active':''} onClick={() => go('settings')}><span><IconSettings size={19}/></span>设置</button>
    </nav>
    {view==='chat'&&(toolsOpen||bindingPanel)&&<button className="qj-chat-scrim" aria-label="关闭聊天工具" onClick={()=>{setToolsOpen(false);setBindingPanel(null)}}/>}
    {view==='chat'&&toolsOpen && <div className="qj-tool-tray" role="dialog" aria-label="添加聊天附件"><strong>添加附件</strong><div className="qj-attachment-actions"><button onClick={()=>{setToolsOpen(false);imagePicker.current?.click()}}>图片</button><button onClick={()=>{setToolsOpen(false);filePicker.current?.click()}}>文件</button><button onClick={()=>{setToolsOpen(false);cameraPicker.current?.click()}}>拍照</button><button onClick={()=>setToolsOpen(false)}>收起</button></div></div>}
    {drawer && <div className="qj-drawer-layer"><button className="qj-scrim" aria-label="关闭菜单" onClick={() => setDrawer(false)} /><aside className="qj-drawer">
      <div className="qj-drawer-title"><b>栖间</b><button className="qj-icon" aria-label="关闭侧边栏" onClick={()=>setDrawer(false)}><IconClose size={18}/></button></div>
      <h3 className="qj-label">我的助手</h3>
      {people.map(p => <button className={'qj-assistant '+(p === person?'selected':'')} key={p} onClick={()=>{setPerson(p);setConversation('');setDrawer(false);setView('chat')}}><span className="qj-avatar">{avatar(p)}</span><span>{displayName(p)}</span><small><IconChevronRight size={15}/></small></button>)}
      <h3 className="qj-label">当前会话</h3>
      <div className="qj-conversation-list">
        {availableConversations.filter(item => !item.archived).map(item => <div className="qj-conversation-row" key={item.id}>
          <button className={'qj-drawer-conv ' + (activeConversation?.id === item.id ? 'selected' : '')} onClick={() => {
            setConversation(item.id); props.onConversationChange?.(item.id); setView('chat'); setDrawer(false)
          }}>{item.title}</button>
          {props.onRenameConversation&&<button className="qj-conversation-action" onClick={()=>setRename({id:item.id,title:item.title})}>改名</button>}
          {props.onDeleteConversation&&<button className="qj-conversation-action" onClick={()=>void props.onDeleteConversation?.(item.id)}>删除</button>}
          {rename?.id===item.id&&<div className="qj-pending-edit"><input aria-label="会话名称" value={rename.title} onChange={e=>setRename({...rename,title:e.target.value})}/><button disabled={!rename.title.trim()} onClick={()=>{props.onRenameConversation?.(item.id,rename.title.trim());setRename(null)}}>保存</button><button onClick={()=>setRename(null)}>取消</button></div>}
          {props.onArchiveConversation && <button className="qj-conversation-action" aria-label={'归档 ' + item.title} onClick={() => props.onArchiveConversation?.(item.id, true)}>归档</button>}
        </div>)}
        {availableConversations.some(item => item.archived) && <details className="qj-archived">
          <summary>已归档</summary>
          {availableConversations.filter(item => item.archived).map(item => <div className="qj-conversation-row" key={item.id}>
            <span>{item.title}</span>
            <button className="qj-conversation-action" aria-label={'恢复 ' + item.title} onClick={() => props.onArchiveConversation?.(item.id, false)}>恢复</button>
          </div>)}
        </details>}
      </div>
      <button className="qj-new" onClick={()=>{props.onCreateConversation?.();setConversation('');setView('chat');setDrawer(false)}}><IconPlus size={15}/> 新建会话</button>
      <div className="qj-drawer-spacer" />
      <button className="qj-drawer-settings" onClick={()=>go('settings')}><IconSettings size={16}/>设置</button>
    </aside></div>}
    
  </div>
}

const settingTabs: Record<string,string[]> = {
  '外观与主题':['全局主题','助手主题'],
  '供应商与订阅':['中转','订阅账号'],
  '模型功能':['聊天模型','模型目录','生图','视频','语音','听觉'],
  '聊天与消息':['聊天展示','上下文','信息注入'],
  '世界书与 MCP':['MCP','世界书','SKILL'],
  '主动任务':['定时任务','自主生活'],
  '数据与连接':['备份与恢复','可选云同步'],
  '诊断与维护':['请求诊断','工具看板','缓存'],
}
function SettingsContent({section,selected,onSelect,render}:{section:string;selected:string;onSelect:(v:string)=>void;render:(v:string)=>ReactNode}){
  const tabs=settingTabs[section]||[section]
  const current=tabs.includes(selected)?selected:tabs[0]
  return <>{tabs.length>1&&<SoftSelect ariaLabel={section} value={current} options={tabs.map(value=>({value,label:value}))} onChange={onSelect}/>}<div key={current}>{render(current)}</div></>
}
