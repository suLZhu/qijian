import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeAudio } from '../src/hearingProtocol.mjs'

const vendor={endpoint:'https://provider.example/v1',keys:[{id:'k',value:'secret',enabled:true}]}
const config={mode:'transcribe',model:'whisper-1',path:'audio/transcriptions'}
const audio=()=>new File([new Uint8Array([0,255,1,2])],'voice.wav',{type:'audio/wav'})

test('语音转文字使用供应商路径和可解析的 multipart 音频',async()=>{
  let captured
  const result=await recognizeAudio({vendor,config,file:audio(),fetchImpl:async(url,init)=>{
    captured={url,init}
    const req=new Request(url,init),form=await req.formData()
    assert.equal(form.get('model'),'whisper-1')
    assert.deepEqual([...new Uint8Array(await form.get('file').arrayBuffer())],[0,255,1,2])
    return Response.json({text:'你好',usage:{prompt_tokens:5}})
  }})
  assert.equal(captured.url,'https://provider.example/v1/audio/transcriptions')
  assert.equal(result.text,'你好')
  assert.equal(result.usage.prompt_tokens,5)
})

test('音频理解以正确格式编码字节并获取文字',async()=>{
  const result=await recognizeAudio({vendor,config:{mode:'understand',model:'audio',path:'chat/completions'},file:audio(),fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body),input=body.messages[0].content[1].input_audio
    assert.equal(input.format,'wav')
    assert.deepEqual([...Uint8Array.from(atob(input.data),c=>c.charCodeAt(0))],[0,255,1,2])
    return Response.json({choices:[{message:{content:'有人说话'}}]})
  }})
  assert.equal(result.text,'有人说话')
})

test('拒绝跨供应商地址、不支持格式和无效响应',async()=>{
  let calls=0
  const fetchImpl=async()=>{calls++;return Response.json({})}
  await assert.rejects(recognizeAudio({vendor,config:{...config,path:'https://elsewhere.example/path'},file:audio(),fetchImpl}),/所选供应商/)
  await assert.rejects(recognizeAudio({vendor,config:{mode:'understand',model:'m',path:'chat/completions'},file:new File(['x'],'a.webm'),fetchImpl}),/WAV 或 MP3/)
  assert.equal(calls,0)
  await assert.rejects(recognizeAudio({vendor,config,file:audio(),fetchImpl}),/未返回识别文字/)
})
