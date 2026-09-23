// 执行宿主刷新边界，验证开关重绘不会触发第三方脚本的预设切换清理。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 宿主依赖浏览器与酒馆绝对路径模块；提取这个无 import 的真实函数做边界测试。
const host=fs.readFileSync(new URL('../src/host/host.js',import.meta.url),'utf8');
const start=host.indexOf('async function refreshSnapshotPrompts(');
const end=host.indexOf('\nasync function applySettingsSnapshot(',start);
assert.ok(start>=0&&end>start);
const refresh=(env,loads=0)=>new Function('env','snapshotPresetLoads',host.slice(start,end)+';return refreshSnapshotPrompts(env);')(env,loads);

test('快照开关重绘保留已启动脚本入口，不模拟预设切换生命周期',async()=>{
 let visible=true,renders=0;
 const env={openai:{promptManager:{render:async()=>{renders++;}}},script:{event_types:{OAI_PRESET_CHANGED_AFTER:'after'},eventSource:{emit:async()=>{visible=false;}}}};
 await refresh(env);
 assert.equal(renders,1);
 assert.equal(visible,true,'脚本在切换事件中清理的入口应继续存在');
});

test('原生预设仍在加载时拒绝快照重绘',async()=>{
 let renders=0;
 await assert.rejects(refresh({openai:{promptManager:{render:async()=>{renders++;}}}},1),{name:'SnapshotContextChanged'});
 assert.equal(renders,0);
});

test('快照重绘失败仍交给上层回滚，不吞掉错误',async()=>{
 const error=new Error('render failed');
 await assert.rejects(refresh({openai:{promptManager:{render:async()=>{throw error;}}}}),e=>e===error);
});
