import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { apiFetch, assetUrl } from './apiBase.mjs'
import { extractDocumentText, supportedDocumentName } from './documentText'
import { LEGACY_ASSISTANTS, migrateLocalStorage } from './assistantIdentity'
import './LayoutPrototype.css'
import { IconBook, IconPlug, IconBack, IconChevronRight, IconClose, IconHome, IconChat, IconMenu, IconPlus, IconSend, IconStop, IconSettings } from './icons'
import { settingItems } from './layout/sections'
import { RealProviderPreview } from './RealProviderPreview'
import type { Vendor } from './vendors.mjs'
import { SettingsSectionsPreview } from './SettingsSectionsPreview'
import { ModelFunctionsPreview, ScheduledTasksPreview } from './FeaturePagesPreview'
import { AdvancedSettingsPreview } from './AdvancedSettingsPreview'
import { ContentSettingsPreview } from './ContentSettingsPreview'
import { RoomAssistantPreview } from './RoomAssistantPreview'

type View = 'home' | 'chat' | 'room' | 'settings' | 'theme' | 'profile'
type Person = string
type AssistantView = { id: string; name: string }
type MessageView = { role:string; content:string; id?:string; reasoning?:string; attachments?:Attachment[] }
type ConversationView = { id: string; title: string; messages: MessageView[]; updatedAt?:string }
type Attachment = { name:string; type:string; size:number; preview?:string; dataUrl?:string; textContent?:string; assetId?:string }
type LayoutPrototypeProps = {
  renderSubscription?:()=>ReactNode
  renderUsage?:()=>ReactNode
  vendors?:Vendor[]
  onSaveVendors?:(next:Vendor[])=>void
  renderBinding?: (kind:'world'|'mcp')=>ReactNode
  assistants?: AssistantView[]
  conversations?: Record<string,ConversationView[]>
  activeIds?: Record<string,string>
  person?: string
  messages?: MessageView[]
  draft?: string
  sending?: boolean
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
        if(file.size>12*1024*1024){setAttachmentError('文件超过 12 MB：'+file.name);continue}
        const item:Attachment={name:file.name,type:file.type||'application/octet-stream',size:file.size}
        if(file.type.startsWith('image/')){
          item.dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file)})
          item.preview=item.dataUrl
          try {
            const response=await apiFetch('/api/attachments',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:item.name,mime:item.type,data:item.dataUrl.split(',')[1]})})
            if(response.ok){const data=await response.json();if(data.id&&data.url){item.assetId=String(data.id);item.preview=String(data.url)}}
          }catch{/* Keep the in-memory image if the persistence endpoint is unavailable. */}
        }else if(supportedDocumentName(file.name)){
          item.textContent=(await extractDocumentText(file)).text
        }else{setAttachmentError('暂不支持此文件格式：'+file.name);continue}
        added.push(item)
      }
      setAttachments(old=>[...old,...added].slice(0,8))
    }catch(error){setAttachmentError(error instanceof Error?error.message:'附件读取失败')}
    finally{setReadingFiles(false);if(imagePicker.current)imagePicker.current.value='';if(filePicker.current)filePicker.current.value='';if(cameraPicker.current)cameraPicker.current.value=''}
  }
  const [conversation, setConversation] = useState('')
  const availableConversations = data.conversations[person] || []
  const activeConversation = availableConversations.find(c=>c.id===data.activeIds[person]) || availableConversations.find(c=>c.id===conversation) || availableConversations[0]
  const actualMessages = props.messages || activeConversation?.messages || stored<Record<string,MessageView[]>>('ai-home.messages', {})[activeConversation?.id || ''] || []
  const draft = props.draft ?? ''
  const submit = async () => { const text=draft.trim(); if((!text&&!attachments.length)||readingFiles||!props.onSend)return; const result=await props.onSend(text,attachments);if(result==='ok')setAttachments([]) }
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
    setBindingPanel(null)
  }
  const title = view === 'home' ? '栖间' : view === 'chat' ? displayName(person) : view === 'room' ? displayName(person) + '的房间' :
    view === 'settings' ? (section || '设置') :
    view === 'theme' ? '主题中心' : displayName(person) + '的资料'
  return <div className="qj-preview">
    <div className="qj-status" aria-hidden="true" />
    <header className="qj-topbar">
      {(view === 'chat' || view === 'home') ? <button className="qj-icon" aria-label="打开侧边栏" onClick={() => setDrawer(true)}><IconMenu size={18}/></button> :
       <button className="qj-icon" aria-label="返回" onClick={() => {
         if (section) setSection(null)
         else if (view === 'theme') go('settings')
         else go('home')
       }}><IconBack size={18}/></button>}
      {view === 'chat' ? <button className="qj-chat-identity" aria-label="查看当前助手详情" onClick={() => go('profile')}><span className="qj-avatar">{person.slice(0,1)}</span><span className="qj-top-title"><strong>{title}</strong><small>{activeConversation?.title||'新对话'}</small></span></button> : <div className="qj-top-title"><strong>{title}</strong></div>}
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
      {view === 'chat' && <div className="qj-chat">
        <div className="qj-chat-date">{activeConversation?.title || '暂无会话'}</div>
        {actualMessages.map((m,i)=><div key={m.id||i} className={'qj-message '+(m.role==='user'?'mine':'from')+(m.id&&selected.includes(m.id)?' qj-message-selected':'')} onPointerDown={e=>{if(!m.id||selection?.scope===scope|| (e.target as HTMLElement).closest('button,input,textarea'))return;cancelPress();pressStart.current={x:e.clientX,y:e.clientY};pressTimer.current=setTimeout(()=>{setMessageAction({scope,id:m.id!});pressTimer.current=null},500)}} onPointerMove={e=>{if(Math.hypot(e.clientX-pressStart.current.x,e.clientY-pressStart.current.y)>10)cancelPress()}} onPointerUp={cancelPress} onPointerCancel={cancelPress} onContextMenu={e=>{if(m.id){e.preventDefault();setMessageAction({scope,id:m.id})}}} onClick={()=>{if(m.id&&selection?.scope===scope)toggleSelected(m.id)}}>{m.role!=='user'&&<span className="qj-avatar">{displayName(person).slice(0,1)}</span>}<div className="qj-message-content"><p>{m.content}</p>{m.attachments?.map((a,j)=><div key={j} className="qj-message-attachment">{a.type?.startsWith('image/')&&(a.preview||a.dataUrl)?<img src={assetUrl(a.preview||a.dataUrl||'')} alt={a.name}/>:<span>{a.name}</span>}</div>)}{m.id&&messageAction?.scope===scope&&messageAction.id===m.id&&selection?.scope!==scope&&<div className="qj-message-actions"><button onClick={()=>{setMessageEdit({scope,id:m.id!,text:m.content});setMessageAction(null)}}>编辑</button><button onClick={()=>{setSelection({scope,ids:[m.id!]});setMessageAction(null)}}>多选</button>{m.role==='assistant'&&i===actualMessages.length-1&&<button disabled={props.sending} onClick={()=>{setMessageAction(null);void props.onRegenerateMessage?.(m.id!)}}>重新生成</button>}<button onClick={()=>setMessageAction(null)}>关闭</button></div>}{m.id&&messageEdit?.scope===scope&&messageEdit.id===m.id&&<div className="qj-pending-edit"><textarea value={messageEdit.text} onChange={e=>setMessageEdit({...messageEdit,text:e.target.value})}/><button disabled={!messageEdit.text.trim()} onClick={()=>{if(props.onEditMessage?.(m.id!,messageEdit.text))setMessageEdit(null)}}>保存</button><button onClick={()=>setMessageEdit(null)}>取消</button></div>}</div></div>)}
        {selection?.scope===scope&&<div className="qj-message-actions"><button disabled={!selected.length} onClick={()=>{if(window.confirm('删除选中的 '+selected.length+' 条消息？')){props.onDeleteMessages?.(selected);setSelection(null)}}}>删除（{selected.length}）</button><button onClick={()=>setSelection(null)}>取消多选</button></div>}
      </div>}
      {view === 'room' && <div className="qj-page">
        <div className="qj-room-hero"><div className="qj-room-art"><div className="qj-window">☀</div><div className="qj-shelf">▤ ▤ ▤</div><div className="qj-sofa">▰</div><div className="qj-floor"/></div>
          <b>{displayName(person)}的小空间</b><span>自由布置 · 图片 · 视频 · 小组件</span></div>
        <h3 className="qj-label">房间入口</h3>
        <div className="qj-row-group">
          <button className="qj-row" onClick={() => {setView('settings');setSection('房间与助手')}}><span>房间布置</span><small>进入房间与助手设置</small><i><IconChevronRight size={15}/></i></button>
          <button className="qj-row" onClick={() => setSection('我的作品')}><span>我的作品</span><small>图片、视频、音乐</small><i><IconChevronRight size={15}/></i></button>
        </div>
        {section === '我的作品' && <div className="qj-inline-note">「我的作品」归入后续的栖间图库项目，本轮不制作假页面。</div>}
      </div>}
      {view === 'settings' && <div className="qj-page">
        {section ? <>
          {section === '供应商' ? <RealProviderPreview vendors={props.vendors||[]} onSave={next=>props.onSaveVendors?.(next)}/> :
            section === '订阅' ? props.renderSubscription?.() :
            section === 'AI 用量账本' ? props.renderUsage?.() :
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
            <span>{name}</span><small>{desc}</small><i><IconChevronRight size={15}/></i></button>)}</div>
        </>}
      </div>}
      {view === 'theme' && <div className="qj-page">
        <h3 className="qj-label">一键主题包</h3>
        <div className="qj-theme-list">{['银杏奶灰','月影浅紫','夜幕星雾'].map(name => <button key={name} className={'qj-theme-tile ' + (theme === name ? 'selected' : '')} onClick={() => setTheme(name)}><span className={'qj-swatch '+(name==='月影浅紫'?'lavender':name==='夜幕星雾'?'night':'')} /><b>{name}</b><small>{theme === name ? '已选择' : '预览样式'}</small></button>)}</div>
        <p className="qj-inline-note">主题包应用功能留待页面验收后接入。</p>
      </div>}
      {view === 'profile' && <div className="qj-page">
        <div className="qj-profile"><div className="qj-large-avatar">{displayName(person).slice(0, 1)}</div><h2>{displayName(person)}</h2><p>独立助手资料与专属设置</p></div>
        <div className="qj-row-group"><button className="qj-row" onClick={() => go('room')}><span>进入房间</span><i><IconChevronRight size={15}/></i></button><button className="qj-row" onClick={() => {go('settings');setSection('房间与助手')}}><span>专属设置</span><i><IconChevronRight size={15}/></i></button></div>
      </div>}
    </main>
    {view === 'chat' && props.renderBinding && <div className="qj-chat-resource-actions"><button className="qj-icon" aria-label="世界书" onClick={()=>{setToolsOpen(false);setBindingPanel(v=>v==='world'?null:'world')}}><IconBook size={16}/></button><button className="qj-icon" aria-label="MCP" onClick={()=>{setToolsOpen(false);setBindingPanel(v=>v==='mcp'?null:'mcp')}}><IconPlug size={16}/></button></div>}
    {view === 'chat' && bindingPanel && <div className="qj-tool-tray" role="dialog" aria-label={bindingPanel==='world'?'世界书':'MCP'}><strong>{bindingPanel==='world'?'世界书':'MCP'} · {displayName(person)}</strong>{props.renderBinding?.(bindingPanel)}<button onClick={()=>setBindingPanel(null)}>关闭</button></div>}
    {view === 'chat' && props.pending && <div className="qj-attachment-list" aria-label="待发送消息"><span>{props.pending.status==='needs_review'?'等待确认':'待发送'}：{props.pending.text||'附件'}{props.pending.attachments?.map(a=>' · '+(a.name||'附件')).join('')}<button onClick={()=>setPendingEdit({scope,text:props.pending?.text||''})}>编辑</button><button onClick={()=>{setPendingEdit(null);props.onCancelPending?.()}}>撤回</button>{props.pending.status==='needs_review'&&<button disabled={props.sending} onClick={props.onConfirmPending}>发送</button>}</span></div>}
    {view === 'chat' && props.pending && pendingEdit?.scope===scope && <div className="qj-pending-edit"><textarea aria-label="编辑待发送消息" value={pendingEdit.text} onChange={e=>setPendingEdit({scope,text:e.target.value})}/><button onClick={()=>{if(props.onEditPending?.(pendingEdit.text))setPendingEdit(null)}} disabled={!pendingEdit.text.trim()&&!props.pending.attachments?.length}>保存</button><button onClick={()=>setPendingEdit(null)}>取消</button></div>}
    {view === 'chat' && attachments.length>0 && <div className="qj-attachment-list" aria-label="待发送附件">{attachments.map((a,i)=><span key={i}>{a.name}<button type="button" aria-label={'移除 '+a.name} onClick={()=>setAttachments(old=>old.filter((_,j)=>i!==j))}>×</button></span>)}</div>}
    {view === 'chat' && attachmentError && <div className="qj-chat-error" role="alert">{attachmentError}</div>}
    <input ref={imagePicker} hidden type="file" accept="image/*" multiple onChange={e=>void addFiles(e.target.files)}/>
    <input ref={filePicker} hidden type="file" multiple onChange={e=>void addFiles(e.target.files)}/>
    <input ref={cameraPicker} hidden type="file" accept="image/*" capture="environment" onChange={e=>void addFiles(e.target.files)}/>
    {view === 'chat' && <div className="qj-composer"><button className="qj-icon" aria-label="添加附件" onClick={() => {setBindingPanel(null);setToolsOpen(v=>!v)}}><IconPlus size={18}/></button><textarea className="qj-compose-input" value={draft} onChange={e=>props.onDraftChange?.(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} placeholder="输入消息…" rows={1}/>{props.sending&&!draft.trim()&&!attachments.length?<button className="qj-send" aria-label="停止生成" onClick={props.onStop}><IconStop size={16}/></button>:<button className="qj-send" aria-label="发送" disabled={(!draft.trim()&&!attachments.length)||readingFiles} onClick={()=>void submit()}><IconSend size={17}/></button>}</div>}
    {view === 'chat' && props.chatError && <div className="qj-chat-error" role="status">{props.chatError}</div>}
    <nav className="qj-bottom" aria-label="主要导航">
      <button className={view === 'home'||view === 'chat'?'active':''} onClick={() => go('home')}><span><IconHome size={19}/></span>主页</button>
      <button className={view === 'room'?'active':''} onClick={() => go('room')}><span><IconChat size={19}/></span>房间</button>
      <button className={view === 'settings'||view==='theme'?'active':''} onClick={() => go('settings')}><span><IconSettings size={19}/></span>设置</button>
    </nav>
    {toolsOpen && <div className="qj-tool-tray" role="dialog" aria-label="添加聊天附件"><strong>添加附件</strong><div className="qj-attachment-actions"><button onClick={()=>{setToolsOpen(false);imagePicker.current?.click()}}>图片</button><button onClick={()=>{setToolsOpen(false);filePicker.current?.click()}}>文件</button><button onClick={()=>{setToolsOpen(false);cameraPicker.current?.click()}}>拍照</button><button onClick={()=>setToolsOpen(false)}>收起</button></div></div>}
    {drawer && <div className="qj-drawer-layer"><button className="qj-scrim" aria-label="关闭菜单" onClick={() => setDrawer(false)} /><aside className="qj-drawer">
      <div className="qj-drawer-title"><b>栖间</b><button className="qj-icon" aria-label="关闭侧边栏" onClick={()=>setDrawer(false)}><IconClose size={18}/></button></div>
      <h3 className="qj-label">我的助手</h3>
      {people.map(p => <button className={'qj-assistant '+(p === person?'selected':'')} key={p} onClick={()=>{setPerson(p);setConversation('');setDrawer(false);setView('chat')}}><span className="qj-avatar">{displayName(p).slice(0,1)}</span><span>{displayName(p)}</span><small><IconChevronRight size={15}/></small></button>)}
      <h3 className="qj-label">当前会话</h3>
      {availableConversations.map(item => { const c=item.title; return <button className={'qj-drawer-conv '+(activeConversation?.id===item.id?'selected':'')} key={item.id} onClick={()=>{setConversation(item.id);props.onConversationChange?.(item.id);setView('chat');setDrawer(false)}}>{c}</button>})}
      <button className="qj-new" onClick={()=>{props.onCreateConversation?.();setConversation('');setView('chat');setDrawer(false)}}><IconPlus size={15}/> 新建会话</button>
      <div className="qj-drawer-spacer" />
      <button className="qj-drawer-settings" onClick={()=>go('settings')}><IconSettings size={16}/>设置</button>
    </aside></div>}
    
  </div>
}
