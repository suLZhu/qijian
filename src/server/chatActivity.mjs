// Track live foreground chat requests per assistant, across streaming and
// non-streaming routes. The release closure is idempotent on abort/finish.
export function createChatActivity() {
  const active = new Map()
  return {
    begin(person) {
      if (!person) return () => {}
      active.set(person, (active.get(person) || 0) + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const remaining = (active.get(person) || 1) - 1
        if (remaining) active.set(person, remaining)
        else active.delete(person)
      }
    },
    busy(person) { return (active.get(person) || 0) > 0 },
  }
}
