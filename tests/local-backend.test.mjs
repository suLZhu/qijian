// 本地模式后端垫片（LocalBackend）单元测试：
//   会话恒登录 / 状态快照读写与配额 / 直连聊天（URL 拼接·时间注入·错误映射·流式透传）/
//   模型列表 / 本机记忆检索 / 服务端专属能力的明确降级 / SSE 心跳 / 附件与未匹配路由收敛。
// node 环境没有 localStorage —— 注入内存实现（localBackend 按需读取，不依赖 import 时机）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { localHandle, localAttachmentUrl, warmupLocalAttachments } from '../src/localBackend.mjs'
import { fetchMemoryRecordsWithin } from '../src/memoryPages.mjs'
import { executeBackupRestore, needsRestoredSnapshotSync } from '../src/backupRestore.mjs'
import { syncRestoredSnapshot } from '../src/cloudRecovery.mjs'

function memStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)) },
    removeItem: k => { m.delete(String(k)) },
    clear: () => { m.clear() },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
globalThis.localStorage = memStorage()

const body = async (path, init) => {
  const res = await localHandle(path, init)
  return { status: res.status, data: await res.json() }
}
const getJSON = path => body(path)

// 替换全局 fetch（localBackend 直接引用全局 fetch），t.after 自动还原。
function stubFetch(t, impl) {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => { globalThis.fetch = orig })
}

test('会话：本地模式恒为已登录', async () => {
  assert.deepEqual((await getJSON('/api/session')).data, { authenticated: true })
  const login = await body('/api/login', { method: 'POST', body: '{}' })
  assert.equal(login.data.authenticated, true)
  assert.equal(login.data.token, 'local')
  assert.deepEqual((await body('/api/logout', { method: 'POST', body: '{}' })).data, { ok: true })
})

test('状态快照：PUT→GET 往返与校验', async () => {
  const bad = await body('/api/state', { method: 'PUT', body: JSON.stringify({ state: [1, 2] }) })
  assert.equal(bad.status, 400)
  const missing = await body('/api/state', { method: 'PUT', body: '{}' })
  assert.equal(missing.status, 400)

  const state = { version: 2, conversations: { 'assistant-yanweixi': [{ id: 'c1', title: 't', messages: [] }] }, timeZone: 'Asia/Shanghai' }
  const put = await body('/api/state', { method: 'PUT', body: JSON.stringify({ state }) })
  assert.equal(put.status, 200)
  assert.equal(put.data.ok, true)
  assert.ok(put.data.updatedAt, 'PUT 应返回 updatedAt')

  const got = await getJSON('/api/state')
  assert.equal(got.status, 200)
  assert.deepEqual(got.data.state, state)
  assert.equal(got.data.updatedAt, put.data.updatedAt)
})

test('状态快照：超过 4.5 MB 返回 413（localStorage 配额保护）', async () => {
  const huge = { version: 2, pad: 'x'.repeat(4_500_001) }
  const res = await body('/api/state', { method: 'PUT', body: JSON.stringify({ state: huge }) })
  assert.equal(res.status, 413)
  assert.match(res.data.error, /4\.5 MB/)
})

test('API Key：PUT/GET 往返与参数校验', async () => {
  const bad = await body('/api/keys', { method: 'PUT', body: JSON.stringify({ person: '', apiKey: 'sk' }) })
  assert.equal(bad.status, 400)
  const tooLong = await body('/api/keys', { method: 'PUT', body: JSON.stringify({ person: 'assistant-yanweixi', apiKey: 'x'.repeat(8193) }) })
  assert.equal(tooLong.status, 400)

  const ok = await body('/api/keys', { method: 'PUT', body: JSON.stringify({ person: 'assistant-yanweixi', apiKey: 'sk-test-1' }) })
  assert.equal(ok.status, 200)
  const got = await getJSON('/api/keys')
  assert.equal(got.data.keys['assistant-yanweixi'], 'sk-test-1')
})

test('聊天：端点拼接规则与鉴权头', async (t) => {
  const calls = []
  stubFetch(t, async (url, init) => {
    calls.push({ url, init })
    return new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const chatReq = (endpoint) => body('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ endpoint, apiKey: 'sk-abc', body: { model: 'm', messages: [{ role: 'user', content: '你好' }] } }),
  })

  await chatReq('https://api.example.com')
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/chat/completions')
  await chatReq('https://api.example.com/v1')
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/chat/completions')
  await chatReq('https://api.example.com/v1/chat/completions')
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/chat/completions')
  await chatReq('https://api.example.com/deep/') // 末尾斜杠先剥离
  assert.equal(calls.at(-1).url, 'https://api.example.com/deep/v1/chat/completions')
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer sk-abc')
  assert.equal(calls.at(-1).init.redirect, 'error')
})

test('聊天：注入时间上下文 system 消息并原样透传上游响应', async (t) => {
  const upstream = new Response('{"choices":[{"delta":{"content":"hi"}}]}', { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  let sent
  stubFetch(t, async (url, init) => { sent = JSON.parse(init.body); return upstream })
  const res = await localHandle('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ endpoint: 'https://api.example.com', apiKey: 'k', timeZone: 'Asia/Shanghai', body: { model: 'm', messages: [{ role: 'user', content: '你好' }] } }),
  })
  assert.equal(res.status, 200)
  assert.equal(res, upstream, '上游 Response 必须原样透传（流式不被缓冲）')
  assert.equal(sent.messages[0].role, 'system')
  assert.match(sent.messages[0].content, /当前时间上下文/)
  assert.match(sent.messages[0].content, /\d{4}-\d{2}-\d{2}/)
  assert.equal(sent.messages[1].content, '你好', '原消息保持原样')
})

test('聊天：参数校验与上游错误映射', async (t) => {
  assert.equal((await body('/api/chat', { method: 'POST', body: JSON.stringify({ apiKey: 'k', body: {} }) })).status, 400)
  assert.match((await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'ftp://x', apiKey: 'k', body: {} }) })).data.error, /http/)
  assert.equal((await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', body: {} }) })).status, 400)
  assert.equal((await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', apiKey: 'k' }) })).status, 400)
  assert.equal((await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', apiKey: 'k', body: [1] }) })).status, 400)

  // 上游 401：状态码与正文透传成可读错误
  stubFetch(t, async () => new Response('{"error":"bad key"}', { status: 401, headers: { 'Content-Type': 'application/json' } }))
  const denied = await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'https://api.example.com', apiKey: 'bad', body: { messages: [] } }) })
  assert.equal(denied.status, 401)
  assert.match(denied.data.error, /上游返回 HTTP 401/)
})

test('聊天：网络失败映射为 502 可读错误；中止则原样抛出', async (t) => {
  stubFetch(t, async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e })
  const offline = await body('/api/chat', { method: 'POST', body: JSON.stringify({ endpoint: 'https://api.example.com', apiKey: 'k', body: { messages: [] } }) })
  assert.equal(offline.status, 502)
  assert.match(offline.data.error, /无法连接该接口：ECONNREFUSED/)

  globalThis.fetch = async () => { throw new Error('aborted mid-flight') }
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    () => localHandle('/api/chat', { method: 'POST', signal: ac.signal, body: JSON.stringify({ endpoint: 'https://api.example.com', apiKey: 'k', body: { messages: [] } }) }),
    /aborted mid-flight/,
    '主动中止必须 rethrow，让上层取消读流',
  )
})

test('模型列表：URL 拼接与错误映射', async (t) => {
  const calls = []
  stubFetch(t, async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: null }, { id: 'gpt-y' }] }), { status: 200 })
  })
  const ok = await body('/api/models', { method: 'POST', body: JSON.stringify({ endpoint: 'https://api.example.com/v1', apiKey: 'k' }) })
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/models')
  assert.deepEqual(ok.data.models, ['gpt-x', 'gpt-y'])

  const plain = await body('/api/models', { method: 'POST', body: JSON.stringify({ endpoint: 'https://api.example.com', apiKey: 'k' }) })
  assert.equal(calls.at(-1).url, 'https://api.example.com/v1/models')
  assert.equal(plain.status, 200)

  globalThis.fetch = async () => new Response('not-json', { status: 200 })
  assert.match((await body('/api/models', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', apiKey: 'k' }) })).data.error, /不是合法 JSON/)
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
  assert.match((await body('/api/models', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', apiKey: 'k' }) })).data.error, /未返回可用模型列表/)
  globalThis.fetch = async () => { throw new Error('dns fail') }
  assert.match((await body('/api/models', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x.com', apiKey: 'k' }) })).data.error, /无法连接/)
})

test('记忆检索：镜像会话键按关键词打分返回，支持中文键映射与 exclude', async () => {
  localStorage.setItem('ai-home.conversations', JSON.stringify({
    晏未晞: [
      { id: 'c1', title: '江边散步', messages: [{ role: 'user', content: '我们去江边散步吧' }, { role: 'assistant', content: '好的，江边今天风很舒服' }] },
      { id: 'c2', title: '午饭', messages: [{ role: 'user', content: '今天吃什么' }] },
    ],
    言朔: [{ id: 'c3', title: 'x', messages: [{ role: 'user', content: '江边也有我的事' }] }],
  }))

  const hit = await getJSON('/api/memory/search?person=assistant-yanweixi&q=' + encodeURIComponent('江边散步'))
  assert.equal(hit.status, 200)
  assert.ok(hit.data.results.length >= 1)
  assert.ok(hit.data.results.every(r => r.content.includes('江边') || r.content.includes('散步')))
  assert.ok(hit.data.results.every(r => r.conversationId !== 'c3'), '不能跨人物命中')

  const excluded = await getJSON('/api/memory/search?person=assistant-yanweixi&q=' + encodeURIComponent('江边散步') + '&exclude=c1')
  assert.equal(excluded.data.results.length, 0, 'exclude 排除来源会话')

  const miss = await getJSON('/api/memory/search?person=assistant-yanweixi&q=' + encodeURIComponent('量子引力波'))
  assert.deepEqual(miss.data.results, [])

  const badPerson = await getJSON('/api/memory/search?person=hacker&q=' + encodeURIComponent('江边'))
  assert.equal(badPerson.status, 400)
  const shortQuery = await getJSON('/api/memory/search?person=assistant-yanweixi&q=x')
  assert.equal(shortQuery.status, 400)
})

test('降级：后台 Agent 明确报错；MCP 在本地真连；定时任务已由本地调度器应答', async () => {
  // 本地模式已支持定时任务：空请求体只做参数校验，绝不伪装成功也不提示「配置云服务器」。
  const tasks = await body('/api/tasks', { method: 'POST', body: '{}' })
  assert.equal(tasks.status, 400)
  assert.doesNotMatch(tasks.data.error, /云服务器|暂不支持/)
  assert.deepEqual((await getJSON('/api/tasks')).data, { tasks: [] })

  const wf = await body('/api/workflows/manage', { method: 'POST', body: '{}' })
  assert.equal(wf.status, 400)
  assert.doesNotMatch(wf.data.error, /云服务器|暂不支持/)

  // 本地模式现在会真连远程 MCP；未知/未绑定的服务是 404，而不是「不支持」。
  const mcp = await body('/api/mcp/00000000-0000-4000-8000-000000000000/call', { method: 'POST', body: '{}' })
  assert.equal(mcp.status, 400)
  assert.match(mcp.data.error, /人物身份/)

  const run = await body('/api/agent/runs', { method: 'POST', body: '{}' })
  assert.equal(run.status, 400)
  assert.match(run.data.error, /Agent/)
  assert.deepEqual((await getJSON('/api/agent/runs')).data, { runs: [] })
})

test('agent 事件流：本地返回 SSE 心跳（首帧即有 ping）', async () => {
  const res = await localHandle('/api/agent/events')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Type'), /text\/event-stream/)
  const reader = res.body.getReader()
  const { value } = await reader.read()
  assert.match(new TextDecoder().decode(value), /: ping/)
  await reader.cancel()
})

test('附件：缺数据 400；无 IndexedDB 环境下保存失败也收敛为中文 500', async () => {
  const noData = await body('/api/attachments', { method: 'POST', body: JSON.stringify({ name: 'a.txt' }) })
  assert.equal(noData.status, 400)

  const saved = await body('/api/attachments', { method: 'POST', body: JSON.stringify({ name: 'a.txt', mime: 'text/plain', data: 'aGk=' }) })
  assert.equal(saved.status, 500, 'node 无 IndexedDB：必须返回结构化错误而非裸抛')
  assert.match(saved.data.error, /附件保存失败/)

  const missing = await getJSON('/api/attachments/00000000-0000-4000-8000-000000000000')
  assert.equal(missing.status, 404)
})

test('附件引用：未注册的 preview 原样返回；启动预热在无 IDB 时不抛', async () => {
  assert.equal(localAttachmentUrl('/api/attachments/00000000-0000-4000-8000-000000000000'), '/api/attachments/00000000-0000-4000-8000-000000000000')
  assert.equal(localAttachmentUrl('/api/attachments/not-a-url'), '/api/attachments/not-a-url')
  assert.equal(localAttachmentUrl('https://example.com/x.png'), 'https://example.com/x.png')
  assert.equal(localAttachmentUrl(null), null)
  await warmupLocalAttachments() // 不应 reject
})

test('路由收敛：未匹配 404、坏 JSON 400、未知异常 500 均为中文结构化错误', async () => {
  const notFound = await getJSON('/api/definitely-missing')
  assert.equal(notFound.status, 404)
  assert.equal(notFound.data.error, 'not found')

  const badJson = await body('/api/state', { method: 'PUT', body: '{oops' })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.data.error, '请求无效')

  const badMethod = await localHandle('/api/session', { method: 'DELETE' })
  assert.equal(badMethod.status, 404, '不支持的方法也不能裸抛')
})

test('旧 MCP 升级按凭据及启用状态保留服务，同名服务可以独立编辑和删除', async t => {
  const catalog = 'ai-home.local.mcp'
  const bindings = 'ai-home.local.mcpBindings'
  t.after(() => { localStorage.removeItem(catalog); localStorage.removeItem(bindings) })
  const base = { name: 'Garden', url: 'https://example.org/mcp', transport: 'httpStream', enabled: true }
  const rows = [
    { ...base, id: 'aa', person: 'A', token: 'first' },
    { ...base, id: 'bb', person: 'B', token: 'second' },
    { ...base, id: 'cc', person: 'C', token: 'first' },
    { ...base, id: 'dd', person: 'D', token: 'first', enabled: false },
  ]
  localStorage.setItem(catalog, JSON.stringify(rows))
  localStorage.setItem(bindings, JSON.stringify({ E: ['cc'] }))
  const list = () => getJSON('/api/mcp')
  const ids = async person => (await getJSON('/api/mcp/bindings?person=' + person)).data.connectionIds
  assert.deepEqual((await list()).data.connections.map(c => c.id), ['aa', 'bb', 'dd'])
  assert.deepEqual(await ids('C'), ['aa'])
  assert.deepEqual(await ids('E'), ['aa'])
  assert.deepEqual(await ids('B'), ['bb'])
  assert.deepEqual(await ids('D'), [])
  assert.equal((await body('/api/mcp/bb', { method: 'PUT', body: JSON.stringify({ name: 'B Garden' }) })).status, 200)
  assert.equal((await body('/api/mcp/aa', { method: 'DELETE' })).status, 200)
  const saved = JSON.parse(localStorage.getItem(catalog))
  assert.deepEqual(saved.map(row => [row.id, row.token]), [['bb', 'second'], ['dd', 'first']])
  assert.deepEqual(await ids('B'), ['bb'])
  assert.deepEqual(await ids('A'), [])
})


test('本机记忆列表按状态分页，更新时间相同时顺序稳定', async t => {
  const key = 'ai-home.local.memoryRecords', previous = localStorage.getItem(key)
  t.after(()=>{ if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous) })
  const person='assistant-memory-page'
  const records=Array.from({length:125},(_,i)=>({id:String(i).padStart(3,'0'),person,lifecycle:'active',title:String(i),content:'内容',updatedAt:'2026-01-01T00:00:00Z'}))
  localStorage.setItem(key,JSON.stringify(records))
  const first=await getJSON('/api/memory/records?person='+person+'&limit=100&offset=0')
  const second=await getJSON('/api/memory/records?person='+person+'&limit=100&offset=100')
  assert.equal(first.data.records.length,100);assert.equal(second.data.records.length,25)
  assert.equal(new Set([...first.data.records,...second.data.records].map(x=>x.id)).size,125)
  const recalled = await fetchMemoryRecordsWithin(person,'active',{fetchApi:localHandle,timeoutMs:900})
  assert.equal(recalled.length,125);assert.ok(recalled.some(row=>row.id==='000'))
  assert.equal((await getJSON('/api/memory/records?person='+person+'&lifecycle=invalid')).status,400)
})


test('本机记忆达到容量上限时拒绝新增，不静默删除旧记忆',async t=>{
  const key='ai-home.local.memoryRecords', previous=localStorage.getItem(key)
  t.after(()=>{if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous)})
  const all=Array.from({length:2000},(_,i)=>({id:String(i),person:'assistant-memory-page',title:'旧'+i,content:'原内容'}))
  localStorage.setItem(key,JSON.stringify(all))
  const result=await body('/api/memory/records',{method:'POST',body:JSON.stringify({person:'assistant-memory-page',title:'新增',content:'新内容'})})
  assert.equal(result.status,507);assert.deepEqual(JSON.parse(localStorage.getItem(key)),all)
})


test('本机聊天分类恢复先更新后端快照，旧快照不会盖回',async t=>{
  const keys=['ai-home.conversations','ai-home.restorePending','ai-home.local.state','ai-home.local.stateUpdatedAt']
  const old=Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]))
  t.after(()=>{for(const k of keys)old[k]===null?localStorage.removeItem(k):localStorage.setItem(k,old[k])})
  await localHandle('/api/state',{method:'PUT',body:JSON.stringify({state:{conversations:{a:[{id:'old'}]}}})})
  const restored={a:[{id:'new',messages:[]}]}
  const local={'ai-home.conversations':JSON.stringify(restored)}
  await executeBackupRestore({storage:localStorage,local,markPending:needsRestoredSnapshotSync(local,'chat',true,false),applyIndexed:async()=>async()=>{},syncServer:async()=>{}})
  assert.equal(localStorage.getItem('ai-home.restorePending'),'1')
  await syncRestoredSnapshot(localStorage,{conversations:restored},state=>localHandle('/api/state',{method:'PUT',body:JSON.stringify({state})}))
  assert.equal((await (await localHandle('/api/state')).json()).state.conversations.a[0].id,'new')
  assert.equal(localStorage.getItem('ai-home.restorePending'),null)
})

test('本机 MCP 使用自定义请求头、修改后重连，普通列表不泄漏凭据',async t=>{
  const catalog='ai-home.local.mcp', bindings='ai-home.local.mcpBindings'
  const oldCatalog=localStorage.getItem(catalog),oldBindings=localStorage.getItem(bindings)
  t.after(()=>{if(oldCatalog===null)localStorage.removeItem(catalog);else localStorage.setItem(catalog,oldCatalog);if(oldBindings===null)localStorage.removeItem(bindings);else localStorage.setItem(bindings,oldBindings)})
  const calls=[]
  stubFetch(t,async(_url,init)=>{
    const payload=JSON.parse(init.body),headers=new Headers(init.headers)
    calls.push({method:payload.method,workspace:headers.get('x-workspace'),authorization:headers.get('authorization')})
    if(payload.method==='notifications/initialized')return new Response(null,{status:204})
    const result=payload.method==='initialize'?{protocolVersion:'2025-03-26'}:payload.method==='tools/list'?{tools:[{name:'ping',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'pong'}]}
    return Response.json({jsonrpc:'2.0',id:payload.id,result},{headers:{'mcp-session-id':'s1'}})
  })
  const person='assistant-yanweixi'
  const created=await body('/api/mcp',{method:'POST',body:JSON.stringify({name:'测试',url:'https://example.org/mcp',token:'secret-token',headers:{'X-Workspace':'garden'}})})
  assert.equal(created.status,201);const id=created.data.connection.id
  assert.equal(JSON.stringify(created.data).includes('secret-token'),false);assert.equal(JSON.stringify(created.data).includes('garden'),false)
  assert.equal((await body('/api/mcp/bindings',{method:'PUT',body:JSON.stringify({person,connectionIds:[id]})})).status,200)
  const result=await body('/api/mcp/'+id+'/call',{method:'POST',body:JSON.stringify({person,name:'ping'})})
  assert.equal(result.status,200);assert.equal(calls.every(c=>c.workspace==='garden'&&c.authorization==='Bearer secret-token'),true)
  const list=await getJSON('/api/mcp');assert.equal(JSON.stringify(list.data).includes('secret-token'),false);assert.equal(JSON.stringify(list.data).includes('garden'),false)
  const before=calls.length
  assert.equal((await body('/api/mcp/'+id,{method:'PUT',body:JSON.stringify({headers:{'X-Workspace':'new'}})})).status,200)
  assert.equal((await body('/api/mcp/'+id+'/tools',{method:'POST',body:JSON.stringify({person})})).status,200)
  assert.equal(calls.slice(before).some(c=>c.method==='initialize'&&c.workspace==='new'),true)
})

test('本机账目与日记达到容量上限不会静默删除旧记录', async t => {
  const ledgerKey='ai-home.local.ledger', diaryKey='ai-home.local.diary'
  const oldLedger=localStorage.getItem(ledgerKey), oldDiary=localStorage.getItem(diaryKey)
  t.after(()=>{for(const [key,value] of [[ledgerKey,oldLedger],[diaryKey,oldDiary]]) value===null?localStorage.removeItem(key):localStorage.setItem(key,value)})
  const ledger=Array.from({length:5000},(_,i)=>({id:String(i),requestId:'request-id-'+i}))
  const diaries=Array.from({length:1000},(_,i)=>({id:String(i),owner:'user',title:'旧日记',visibility:'public',body:'内容',created_at:'2026-01-01'}))
  localStorage.setItem(ledgerKey,JSON.stringify(ledger));localStorage.setItem(diaryKey,JSON.stringify(diaries))
  const duplicate=await body('/api/ledger',{method:'POST',body:JSON.stringify({kind:'expense',amount:1,date:'2026-01-01',requestId:'request-id-0'})})
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.duplicate,true)
  const over=await body('/api/ledger',{method:'POST',body:JSON.stringify({kind:'expense',amount:1,date:'2026-01-01',requestId:'new-request-id-123'})})
  assert.equal(over.status,507);assert.deepEqual(JSON.parse(localStorage.getItem(ledgerKey)),ledger)
  const rejected=await body('/api/diary',{method:'POST',body:JSON.stringify({owner:'user',title:'新日记',content:'新内容',visibility:'public'})})
  assert.equal(rejected.status,507);assert.deepEqual(JSON.parse(localStorage.getItem(diaryKey)),diaries)
  assert.equal((await getJSON('/api/diary')).data.entries.length,1000)
})
