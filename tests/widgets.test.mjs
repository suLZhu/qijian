// 房间小组件：创建 / 追加 / 更新 / 删除与配置清洗。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { initWidgets, createWidget, listWidgets, updateWidget, deleteWidget, normalizeConfig } from '../src/server/widgets.mjs'

const PERSON = 'assistant-yanweixi'
const OTHER = 'assistant-yanshuo'

test('非法数量/空标题会被清洗，只有本人能改和删', () => {
  const db = new DatabaseSync(':memory:')
  initWidgets(db)
  const widget = createWidget(db, PERSON, { type: 'checklist' })
  assert.equal(widget.title, '清单')
  const updated = updateWidget(db, widget.id, PERSON, {
    config: { items: [{ text: '买菜' }, { text: '' }, { text: '取快递', done: true }] },
  })
  assert.deepEqual(updated.config.items.map(i => i.text), ['买菜', '取快递'])
  assert.throws(() => updateWidget(db, widget.id, OTHER, { title: '偷改' }), /不属于当前助手/)
  assert.equal(deleteWidget(db, widget.id, OTHER), false)
  assert.equal(deleteWidget(db, widget.id, PERSON), true)
  assert.equal(listWidgets(db, PERSON).length, 0)
})

test('计数器与便签的配置边界', () => {
  assert.equal(normalizeConfig('counter', { count: '12', step: 0 }).count, 12)
  assert.equal(normalizeConfig('counter', { count: '12', step: 0 }).step, 1)
  assert.equal(normalizeConfig('note', { text: 'a'.repeat(9000) }).text.length, 8000)
})

test('服务器组件超过上限时原数据保持不变',()=>{
  const db=new DatabaseSync(':memory:');initWidgets(db)
  try {
    const widget=createWidget(db,PERSON,{type:'checklist',config:{items:Array.from({length:200},()=>({text:'已有'}))}})
    assert.throws(()=>updateWidget(db,widget.id,PERSON,{config:{items:[...widget.config.items,{text:'新增'}]}}),/上限/)
    assert.deepEqual(listWidgets(db,PERSON)[0].config,widget.config)
  } finally {db.close()}
})

test('旧记账组件保留在数据库，不再列出或允许新建',()=>{
 const db=new DatabaseSync(':memory:');initWidgets(db)
 try {
  db.prepare('INSERT INTO room_widgets VALUES (?,?,?,?,?,?,?)').run('old',PERSON,'ledger','旧账','{"entries":[{"amount":2}]}','2026','2026')
  assert.equal(listWidgets(db,PERSON).length,0)
  assert.throws(()=>createWidget(db,PERSON,{type:'ledger'}),/停用/)
  assert.match(db.prepare('SELECT config FROM room_widgets WHERE id=?').get('old').config,/amount/)
 } finally {db.close()}
})
