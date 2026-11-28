import {createHash} from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import {buildBackupPayload, savePreUpdateBackup} from '../src/backupService.mjs'

function storage(entries) { const m=new Map(Object.entries(entries)); return {get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null} }
test('整体备份统一收集本地设置、附件及素材', async () => {
  const payload=await buildBackupPayload('full',['a'],{storage:storage({'ai-home.messages':'history','ai-home.sessionToken':'private'}),localMode:true,collectIndexed:async()=>({attachments:[{id:'a'}],customAssets:{background:'b'}})})
  assert.equal(payload.data.local['ai-home.messages'],'history')
  assert.equal(payload.data.local['ai-home.sessionToken'],undefined)
  assert.equal(payload.data.indexed.attachments.length,1)
  assert.equal(payload.data.indexed.customAssets.background,'b')
})
test('云端记忆与密钥读取失败时终止备份', async () => {
  const opts={storage:storage({}),localMode:false,fetchApi:async()=>new Response('',{status:500})}
  await assert.rejects(buildBackupPayload('full',['a'],opts),/读取失败/)
})
test('更新前备份必须成功写入并读回校验，名称不会覆盖普通备份', async () => {
  let contents='',name=''
  const opts={available:()=>true,build:async()=>({app:'qijian',kind:'full',data:{local:{},indexed:{attachments:[]}}}),save:(n,c)=>{name=n;contents=c;return {ok:true,name:n}},read:()=>({ok:true,content:contents})}
  assert.equal(await savePreUpdateBackup(['a'],opts),name)
  assert.match(name,/-整体-.*-更新前-/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,read:()=>({ok:true,content:'incomplete'})}),/校验失败/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,save:()=>({ok:false,error:'磁盘已满'})}),/磁盘已满/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,build:async()=>{throw Error('读取附件失败')}}),/读取附件失败/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,available:()=>false}),/不可用/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,requiredState:{conversations:{a:[1]}}}),/最新聊天尚未保存/)
  await assert.rejects(savePreUpdateBackup(['a'],{...opts,verify:()=>false}),/数据发生变化/)
})


test('云端备份包含经过校验的服务器图片原始 ID 和内容',async()=>{
  const bytes=Buffer.from('server-image'), id='11111111-1111-4111-8111-111111111111'
  const metadata={id,name:'image.png',mime:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),created_at:'2026-01-01T00:00:00Z'}
  const fetchApi=async url=>{if(url==='/api/backups/attachments')return Response.json({version:1,attachments:[metadata]});if(url==='/api/attachments/'+id)return new Response(bytes);throw Error(url)}
  const payload=await buildBackupPayload('chat',[],{storage:storage({}),localMode:false,fetchApi,collectIndexed:async()=>({attachments:[]})})
  assert.equal(payload.data.server.attachments[0].id,id)
  assert.equal(payload.data.server.attachments[0].data,bytes.toString('base64'))
})

test('服务器附件损坏或服务器过旧时拒绝生成不完整备份',async()=>{
  const id='11111111-1111-4111-8111-111111111111', bytes=Buffer.from('corrupt')
  const meta={id,name:'a.png',mime:'image/png',size:bytes.length,sha256:'0'.repeat(64),created_at:'2026-01-01T00:00:00Z'}
  const opts={storage:storage({}),localMode:false,collectIndexed:async()=>({attachments:[]}),fetchApi:async url=>url==='/api/backups/attachments'?Response.json({version:1,attachments:[meta]}):new Response(bytes)}
  await assert.rejects(buildBackupPayload('chat',[],opts),/校验失败/)
  await assert.rejects(buildBackupPayload('chat',[],{...opts,fetchApi:async()=>new Response('',{status:404})}),/不支持附件备份/)
})

test('旧服务器未提供已有向量时拒绝生成不完整的记忆备份',async()=>{
  const fetchApi=async url=>url.startsWith('/api/memory/records?')?Response.json({records:[{id:'x',person:'assistant-first',hasEmbedding:true}]}):Response.json({keys:{}})
  await assert.rejects(buildBackupPayload('memory',['assistant-first'],{storage:storage({}),localMode:false,fetchApi}),/记忆向量/)
})


test('MCP 分类备份保存服务器服务与助手绑定，旧服务器不能伪装成功',async()=>{
  const mcp={version:1,services:[{id:'id'}],bindings:[{person:'a'}]}
  const options={storage:storage({}),localMode:false,fetchApi:async url=>url==='/api/backups/mcp'?Response.json(mcp):new Response('',{status:404})}
  const payload=await buildBackupPayload('mcp',[],options)
  assert.deepEqual(payload.data.server.mcp,mcp)
  await assert.rejects(buildBackupPayload('mcp',[],{...options,fetchApi:async()=>new Response('',{status:404})}),/不支持 MCP/)
})

test('服务器整体备份包含任务，旧服务器不产生缺项备份',async()=>{
  const tables={scheduled_tasks:[{id:'task'}]}
  const fetchApi=async url=>{
    if(url==='/api/keys') return Response.json({keys:{}})
    if(url==='/api/backups/records') return Response.json({version:1,tables})
    if(url==='/api/backups/mcp') return Response.json({version:1,services:[],bindings:[]})
    if(url==='/api/backups/attachments') return Response.json({version:1,attachments:[]})
    throw Error(url)
  }
  const options={storage:storage({}),localMode:false,fetchApi,collectIndexed:async()=>({attachments:[]})}
  const payload=await buildBackupPayload('full',[],options)
  assert.deepEqual(payload.data.server.records.tables,tables)
  await assert.rejects(buildBackupPayload('full',[],{...options,fetchApi:async url=>url==='/api/backups/records'?new Response('',{status:404}):fetchApi(url)}),/不支持任务备份/)
})
