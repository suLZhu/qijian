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
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:15000})
  await page.waitForFunction(()=>{
    const root=document.getElementById('root')
    return root?.childElementCount > 0 || !!document.querySelector('#qijian-boot-recovery')
  },{timeout:12000})
  const result=await page.evaluate(()=>({
    rootChildren:document.getElementById('root')?.childElementCount,
    recovery:!!document.querySelector('#qijian-boot-recovery'),
    bodyText:(document.body?.innerText||'').slice(0,500),
  }))
  if(errors.length) console.error('Browser errors:\n'+errors.join('\n'))
  console.log('Browser startup:',JSON.stringify(result))
  assert(!result.recovery,'Startup recovery overlay shown')
  assert(result.rootChildren>0,'React did not render any child')
  await page.evaluate(async()=>{await Promise.all(Array.from(document.querySelectorAll('.ui-icon-image')).map(el=>el.decode()))})
  const icons=await page.evaluate(()=>Array.from(document.querySelectorAll('.ui-icon-image')).map(el=>{
    const r=el.getBoundingClientRect(), css=getComputedStyle(el)
    return {width:r.width,height:r.height,tag:el.tagName,loaded:el.complete&&el.naturalWidth===96&&el.naturalHeight===96}
  }))
  assert(icons.length>0,'No shared icons rendered on startup')
  for(const icon of icons){
    assert(icon.width>0 && icon.width<=48 && icon.height>0 && icon.height<=48,'Icon exceeds its layout cell: '+JSON.stringify(icon))
    assert(icon.tag.toLowerCase()==='img' && icon.loaded,'Unclipped icon sprite: '+JSON.stringify(icon))
  }
  const assets=await page.evaluate(async(names)=>Promise.all(names.map(async name=>{
    const img=new Image();img.src='/ui-icons/'+name+'.png';await img.decode()
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0)
    const pixels=ctx.getImageData(0,0,96,96).data
    return img.naturalWidth===96&&img.naturalHeight===96&&pixels.some((v,i)=>i%4===3&&v>0)&&pixels.some((v,i)=>i%4===3&&v===0)
  })),["home","chat","user","settings","clock","memory","grid","calendar","coffee","photo","music","ledger","book","plus","sun","star","flower","list","palette","plug","chart","sparkles","folder","shield","info","back","chevron-right","chevron-down","chevron-up","close","edit","trash","eye","eye-off","arrow-up","arrow-down","switch","share","test","search","minus","file","warning","mail","lock","check","more","video","copy","refresh","emoji","menu","mic","stop","send"])
  assert(assets.every(Boolean),'Invalid PNG artwork')
  console.log('Shared icon layout checks passed:',icons.length,'PNG assets:',assets.length)
  console.log('Qijian browser startup smoke test PASSED')
} finally {
  if(browser) await browser.close()
  preview.kill('SIGTERM')
}
