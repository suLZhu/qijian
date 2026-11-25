export function ensureMcpSchema(db) {
  const columns = db.prepare('PRAGMA table_info(mcp_connections)').all()
  const hasPerson = columns.some(column => String(column.name) === 'person')

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_bindings (
      person TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(person, connection_id)
    );
    CREATE INDEX IF NOT EXISTS mcp_bindings_connection_idx ON mcp_bindings(connection_id);
  `)

  if (!hasPerson) return { migrated: false }

  const legacyRows = db.prepare('SELECT * FROM mcp_connections ORDER BY updated_at DESC').all()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE mcp_connections_v2 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        transport TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        token_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const byKey = new Map()
    const insertService = db.prepare('INSERT INTO mcp_connections_v2 (id,name,url,transport,enabled,token_enc,updated_at) VALUES (?,?,?,?,?,?,?)')
    const insertBinding = db.prepare('INSERT OR IGNORE INTO mcp_bindings (person,connection_id,created_at) VALUES (?,?,?)')
    for (const row of legacyRows) {
      const key = [String(row.name || '').trim().toLowerCase(), String(row.url || '').trim(), String(row.transport || 'httpStream')].join('\n')
      let connectionId = byKey.get(key)
      if (!connectionId) {
        connectionId = String(row.id)
        byKey.set(key, connectionId)
        insertService.run(connectionId, row.name, row.url, row.transport, row.enabled, row.token_enc, row.updated_at)
      }
      if (row.person) insertBinding.run(String(row.person), connectionId, row.updated_at || new Date().toISOString())
    }
    db.exec('DROP TABLE mcp_connections')
    db.exec('ALTER TABLE mcp_connections_v2 RENAME TO mcp_connections')
    db.exec('COMMIT')
    return { migrated: true, legacyCount: legacyRows.length, serviceCount: byKey.size }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function listMcpServices(db) {
  return db.prepare('SELECT * FROM mcp_connections ORDER BY updated_at DESC').all()
}

export function boundMcpIds(db, person) {
  return db.prepare('SELECT connection_id FROM mcp_bindings WHERE person=? ORDER BY created_at').all(person).map(row => String(row.connection_id))
}

export function replaceMcpBindings(db, person, connectionIds) {
  const unique = [...new Set((Array.isArray(connectionIds) ? connectionIds : []).map(String).filter(Boolean))]
  const existing = unique.length
    ? new Set(db.prepare(`SELECT id FROM mcp_connections WHERE id IN (${unique.map(() => '?').join(',')}) AND enabled=1`).all(...unique).map(row => String(row.id)))
    : new Set()
  const accepted = unique.filter(id => existing.has(id))
  const now = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM mcp_bindings WHERE person=?').run(person)
    const insert = db.prepare('INSERT INTO mcp_bindings (person,connection_id,created_at) VALUES (?,?,?)')
    for (const id of accepted) insert.run(person, id, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return accepted
}

export function boundMcpServices(db, person) {
  return db.prepare(`
    SELECT c.*
    FROM mcp_connections c
    INNER JOIN mcp_bindings b ON b.connection_id=c.id
    WHERE b.person=? AND c.enabled=1
    ORDER BY c.updated_at DESC
  `).all(person)
}

export function boundMcpService(db, person, connectionId) {
  return db.prepare(`
    SELECT c.*
    FROM mcp_connections c
    INNER JOIN mcp_bindings b ON b.connection_id=c.id
    WHERE b.person=? AND b.connection_id=? AND c.enabled=1
  `).get(person, connectionId)
}

export function deleteMcpService(db, connectionId) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM mcp_bindings WHERE connection_id=?').run(connectionId)
    const result = db.prepare('DELETE FROM mcp_connections WHERE id=?').run(connectionId)
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
