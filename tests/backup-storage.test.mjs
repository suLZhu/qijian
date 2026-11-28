import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareBackupStorage,backupStorageMode} from '../src/backupStorage.mjs'

const a='assistant-yanweixi', b='assistant-yanshuo', id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const record={id,person:a,title:'偏好',content:'喜欢茉莉花茶',lifecycle:'active',scope:'private',embedding:[0.25,-0.5],embedModel:'vec'}

test('服务器备份转本机保留记忆、向量和密钥，保留当前连接',()=>{
 const payload={data:{storageMode:'server',server:{memory:{[a]:[record]},keys:{[a]:'key-a'}}}}
 const local={'ai-home.apiBaseOverride':'https://old.example','ai-home.local.state':'stale','ai-home.local.memoryRecords':'[]','ai-home.apiKey':'{}'}
 const result=prepareBackupStorage(payload,'full',local,true)
 assert.equal(result.crossMode,true);assert.equal(result.local['ai-home.apiBaseOverride'],undefined);assert.equal(result.local['ai-home.local.state'],undefined)
 assert.deepEqual(JSON.parse(result.local['ai-home.local.memoryRecords'])[0].embedding,[0.25,-0.5])
 assert.equal(JSON.parse(result.local['ai-home.apiKey'])[a],'key-a')
})
test('本机备份转服务器时按助手分组并保留向量',()=>{
 const payload={data:{storageMode:'local',server:{}}}
 const local={'ai-home.local.memoryRecords':JSON.stringify([record]),'ai-home.apiKey':JSON.stringify({[a]:'k'})}
 const result=prepareBackupStorage(payload,'full',local,false)
 assert.equal(result.server.memory[a][0].id,id);assert.deepEqual(result.server.memory[a][0].embedding,[0.25,-0.5]);assert.equal(result.server.keys[a],'k')
})
test('不同助手的相同编号和无法安全迁移的内容拒绝恢复',()=>{
 const payload={data:{storageMode:'server',server:{memory:{[b]:[{...record,person:b}]}}}}
 assert.throws(()=>prepareBackupStorage(payload,'memory',{'ai-home.local.memoryRecords':JSON.stringify([record])},true),/编号冲突/)
 const local={'ai-home.local.memoryRecords':JSON.stringify([{...record,title:'x'.repeat(121)}])}
 assert.throws(()=>prepareBackupStorage({data:{storageMode:'local',server:{}}},'memory',local,false),/格式不兼容/)
})
test('兼容旧备份模式推断，同模式不改写数据',()=>{
 assert.equal(backupStorageMode({data:{server:{memory:{}}}},'full'),'server')
 assert.equal(backupStorageMode({data:{server:{}}},'full'),'local')
 const local={'ai-home.apiBaseOverride':'https://same.example'}
 assert.deepEqual(prepareBackupStorage({data:{storageMode:'server',server:{}}},'full',local,false).local,local)
})
