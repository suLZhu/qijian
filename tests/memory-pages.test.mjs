import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchAllMemoryRecords, fetchMemoryRecordsWithin, rankMemoryRecords} from '../src/memoryPages.mjs'

test('读取超过一页的完整记忆并保留助手隔离',async()=>{
  const rows=Array.from({length:725},(_,i)=>({id:String(i),person:'a'})), calls=[]
  const fetcher=async path=>{const q=new URL(path,'http://example.test').searchParams;calls.push(q);const start=Number(q.get('offset'));return Response.json({records:rows.slice(start,start+Number(q.get('limit')))})}
  const result=await fetchAllMemoryRecords('a','active',fetcher)
  assert.equal(result.length,725);assert.equal(calls.length,2);assert.equal(calls[1].get('offset'),'500');assert.equal(calls[0].get('person'),'a');assert.equal(calls[0].get('lifecycle'),'active')
})
test('分页重复或第二页失败时不返回伪造的完整结果',async()=>{
  const page=Array.from({length:500},(_,i)=>({id:String(i),person:'a'}))
  await assert.rejects(fetchAllMemoryRecords('a',undefined,async()=>Response.json({records:page})),/没有推进/)
  let calls=0
  await assert.rejects(fetchAllMemoryRecords('a',undefined,async()=>++calls===1?Response.json({records:page}):new Response('',{status:503})),/503/)
})

 test('不接受其他助手的记忆记录',async()=>{await assert.rejects(fetchAllMemoryRecords('a',undefined,async()=>Response.json({records:[{id:'x',person:'b'}]})),/不属于当前助手/)})


test('聊天记忆分页整体受软时限约束并取消网络',async()=>{
  let aborted=false
  const fetcher=(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))})})
  await assert.rejects(fetchMemoryRecordsWithin('a','active',{timeoutMs:10,fetchApi:fetcher}),/超时|aborted/)
  assert.equal(aborted,true)
})

test('用户停止生成会取消记忆检索',async()=>{
  const controller=new AbortController();controller.abort(); let called=false
  await assert.rejects(fetchMemoryRecordsWithin('a','active',{signal:controller.signal,fetchApi:async()=>{called=true;return Response.json({records:[]})}}),/取消/)
  assert.equal(called,false)
})


test('召回无关键词的相关标题正文，忽略无关记忆',()=>{
  const rows=[{title:'茶饮偏好',content:'用户喜欢茉莉花茶',keywords:''},{title:'其他',content:'喜欢打篮球',keywords:''}]
  const result=rankMemoryRecords(rows,'我最近想喝茉莉花茶',null,()=>0)
  assert.equal(result.length,1);assert.equal(result[0].record.title,'茶饮偏好')
})


test('向量召回只比较相同模型的向量',()=>{
  const rows=[{title:'同模型',content:'内容',embedModel:'m1',embedding:[1,0]},{title:'不同模型',content:'其他',embedModel:'m2',embedding:[1,0]}]
  const result=rankMemoryRecords(rows,'无关查询',[1,0],()=>1,'m1')
  assert.deepEqual(result.map(x=>x.record.title),['同模型'])
})
