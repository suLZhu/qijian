import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {prepareBackupAttachments} from '../src/backupAttachments.mjs'

const id='11111111-1111-4111-8111-111111111111', data=Buffer.from('photo').toString('base64')
const local={id,name:'photo.png',mime:'image/png',data,createdAt:'2026-01-01T00:00:00Z'}
const remote={...local,created_at:local.createdAt,size:5,sha256:createHash('sha256').update('photo').digest('hex')}

test('本地备份恢复到服务器时保留图片 ID 和校验信息',async()=>{
  const result=await prepareBackupAttachments('full',{attachments:[local]},null,false)
  assert.equal(result.serverAttachments[0].id,id)
  assert.equal(result.serverAttachments[0].sha256,remote.sha256)
  assert.equal(result.serverAttachments[0].size,5)
})
test('服务器备份恢复到本地时合并图片和主题',async()=>{
  const result=await prepareBackupAttachments('full',{attachments:[],customAssets:{bg:'a'}},{attachments:[remote]},true)
  assert.equal(result.indexed.attachments[0].id,id)
  assert.equal(result.indexed.customAssets.bg,'a')
})
test('不同内容的相同编号和损坏的数据会拒绝恢复',async()=>{
  const different={...remote,data:Buffer.from('other').toString('base64'),sha256:createHash('sha256').update('other').digest('hex')}
  await assert.rejects(prepareBackupAttachments('chat',{attachments:[local]},{attachments:[different]},true),/编号冲突/)
  await assert.rejects(prepareBackupAttachments('chat',{attachments:[]},{attachments:[{...remote,sha256:'0'.repeat(64)}]},true),/校验失败/)
  await assert.rejects(prepareBackupAttachments('chat',{attachments:[{...local,data:'!!!'}]},null,true),/格式无效/)
})
test('旧备份或非聊天分类不会更改附件',async()=>{
  assert.equal((await prepareBackupAttachments('full',undefined,undefined,true)).indexed,undefined)
  assert.equal((await prepareBackupAttachments('models',{attachments:[local]},null,false)).serverAttachments,undefined)
})


test('本机附件支持非图片旧文件，迁往服务器时安全拒绝',async()=>{
  const legacy={...local,name:'note.txt',mime:'text/plain'}
  const backed=await prepareBackupAttachments('chat',{attachments:[legacy]},null,true)
  assert.equal(backed.indexed.attachments[0].sha256,remote.sha256)
  await assert.rejects(prepareBackupAttachments('chat',{attachments:[legacy]},null,false),/格式无效/)
})
