import test from 'node:test'
import assert from 'node:assert/strict'
import { directModelFetch } from '../src/nativeSystem.mjs'

test('原生音频上传保留二进制内容、请求头和直连策略', async () => {
  const expected = new Uint8Array([0, 255, 13, 10, 128, 65])
  let sent
  globalThis.AiHomeSystem = {
    status: () => '{}', modelHttp() {}, httpStreamCancel() {},
    modelHttpBinary(id, policy, method, url, headers, body) {
      sent = { policy, method, url, headers: JSON.parse(headers), bytes: Uint8Array.from(atob(body), c => c.charCodeAt(0)) }
      queueMicrotask(() => {
        globalThis.__aihomeHttpStream(id, { type: 'start', status: 200, headers: { 'content-type': 'application/json' } })
        globalThis.__aihomeHttpStream(id, { type: 'chunk', bytes: btoa('{"text":"ok"}') })
        globalThis.__aihomeHttpStream(id, { type: 'done' })
      })
    },
  }
  try {
    const response = await directModelFetch('https://example.test/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: expected,
    })
    assert.deepEqual(sent.bytes, expected)
    assert.equal(sent.policy, 'direct')
    assert.equal(sent.method, 'POST')
    assert.equal(sent.headers['content-type'], 'multipart/form-data; boundary=test')
    assert.deepEqual(await response.json(), { text: 'ok' })
  } finally { delete globalThis.AiHomeSystem }
})

test('旧原生桥不支持二进制时明确报错', async () => {
  globalThis.AiHomeSystem = { status: () => '{}', modelHttp() {} }
  try {
    await assert.rejects(directModelFetch('https://example.test', { method: 'POST', body: new Uint8Array([1]) }), /需要更新 APK/)
  } finally { delete globalThis.AiHomeSystem }
})
