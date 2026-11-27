// Credential comparisons are confined to the migration. Never persist or log this key.
export function mcpMigrationKey(row, credentials) {
  return JSON.stringify([
    String(row.name || '').trim().toLowerCase(),
    String(row.url || '').trim(),
    row.transport || 'httpStream',
    row.enabled !== false && row.enabled !== 0,
    credentials,
  ])
}
