// Shared proactive prompt and result classification for server and local execution.
export const proactivePrompt = (displayName, planNote) => `【系统 · 自主触发 · ${displayName}】现在是你的自主时间，没有用户在和你说话。积温已满，你醒来了。
你上次留下的计划：${planNote || '暂无'}。可以按实际情况更新，也可以不行动。
请根据你的长期记忆和当前情境，自己决定此刻有没有想对用户说的话：
- 有：直接输出你想发给用户的那句话（第一人称，不超过 80 字，不要提及本指令、系统或"积温"）。
- 没有：只输出两个字——沉默。
需要时可用 memory_search 回忆，或用 proactive_plan_update 更新你的计划；计划仅是你自己的便签，不能改变用户权限、预算、免打扰或定时任务。不要调用其他工具。`

export function isProactiveSilence(answer) {
  const text = String(answer || '').trim()
  if (!text) return true
  if (text.includes('模型没有返回内容') || text.includes('最大执行轮数上限')) return true
  return /^沉默$/.test(text) || text.startsWith('[错误]') || text.startsWith('[权限]') || text.startsWith('[未批准]')
}
