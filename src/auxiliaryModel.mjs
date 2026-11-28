// 为非流式辅助模型请求记录真实回包用量；诊断只保留角色与参数，不保存对话或记忆正文。
import { recordMediaUsage } from './usageLedger.mjs'
import { appendDiagLog, buildDiagSnapshot, loadDiagLogs, saveDiagLogs } from './requestDiag.mjs'

export async function observeAuxiliaryRequest({ storage, person, trigger, body, request, identify }) {
  const started = Date.now()
  let response
  try {
    response = await request()
    const actual = identify(response)
    if (response.ok && actual.known !== false) {
      const data = await response.clone().json().catch(() => null)
      const usage = data?.usage || {}
      recordMediaUsage(storage, person, { at:new Date().toISOString(), model:actual.model || '', vendorId:actual.vendorId || '', vendor:actual.vendor || '', subscription:!!actual.subscription, promptTokens:usage.prompt_tokens ?? usage.input_tokens, completionTokens:usage.completion_tokens ?? usage.output_tokens })
    }
    try {
      const log = buildDiagSnapshot({assistantId:person,trigger,provider:actual.vendor,requestBody:{model:actual.model || '',stream:false,messages:body.messages.map(m=>({role:m.role}))}})
      log.elapsedMs = Date.now() - started
      log.outcome = response.ok ? '成功' : '失败'
      if (!response.ok) log.error = 'HTTP ' + response.status
      saveDiagLogs(storage, appendDiagLog(loadDiagLogs(storage), log))
    } catch { /* 诊断不可用不影响请求 */ }
    return response
  } catch (error) {
    try {
      const log = buildDiagSnapshot({assistantId:person,trigger,requestBody:{model:'',stream:false,messages:body.messages.map(m=>({role:m.role}))}})
      log.elapsedMs = Date.now() - started
      log.outcome = '失败'
      log.error = '网络或响应异常'
      saveDiagLogs(storage, appendDiagLog(loadDiagLogs(storage), log))
    } catch { /* 诊断不可用不影响请求 */ }
    throw error
  }
}
