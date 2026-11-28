import { buildTimeContext } from './timeContext.mjs'

// Pure decisions shared by the server and the future local scheduler. The caller
// provides persisted events, reported usage, and a live busy check.
export function isQuietHour(config, now = new Date(), timeZone) {
  const hour = buildTimeContext(now, timeZone).hour
  return config.quiet_start === config.quiet_end ? false
    : config.quiet_start < config.quiet_end
      ? hour >= config.quiet_start && hour < config.quiet_end
      : hour >= config.quiet_start || hour < config.quiet_end
}

export function decideProactiveWake({ config, now = new Date(), timeZone, manual = false, events = [], usage = { tokens: 0, unknown: 0 }, isBusy = () => false }) {
  if (!config.enabled) return { queued: false, reason: 'disabled' }
  if (!config.allow_chat) return { queued: false, reason: 'chat_not_allowed' }
  if (isQuietHour(config, now, timeZone)) return { queued: false, reason: 'quiet_hours' }
  const today = buildTimeContext(now, timeZone).date
  const used = events.filter(event => buildTimeContext(new Date(event.created_at), timeZone).date === today).length
  if (used >= config.daily_wake_limit) return { queued: false, reason: 'daily_limit', used, limit: config.daily_wake_limit }
  if (usage.unknown) return { queued: false, reason: 'usage_unavailable' }
  if (usage.tokens >= config.daily_token_limit) return { queued: false, reason: 'token_limit', used: usage.tokens, limit: config.daily_token_limit }
  if (!manual && isBusy()) return { queued: false, reason: 'assistant_busy' }
  if (events.some(event => event.status === 'pending')) return { queued: false, reason: 'pending_exists' }
  const last = events.reduce((latest, event) => Math.max(latest, new Date(event.created_at).getTime() || 0), 0)
  const minHours = config.mode === 'quiet' ? Math.max(24, config.interval_hours)
    : config.mode === 'lively' ? Math.max(2, Math.floor(config.interval_hours / 2)) : config.interval_hours
  if (!manual && last && now.getTime() - last < minHours * 3600000) return { queued: false, reason: 'cooldown' }
  return { queued: true }
}
