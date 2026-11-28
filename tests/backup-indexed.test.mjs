import test from 'node:test'
import assert from 'node:assert/strict'
import {collectBackupIndexed, applyBackupIndexed} from '../src/backupIndexed.mjs'

function fixture() {
  let attachments = [{id:'old'}], assets = {background:'old'}
  const ops = {
    exportLocalAttachments: async () => attachments,
    readStoredCustomAssets: async () => assets,
    writeStoredCustomAssets: async value => { assets = value },
    applyLocalAttachments: async value => { const old = attachments; attachments = value; return old },
    rollbackLocalAttachments: async value => { attachments = value },
  }
  return {ops, state: () => ({attachments, assets})}
}
test('full and chat backups include appropriate IndexedDB resources', async () => {
  const {ops,state} = fixture()
  assert.deepEqual(await collectBackupIndexed('full',ops), {attachments:state().attachments,customAssets:state().assets})
  assert.deepEqual(await collectBackupIndexed('chat',ops), {attachments:state().attachments})
  assert.deepEqual(await collectBackupIndexed('models',ops), {})
})
test('backup read failures propagate', async () => {
  const {ops} = fixture()
  ops.readStoredCustomAssets = async () => { throw Error('read failed') }
  await assert.rejects(collectBackupIndexed('full',ops), /read failed/)
})
test('restore rollback preserves original resources', async () => {
  const {ops,state} = fixture(), original = state()
  const undo = await applyBackupIndexed('full',{attachments:[{id:'new'}],customAssets:{background:'new'}},ops)
  assert.equal(state().assets.background,'new')
  await undo()
  assert.deepEqual(state(),original)
})
test('attachment failure rolls back theme write', async () => {
  const {ops,state} = fixture(), original = state()
  ops.applyLocalAttachments = async () => { throw Error('write failed') }
  await assert.rejects(applyBackupIndexed('full',{attachments:[],customAssets:null},ops), /write failed/)
  assert.deepEqual(state(),original)
})
test('old backups and unrelated categories leave resources untouched', async () => {
  const {ops,state} = fixture(), original = state()
  await applyBackupIndexed('full',undefined,ops)
  await applyBackupIndexed('models',{attachments:[],customAssets:null},ops)
  assert.deepEqual(state(),original)
})
test('malformed resources are rejected before writes', async () => {
  const {ops,state} = fixture(), original = state()
  await assert.rejects(applyBackupIndexed('full',{attachments:{},customAssets:null},ops), /附件/)
  assert.deepEqual(state(),original)
})
