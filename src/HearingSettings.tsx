import {appendDiagLog,buildDiagSnapshot,loadDiagLogs,saveDiagLogs} from './requestDiag.mjs'
import {recordMediaUsage} from './usageLedger.mjs'
import {useEffect,useRef,useState} from 'react'
import {recognizeAudio} from './hearingProtocol.mjs'
import {type Vendor} from './vendors.mjs'
import {apiFetch,isLocalMode} from './apiBase.mjs'

type Config={vendor:string;model:string;path:string;mode:'transcribe'|'understand';trigger:string;triggerIntervalSeconds:number;sentinelEnabled:boolean}
const defaults:Config={mode:'transcribe',vendor:'',model:'whisper-1',path:'audio/transcriptions',trigger:'',triggerIntervalSeconds:120,sentinelEnabled:false}
export function HearingSettings({vendors,person,onUse}:{vendors:Vendor[];person:string;onUse?:(text:string)=>void}){
  const available=vendors.filter(v=>v.enabled!==false&&!v.subscription&&!v.subscriptionAccountId&&!v.subscriptionChannel)
  const [cfg,setCfg]=useState<Config>(()=>{try{return {...defaults,...JSON.parse(localStorage.getItem('ai-home.hearing.'+person)||'{}'),sentinelEnabled:false}}catch{return defaults}})
  const [enabled,setEnabled]=useState(()=>localStorage.getItem('ai-home.hearing.enabled.'+person)==='true')
  const [file,setFile]=useState<File|null>(null),[result,setResult]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const active=useRef<AbortController|null>(null)
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),recordTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const alive=useRef(true),[recording,setRecording]=useState(false),[starting,setStarting]=useState(false)
  const sentinel=useRef(false),[sentinelActive,setSentinelActive]=useState(false)
  function release(){
    if(recordTimer.current)clearTimeout(recordTimer.current)
    recordTimer.current=null
    stream.current?.getTracks().forEach(t=>t.stop());stream.current=null
  }
  function stopSentinel(){
    sentinel.current=false
    active.current?.abort()
    if(recorder.current?.state==='recording')recorder.current.stop()
    release()
    if(alive.current){setSentinelActive(false);setNotice('实时听觉已停止')}
    void apiFetch('/api/hearing/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({person})}).catch(()=>{})
  }
  useEffect(()=>{alive.current=true;if(isLocalMode())void apiFetch('/api/hearing/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({person})}).catch(()=>{});const hidden=()=>{if(document.hidden&&sentinel.current)stopSentinel()};document.addEventListener('visibilitychange',hidden);return ()=>{alive.current=false;document.removeEventListener('visibilitychange',hidden);if(sentinel.current)stopSentinel();active.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();release()}},[])

  async function startRecording(){
    if(!enabled||starting||recording||busy)return
    setStarting(true)
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('当前环境不支持麦克风录音，请上传音频文件')
      const input=await navigator.mediaDevices.getUserMedia({audio:true})
      if(!alive.current){input.getTracks().forEach(t=>t.stop());return}
      stream.current=input
      const r=new MediaRecorder(input);recorder.current=r
      const chunks:Blob[]=[];let failed=false
      r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      r.onstop=()=>{release();recorder.current=null;if(!alive.current)return;setRecording(false);if(failed)return;const type=r.mimeType||'audio/webm';const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';setFile(new File(chunks,'recording.'+ext,{type}));setNotice('录音已停止，请确认后识别')}
      r.onerror=()=>{failed=true;if(r.state==='recording')r.stop();release();if(alive.current){setRecording(false);setNotice('录音失败')}}
      r.start(1000);setRecording(true);setNotice('正在录音…')
      recordTimer.current=setTimeout(()=>{if(r.state==='recording')r.stop()},120000)
    }catch(e){release();if(alive.current)setNotice(e instanceof Error?e.message:'无法使用麦克风')}
    finally{if(alive.current)setStarting(false)}
  }
  const vendor=available.find(v=>v.id===cfg.vendor)
  async function startSentinel(){
    if(!isLocalMode()||!enabled||sentinel.current||starting||recording||busy)return
    if(!cfg.trigger.trim()||!vendor||!cfg.model.trim()||cfg.mode!=='transcribe'){setNotice('请选择语音转文字模型并填写触发词');return}
    setStarting(true)
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('当前环境不支持麦克风录音')
      const input=await navigator.mediaDevices.getUserMedia({audio:true})
      if(!alive.current||document.hidden){input.getTracks().forEach(t=>t.stop());return}
      stream.current=input
      localStorage.setItem('ai-home.hearing.'+person,JSON.stringify({...cfg,sentinelEnabled:true}))
      localStorage.setItem('ai-home.hearing.enabled.'+person,'true')
      sentinel.current=true;setSentinelActive(true);setNotice('实时听觉已开启，正在录音并分段识别')
      const segment=()=>{
        if(!sentinel.current||!stream.current)return
        const r=new MediaRecorder(stream.current);recorder.current=r
        const chunks:Blob[]=[]
        r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
        r.onerror=()=>{stopSentinel();if(alive.current)setNotice('实时录音失败，已停止')}
        r.onstop=()=>{void (async()=>{
          if(!sentinel.current||!alive.current)return
          const type=r.mimeType||'audio/webm',ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'
          const audio=new File(chunks,'recording.'+ext,{type})
          if(!audio.size){stopSentinel();if(alive.current)setNotice('录音为空，实时听觉已停止');return}
          const controller=new AbortController();active.current=controller
          const timer=setTimeout(()=>controller.abort(),120000),started=Date.now();let attempted=false,status=0,outcome='失败'
          try{
            const result=await recognizeAudio({vendor,config:cfg,file:audio,signal:controller.signal,onAttempt:()=>{attempted=true}})
            status=result.status
            recordMediaUsage(localStorage,person,{at:new Date().toISOString(),model:cfg.model,vendorId:vendor.id,vendor:vendor.name,subscription:false,promptTokens:result.usage?.prompt_tokens,completionTokens:result.usage?.completion_tokens})
            if(!sentinel.current||controller.signal.aborted)return
            const response=await apiFetch('/api/hearing/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({person,text:result.text}),signal:controller.signal})
            if(!response.ok)throw Error('听觉事件处理失败')
            const event=await response.json();outcome='成功'
            if(alive.current)setNotice(event.queued?'已听到触发词，助手正在处理':'实时听觉运行中 · '+(event.reason||'未触发'))
          }catch(e){status=Number((e as {status?:number})?.status)||status;if(!controller.signal.aborted){stopSentinel();if(alive.current)setNotice(e instanceof Error?e.message:'听觉识别失败，已停止')}}
          finally{
            if(attempted){const log=buildDiagSnapshot({assistantId:person,trigger:'听觉哨兵',provider:vendor.name,requestBody:{model:cfg.model},requestChars:audio.size});log.serverInjects=[];log.elapsedMs=Date.now()-started;log.outcome=controller.signal.aborted?'已停止':outcome;log.error=outcome==='失败'?(status?'HTTP '+status:'网络或响应异常'):undefined;try{saveDiagLogs(localStorage,appendDiagLog(loadDiagLogs(localStorage),log))}catch{}}
            clearTimeout(timer);if(active.current===controller)active.current=null
          }
          if(sentinel.current&&alive.current)segment()
        })()}
        r.start();recordTimer.current=setTimeout(()=>{if(r.state==='recording')r.stop()},10000)
      }
      segment()
    }catch(e){stopSentinel();if(alive.current)setNotice(e instanceof Error?e.message:'无法启动实时听觉')}
    finally{if(alive.current)setStarting(false)}
  }
  function save(){localStorage.setItem('ai-home.hearing.'+person,JSON.stringify({...cfg,sentinelEnabled:false}));localStorage.setItem('ai-home.hearing.enabled.'+person,String(enabled))}
  async function recognize(){
    if(active.current||!file)return
    const controller=new AbortController();active.current=controller;setBusy(true);setResult('');setNotice('正在识别…')
    const started=Date.now();let attempted=false,outcome="失败",status=0
    const timer=setTimeout(()=>controller.abort(),120000)
    try{
      if(!enabled)throw Error('请先启用当前助手的听觉')
      if(!vendor)throw Error('请选择供应商和模型')
      save()
      const {text,usage,status:responseStatus}=await recognizeAudio({vendor,config:cfg,file,signal:controller.signal,onAttempt:()=>{attempted=true}})
      status=responseStatus
      recordMediaUsage(localStorage,person,{at:new Date().toISOString(),model:cfg.model,vendorId:vendor.id,vendor:vendor.name,subscription:false,promptTokens:usage?.prompt_tokens,completionTokens:usage?.completion_tokens})
      setResult(text);setNotice('识别完成');outcome='成功'
    }catch(e){status=Number((e as {status?:number})?.status)||status;setNotice(controller.signal.aborted?'识别已取消或超时':e instanceof Error?e.message:'识别失败')}
    finally{
      if(attempted){const log=buildDiagSnapshot({assistantId:person,trigger:'听觉',provider:vendor?.name,requestBody:{model:cfg.model},requestChars:file.size});log.serverInjects=[];log.elapsedMs=Date.now()-started;log.outcome=controller.signal.aborted?'取消或超时':outcome;log.error=outcome==='失败'?(status?'HTTP '+status:'网络或响应异常'):undefined;saveDiagLogs(localStorage,appendDiagLog(loadDiagLogs(localStorage),log))}
      clearTimeout(timer);active.current=null;setBusy(false)
    }
  }
  return <fieldset><legend>听觉</legend>
    <label><input type="checkbox" checked={enabled} disabled={busy||recording||starting||sentinelActive} onChange={e=>setEnabled(e.target.checked)}/>启用当前助手的听觉</label>
    <label>供应商<select disabled={busy||sentinelActive} value={cfg.vendor} onChange={e=>setCfg({...cfg,vendor:e.target.value})}><option value="">请选择</option>{available.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label>听觉模式<select disabled={busy||recording||starting||sentinelActive} value={cfg.mode} onChange={e=>{const mode=e.target.value==='understand'?'understand':'transcribe';setCfg({...cfg,mode,model:mode==='transcribe'?'whisper-1':'',path:mode==='transcribe'?'audio/transcriptions':'chat/completions'});setResult('')}}><option value="transcribe">语音转文字</option><option value="understand">音频内容理解</option></select></label>
    {cfg.mode==='understand'&&<p>需要支持 OpenAI input_audio 协议的模型，当前支持 WAV、MP3 文件。</p>}
    <label>模型<input disabled={busy||sentinelActive} value={cfg.model} onChange={e=>setCfg({...cfg,model:e.target.value})}/></label>
    <label>接口路径<input disabled={busy||sentinelActive} value={cfg.path} onChange={e=>setCfg({...cfg,path:e.target.value})}/></label>
    <button disabled={busy||sentinelActive} onClick={()=>{try{save();setNotice('配置已保存')}catch{setNotice('保存失败')}}}>保存配置</button>
    <label>音频文件<input disabled={busy||recording||starting||sentinelActive} type="file" accept="audio/*,.webm,.mp4,.m4a" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    <p>单次识别仅上传所选文件。实时听觉开启期间会持续录音，并每 10 秒上传音频至所选供应商；切到后台或关闭页面会停止。</p>
    <label>触发词<input disabled={sentinelActive||busy} value={cfg.trigger} onChange={e=>setCfg({...cfg,trigger:e.target.value})}/></label>
    <label>触发间隔（秒）<input type="number" min={60} max={3600} disabled={sentinelActive||busy} value={cfg.triggerIntervalSeconds} onChange={e=>setCfg({...cfg,triggerIntervalSeconds:Math.max(60,Math.min(3600,Number(e.target.value)||120))})}/></label>
    {sentinelActive?<button onClick={stopSentinel}>立即停止实时听觉</button>:<button disabled={!isLocalMode()||!enabled||busy||recording||starting||cfg.mode!=='transcribe'} onClick={()=>void startSentinel()}>开启实时听觉</button>}
    {sentinelActive&&<p role="status">正在录音并识别 · 离开页面或切到后台会停止</p>}

    {recording?<button onClick={()=>recorder.current?.stop()}>停止录音</button>:<button disabled={!enabled||busy||starting||sentinelActive||cfg.mode==='understand'} onClick={()=>void startRecording()}>{starting?'等待麦克风权限…':'开始录音'}</button>}
    {file&&<p>已选择：{file.name} · {Math.ceil(file.size/1024)} KB</p>}
    <button disabled={busy||!file||!enabled||recording||starting||sentinelActive} onClick={()=>void recognize()}>识别音频</button>{busy&&<button onClick={()=>active.current?.abort()}>取消</button>}
    <p role="status">{notice}</p>{result&&<><label>识别结果<textarea readOnly value={result}/></label>{onUse&&<button onClick={()=>onUse(result)}>加入聊天输入框</button>}</>}
  </fieldset>
}
