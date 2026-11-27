import { ProxyAgent, Agent, fetch as httpFetch } from 'undici'
import { checkOutboundPolicy } from './outboundPolicy.mjs'
const direct = new Agent()
let proxy
let proxyUrl

export function directFetch(url, options = {}) {
  return httpFetch(url, { ...options, dispatcher: direct })
}

export async function subscriptionFetch(url, options = {}) {
  const configured = (process.env.QIJIAN_SUBSCRIPTION_PROXY || '').trim()
  const decision = checkOutboundPolicy({ policy: 'subscription-proxy', proxyReady: !!configured })
  if (!decision.allowed) throw new Error(decision.reason)
  if (proxyUrl !== configured) {
    let address
    try { address = new URL(configured) }
    catch { throw new Error('订阅代理地址格式无效') }
    if (!['http:', 'https:'].includes(address.protocol)) throw new Error('订阅代理仅支持 HTTP/HTTPS CONNECT')
    const replacement = new ProxyAgent(configured)
    if (proxy) void proxy.close().catch(() => {})
    proxy = replacement
    proxyUrl = configured
  }
  try {
    return await httpFetch(url, { ...options, dispatcher: proxy, redirect: 'error' })
  } catch (error) {
    if (options.signal?.aborted) throw error
    const code = error?.cause?.code
    const detail = typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? '（' + code + '）' : ''
    throw new Error('经订阅代理连接上游失败' + detail)
  }
}
