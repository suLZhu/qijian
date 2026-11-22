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
  console.log('Qijian browser startup smoke test PASSED')
} finally {
  if(browser) await browser.close()
  preview.kill('SIGTERM')
}
