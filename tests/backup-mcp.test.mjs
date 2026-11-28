import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareBackupMcp} from '../src/backupMcp.mjs'
const id='9a2a56c7-0d23-4a4b-a201-441153eff702', person='assistant-test'
const service={id,name:'工具',url:'https://example.com/mcp',transport:'httpStream',enabled:true,token:'secret',headers:{'X-Key':'value'}}
test('MCP 本机和服务器之间转换服务、凭据和绑定',()=>{
 const local={'ai-home.local.mcp':JSON.stringify([service]),'ai-home.local.mcpBindings':JSON.stringify({[person]:[id]})}
 const cloud=prepareBackupMcp({local,server:{},crossMode:true},'mcp',false)
 assert.equal(cloud.server.mcp.services[0].credentials.headers['X-Key'],'value')
 assert.deepEqual(cloud.server.mcp.bindings,[{person,connectionId:id}])
 const restored=prepareBackupMcp({local:{},server:cloud.server,crossMode:true},'mcp',true)
 assert.equal(JSON.parse(restored.local['ai-home.local.mcp'])[0].token,'secret')
 assert.deepEqual(JSON.parse(restored.local['ai-home.local.mcpBindings']),{[person]:[id]})
})
test('MCP 冲突或服务器不支持的地址不会静默迁移',()=>{
 const local={'ai-home.local.mcp':JSON.stringify([service])}
 assert.throws(()=>prepareBackupMcp({local,server:{mcp:{version:1,services:[{...service,name:'其他',credentials:{token:'secret',headers:{'X-Key':'value'}}}],bindings:[]}},crossMode:true},'mcp',false),/冲突/)
 assert.throws(()=>prepareBackupMcp({local:{'ai-home.local.mcp':JSON.stringify([{...service,url:'http://example.com'}])},server:{},crossMode:true},'mcp',false),/HTTPS/)
})
