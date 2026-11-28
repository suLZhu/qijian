import { modelListUrl, orderedKeys } from './vendors.mjs'
import { directModelFetch } from './nativeSystem.mjs'

export async function recognizeAudio({ vendor, config, file, signal, onAttempt, fetchImpl = directModelFetch }) {
  if (!vendor || !String(config?.model || '').trim()) throw new Error('请选择供应商和模型')
  if (!file || !file.size || file.size > 25 * 1024 * 1024) throw new Error('请选择不超过25 MB的非空音频')
  const base = new URL('./', modelListUrl({ ...vendor, modelsPath:'' }))
  const url = new URL(config.path, base)
  if (!['http:','https:'].includes(base.protocol) || url.origin !== base.origin || url.username || url.password) throw new Error('接口路径必须属于所选供应商')
  const key = orderedKeys(vendor.keys).find(k => k.value)?.value
  if (!key) throw new Error('请先配置 API Key')
  let options
  if (config.mode === 'understand') {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'wav' && ext !== 'mp3') throw new Error('此音频理解协议仅支持 WAV 或 MP3，请上传对应格式')
    const bytes = new Uint8Array(await file.arrayBuffer())
    let raw = ''
    for (let i=0;i<bytes.length;i+=8192) raw += String.fromCharCode(...bytes.subarray(i,i+8192))
    options = { method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:[{role:'user',content:[{type:'text',text:'请客观描述音频中的语音、环境声音及可辨识事件。不确定的内容请注明，不要猜测。'},{type:'input_audio',input_audio:{data:btoa(raw),format:ext}}]}],modalities:['text'],stream:false}),signal }
  } else if (config.mode === 'transcribe') {
    const form = new FormData()
    form.append('model',String(config.model).trim())
    form.append('file',file,'audio.'+(file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'')||'wav'))
    const request = new Request(url,{method:'POST',body:form})
    options = { method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':request.headers.get('Content-Type')},body:await request.arrayBuffer(),signal }
  } else throw new Error('不支持的听觉模式')
  signal?.throwIfAborted()
  onAttempt?.()
  const response = await fetchImpl(url.href,{...options,timeoutMs:120000})
  if (!response.ok) throw Object.assign(new Error('识别接口返回 HTTP '+response.status),{ status:response.status })
  const data = await response.json()
  const text = config.mode === 'understand' ? data.choices?.[0]?.message?.content : data.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('接口未返回识别文字')
  return { text, usage:data.usage || null, status:response.status }
}
