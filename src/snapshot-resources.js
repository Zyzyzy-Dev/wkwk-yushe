// 快照资源纯逻辑：保存世界书配置与正则开关，按稳定标识恢复并保留当前正文和新增记录。
const copy = value => JSON.parse(JSON.stringify(value));
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const contentFields = new Set(['uid', 'content', 'comment']);
function object(value) {return value && typeof value === 'object' && !Array.isArray(value);}
function safeJson(value) {
  if (value === null || ['string','boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw new Error('配置必须是有效 JSON');
  for (const [key, child] of Object.entries(value)) {
    if (reserved.has(key)) throw new Error('配置含不支持的字段');
    safeJson(child);
  }
}
function unique(items, key) {
  if (!Array.isArray(items)) throw new Error('快照资源列表无效');
  const seen = new Set();
  for (const item of items) {
    const id = item?.[key];
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('快照资源标识缺失或重复');
    seen.add(id);
  }
}
function worldRecords(data) {
  if (!object(data?.entries)) throw new Error('世界书条目格式无效');
  const records = Object.entries(data.entries).map(([key, entry]) => {
    if (!object(entry)) throw new Error('世界书条目格式无效');
    return {uid:String(entry.uid ?? key),key,entry};
  });
  unique(records,'uid'); return records;
}
export function captureWorldEntries(name, data) {
  return {name, entries:worldRecords(data).map(({uid,entry}) => ({
    uid, name:String(entry.comment || uid),
    settings:copy(Object.fromEntries(Object.entries(entry).filter(([key])=>!contentFields.has(key)))),
  }))};
}
export function restoreWorldEntries(saved, current) {
  const data=copy(current), records=new Map(worldRecords(data).map(record=>[record.uid,record]));
  unique(saved.entries,'uid'); const missing=[];
  for (const item of saved.entries) {
    validateWorldSettings(item.settings);
    const record=records.get(item.uid);
    if (!record) {missing.push(item.name || item.uid);continue;}
    Object.assign(record.entry,copy(item.settings));
  }
  return {data,missing};
}
function regexId(script) {return String(script?.id || (script?.scriptName ? 'name:'+script.scriptName : ''));}
// 旧正则兼容标识：正常 ID 保持原样，冲突/缺失时按定义生成局部键，不改写宿主正则。
function regexRecords(scripts) {
  if (!Array.isArray(scripts) || scripts.some(script=>!object(script))) throw new Error('正则列表格式无效');
  const counts=new Map(), fingerprints=new Map();
  const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const digest=text=>{let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');};
  const records=scripts.map(script=>{
    const raw=regexId(script);
    // enabled/disabled are snapshot state, never part of identity.
    const definition=JSON.stringify(canonical(Object.fromEntries(Object.entries(script).filter(([key])=>key!=='disabled'))));
    const hash=digest(definition);
    if(fingerprints.has(hash)&&fingerprints.get(hash)!==definition)throw new Error('正则兼容标识冲突，请为正则设置不同 ID');
    fingerprints.set(hash,definition);counts.set(raw,(counts.get(raw)||0)+1);
    return {script,raw,hash};
  });
  const totals=new Map(),used=new Map();for(const row of records)totals.set(row.hash,(totals.get(row.hash)||0)+1);
  const rawIds=new Set(records.map(row=>row.raw));
  for(const row of records){
    const ordinal=used.get(row.hash)||0;used.set(row.hash,ordinal+1);
    // Identical definitions use their occurrence only within that definition, not the whole array.
    let fallback='snapshot-regex:'+row.hash+':'+totals.get(row.hash)+':'+ordinal;
    while(rawIds.has(fallback))fallback='snapshot-regex:'+fallback;
    row.fallback=fallback;row.id=row.raw&&counts.get(row.raw)===1?row.raw:fallback;
  }
  return records;
}

export function captureRegexSwitches(scripts) {
  const result=regexRecords(scripts).map(({id,script})=>({id,name:String(script.scriptName || script.id || '未命名正则'),enabled:script.disabled !== true}));
  unique(result,'id');return result;
}
export function restoreRegexSwitches(saved, current) {
  unique(saved,'id');const scripts=copy(current), records=new Map();
  for (const record of regexRecords(scripts)) {records.set(record.id,record.script);records.set(record.fallback,record.script);}
  const missing=[];
  for (const item of saved) {
    if (typeof item.enabled !== 'boolean') throw new Error('正则开关格式无效');
    const script=records.get(item.id);
    if (script) script.disabled=!item.enabled;else missing.push(item.name || item.id);
  }
  return {scripts,missing};
}

function regexGroupRecords(state) {
  const groups = [...(state?.groups || [])].filter(group=>group?.id!=='__ungrouped'&&group?.id!=='__pending_assignment').sort((a,b)=>(a.order??0)-(b.order??0)).map(group => ({id:String(group.id || ''),name:String(group.name || group.id)}));
  unique(groups,'id');
  return groups;
}
export function regexEditor(scripts, state, saved = captureRegexSwitches(scripts)) {
  const source = new Map();
  for(const record of regexRecords(scripts)){source.set(record.id,record.script);source.set(record.fallback,record.script);}
  const groups = regexGroupRecords(state), ids = new Set(groups.map(group => group.id));
  const entries = saved.map((item,index) => {
    const script = source.get(item.id), meta=state?.scripts?.[script?.id],groupId = String(meta?.groupId||'');
    return {id:item.id,name:String(script?.scriptName || item.name || item.id),groupId:ids.has(groupId) ? groupId : groupId==='__pending_assignment'?groupId:'__ungrouped',order:Number.isFinite(Number(meta?.order))?Number(meta.order):index,findRegex:String(script?.findRegex || ''),replaceString:String(script?.replaceString || ''),missing:!script};
  });
  if(entries.some(entry=>entry.groupId==='__pending_assignment'))groups.unshift({id:'__pending_assignment',name:'待分组'});
  if(entries.some(entry=>entry.groupId==='__ungrouped'))groups.push({id:'__ungrouped',name:state?.ungrouped?.name||'默认分组'});
  return {entries,groups:groups.map(group => ({...group,memberIds:entries.filter(entry => entry.groupId === group.id).map(entry => entry.id)}))};
}

// 正则分组开关遵循柏宝箱的批量开关语义，不另设运行门控。
export function regexGroupState(entries, memberIds) {
  const ids=new Set(memberIds),members=entries.filter(entry=>ids.has(entry.id));
  const enabled=members.filter(entry=>entry.enabled).length,count=members.length;
  return {checked:count>0&&enabled===count,mixed:enabled>0&&enabled<count,count,enabled};
}
export function toggleRegexGroup(entries, memberIds, enabled) {
  const ids=new Set(memberIds);
  return entries.map(entry=>({...entry,...(ids.has(entry.id)?{enabled:Boolean(enabled)}:{})}));
}

// v1 只迁移明确记录的全局挂载及其配置；附加书既不回填也不应用。
// 白名单输出让 editor.content/groupId 等展示字段永远无法进入持久快照。
export function normalizeSnapshotResources(resources) {
  if (!object(resources)) throw new Error('快照资源格式无效');
  if(!Array.isArray(resources.worlds?.global)||!Array.isArray(resources.worldEntries)||['global','preset','character'].some(scope=>!Array.isArray(resources.regex?.[scope])))throw new Error('快照资源配置不完整');
  if (resources.version !== undefined && resources.version !== 1 && resources.version !== 2) throw new Error('快照资源版本不受支持');
  const normalized = {
    version:2,
    worlds:{global:copy(resources.worlds?.global || [])},
    worldEntries:(resources.worldEntries || []).filter(book => resources.worlds?.global?.includes(book.name)).map(book => ({name:book.name,entries:book.entries.map(entry => ({uid:entry.uid,name:entry.name || entry.uid,settings:copy(entry.settings)}))})),
    regex:Object.fromEntries(['global','preset','character'].map(scope => [scope,(resources.regex?.[scope] || []).map(({id,name,enabled}) => ({id,name:name || id,enabled}))])),
  };
  return validateSnapshotResources(normalized);
}
function validateWorldSettings(settings) {
  if (!object(settings)) throw new Error('世界书配置格式无效');
  safeJson(settings);
  if (Object.keys(settings).some(key=>contentFields.has(key))) throw new Error('快照只保存条目配置，不能修改正文、名称或 UID');
  for (const field of ['disable','constant','vectorized','selective','useProbability','excludeRecursion','preventRecursion','delayUntilRecursion']) {
    // delayUntilRecursion also accepts a numeric recursion level in newer hosts.
    if (field === 'delayUntilRecursion' && typeof settings[field] === 'number') continue;
    if (settings[field] !== undefined && typeof settings[field] !== 'boolean') throw new Error('世界书 '+field+' 必须是布尔值');
  }
  for (const field of ['position','depth','order','probability']) if (settings[field] !== undefined && !Number.isFinite(settings[field])) throw new Error('世界书 '+field+' 必须是数字');
  for (const field of ['key','keysecondary']) if (settings[field] !== undefined && (!Array.isArray(settings[field]) || settings[field].some(key=>typeof key!=='string'))) throw new Error('世界书关键词必须是文本数组');
}
export function validateSnapshotResources(resources) {
  if (!object(resources) || !object(resources.worlds) || !object(resources.regex)) throw new Error('快照资源格式无效');
  safeJson(resources);
  if (resources.version !== undefined && resources.version !== 1 && resources.version !== 2) throw new Error('快照资源版本不受支持');
  const names=new Set();
  if (resources.version === 2 && Object.keys(resources.worlds).some(scope => scope !== 'global')) throw new Error('新快照仅支持全局世界书');
  for (const scope of resources.version === 2 ? ['global'] : ['global','character','chat']) {
    const values=resources.worlds[scope];
    if (!Array.isArray(values) || values.some(name=>typeof name!=='string'||!name) || new Set(values).size!==values.length || (scope==='chat'&&values.length>1)) throw new Error('世界书挂载列表无效（聊天最多一本）');
    values.forEach(name=>names.add(name));
  }
  unique(resources.worldEntries,'name');
  for (const book of resources.worldEntries) {
    if (!names.has(book.name)) throw new Error('世界书配置与挂载列表不一致');
    unique(book.entries,'uid');
    for (const entry of book.entries) validateWorldSettings(entry.settings);
  }
  if (resources.worldEntries.length!==names.size) throw new Error('所选世界书配置尚未读取完成');
  for (const scope of ['global','preset','character']) {
    unique(resources.regex[scope],'id');
    if (resources.regex[scope].some(item=>typeof item.enabled!=='boolean')) throw new Error('正则开关格式无效');

  }
  return resources;
}
