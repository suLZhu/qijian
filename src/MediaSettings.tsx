import {useEffect,useRef,useState} from 'react'
import {directModelFetch} from './nativeSystem.mjs'
import {modelListUrl,orderedKeys,type Vendor} from './vendors.mjs'

const modes={image:['生图','images/generations'],video:['视频','videos'],audio:['语音','audio/speech']} as const
type Mode=keyof typeof modes
type Config={vendor:string;model:string;voice:string;path:string;videoFormat:"multipart"|"json"}
function load(mode:Mode):Config {
  const defaults:Config={videoFormat:'multipart',vendor:'',model:'',voice:'alloy',path:modes[mode][1]}
  try{return {...defaults,...JSON.parse(localStorage.getItem('ai-home.media.'+mode)||'{}')}}catch{return defaults}
}
export function MediaSettings({vendors}:{vendors:Vendor[]}) {
  const [mode,setMode]=useState<Mode>('image')
  return <section><h3>媒体生成</h3>{(Object.keys(modes) as Mode[]).map(k=><button key={k} aria-pressed={mode===k} onClick={()=>setMode(k)}>{modes[k][0]}</button>)}<MediaForm key={mode} mode={mode} vendors={vendors.filter(v=>v.enabled!==false&&!v.subscription&&!v.subscriptionAccountId&&!v.subscriptionChannel)}/></section>
}
function MediaForm({mode,vendors}:{mode:Mode;vendors:Vendor[]}) {
  const [cfg,setCfg]=useState(()=>load(mode)),[prompt,setPrompt]=useState(''),[notice,setNotice]=useState(''),[result,setResult]=useState(''),[busy,setBusy]=useState(false)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>()=>active.current?.abort(),[])
  useEffect(()=>()=>{if(result.startsWith('blob:'))URL.revokeObjectURL(result)},[result])
  const vendor=vendors.find(v=>v.id===cfg.vendor)
  function save(){localStorage.setItem('ai-home.media.'+mode,JSON.stringify(cfg))}
  async function generate(){
    if(active.current)return
    const controller=new AbortController()
    active.current=controller
    const timer=setTimeout(()=>controller.abort(),600000)
    setBusy(true);setResult('');setNotice('正在生成…')
    try{
      if(!vendor||!cfg.model.trim()||!prompt.trim())throw Error('请选择供应商并填写模型和内容')
      const base=new URL('./',modelListUrl({...vendor,modelsPath:''}))
      const url=new URL(cfg.path,base)
      if(!['http:','https:'].includes(base.protocol)||url.origin!==base.origin)throw Error('接口路径必须属于所选供应商')
      const key=orderedKeys(vendor.keys).find(k=>k.value)?.value
      if(!key)throw Error('请先在供应商设置中保存 API Key')
      save()
      async function request(address:string,body?:object){
        const multipart=body&&mode==='video'&&cfg.videoFormat==='multipart'
        const boundary='qijian-'+crypto.randomUUID()
        const payload=multipart?Object.entries(body).map(([name,value])=>
          '--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n'
        ).join('')+'--'+boundary+'--\r\n':body?JSON.stringify(body):undefined
        const contentType=multipart?'multipart/form-data; boundary='+boundary:'application/json'
        const response=await directModelFetch(address,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':contentType}:{})},body:payload,signal:controller.signal})
        if(!response.ok)throw Error('供应商返回 HTTP '+response.status)
        return response
      }
      const response=await request(url.href,mode==='audio'?{model:cfg.model,input:prompt,voice:cfg.voice}:{model:cfg.model,prompt})
      let source=''
      if(mode==='audio')source=URL.createObjectURL(await response.blob())
      else if(mode==='image'){
        const item=(await response.json()).data?.[0]
        source=item?.b64_json?'data:image/png;base64,'+item.b64_json:item?.url
        if(!source||!(/^(https?:\/\/|data:image\/png;base64,)/i.test(source)))throw Error('接口没有返回可显示的图片')
      }else{
        let job=await response.json()
        if(!job.id)throw Error('视频接口没有返回任务编号')
        const jobUrl=new URL(url)
        jobUrl.pathname=jobUrl.pathname.replace(/\/$/,'')+'/'+encodeURIComponent(job.id)
        while(job.status!=='completed'){
          if(['failed','cancelled','canceled','expired'].includes(job.status))throw Error('视频任务未完成：'+job.status)
          setNotice('视频处理中 · '+job.id)
          await new Promise(resolve=>setTimeout(resolve,3000))
          controller.signal.throwIfAborted()
          job=await (await request(jobUrl.href)).json()
        }
        jobUrl.pathname+='/content'
        source=URL.createObjectURL(await (await request(jobUrl.href)).blob())
      }
      setResult(source);setNotice('已收到生成结果')
    }catch(e){setNotice(controller.signal.aborted?'已停止等待，供应商任务可能仍在执行':e instanceof Error?e.message:'请求失败')}
    finally{clearTimeout(timer);active.current=null;setBusy(false)}
  }
  return <fieldset><legend>{modes[mode][0]} · OpenAI 兼容 API</legend>
    <label>供应商<select disabled={busy} value={cfg.vendor} onChange={e=>setCfg({...cfg,vendor:e.target.value,model:''})}><option value="">请选择</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label>模型<input disabled={busy} list="media-models" value={cfg.model} onChange={e=>setCfg({...cfg,model:e.target.value})}/></label><datalist id="media-models">{vendor?.models.map(m=><option key={m.id} value={m.id}/>)}</datalist>
    {mode==='audio'&&<label>音色<input value={cfg.voice} onChange={e=>setCfg({...cfg,voice:e.target.value})}/></label>}
    <details><summary>接口设置</summary>{mode==='video'&&<label>请求格式<select value={cfg.videoFormat} onChange={e=>setCfg({...cfg,videoFormat:e.target.value==='json'?'json':'multipart'})}><option value="multipart">表单</option><option value="json">JSON</option></select></label>}<input value={cfg.path} onChange={e=>setCfg({...cfg,path:e.target.value})}/></details>
    <button onClick={()=>{try{save();setNotice('配置已保存')}catch{setNotice('保存失败')}}}>保存配置</button>
    <label>{mode==='audio'?'朗读文本':'生成描述'}<textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
    <button disabled={busy||!prompt.trim()} onClick={()=>void generate()}>生成{modes[mode][0]}</button>{busy&&<button onClick={()=>active.current?.abort()}>停止等待</button>}
    <p role="status">{notice}</p>{result&&(mode==='audio'?<audio controls src={result}/>:mode==='video'?<video controls src={result}/>:<img src={result} alt="生成结果" style={{maxWidth:'100%'}}/>)}
  </fieldset>
}
