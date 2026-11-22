import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function apkMetadata(badging, apk, channel, notes, previousCode = 0) {
  if (!['stable', 'beta'].includes(channel)) throw new Error('Unknown APK release channel')
  const result = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging)
  if (!result || result[1] !== 'com.sulzhu.aihome') throw new Error('Unexpected Android application ID or version metadata')
  const [, applicationId, code, versionName] = result
  const versionCode = Number(code)
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode <= previousCode) throw new Error('Version code must increase')
  return {
    applicationId, versionCode, versionName, channel, notes,
    apkUrl: `https://github.com/suLZhu/qijian/releases/download/qijian-${channel}/qijian-${versionCode}.apk`,
    sizeBytes: apk.length,
    sha256: createHash('sha256').update(apk).digest('hex'),
  }
}

if (process.argv[1]?.endsWith('/prepare-apk-release.mjs')) {
  const [, , apkPath, badgingPath, directory, channel] = process.argv
  const manifestPath = join(directory, 'latest.json')
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
  const notes = process.env.QIJIAN_RELEASE_NOTES || '整合聊天稳定性与记忆修复，新增应用内 APK 更新。'
  const metadata = apkMetadata(readFileSync(badgingPath, 'utf8'), readFileSync(apkPath), channel, notes, previous?.versionCode)
  copyFileSync(apkPath, join(directory, `qijian-${metadata.versionCode}.apk`))
  writeFileSync(manifestPath, JSON.stringify(metadata, null, 2) + '\n')
}
