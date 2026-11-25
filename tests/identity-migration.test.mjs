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
