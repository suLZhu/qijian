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
