import {apiFetch} from './apiBase.mjs'

// 两种后端统一分页，失败时保留旧视图并显示错误，不能把前一百条伪装成全部记忆。
export async function fetchAllMemoryRecords(person, lifecycle, fetchApi = apiFetch) {
  const records = [], seen = new Set(), pageSize = 500
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const params = new URLSearchParams({person,limit:String(pageSize),offset:String(offset)})
    if (lifecycle) params.set('lifecycle',lifecycle)
    const response = await fetchApi('/api/memory/records?' + params, {credentials:'include'})
    const data = await response.json().catch(()=>({}))
    if (!response.ok) throw new Error(data.error || '读取记忆失败（HTTP ' + response.status + '）')
    if (!Array.isArray(data.records)) throw new Error('记忆列表格式无效')
    let added = 0
    for (const record of data.records) {
      if (!record || typeof record.id !== 'string' || !record.id || record.person !== person) throw new Error('记忆记录格式无效或不属于当前助手')
      if (!seen.has(record.id)) { seen.add(record.id); records.push(record); added++ }
    }
    if (data.records.length < pageSize) return records
    if (!added) throw new Error('记忆分页没有推进，请检查服务器版本')
  }
  throw new Error('记忆数量超过读取上限，请使用备份导出')
}
