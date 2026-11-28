import test from 'node:test'
import assert from 'node:assert/strict'
import { localHandle } from '../src/localBackend.mjs'
import { registerLocalAgentExecutor } from '../src/localAgentRuns.mjs'
import { parseTaskEnvelope } from '../src/taskResult.mjs'

const values = new Map()
globalThis.localStorage = { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,String(v)) }
const req = async (path, body) => { const res = await localHandle(path, body ? { method:'POST',body:JSON.stringify(body) } : {}); return { status:res.status, ...(await res.json()) } }
const wait = () => new Promise(resolve=>setTimeout(resolve,0))
function setup(overrides={}) {
  values.clear()
  values.set('ai-home.local.state', JSON.stringify({ timeZone:'Asia/Shanghai', conversations:{ a:[{id:'c',messages:[]}] } }))
  values.set('ai-home.activeConversationIds', JSON.stringify({a:'c'}))
  values.set('ai-home.local.proactive', JSON.stringify({a:{ person:'a',enabled:1,allow_chat:1,allow_memory_search:1,quiet_start:0,quiet_end:0,interval_hours:12,daily_wake_limit:6,daily_token_limit:12000,mode:'natural',...overrides }}))
}

test('本地自主唤醒真实启动执行器，结果按绑定会话进入收件箱，冷却期不重复触发', async () => {
  setup()
  const unregister = registerLocalAgentExecutor(async run => {
    assert.equal(run.source,'proactive')
    assert.equal(run.conversationId,'c')
    return {answer:'今天忙不忙？',usage:{promptTokens:10,completionTokens:4}}
  })
  try {
    const wake = await req('/api/proactive',{person:'a',action:'wake',automatic:true})
    assert.equal(wake.queued,true)
    await wait()
    const panel = await req('/api/proactive?person=a')
    assert.equal(panel.events[0].status,'sent')
    assert.equal(panel.tokenUsage.tokens,14)
    const inbox = await req('/api/inbox')
    assert.equal(inbox.messages[0].kind,'proactive_result')
    assert.equal(parseTaskEnvelope(inbox.messages[0].content).conversationId,'c')
    assert.equal(parseTaskEnvelope(inbox.messages[0].content).answer,'今天忙不忙？')
    assert.equal((await req('/api/proactive',{person:'a',action:'wake',automatic:true})).reason,'cooldown')
  } finally { unregister() }
})

test('静默不发消息，未上报用量会阻止下一次唤醒', async () => {
  setup()
  const unregister = registerLocalAgentExecutor(async()=>({answer:'沉默'}))
  try {
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).queued,true)
    await wait()
    assert.equal((await req('/api/proactive?person=a')).events[0].status,'silent')
    assert.equal((await req('/api/inbox')).messages.length,0)
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).reason,'usage_unavailable')
  } finally { unregister() }
})

test('助手忙碌或关闭权限不唤醒；执行中撤销聊天权限不投递', async () => {
  setup()
  let finish
  const unregister = registerLocalAgentExecutor((_run,signal)=>new Promise((resolve,reject)=>{ finish=()=>resolve({answer:'不该发送'}); signal.addEventListener('abort',()=>reject(new Error('cancelled'))) }))
  try {
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).queued,true)
    await wait()
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).reason,'assistant_busy')
    const cfg = (await req('/api/proactive?person=a')).settings
    await req('/api/proactive',{person:'a',action:'configure',...cfg,enabled:false})
    finish()
    await wait()
    assert.equal((await req('/api/inbox')).messages.length,0)
    assert.equal((await req('/api/proactive?person=a')).events[0].status,'dismissed')
  } finally { unregister() }
})

test('免打扰、每日限制、缺少会话和权限均拒绝触发', async () => {
  let calls=0
  const unregister=registerLocalAgentExecutor(async()=>{calls++;return {answer:'hello'}})
  try {
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(new Date()))
    setup({quiet_start:hour,quiet_end:(hour+1)%24})
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).reason,'quiet_hours')
    setup({allow_chat:0})
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).reason,'chat_not_allowed')
    setup()
    values.set('ai-home.activeConversationIds',JSON.stringify({a:'missing'}))
    assert.match((await req('/api/proactive',{person:'a',action:'wake'})).reason,/会话/)
    setup({daily_wake_limit:1})
    values.set('ai-home.local.proactiveEvents',JSON.stringify([{person:'a',status:'sent',created_at:new Date().toISOString()}]))
    assert.equal((await req('/api/proactive',{person:'a',action:'wake'})).reason,'daily_limit')
    assert.equal(calls,0)
  } finally { unregister() }
})

test('普通 Agent API 不能冒用内部自主来源', async () => {
  setup()
  const unregister=registerLocalAgentExecutor(async()=>({answer:'hello'}))
  try {
    const result=await req('/api/agent/runs',{person:'a',prompt:'test',source:'proactive',internal:true})
    assert.equal(result.status,400)
    assert.match(result.error,/来源/)
  } finally { unregister() }
})

test('自主计划只改助手便签，保存设置时保留且禁用时拒绝', async () => {
  setup()
  const before=(await req('/api/proactive?person=a')).settings
  assert.equal((await req('/api/proactive/plan',{person:'a',note:'下次关心近况'})).ok,true)
  const after=(await req('/api/proactive?person=a')).settings
  assert.equal(after.plan_note,'下次关心近况')
  for(const key of ['enabled','allow_chat','allow_memory_search','daily_token_limit','quiet_start'])assert.equal(after[key],before[key])
  await req('/api/proactive',{person:'a',action:'configure',...after,enabled:true})
  assert.equal((await req('/api/proactive?person=a')).settings.plan_note,'下次关心近况')
  await req('/api/proactive',{person:'a',action:'configure',...after,enabled:false})
  assert.equal((await req('/api/proactive/plan',{person:'a',note:'不能保存'})).status,403)
})
