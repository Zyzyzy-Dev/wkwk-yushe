// 运行宿主快照保存核验：对象键序、原生延后写入与真实持久化差异。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/host/host.js', import.meta.url), 'utf8');
const start = source.indexOf('async function saveSnapshotSettings(');
const end = source.indexOf('\nasync function saveSnapshotMetadata(', start);
assert.ok(start >= 0 && end > start);
const key = 'preset_compare_snapshots';
const factory = new Function('snapshotStore', 'selectedSnapshotWorlds', 'snapshotWorldSettings', 'readSnapshotPersistence', 'SNAPSHOT_KEY', 'setTimeout', 'Date', source.slice(start, end) + ';return saveSnapshotSettings;');
const reorder = v => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])) : v;
function fixture() {
  return {extension_settings:{[key]:{version:1,snapshots:[{id:'s1',name:'快照',entries:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}],scope:{preset:true,worlds:true,regex:true}}],characterBindings:{'a.png':'s1'}},regex:[{id:'r',disabled:false}]},
    oai_settings:{prompt_order:[{character_id:1,order:[{identifier:'a',enabled:true},{identifier:'b',enabled:false}]}],extensions:{baibaiToolkit:{presetPromptGroups:{groups:[{id:'g',enabled:false}]}},regex_scripts:[]}},world_info_settings:{world_info:{globalSelect:['A','B'],charLore:[]}}};
}
function setup({transform=v=>v, deferred=false, asString=true, readError=false, expire=false}={}) {
  const live=fixture();let reads=0,saves=0,now=0;
  const persisted=transform(structuredClone(live));
  const env={extensions:{extension_settings:live.extension_settings},openai:{oai_settings:live.oai_settings},script:{saveSettings:async()=>{saves++}}};
  const run=factory(e=>e.extensions.extension_settings[key],()=>live.world_info_settings.world_info.globalSelect,()=>live.world_info_settings.world_info,
    async()=>{reads++;if(expire)now=8001;if(readError)throw Error('HTTP 503');const disk=deferred&&reads<3?{}:persisted;return {settings:asString?JSON.stringify(disk):disk}},key,fn=>{queueMicrotask(fn);return 0},{now:()=>now});
  return {save:(verify=false)=>run(env,verify),reads:()=>reads,saves:()=>saves};
}
for(const asString of [true,false]) test(`快照及应用状态对象键序变化仍通过（${asString?'string':'object'}）`,async()=>{
  const f=setup({transform:reorder,asString});await f.save(true);assert.equal(f.saves(),1);
});
test('原生延后写入时等待回读，不重复保存设置',async()=>{
  const f=setup({deferred:true});await f.save();assert.equal(f.saves(),1);assert.equal(f.reads(),3);
});
for(const [name,change] of [
  ['快照丢失',d=>d.extension_settings[key].snapshots=[]],
  ['快照值改变',d=>d.extension_settings[key].snapshots[0].entries[0].enabled=false],
  ['快照条目数组顺序改变',d=>d.extension_settings[key].snapshots[0].entries.reverse()],
  ['角色绑定丢失',d=>d.extension_settings[key].characterBindings={}],
  ['提示词开关改变',d=>d.oai_settings.prompt_order[0].order[0].enabled=false],
  ['分组开关改变',d=>d.oai_settings.extensions.baibaiToolkit.presetPromptGroups.groups[0].enabled=true],
  ['世界书顺序改变',d=>d.world_info_settings.world_info.globalSelect.reverse()],
  ['正则开关改变',d=>d.extension_settings.regex[0].disabled=true],
]) test(`实际未保存仍拒绝：${name}`,async()=>{
  const f=setup({transform:d=>{change(d);return d}});await assert.rejects(f.save(true),/未确认/);assert.equal(f.saves(),1);
});
test('回读接口失败仍报告真实读取错误',async()=>{const f=setup({readError:true});await assert.rejects(f.save(),/HTTP 503/)});
test('回读预算耗尽后不继续安排请求或重复写入',async()=>{const f=setup({deferred:true,expire:true});await assert.rejects(f.save(),/未确认快照保存成功/);assert.equal(f.reads(),1);assert.equal(f.saves(),1)});
test('快照回读中断不建议导入世界书，世界书保留其恢复建议',async()=>{
  const a=source.indexOf('async function readSnapshotPersistence('),b=source.indexOf('\nasync function saveSnapshotSettings(',a);
  const read=new Function('fetch',source.slice(a,b)+';return readSnapshotPersistence;')(async()=>{throw Object.assign(new Error('abort'),{name:'AbortError'})});
  for(const label of ['快照保存核验','世界书正文']){
    await assert.rejects(read({script:{getRequestHeaders:()=>({})}},'/api/settings/get',{}, {label}),error=>{
      assert.match(error.message,/读取被中断/);assert.equal(error.message.includes('导入世界书 JSON'),label==='世界书正文');return true;
    });
  }
});
