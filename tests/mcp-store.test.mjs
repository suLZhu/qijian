import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ensureMcpSchema, listMcpServices, boundMcpIds, replaceMcpBindings, boundMcpServices, deleteMcpService } from '../src/server/mcpStore.mjs'

test('旧 MCP person 行迁移为全局服务 + 助手绑定，并去重相同服务', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE mcp_connections (
      id TEXT PRIMARY KEY, person TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      transport TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, token_enc TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  const insert = db.prepare('INSERT INTO mcp_connections VALUES (?,?,?,?,?,?,?,?)')
  insert.run('m1', 'assistant-a', 'Garden', 'https://example.com/mcp', 'httpStream', 1, 'secret-a', '2026-01-02')
  insert.run('m2', 'assistant-b', 'Garden', 'https://example.com/mcp', 'httpStream', 1, 'secret-b', '2026-01-01')
  insert.run('m3', 'assistant-b', 'GitHub', 'https://github.example/mcp', 'httpStream', 0, 'secret-c', '2026-01-03')

  insert.run('m4', 'assistant-c', 'Garden', 'https://example.com/mcp', 'httpStream', 1, 'secret-copy', '2025-12-31')
  insert.run('m5', 'assistant-d', 'Garden', 'https://example.com/mcp', 'httpStream', 0, 'secret-a', '2025-12-31')
  insert.run('m6', 'assistant-e', 'Garden', 'https://example.com/mcp', 'httpStream', 1, 'unreadable', '2025-12-30')
  const result = ensureMcpSchema(db, row => {
    if (row.token_enc === 'unreadable') throw new Error('unreadable')
    return row.token_enc === 'secret-copy' ? 'secret-a' : row.token_enc
  })
  assert.equal(result.serviceCount, 5)
  assert.deepEqual(boundMcpIds(db, 'assistant-a'), ['m1'])
  assert.deepEqual(boundMcpIds(db, 'assistant-b').sort(), ['m2', 'm3'])
  assert.deepEqual(boundMcpIds(db, 'assistant-c'), ['m1'])
  assert.deepEqual(boundMcpIds(db, 'assistant-d'), ['m5'])
  assert.deepEqual(boundMcpServices(db, 'assistant-d'), [])
  assert.equal(boundMcpServices(db, 'assistant-b')[0].token_enc, 'secret-b')
  assert.equal(boundMcpServices(db, 'assistant-e')[0].token_enc, 'unreadable')
  assert.equal(ensureMcpSchema(db).migrated, false)
  assert.equal(listMcpServices(db).length, 5)
})

test('显式绑定只接受存在且已启用的全局服务，删除服务同步删除绑定', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE mcp_connections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, transport TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, token_enc TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO mcp_connections VALUES ('a','A','https://a','httpStream',1,'x','2026');
    INSERT INTO mcp_connections VALUES ('b','B','https://b','httpStream',0,'x','2026');
  `)
  ensureMcpSchema(db)
  assert.deepEqual(replaceMcpBindings(db, 'assistant-a', ['a', 'b', 'ghost', 'a']), ['a'])
  assert.deepEqual(boundMcpIds(db, 'assistant-a'), ['a'])
  assert.equal(deleteMcpService(db, 'a').changes, 1)
  assert.deepEqual(boundMcpIds(db, 'assistant-a'), [])
})
