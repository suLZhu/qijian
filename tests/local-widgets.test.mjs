// 本地模式小组件：localStorage CRUD，与服务器同一套清洗逻辑。
import { test } from 'node:test'
import assert from 'node:assert/strict'

const memory = new Map()
globalThis.localStorage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)) },
  removeItem: key => { memory.delete(key) },
  key: index => [...memory.keys()][index] ?? null,
  get length() { return memory.size },
}

const { localHandle } = await import('../src/localBackend.mjs')
const PERSON = 'assistant-yanweixi'

test('本地创建 → 列表 → 追加 → 删除', async () => {
  const created = await localHandle('/api/widgets', { method: 'POST', body: JSON.stringify({ person: PERSON, type: 'checklist', title: '清单' }) })
  assert.equal(created.status, 201)
  const { widget } = await created.json()
  assert.equal(widget.type, 'checklist')

  const list = await (await localHandle('/api/widgets?person=' + PERSON, { method: 'GET' })).json()
  assert.equal(list.widgets.length, 1)

  const patched = await localHandle('/api/widgets/' + widget.id, {
    method: 'PATCH', body: JSON.stringify({ person: PERSON, config: { ...widget.config, items: [{ text: '早饭' }] } }),
  })
  const updated = await patched.json()
  assert.equal(updated.widget.config.items.length, 1)

  const removed = await localHandle('/api/widgets/' + widget.id, { method: 'DELETE', body: JSON.stringify({ person: PERSON }) })
  assert.equal(removed.status, 200)
  const after = await (await localHandle('/api/widgets?person=' + PERSON, { method: 'GET' })).json()
  assert.equal(after.widgets.length, 0)
})

test('清单组件超过上限时拒绝更新，不丢弃已有项目',async()=>{
  for (const [type,key,entry] of [['checklist','items',{text:'已有'}]]) {
    const created=await (await localHandle('/api/widgets',{method:'POST',body:JSON.stringify({person:PERSON,type,config:{[key]:Array.from({length:200},()=>entry)}})})).json()
    const id=created.widget.id
    const response=await localHandle('/api/widgets/'+id,{method:'PATCH',body:JSON.stringify({person:PERSON,config:{[key]:[...created.widget.config[key],entry]}})})
    assert.equal(response.status,400);assert.match((await response.json()).error,/上限/)
    const list=await (await localHandle('/api/widgets?person='+PERSON)).json()
    assert.deepEqual(list.widgets.find(x=>x.id===id).config,created.widget.config)
  }
})

 test('旧记账组件不显示、不新增，存储中的记录保持不变',async()=>{
  const old={id:'old-ledger',person:PERSON,type:'ledger',title:'旧账',config:{entries:[{amount:2}]}}
  memory.set('ai-home.local.widgets',JSON.stringify([old]))
  const list=await (await localHandle('/api/widgets?person='+PERSON)).json()
  assert.equal(list.widgets.length,0)
  assert.equal((await localHandle('/api/widgets',{method:'POST',body:JSON.stringify({person:PERSON,type:'ledger'})})).status,400)
  assert.deepEqual(JSON.parse(memory.get('ai-home.local.widgets')),[old])
 })
