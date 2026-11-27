import {readdirSync,readFileSync,existsSync} from 'node:fs'
import assert from 'node:assert/strict'
for(const path of ['public/msg-icons','public/icons.svg','public/ui-icons-sprite.svg']) assert(!existsSync(path),'Legacy icon asset: '+path)
for(const path of readdirSync('src',{recursive:true}).filter(p=>/\.(tsx?|css)$/.test(p))){
 const source=readFileSync('src/'+path,'utf8')
 assert(!/msg-icons\/|ui-icons-sprite\.svg|\/icons\.svg|<svg\b/.test(source),'Legacy icon renderer: '+path)
}

for(const path of ['src/App.css','src/minimal.css']) {
 const source=readFileSync(path,'utf8')
 assert(!/\.ui-icon-image\s*>\s*img|\.shell\s+\.ui-icon-image\s*\{|\.vendor-model-brand\s+\.ui-icon-image\s*\{/.test(source),'Legacy icon sizing override: '+path)
}
