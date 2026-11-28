import { randomUUID } from "node:crypto"
import { buildTimeContext } from "./timeContext.mjs"
import { decideProactiveWake } from "./proactiveRules.mjs"
export { isQuietHour } from "./proactiveRules.mjs"
// Server-side wake decisions are deterministic; the model never silently invents a message.
// Background model execution and delivery are wired by the server.
const PEOPLE = ['assistant-yanweixi','assistant-yanshuo']
export function initProactive(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS proactive_settings (
 person TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
 mode TEXT NOT NULL DEFAULT 'natural', quiet_start INTEGER NOT NULL DEFAULT 23,
 quiet_end INTEGER NOT NULL DEFAULT 8, interval_hours INTEGER NOT NULL DEFAULT 12,
 daily_wake_limit INTEGER NOT NULL DEFAULT 6, daily_token_limit INTEGER NOT NULL DEFAULT 12000,
 allow_chat INTEGER NOT NULL DEFAULT 1, allow_memory_search INTEGER NOT NULL DEFAULT 1,
 plan_note TEXT NOT NULL DEFAULT '', plan_updated_at TEXT,
 updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS proactive_events (
 id TEXT PRIMARY KEY, person TEXT NOT NULL, reason TEXT NOT NULL,
 mood TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS proactive_events_person_idx ON proactive_events(person,created_at);`)
 const columns=db.prepare('PRAGMA table_info(proactive_settings)').all()
 if(!columns.some(row=>row.name==='daily_wake_limit'))db.exec('ALTER TABLE proactive_settings ADD COLUMN daily_wake_limit INTEGER NOT NULL DEFAULT 6')
 if(!columns.some(row=>row.name==='daily_token_limit'))db.exec('ALTER TABLE proactive_settings ADD COLUMN daily_token_limit INTEGER NOT NULL DEFAULT 12000')
 if(!columns.some(row=>row.name==='allow_chat'))db.exec('ALTER TABLE proactive_settings ADD COLUMN allow_chat INTEGER NOT NULL DEFAULT 1')
 if(!columns.some(row=>row.name==='allow_memory_search'))db.exec('ALTER TABLE proactive_settings ADD COLUMN allow_memory_search INTEGER NOT NULL DEFAULT 1')
 if(!columns.some(row=>row.name==='plan_note'))db.exec("ALTER TABLE proactive_settings ADD COLUMN plan_note TEXT NOT NULL DEFAULT ''")
 if(!columns.some(row=>row.name==='plan_updated_at'))db.exec('ALTER TABLE proactive_settings ADD COLUMN plan_updated_at TEXT')
 for(const person of PEOPLE) db.prepare('INSERT OR IGNORE INTO proactive_settings(person,updated_at) VALUES (?,?)').run(person,new Date().toISOString())
}
export function settings(db,person) {return db.prepare('SELECT * FROM proactive_settings WHERE person=?').get(person)}
export function events(db,person) {return db.prepare('SELECT * FROM proactive_events WHERE person=? ORDER BY created_at DESC LIMIT 30').all(person)}
export function configure(db,person,input) {
 if(!PEOPLE.includes(person))throw new Error('无效人物')
 const mode=['quiet','natural','lively'].includes(input.mode)?input.mode:'natural'
 const enabled=input.enabled===true?1:0
 const start=Number(input.quiet_start),end=Number(input.quiet_end)
 const interval=Number(input.interval_hours)
 const limit=Number(input.daily_wake_limit ?? settings(db,person)?.daily_wake_limit ?? 6)
 const tokenLimit=Number(input.daily_token_limit ?? settings(db,person)?.daily_token_limit ?? 12000)
 const existing=settings(db,person)
 const allowChat=(input.allow_chat ?? existing?.allow_chat ?? 1)?1:0
 const allowMemorySearch=(input.allow_memory_search ?? existing?.allow_memory_search ?? 1)?1:0
 if(!Number.isInteger(start)||start<0||start>23||!Number.isInteger(end)||end<0||end>23||!Number.isInteger(interval)||interval<2||interval>72||!Number.isInteger(limit)||limit<1||limit>48||!Number.isInteger(tokenLimit)||tokenLimit<1000||tokenLimit>500000)throw new Error('时间或每日唤醒上限无效')
 db.prepare('UPDATE proactive_settings SET enabled=?,mode=?,quiet_start=?,quiet_end=?,interval_hours=?,daily_wake_limit=?,daily_token_limit=?,allow_chat=?,allow_memory_search=?,updated_at=? WHERE person=?').run(enabled,mode,start,end,interval,limit,tokenLimit,allowChat,allowMemorySearch,new Date().toISOString(),person)
 return settings(db,person)
}
export function proactiveTimeZone(db) {
 try { return JSON.parse(db.prepare('SELECT payload FROM app_state WHERE id=1').get()?.payload || '{}').timeZone } catch { return undefined }
}
// Provider-reported usage only. A request may cross the threshold before its
// usage arrives, so this is a stop-before-next-call threshold, not a guarantee
// that the final day's total can never exceed the configured value.
export function proactiveTokenUsage(db,person,now=new Date()) {
 const timeZone=proactiveTimeZone(db)
 const today=buildTimeContext(now,timeZone).date
 const rows=db.prepare("SELECT created_at,usage FROM agent_runs WHERE assistant_id=? AND source='proactive' AND created_at>=? AND status!='running'")
  .all(person,new Date(now.getTime()-48*3600000).toISOString())
 let tokens=0,unknown=0
 for(const row of rows) {
  if(buildTimeContext(new Date(row.created_at),timeZone).date!==today)continue
  let usage
  try { usage=JSON.parse(row.usage) } catch { usage={} }
  const prompt=Number(usage.promptTokens),completion=Number(usage.completionTokens)
  if(!Number.isFinite(prompt)||!Number.isFinite(completion)||prompt+completion<=0)unknown++
  else tokens+=Math.max(0,prompt)+Math.max(0,completion)
 }
 return {tokens,unknown}
}

export function wake(db,person,{manual=false,now=new Date(),busy:busyCallback=()=>false}={}) {
 if(!PEOPLE.includes(person))throw new Error('无效人物')
 const config=settings(db,person)
 const timeZone=proactiveTimeZone(db)
 // Include old pending events and the latest event even when the interval exceeds 48 hours.
 const recent=db.prepare("SELECT created_at,status FROM proactive_events WHERE person=? AND (created_at>=? OR status='pending' OR id=(SELECT id FROM proactive_events WHERE person=? ORDER BY created_at DESC LIMIT 1))").all(person,new Date(now.getTime()-48*3600000).toISOString(),person)
 const decision=decideProactiveWake({config,now,timeZone,manual,events:recent,usage:proactiveTokenUsage(db,person,now),isBusy:()=>Boolean(db.prepare("SELECT 1 FROM agent_runs WHERE assistant_id=? AND status='running' LIMIT 1").get(person))||busyCallback(person)})
 if(!decision.queued)return decision
 const mood='curious'
 const reason=manual?'用户手动测试唤醒':'定时心跳：检查是否有真实进展、值得分享的发现或待办事项'
 const id=randomUUID()
 db.prepare('INSERT INTO proactive_events(id,person,reason,mood,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,person,reason,mood,'pending',now.toISOString(),now.toISOString())
 return {queued:true,id,reason,mood}
}
export function dismiss(db,person,id) {
 const r=db.prepare("UPDATE proactive_events SET status='dismissed',updated_at=? WHERE id=? AND person=? AND status='pending'").run(new Date().toISOString(),id,person)
 return r.changes>0
}
