// 运行宿主快照保存核验：对象键序、原生延后写入与真实持久化差异。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/host/host.js', import.meta.url), 'utf8');
const start = source.indexOf('async function saveSnapshotSettings(');
const end = source.indexOf('\nasync function saveSnapshotMetadata(', start);
assert.ok(start >= 0 && end > start);
const key = 'preset_compare_snapshots';
const factory = new Function('snapshotStore', 'selectedSnapshotWorlds', 'snapshotWorldSettings', 'readSnapshotPersistence', 'SNAPSHOT_KEY', 'setTimeout', 'Date', 'snapshotPersistenceStatus', 'API_BINDINGS_KEY', source.slice(start, end) + ';return saveSnapshotSettings;');
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
    async()=>{reads++;if(expire)now=20001;if(readError)throw Error('HTTP 503');const disk=deferred&&reads<3?{extension_settings:{}}:persisted;return {settings:asString?JSON.stringify(disk):disk}},key,fn=>{queueMicrotask(fn);return 0},{now:()=>now},new WeakMap(),'preset_compare_api_snapshot_links');
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

function uncertainFixture({readMode='abort',writeFail=false,verifySwitches=false}={}){
  const live=fixture(),pending=new WeakMap(),links='preset_compare_api_snapshot_links';let writes=0,reads=0,now=0,disk=null,mode=readMode;
  live.extension_settings[links]=[{apiId:'api',snapshotId:'s1'}];
  const env={extensions:{extension_settings:live.extension_settings},openai:{oai_settings:live.oai_settings},script:{saveSettings:async()=>{writes++;if(writeFail)throw Error('write rejected');disk=structuredClone(live);}}};
  const read=async(_env,_url,_body,{timeoutMs})=>{reads++;if(mode==='timeout'){now+=timeoutMs;throw Error(`快照保存核验读取超时（${Math.ceil(timeoutMs/1000)} 秒）`);}if(mode==='flaky'&&reads===1)throw Error('temporary read failure');if(mode==='abort')throw Object.assign(Error('read aborted'),{name:'AbortError'});if(mode==='invalid')return {settings:'{'};if(mode==='partial')return {bootstrap:{partial:true},settings:disk};if(mode==='http')throw Error('HTTP 503');if(mode==='missing-settings')return {};if(mode==='mismatch')return {settings:{...disk,extension_settings:{[key]:{version:1,snapshots:[],characterBindings:{}}}}};if(mode==='link-mismatch')return {settings:{...disk,extension_settings:{...disk.extension_settings,[links]:[]}}};return {settings:disk};};
  const run=factory(e=>e.extensions.extension_settings[key],()=>live.world_info_settings.world_info.globalSelect,()=>live.world_info_settings.world_info,read,key,(fn,ms)=>{now+=ms;queueMicrotask(fn);return 0},{now:()=>now},pending,links);
  return {live,pending,get writes(){return writes},get reads(){return reads},get disk(){return disk},set mode(value){mode=value},save:options=>run(env,verifySwitches,null,options),verify:()=>run(env,false,null,{allowUnverified:true,verifyOnly:true})};
}
for(const readMode of ['timeout','abort','http','invalid','partial','missing-settings'])test(`写入后无法完整回读保留待核验状态：${readMode}`,async()=>{
  const f=uncertainFixture({readMode}),result=await f.save({allowUnverified:true});
  assert.equal(result.verified,false);assert.match(result.message,/保留|核验/);assert.doesNotMatch(result.message,/已保存成功/);
  assert.deepEqual(f.pending.get(f.live.extension_settings[key]),result);assert.equal(f.writes,1);assert.ok(f.reads<=8);assert.deepEqual(f.disk,f.live);
});
test('待核验状态能通过纯回读清除，不重复写入',async()=>{
  const f=uncertainFixture();await f.save({allowUnverified:true});f.mode='ok';assert.equal((await f.verify()).verified,true);assert.equal(f.writes,1);assert.equal(f.pending.has(f.live.extension_settings[key]),false);
});
test('重新核验仍不匹配时保留当前改动与待核验状态',async()=>{
  const f=uncertainFixture();await f.save({allowUnverified:true});const before=JSON.stringify(f.live);f.mode='mismatch';
  const result=await f.verify();assert.equal(result.verified,false);assert.match(result.message,/不一致|未确认/);assert.equal(JSON.stringify(f.live),before);assert.equal(f.writes,1);
});
test('删除涉及的API绑定也必须核验，不可仅快照库匹配就报成功',async()=>{
  const f=uncertainFixture({readMode:'link-mismatch'});await assert.rejects(f.save({allowUnverified:true}),/绑定|未确认/);assert.equal(f.writes,1);
});
test('明确写入失败不伪装为已提交或待核验',async()=>{
  const f=uncertainFixture({writeFail:true});await assert.rejects(f.save({allowUnverified:true}),/write rejected/);assert.equal(f.reads,0);assert.equal(f.pending.has(f.live.extension_settings[key]),false);
});
test('有效回读持续不匹配仍拒绝初次操作',async()=>{
  const f=uncertainFixture({readMode:'mismatch'});await assert.rejects(f.save({allowUnverified:true}),/未确认/);assert.equal(f.pending.has(f.live.extension_settings[key]),false);
});
test('应用快照严格核验不受宽松存储选项影响',async()=>{
  const f=uncertainFixture({verifySwitches:true});await assert.rejects(f.save({allowUnverified:true}),/read aborted/);assert.equal(f.pending.has(f.live.extension_settings[key]),false);
});
test('短暂读取异常恢复后只读重试可直接确认成功',async()=>{
  const f=uncertainFixture({readMode:'flaky'});const result=await f.save({allowUnverified:true});assert.equal(result.verified,true);assert.equal(f.writes,1);assert.equal(f.reads,2);
});

function timedFixture({responseDelay=0,persistAfter=0}={}){
  const live=fixture(),pending=new WeakMap(),reads=[];let now=0,writes=0;
  const env={extensions:{extension_settings:live.extension_settings},openai:{oai_settings:live.oai_settings},script:{saveSettings:async()=>{writes++}}};
  const read=async(_env,_url,_body,{timeoutMs})=>{
    reads.push({at:now,timeoutMs});
    if(responseDelay>=timeoutMs){now+=timeoutMs;throw Error('快照保存核验读取超时');}
    now+=responseDelay;
    return {settings:now>=persistAfter?structuredClone(live):{extension_settings:{}}};
  };
  const run=factory(e=>e.extensions.extension_settings[key],()=>[],()=>({}),read,key,(fn,ms)=>{now+=ms;queueMicrotask(fn);return 0},{now:()=>now},pending,'preset_compare_api_snapshot_links');
  return {reads,get elapsed(){return now},get writes(){return writes},save:options=>run(env,false,null,{allowUnverified:true,...options})};
}
for(const verifyOnly of [false,true])test(`${verifyOnly?'重新核验':'保存'}允许超过8秒的慢回读在20秒内完成`,async()=>{
  const f=timedFixture({responseDelay:12000});assert.equal((await f.save({verifyOnly})).verified,true);
  assert.deepEqual(f.reads,[{at:0,timeoutMs:20000}]);assert.equal(f.elapsed,12000);assert.equal(f.writes,verifyOnly?0:1);
});
test('酒馆超过8秒才落盘时继续只读重试并及时确认',async()=>{
  const f=timedFixture({persistAfter:11500});assert.equal((await f.save()).verified,true);
  assert.ok(f.elapsed>=11500&&f.elapsed<20000);assert.equal(f.writes,1);assert.ok(f.reads.length<=8);
  for(const read of f.reads)assert.equal(read.at+read.timeoutMs,20000);
});
test('慢回读耗尽20秒总预算后保留待核验，不叠加超时或重复写入',async()=>{
  const f=timedFixture({responseDelay:30000});assert.equal((await f.save()).verified,false);
  assert.equal(f.elapsed,20000);assert.equal(f.reads.length,1);assert.equal(f.writes,1);
});
