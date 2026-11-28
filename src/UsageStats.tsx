import { usageRows } from './usageLedger.mjs'
import { useEffect, useMemo, useState } from 'react'
import { localAgentUsageMessages, subscribeLocalAgentEvents } from './localAgentRuns.mjs'
import { SoftSelect } from './SoftSelect'

// AI 用量统计：按助手切换；同一助手用过多个模型时，每个模型可单独设置
// 「按量（元/千 Token）」或「按次（元/次）」价格。价格只存本机。
const PRICING_KEY = 'ai-home.usagePricing'

type Mode = 'perToken' | 'perCall'
type Price = { mode: Mode; price: string; amount?: string }
type Usage = { at?: string; model?: string; promptTokens?: number; completionTokens?: number }
type Msg = { role?: string; usage?: Usage }
type Conv = { messages?: Msg[] }

function loadPricing(): Record<string, Record<string, Price>> {
  try {
    const raw = localStorage.getItem(PRICING_KEY)
    const v = raw ? JSON.parse(raw) : {}
    if (!v || typeof v !== 'object') return {}
    // 兼容旧结构：{ assistant: { mode, price } } → { assistant: { '*': { mode, price } } }
    const out: Record<string, Record<string, Price>> = {}
    for (const [person, value] of Object.entries<any>(v)) {
      if (value && typeof value === 'object' && typeof value.price === 'string' && typeof value.mode === 'string') {
        out[person] = { '*': { mode: value.mode, price: value.price } }
      } else if (value && typeof value === 'object') {
        out[person] = value
      }
    }
    return out
  } catch { return {} }
}

function savePricing(all: Record<string, Record<string, Price>>) {
  try { localStorage.setItem(PRICING_KEY, JSON.stringify(all)) } catch { /* 隐私模式 */ }
}

function costOf(calls: number, tokens: number, p: Price | undefined) {
  const amount = p?.amount?.trim()
  if (amount && Number.isFinite(Number(amount)) && Number(amount) >= 0) return Number(amount)
  const price = Number(p && p.price)
  if (!p || !Number.isFinite(price) || price <= 0) return 0
  return p.mode === 'perCall' ? calls * price : (tokens / 1000) * price
}

export function UsageStats({ people, conversations, models, displayName }: {
  people: string[]
  conversations: Record<string, Conv[]>
  models: Record<string, string>
  displayName: (p: string) => string
}) {
  const [pricing, setPricing] = useState<Record<string, Record<string, Price>>>(() => loadPricing())
  const [active, setActive] = useState(people[0] || '')
  const [runRevision, setRunRevision] = useState(0)
  useEffect(() => subscribeLocalAgentEvents(event => { if (event.type === 'run_finished' || event.type === 'run_usage') setRunRevision(value => value + 1) }), [])

  const perPerson = useMemo(() => {
    return Object.fromEntries(people.map(person => {
      let agentMessages: Msg[] = []
      try { agentMessages = localAgentUsageMessages(person) } catch { /* storage unavailable */ }
      return [person, usageRows([...(conversations[person] || []),{messages:[...agentMessages]}])]
    }))
  }, [people, conversations, runRevision])

  const priceFor = (person: string, model: string): Price => {
    const map = pricing[person] || {}
    return map[model] || map['*'] || { mode: 'perToken', price: '' }
  }
  const patchPrice = (person: string, model: string, next: Partial<Price>) => {
    const map = { ...(pricing[person] || {}) }
    map[model] = { ...priceFor(person, model), ...next }
    const all = { ...pricing, [person]: map }
    setPricing(all)
    savePricing(all)
  }

  const totals = people.reduce((acc, p) => {
    for (const row of perPerson[p] || []) {
      acc.calls += row.calls
      acc.tokens += row.tokens
      if (!row.subscription) acc.cost += costOf(row.calls, row.tokens, priceFor(p, row.key))
    }
    return acc
  }, { calls: 0, tokens: 0, cost: 0 })

  const rows = perPerson[active] || []
  const latest = rows[0] && rows[0].model !== '未标记模型' ? rows[0].model : (models[active] || '')

  return <div className="usage-stats">

    <div className="usage-people" role="tablist" aria-label="选择助手">
      <SoftSelect ariaLabel="选择助手" value={active} options={people.map(p=>({value:p,label:displayName(p)}))} onChange={setActive}/>
    </div>
    <div className="usage-summary usage-summary-rows">
      <div><small>合计花费（估算）</small><b>≈ ¥{totals.cost.toFixed(2)}</b></div>
      <div><small>调用次数</small><b>{totals.calls}</b></div>
      <div><small>Token 总量</small><b>{totals.tokens.toLocaleString()}</b></div>
    </div>

    <div className="usage-model-line"><small>最近使用的模型</small><b>{latest || '（未设置）'}</b></div>

    <div className="usage-model-list">
      {rows.length === 0 && <p className="muted">这个助手还没有带用量记录的消息。</p>}
      {rows.map((row) => {
        const p = priceFor(active, row.key)
        return <div className="usage-model-block" key={row.key}>
          <div className="usage-model-head"><b>{row.vendor} · {row.model}</b><small>{row.calls} 次 · {row.tokens.toLocaleString()} Token{row.subscription ? ' · 订阅' : ' · ≈ ¥' + costOf(row.calls, row.tokens, p).toFixed(2)}</small></div>
          {!row.subscription && <><label className="usage-field">计费方式
            <SoftSelect ariaLabel={'计费方式 ' + row.model} value={p.mode} onChange={(value) => patchPrice(active, row.key, { mode: value as Mode })} options={[{ value: 'perToken', label: '按量（元 / 千 Token）' }, { value: 'perCall', label: '按次（元 / 次）' }]}/>
          </label>
          <label className="usage-field">单价
            <input aria-label={'单价 ' + row.model} type="number" min="0" step="0.0001" value={p.price} placeholder={p.mode === 'perToken' ? '例如 0.008' : '例如 0.02'} onChange={(e) => patchPrice(active, row.key, { price: e.target.value })}/>
          </label>
          <label className="usage-field">实付总额（元）
            <input type="number" min="0" step="0.01" value={p.amount || ''} placeholder="留空按单价估算" onChange={e => patchPrice(active, row.key, { amount: e.target.value })}/>
          </label></>}
        </div>
      })}
    </div>
    <p className="muted">每个模型单独计价：按量按「元 / 千 Token」，按次按每次调用；价格只存本机。</p>
  </div>
}
