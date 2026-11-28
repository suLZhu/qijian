export function usageRows(conversations) {
  const groups = new Map()
  for (const conversation of conversations || []) {
    for (const message of conversation.messages || []) {
      if (message.role !== 'assistant' || !message.usage) continue
      const usage = message.usage
      const rounds = usage.rounds?.length ? usage.rounds : [usage]
      for (const round of rounds) {
        const model = round.model || '未标记模型'
        const key = round.vendorId ? JSON.stringify([round.vendorId, model, !!round.subscription]) : model
        const row = groups.get(key) || { key, model, vendor: round.vendor || '未记录来源', subscription: !!round.subscription, calls: 0, tokens: 0, lastAt: '' }
        row.calls++
        row.tokens += (Number(round.promptTokens) || 0) + (Number(round.completionTokens) || 0)
        if (usage.at > row.lastAt) row.lastAt = usage.at
        groups.set(key, row)
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

export function readMediaUsage(storage,person){
  try{const rows=JSON.parse(storage.getItem('ai-home.mediaUsage.'+person)||'[]');return Array.isArray(rows)?rows:[]}catch{return []}
}
export function recordMediaUsage(storage,person,usage){
  try{const rows=readMediaUsage(storage,person);rows.push({role:'assistant',usage});storage.setItem('ai-home.mediaUsage.'+person,JSON.stringify(rows))}catch{/* storage unavailable */}
}
