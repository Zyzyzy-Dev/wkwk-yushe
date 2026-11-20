// 分享快照依赖核对。比较接收方保存的标识及名称，预览与实际应用共用冲突判定。
import {regexRecords} from '../features/snapshot/snapshot-resources.js';
import {snapshotOrder} from '../features/snapshot/snapshot.js';

const check = (status, label, detail) => ({status, label, detail});

function indexRows(rows) {
  const byId = new Map(), names = new Set();
  for (const row of rows) {
    if (!row.id) throw new Error('本地列表存在缺少标识的记录');
    if (byId.has(row.id)) throw new Error('本地列表含重复标识「'+row.id+'」');
    byId.set(row.id, row);
    if (row.name) names.add(row.name);
  }
  return {byId, names};
}

function localRows(read) {
  try {return {index:read()};}
  catch (error) {return {error:error.message};}
}

function compareRows(label, saved, key, local, {unverifiedDefinition = false} = {}) {
  if (local.error) return [check('conflict',label,local.error)];
  const {byId,names} = local.index;
  const results = new Map(), used = new Set();
  for (const item of saved) {
    const row = byId.get(item[key]), name = item.name || item[key];
    let status = 'matched', reason = '';
    if (!row) {
      status = names.has(name) ? 'conflict' : 'missing';
      if (status==='conflict') reason = '同名但标识不同';
    } else if (used.has(row) || row.ambiguous) {
      status = 'conflict'; reason = '标识存在歧义';
    } else if (row.name && item.name && row.name!==item.name) {
      status = 'conflict'; reason = '本地名称为「'+row.name+'」';
    } else if (item.definitionFingerprint && item.definitionFingerprint!==row.fingerprint) {
      status = 'conflict'; reason = '定义已变化';
    } else if (unverifiedDefinition || !row.name || !item.name) {
      status = 'unknown';
      reason = unverifiedDefinition ? '标识和名称相符，分享记录未保存定义指纹' : '仅有标识可核对';
    }
    if (row) used.add(row);
    if (!results.has(status)) results.set(status,{count:0,examples:[]});
    const group = results.get(status);
    group.count++;
    if (status!=='matched' || group.examples.length<4) group.examples.push(name+(reason?'（'+reason+'）':''));
  }
  const checks = [];
  for (const [status,{count,examples}] of results) {
    if (status==='matched') {
      checks.push(check(status,label,count+' 项 · '+examples.join('、')+(count>examples.length?' 等':'')));
      continue;
    }
    // 需要处理的资源都列出，分行后沿用界面的分页，避免大快照只看得到前几个名称。
    for (let start=0; start<examples.length; start+=8) {
      const page=examples.slice(start,start+8);
      checks.push(check(status,label,page.length+' 项 · '+page.join('、')));
    }
  }
  return checks;
}

export function shareRegexIndex(scripts, strictDefinitions = false) {
  return localRows(()=>{
    const records = regexRecords(scripts), counts = new Map();
    for (const {hash} of records) counts.set(hash,(counts.get(hash)||0)+1);
    const rows = records.map(({id,script,hash})=>{
      const ambiguous = counts.get(hash)>1;
      if (strictDefinitions && ambiguous) throw new Error('本地正则含相同定义的重复条目');
      return {id,name:String(script.scriptName||script.id||'未命名正则'),fingerprint:'v1:'+hash,ambiguous};
    });
    const index = indexRows(rows);
    records.forEach(({fallback},i)=>index.byId.set(fallback,rows[i]));
    return index;
  });
}

export function shareRegexChecks(saved, index, preset = false) {
  const label = preset ? '预设正则' : '全局正则';
  if (preset && new Set(saved.map(item=>item.definitionFingerprint)).size!==saved.length) {
    return [check('conflict',label,'分享记录含相同定义的重复条目')];
  }
  return compareRows(label,saved,'id',index,{unverifiedDefinition:!preset});
}

export function sharePresetIndexes(settings, groups, orderId) {
  const entries = localRows(()=>{
    const prompts = indexRows((settings.prompts||[]).map(p=>({id:p.identifier,name:p.name})));
    return indexRows(snapshotOrder(settings,orderId).map(item=>{
      const id = item?.identifier;
      return {id,name:prompts.byId.get(id)?.name};
    }));
  });
  const groupIndex = localRows(()=>indexRows((groups?.groups||[]).map(group=>({id:String(group.id??''),name:group.name}))));
  return {entries, groups:groupIndex};
}

export function sharePresetChecks(snapshot, indexes) {
  return [...compareRows('预设条目',snapshot.entries,'identifier',indexes.entries),
    ...compareRows('预设分组',snapshot.groups,'id',indexes.groups)];
}

export function shareBookIndex(data) {
  if (!data?.entries || typeof data.entries!=='object' || Array.isArray(data.entries)) return null;
  return localRows(()=>indexRows(Object.entries(data.entries).map(([key,entry])=>{
    if (!entry || typeof entry!=='object') throw new Error('本地世界书条目格式无效');
    return {id:String(entry.uid??key),name:entry.comment || null};
  })));
}

export function shareBookChecks(book, index) {
  const label = '世界书「'+book.name+'」条目';
  if (!index) return [check('unknown',label,'无法读取本地条目')];
  return compareRows(label,book.entries,'uid',index);
}

export function assertNoShareConflicts(checks, message='分享快照有资源冲突，请核对本地资源或重新保存快照。') {
  const conflicts = checks.filter(item=>item.status==='conflict');
  if (conflicts.length) throw new Error(message+conflicts[0].label+' · '+conflicts[0].detail+(conflicts.length>1?' 等':''));
}

function presetData(env, name, activeName, activeGroups, orderId) {
  const label='预设「'+name+'」';
  if (env.script.main_api!=='openai') return {check:check('unknown',label,'请在聊天补全模式下核对')};
  try {
    const {preset_names:names,presets} = env.manager.getPresetList();
    if (!names || typeof names!=='object' || !Array.isArray(presets)) throw new Error('本地预设列表尚未就绪');
    let index;
    if (Array.isArray(names)) {
      if (names.filter(value=>value===name).length>1) return {check:check('conflict',label,'本地有多个同名预设')};
      index=names.indexOf(name);
    } else index=Object.hasOwn(names,name) ? names[name] : -1;
    if (index===-1) return {check:check('missing',label,'本地未找到同名预设')};
    if (!presets[index]) throw new Error('本地预设内容尚未就绪');
    const active=name===activeName, settings=active ? env.openai.oai_settings : presets[index];
    if (active && settings?.preset_settings_openai!==name) throw new Error('当前预设仍在加载');
    const groups=active ? activeGroups() : settings.extensions?.baibaiToolkit?.presetPromptGroups;
    return {check:check('matched',label,'本地存在同名预设'),indexes:sharePresetIndexes(settings,groups,orderId),scripts:settings.extensions?.regex_scripts??[]};
  } catch (error) {return {check:check('unknown',label,error.message)};}
}

export function assertSharedSwitches(env, snapshot, activeName, activeGroups, orderId) {
  if (snapshot.scope.preset) {
    const preset=presetData(env,snapshot.presetName,activeName,activeGroups,orderId);
    if (!preset.indexes) throw new Error(preset.check.label+' · '+preset.check.detail);
    assertNoShareConflicts(sharePresetChecks(snapshot,preset.indexes));
  }
  if (snapshot.scope.regex) {
    assertNoShareConflicts(shareRegexChecks(snapshot.resources?.regex.global||[],shareRegexIndex(env.extensions.extension_settings.regex??[])));
  }
}

// 批量共用本次读取结果。限制同时读取数和整轮等待时长，剩余项目仍可保存后核对。
async function readBooks(snapshots, catalog, readBook, checkContext) {
  const names = new Set();
  for (const snapshot of snapshots) for (const book of snapshot.resources?.worldEntries||[]) {
    if (book.entries.length && catalog?.has(book.name)) names.add(book.name);
  }
  const next = names.values(), books = new Map(), deadline = Date.now()+10000;
  async function worker() {
    for (const name of next) {
      checkContext();
      const remaining=deadline-Date.now();
      if (remaining<=0) return;
      try {books.set(name,shareBookIndex(await readBook(name,remaining)));}
      catch {books.set(name,null);}
    }
  }
  await Promise.all(Array.from({length:Math.min(3,names.size)},worker));
  return books;
}

export async function previewSnapshotShare(snapshots, env, {activeName,orderId,hasOrder,activeGroups,readBook,readReasoning,checkContext}) {
  const catalog = Array.isArray(env.world.world_names) ? new Set(env.world.world_names) : null;
  const books = await readBooks(snapshots,catalog,readBook,checkContext);
  const presets = new Map();
  const globalRegex = snapshots.some(s=>s.scope.regex) ? shareRegexIndex(env.extensions.extension_settings.regex??[]) : null;
  let reasoning;
  if (snapshots.some(s=>s.scope.reasoning)) {
    try {reasoning = await readReasoning();} catch { /* 仍可导入格式副本。 */ }
  }
  checkContext();
  return {items:snapshots.map(snapshot=>{
    const checks = [], {scope,presetName} = snapshot;
    if (scope.preset) {
      if (!presets.has(presetName)) presets.set(presetName,presetData(env,presetName,activeName,activeGroups,orderId));
      const preset = presets.get(presetName);
      checks.push(preset.check);
      if (preset.indexes) {
        if (hasOrder) checks.push(...sharePresetChecks(snapshot,preset.indexes));
        else checks.push(check('unknown','预设开关','尚未取得本地条目节点，导入后使用公共节点'));
        if (scope.presetRegex) {
          preset.regex ??= shareRegexIndex(preset.scripts,true);
          checks.push(...shareRegexChecks(snapshot.presetRegex.switches,preset.regex,true));
        }
      }
    }
    if (scope.worlds) {
      const savedBooks=new Map((snapshot.resources?.worldEntries||[]).map(book=>[book.name,book]));
      for (const name of snapshot.worldNames) {
        const available = catalog?.has(name);
        checks.push(check(!catalog?'unknown':available?'matched':'missing','世界书「'+name+'」',!catalog?'本地目录尚未就绪':available?'本地存在同名世界书':'本地未找到同名世界书'));
        if (available && savedBooks.get(name)?.entries.length) checks.push(...shareBookChecks(savedBooks.get(name),books.get(name)));
      }
    }
    if (scope.regex) checks.push(...shareRegexChecks(snapshot.resources?.regex.global||[],globalRegex));
    if (scope.reasoning) checks.push(check(reasoning?'matched':'unknown','推理设置',reasoning?'酒馆支持读取推理设置，分享文件含格式副本':'当前无法核对酒馆推理设置'));
    return {name:snapshot.name,checks};
  })};
}
