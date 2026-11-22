import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { strict as assert } from 'node:assert'
import puppeteer from 'puppeteer-core'

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'], {stdio:'pipe'})
const errors=[]
let browser
try {
  let started=false
  for(let i=0;i<60;i++){
    if(preview.exitCode!==null) throw Error('vite preview exited early: '+preview.exitCode)
    try { const r=await fetch('http://127.0.0.1:4173/'); if(r.ok){started=true;break} } catch{}
    await delay(250)
  }
  assert(started,'Preview server never started')
  const executablePath=process.env.CHROME_BIN || '/usr/bin/google-chrome'
  browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']})
  const page=await browser.newPage()
  await page.setViewport({width:393,height:852,deviceScaleFactor:2})
  page.on('pageerror', error=>errors.push('PAGE: '+error.stack))
  page.on('console', event=>{if(event.type()==='error')errors.push('CONSOLE: '+event.text())})
  page.on('requestfailed', request=>errors.push('NETWORK: '+request.url()+' '+request.failure()?.errorText))
  await page.evaluateOnNewDocument(() => {
    const message = { id: 'fixture-message', role: 'user', content: 'existing chat fixture' }
    localStorage.setItem('ai-home.conversations', JSON.stringify({
      'assistant-yanweixi': [{ id: 'fixture-chat', title: 'existing chat fixture', updatedAt: new Date().toISOString(), messages: [message] }],
      'assistant-yanshuo': [],
    }))
    localStorage.setItem('ai-home.worldEntries', JSON.stringify([{ id: 'fixture-world', title: 'existing world fixture', content: 'fixture', boundCharacters: [] }]))
    localStorage.setItem('ai-home.local.mcp', JSON.stringify([{ id: 'fixture-mcp', name: 'existing MCP fixture' }]))
    localStorage.setItem('ai-home.vendors', JSON.stringify([{ id: 'fixture-vendor', name: 'existing vendor fixture' }]))
    // Simulate an incomplete local backend snapshot alongside richer WebView data.
    localStorage.setItem('ai-home.local.state', JSON.stringify({ conversations: { 'assistant-yanweixi': [], 'assistant-yanshuo': [] }, worldEntries: [] }))
  })
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:15000})
  await page.waitForFunction(()=>{
    const root=document.getElementById('root')
    return !!root?.querySelector(".home-screen, .qj-preview") || !!document.querySelector('#qijian-boot-recovery')
  },{timeout:12000})
  const result=await page.evaluate(()=>({
    production:!!document.querySelector(".home-screen"),
    prototype:!!document.querySelector(".qj-preview, .qj-preview-label"),
    existingData: [
      ['ai-home.conversations', 'fixture-message'], ['ai-home.worldEntries', 'fixture-world'],
      ['ai-home.local.mcp', 'fixture-mcp'], ['ai-home.vendors', 'fixture-vendor'],
    ].every(([key, marker]) => localStorage.getItem(key)?.includes(marker)),
    rootChildren:document.getElementById('root')?.childElementCount,
    recovery:!!document.querySelector('#qijian-boot-recovery'),
    bodyText:(document.body?.innerText||'').slice(0,500),
  }))
  if(errors.length) console.error('Browser errors:\n'+errors.join('\n'))
  console.log('Browser startup:',JSON.stringify(result))
  assert(!result.recovery,'Startup recovery overlay shown')
  assert(!result.prototype,'Production entry opened the layout prototype')
  assert(result.production,'Production shell did not mount')
  assert(result.existingData,'Existing profile data was overwritten during startup')
  assert(result.rootChildren>0,'React did not render any child')
  await page.$eval('.mobile-menu-toggle', button => button.click())
  await page.waitForSelector('.app-sidebar.sidebar-open')
  await page.$eval('.sidebar-settings', button => button.click())
  await page.waitForSelector('.settings-page-back')
  for (const viewport of [{ width: 320, height: 640 }, { width: 852, height: 393 }]) {
    await page.setViewport(viewport)
    const geometry = await page.evaluate(() => {
      const root = document.documentElement
      root.style.setProperty('--native-safe-top', '24px')
      root.style.setProperty('--native-safe-left', '20px')
      root.style.setProperty('--native-safe-right', '16px')
      const header = document.querySelector('.settings-page-header').getBoundingClientRect()
      const back = document.querySelector('.settings-page-back').getBoundingClientRect()
      const icon = document.querySelector('.settings-page-back .ui-icon-image').getBoundingClientRect()
      const title = document.querySelector('.settings-page-header h2').getBoundingClientRect()
      return { headerTop: header.top, headerLeft: header.left, backWidth: back.width, backHeight: back.height, iconWidth: icon.width, titleTop: title.top, titleHeight: title.height, iconTop: icon.top, iconHeight: icon.height }
    })
    assert(geometry.headerTop >= 24 && geometry.headerTop < 50, 'Settings should consume the top inset once')
    assert(geometry.headerLeft >= 20, 'Settings must avoid the left cutout')
    assert(geometry.backWidth >= 48 && geometry.backHeight >= 48, 'Back hit target is too small')
    assert.equal(geometry.iconWidth, 24, 'Back glyph size')
    assert(Math.abs(geometry.titleTop + geometry.titleHeight / 2 - geometry.iconTop - geometry.iconHeight / 2) < 2, 'Back glyph is misaligned with title')
  }
  await page.$eval('.settings-row', button => button.click())
  await page.waitForFunction(() => document.querySelector('.settings-page-back')?.textContent === '全部设置')
  await page.$eval('.settings-page-back', button => button.click())
  await page.waitForFunction(() => document.querySelector('.settings-page-back')?.textContent === '主页')
  console.log('Qijian browser startup smoke test PASSED')
} finally {
  if(browser) await browser.close()
  preview.kill('SIGTERM')
}
