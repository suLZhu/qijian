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

// 聊天召回整个分页过程共用一个软时限，超时或停止生成后取消后续请求。
export async function fetchMemoryRecordsWithin(person, lifecycle, {signal, timeoutMs = 900, fetchApi = apiFetch} = {}) {
  if (signal?.aborted) throw new Error('记忆检索已取消')
  const controller = new AbortController()
  let timer, onAbort
  const stop = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(new Error('记忆检索已取消')) }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, {once:true})
    timer = setTimeout(() => { controller.abort(); reject(new Error('记忆检索超时')) }, Math.max(1, timeoutMs))
  })
  try {
    return await Promise.race([
      fetchAllMemoryRecords(person, lifecycle, (url,init) => {
        if (controller.signal.aborted) throw new Error('记忆检索已取消')
        return fetchApi(url,{...init,signal:controller.signal})
      }),
      stop,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// 按查询与关键词、标题和正文的关联度排序；向量可用时同样参与排序。
export function rankMemoryRecords(records, query, queryVector, cosine) {
  const text = String(query || '').trim().toLowerCase().slice(0, 500)
  const words = text.split(/[\s，。！？、,.!?；;：:（）()]+/).filter(x=>x.length >= 2).slice(0, 8)
  const terms = [...new Set(words.flatMap(word => {
    if (!/[\u3400-\u9fff]/u.test(word) || word.length <= 4) return [word]
    const parts=[]
    for (let i=0; i+3<=word.length && parts.length<12; i+=2) parts.push(word.slice(i,i+3))
    return parts
  }))].slice(0,20)
  return (Array.isArray(records) ? records : []).map(record => {
    const keywords=String(record.keywords || '').toLowerCase().split(/[,，、\s]+/).filter(Boolean)
    const content=(String(record.title || '')+'\n'+String(record.content || '')+'\n'+String(record.keywords || '')).toLowerCase()
    const keywordScore=keywords.filter(keyword=>text.includes(keyword)).length
    const textScore=terms.filter(term=>content.includes(term)).length * 0.5
    const vectorScore=queryVector && Array.isArray(record.embedding) && typeof cosine === 'function' ? cosine(queryVector,record.embedding) : 0
    return {record,score:vectorScore*2+keywordScore+textScore}
  }).filter(item=>item.score>0.15).sort((a,b)=>b.score-a.score).slice(0,4)
}
