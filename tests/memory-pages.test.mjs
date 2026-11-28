import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchAllMemoryRecords} from '../src/memoryPages.mjs'

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
