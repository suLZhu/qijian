import test from 'node:test'
import assert from 'node:assert/strict'
import { observeAuxiliaryRequest } from '../src/auxiliaryModel.mjs'
import { readMediaUsage } from '../src/usageLedger.mjs'
import { loadDiagLogs } from '../src/requestDiag.mjs'

function memory() { const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))} }
const input=(storage, request, identify=()=>({model:'m',vendorId:'v',vendor:'供应商',subscription:false}))=>({storage,person:'assistant-a',trigger:'记忆整理',body:{messages:[{role:'user',content:'私密对话'}]},request,identify})

test('按实际来源保存用量且诊断不含对话正文',async()=>{
  const storage=memory()
  const response=await observeAuxiliaryRequest(input(storage,async()=>Response.json({choices:[{message:{content:'私密结果'}}],usage:{prompt_tokens:23,completion_tokens:7}})))
  assert.equal((await response.json()).choices[0].message.content,'私密结果')
  const rows=readMediaUsage(storage,'assistant-a')
  assert.equal(rows[0].usage.promptTokens,23)
  assert.equal(rows[0].usage.completionTokens,7)
  assert.equal(rows[0].usage.vendorId,'v')
  assert.equal(JSON.stringify(loadDiagLogs(storage)).includes('私密'),false)
})

test('失败不计费，只记录安全的状态或异常分类',async()=>{
  const storage=memory()
  const response=await observeAuxiliaryRequest(input(storage,async()=>new Response('含有私密信息',{status:500})))
  assert.equal(response.status,500)
  assert.equal(readMediaUsage(storage,'assistant-a').length,0)
  assert.equal(loadDiagLogs(storage)[0].error,'HTTP 500')
  await assert.rejects(observeAuxiliaryRequest(input(storage,async()=>{throw Error('secret')})))
  assert.equal(JSON.stringify(loadDiagLogs(storage)).includes('secret'),false)
})

test('来源未知不臆造供应商计费',async()=>{
  const storage=memory()
  await observeAuxiliaryRequest(input(storage,async()=>Response.json({usage:{prompt_tokens:5}}),()=>({model:'',vendorId:'',vendor:'未记录来源',subscription:false,known:false})))
  assert.equal(readMediaUsage(storage,'assistant-a').length,0)
})
