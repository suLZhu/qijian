import test from 'node:test'
import assert from 'node:assert/strict'
import { readLocalAuto, writeLocalAuto, runLocalOrganize, tidyMemoryLibrary } from '../src/memoryLocalOrganize.mjs'
import { readMemoryModels, writeMemoryModels } from '../src/memoryModels.mjs'
import { localHandle } from '../src/localBackend.mjs'

const storage = new Map()
let failRecords = false
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (failRecords && key === 'ai-home.local.memoryRecords') throw Error('quota'); storage.set(key, String(value)) },
  removeItem: key => storage.delete(key),
  key: index => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
}
const reply = content => async () => Response.json({choices:[{message:{content:JSON.stringify(content)}}]})
const messages = [{role:'user',content:'我喜欢茉莉花茶',at:new Date().toISOString()}]
const proposal = [{title:'喜欢茉莉花茶',content:'用户喜欢茉莉花茶',category:'偏好习惯'}]

test('旧配置可继承，助手整理进度和模型各自隔离', () => {
  storage.clear()
  localStorage.setItem('ai-home.memoryAuto', JSON.stringify({minMessages:20,lastRunAt:'2025-01-01T00:00:00Z'}))
  assert.equal(readLocalAuto('a').minMessages,20)
  assert.equal(readLocalAuto('a').lastRunAt,null)
  writeLocalAuto({lastRunAt:'2026-01-01T00:00:00Z'},'a')
  assert.equal(readLocalAuto('b').lastRunAt,null)
  writeMemoryModels({organize:{vendorId:'v',model:'m'},embed:{vendorId:'',model:''}},'a')
  assert.equal(readMemoryModels('a').organize.model,'m')
  assert.equal(readMemoryModels('b').organize.model,'')
})

test('整理真实写入本机记忆，异常不推进进度', async () => {
  storage.clear()
  const cfg = readLocalAuto('a')
  const result = await runLocalOrganize({person:'a',messages,cfg,requestChat:reply(proposal)})
  assert.equal(result.created,1)
  assert.ok(readLocalAuto('a').lastRunAt)
  const records = await (await localHandle('/api/memory/records?person=a')).json()
  assert.equal(records.records[0].title,'喜欢茉莉花茶')
  await assert.rejects(runLocalOrganize({person:'b',messages,cfg:readLocalAuto('b'),requestChat:async()=>Response.json({choices:[{message:{content:'错误'}}]})}),/有效/)
  assert.equal(readLocalAuto('b').lastRunAt,null)
  failRecords = true
  try { await assert.rejects(runLocalOrganize({person:'b',messages,cfg:readLocalAuto('b'),requestChat:reply(proposal)}),/失败/) } finally { failRecords = false }
  assert.equal(readLocalAuto('b').lastRunAt,null)
})

test('整理来源必须有效，候选记忆不会归档原记忆', async () => {
  storage.clear()
  const add = await localHandle('/api/memory/records',{method:'POST',body:JSON.stringify({person:'a',title:'旧记忆',content:'原有内容',lifecycle:'active'})})
  const old = (await add.json()).record
  const record = {id:old.id,title:'旧记忆',content:'原有内容',lifecycle:'active'}
  await assert.rejects(tidyMemoryLibrary({person:'a',records:[record],requestChat:reply([{title:'新记忆',content:'整理后的内容',sources:['unknown']}])}),/来源无效/)
  const result = await tidyMemoryLibrary({person:'a',records:[record],autoConfirm:false,requestChat:reply([{title:'新记忆',content:'整理后的内容',sources:[old.id]}])})
  assert.equal(result.archived,0)
  const data = await (await localHandle('/api/memory/records?person=a')).json()
  assert.equal(data.records.find(r=>r.id===old.id).lifecycle,'active')
  assert.equal(data.records.find(r=>r.title==='新记忆').lifecycle,'candidate')
})


test('整理过程中新增的消息不会被完成时间跳过', async () => {
  storage.clear()
  let requestAt
  await runLocalOrganize({person:'a',messages,cfg:readLocalAuto('a'),requestChat:async()=>{requestAt = Date.now(); return Response.json({choices:[{message:{content:'[]'}}]})}})
  assert.ok(Date.parse(readLocalAuto('a').lastRunAt) <= requestAt)
})
