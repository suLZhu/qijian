import type { ReactNode } from 'react'
import { settingItems, type SettingsSection } from './sections'

export function SettingsIndex({open,extra}:{open:(name:SettingsSection)=>void;extra?:ReactNode}) {
  return <div className="qj-page">
    <div className="qj-section-head"><h2>设置中心</h2><p>常用功能在前，其他功能集中管理。</p></div>
    <div className="qj-row-group">{settingItems.map(([name,desc])=>
      <button type="button" key={name} className="qj-row" onClick={()=>open(name)}>
        <span>{name}</span><small>{desc}</small><i aria-hidden="true">›</i>
      </button>
    )}{extra}</div>
  </div>
}

export type Destination = 'home'|'room'|'settings'
export function BottomNav({current,go}:{current:Destination;go:(page:Destination)=>void}) {
  return <nav className="qj-bottom" aria-label="主导航">
    {([['home','▤','主页'],['room','⌂','房间'],['settings','⚙','设置']] as const).map(([page,icon,label])=>
      <button type="button" key={page} aria-label={label} className={current===page?'active':''} aria-current={current===page?'page':undefined} onClick={()=>go(page)}>
        <span aria-hidden="true">{icon}</span>{label}
      </button>
    )}
  </nav>
}
