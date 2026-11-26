import test from 'node:test'
import assert from 'node:assert/strict'
import { usageRows } from '../src/usageLedger.mjs'

test('一次回复的多次模型调用按实际站点、模型和订阅类型分账，旧记录保留', () => {
  const round = { model: 'same', vendorId: 'a', vendor: 'A', promptTokens: 2, completionTokens: 3 }
  const rows = usageRows([{ messages: [
    { role: 'assistant', usage: { rounds: [round, round, { ...round, subscription: true }, { ...round, vendorId: 'b' }] } },
    { role: 'assistant', usage: { model: 'same', completionTokens: 8 } },
  ] }])
  assert.deepEqual(rows.map(r => [r.calls, r.tokens, r.subscription]), [[2,10,false],[1,5,true],[1,5,false],[1,8,false]])
  assert.equal(rows[3].vendor, '未记录来源')
})
