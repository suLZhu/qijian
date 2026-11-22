import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apkMetadata } from '../scripts/prepare-apk-release.mjs'

const badging = "package: name='com.sulzhu.aihome' versionCode='51' versionName='5.1'"
test('生成稳定和测试 APK 元数据，下载地址固定在对应频道', () => {
  const apk = Buffer.from('fake apk')
  for (const channel of ['stable', 'beta']) {
    const result = apkMetadata(badging, apk, channel, '说明', 50)
    assert.equal(result.versionCode, 51)
    assert.equal(result.versionName, '5.1')
    assert.equal(result.channel, channel)
    assert.match(result.apkUrl, new RegExp('/qijian-' + channel + '/qijian-51[.]apk$'))
    assert.equal(result.sizeBytes, apk.length)
    assert.match(result.sha256, /^[a-f0-9]{64}$/)
  }
})
test('拒绝旧包、同版本、缺少元数据和错误包名', () => {
  for (const previous of [51, 52]) assert.throws(() => apkMetadata(badging, Buffer.alloc(1), 'beta', '', previous))
  assert.throws(() => apkMetadata('', Buffer.alloc(1), 'beta', ''))
  assert.throws(() => apkMetadata(badging.replace('com.sulzhu.aihome', 'com.example.wrong'), Buffer.alloc(1), 'beta', ''))
})
