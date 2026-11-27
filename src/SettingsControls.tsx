import { useState } from 'react'
import { useChatDisplay } from './ChatDisplay'
import { saveChatDisplay } from './chatDisplayPrefs.mjs'
import { SoftSelect } from './SoftSelect'
import { AppLockSettings } from './AppLockSettings'
export function SettingsInjection(){
 const prefs=useChatDisplay()
 const [city,setCity]=useState(prefs.weatherCity)
 return <div className="setting-card"><label><input type="checkbox" checked={prefs.timeEnabled} onChange={e=>saveChatDisplay({...prefs,timeEnabled:e.target.checked})}/> 注入当前时间</label><form onSubmit={e=>{e.preventDefault();saveChatDisplay({...prefs,weatherCity:city.trim()})}}><label>天气城市<input value={city} maxLength={80} onChange={e=>setCity(e.target.value)} placeholder="留空关闭天气"/></label><button type="submit">保存</button></form></div>
}
export function SettingsTools(){
 const prefs=useChatDisplay()
 return <div className="setting-card"><label><input type="checkbox" checked={prefs.toolsEnabled} onChange={e=>saveChatDisplay({...prefs,toolsEnabled:e.target.checked})}/> 聊天工具</label><div>连续工具调用最大轮数<SoftSelect value={String(prefs.toolRoundLimit)} options={[5,10,15,20].map(n=>({value:String(n),label:n+' 轮'}))} onChange={v=>saveChatDisplay({...prefs,toolRoundLimit:Number(v)})}/></div><AppLockSettings/></div>
}
