import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../src/server/identity.mjs'

test('身份迁移兼容全局 MCP 表，并保留其他旧身份数据', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE mcp_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO mcp_connections VALUES ('mcp-1', '服务');
      CREATE TABLE mcp_bindings (person TEXT NOT NULL, connection_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(person, connection_id));
      INSERT INTO mcp_bindings VALUES ('晏未晞', 'mcp-1', '2026-01-01');
      INSERT INTO mcp_bindings VALUES ('assistant-yanweixi', 'mcp-1', '2026-01-02');
      CREATE TABLE assistant_inbox (id TEXT PRIMARY KEY, person TEXT NOT NULL);
      INSERT INTO assistant_inbox VALUES ('message-1', '晏未晞');`)
    migrateDatabase(db)
    migrateDatabase(db)
    assert.equal(db.prepare('SELECT name FROM mcp_connections WHERE id=?').get('mcp-1').name, '服务')
    assert.equal(db.prepare('SELECT count(*) AS count FROM mcp_bindings').get().count, 1)
    assert.equal(db.prepare('SELECT person FROM mcp_bindings WHERE connection_id=?').get('mcp-1').person, 'assistant-yanweixi')
    assert.equal(db.prepare('SELECT person FROM assistant_inbox WHERE id=?').get('message-1').person, 'assistant-yanweixi')
  } finally {
    db.close()
  }
})

test('旧任务约束迁移保留分钟间隔、绑定会话以及助手和用户各自的创建权', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE scheduled_tasks (
      id TEXT PRIMARY KEY, person TEXT CHECK(person IN ('晏未晞','言朔')),
      title TEXT, prompt TEXT, run_at TEXT, recurrence TEXT, status TEXT,
      created_at TEXT, updated_at TEXT, created_by TEXT, temporary INTEGER,
      conversation_id TEXT, interval_minutes INTEGER);
      INSERT INTO scheduled_tasks VALUES ('a','晏未晞','聊天','找我聊聊','2026','daily','scheduled','2025','2025','晏未晞',1,'chat-a',10);
      INSERT INTO scheduled_tasks VALUES ('b','言朔','花园','逛花园','2026','once','scheduled','2025','2025','user',0,'chat-b',0);`)
    migrateDatabase(db)
    migrateDatabase(db)
    const rows = db.prepare('SELECT person, created_by, conversation_id, interval_minutes, temporary FROM scheduled_tasks ORDER BY id').all()
    assert.deepEqual(rows.map(row => Object.values(row)), [
      ['assistant-yanweixi','assistant-yanweixi','chat-a',10,1],
      ['assistant-yanshuo','user','chat-b',0,0],
    ])
  } finally { db.close() }
})
