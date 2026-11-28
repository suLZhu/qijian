import test from 'node:test'
import assert from 'node:assert/strict'
import {executeBackupRestore} from '../src/backupRestore.mjs'

function fixture() {
  const map=new Map([['ai-home.messages','old']]); let indexed='old', calls=0, fail=false
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(fail){fail=false;throw Error('quota')}map.set(k,v)},removeItem:k=>map.delete(k)}
  return {map,storage,failNext:()=>fail=true, state:()=>indexed, calls:()=>calls, indexed:async()=>{indexed='new';return async()=>{indexed='old'}},server:async()=>{calls++}}
}
test('本机写入失败先回滚，不调用服务器',async()=>{
  const f=fixture();f.failNext()
  await assert.rejects(executeBackupRestore({storage:f.storage,local:{'ai-home.messages':'new'},markPending:true,applyIndexed:f.indexed,syncServer:f.server}),/quota/)
  assert.equal(f.map.get('ai-home.messages'),'old');assert.equal(f.state(),'old');assert.equal(f.calls(),0)
})
test('服务器失败回滚本机、附件和同步标记',async()=>{
  const f=fixture()
  await assert.rejects(executeBackupRestore({storage:f.storage,local:{'ai-home.messages':'new'},markPending:true,applyIndexed:f.indexed,syncServer:async()=>{throw Error('offline')}}),/offline/)
  assert.equal(f.map.get('ai-home.messages'),'old');assert.equal(f.state(),'old');assert.equal(f.map.has('ai-home.restorePending'),false)
})
test('全部成功后才保留恢复数据和同步标记',async()=>{
  const f=fixture()
  await executeBackupRestore({storage:f.storage,local:{'ai-home.messages':'new'},markPending:true,applyIndexed:f.indexed,syncServer:f.server})
  assert.equal(f.map.get('ai-home.messages'),'new');assert.equal(f.state(),'new');assert.equal(f.calls(),1);assert.equal(f.map.get('ai-home.restorePending'),'1')
})
