// 固定列名而非执行备份中携带的 SQL；由外层事务统一提交或回滚。
const TABLES = {
  scheduled_tasks: ['id','person','title','prompt','run_at','recurrence','status','last_run_at','created_at','updated_at','created_by','temporary','conversation_id','interval_minutes'],
}
export function exportRecordBackup(db) {
  const tables = {}
  for (const [table,columns] of Object.entries(TABLES)) tables[table] = db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all()
  return {version:1,tables}
}
export function restoreRecordBackup(db, backup) {
  if (!backup || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables) || Object.keys(backup.tables).length !== Object.keys(TABLES).length) throw new Error('服务器记录备份格式无效')
  let count=0
  for (const [table,columns] of Object.entries(TABLES)) {
    const rows=backup.tables[table]
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error('服务器记录备份格式无效')
    const statement=db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(${columns[0]}) DO UPDATE SET ${columns.slice(1).map(c=>`${c}=excluded.${c}`).join(',')}`)
    const ids=new Set()
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== columns.length || columns.some(c=>!Object.hasOwn(row,c)) || typeof row[columns[0]] !== 'string' || !row[columns[0]] || ids.has(row[columns[0]]) || columns.some(c=>row[c] !== null && typeof row[c] !== 'string' && !(typeof row[c] === 'number' && Number.isFinite(row[c])))) throw new Error('服务器记录备份格式无效')
      ids.add(row[columns[0]])
      statement.run(...columns.map(c=>row[c]))
      count++
    }
  }
  return count
}
