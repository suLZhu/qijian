export type LocalAgentRun = {
  id: string; assistantId: string; source: string; conversationId: string
  prompt: string; answer: string; rounds: number; toolCalls: number
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'
  usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number; calls?: number }
  model: string; createdAt: string; updatedAt: string; finishedAt: string | null
  errorCode?: string; errorMessage?: string
}
export type LocalAgentEvent = { type: string; at: string; runId: string; assistantId: string; status: string }
export type LocalAgentResult = { answer: string; usage?: LocalAgentRun['usage']; model?: string; rounds?: number; toolCalls?: number }
export function registerLocalAgentExecutor(handler: (run: LocalAgentRun, signal: AbortSignal) => Promise<LocalAgentResult>): () => void
export function subscribeLocalAgentEvents(listener: (event: LocalAgentEvent) => void): () => void
export function listLocalAgentRuns(person?: string, limit?: number): LocalAgentRun[]
export function getLocalAgentRun(id: string): LocalAgentRun | null
export function localAgentUsageMessages(person: string): Array<{ role: 'assistant'; usage: LocalAgentRun['usage'] }>
export function startLocalAgentRun(input: { person: string; prompt: string; source?: string; conversationId?: string }): LocalAgentRun
export function cancelLocalAgentRun(id: string): { ok: boolean; accepted: boolean; status: LocalAgentRun['status'] } | null
