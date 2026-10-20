// 缝合草稿白名单与浏览器本地存储；不持久化连接密钥、主预设设置或保存事务。
import {clone,createIdentifier} from '../core.js';
import {contentDigest} from '../../../shared/digest.js';

const fail=()=>{throw Error('缝合草稿格式无效，当前输入未改变');};
function ready(session){
 if(session.saveId)throw Error('保存结果待核验，请先完成只读复查，再操作草稿');
 if(['generating','saving','saved','merged'].includes(session.status))throw Error('请等待当前任务完成或取消生成后，再操作草稿');
}
async function fingerprint(baseline){
 return contentDigest(JSON.stringify(baseline));
}
function sourcesOf(sources){
 if(!Array.isArray(sources))fail();
 const ids=new Set();return sources.map(s=>{
  if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.name!=='string'||typeof s.content!=='string')fail();ids.add(s.id);
  const result={id:s.id,name:s.name,content:s.content};
  for(const key of ['kind','origin','sourceName','sourceId'])if(typeof s[key]==='string')result[key]=s[key];
  return result;
 });
}
function validPlan(plan,sources){
 return plan&&[1,2].includes(plan.schemaVersion)&&Array.isArray(plan.items)&&plan.items.length===sources.length&&new Set(plan.items.map(i=>i?.sourceId)).size===sources.length&&plan.items.every(i=>i&&typeof i==='object'&&!Array.isArray(i)&&sources.some(s=>s.id===i.sourceId));
}
function selectedSources(pickerState){
 return Object.fromEntries(['preset','world'].map(kind=>[kind,[...(pickerState?.[kind]?.selected?.values()||[])].map(item=>{
  if(typeof item?.sourceId!=='string'||typeof item.sourceName!=='string'||typeof item.name!=='string'||typeof item.content!=='string')fail();
  return {kind,sourceId:item.sourceId,sourceName:item.sourceName,name:item.name,content:item.content,origin:item.origin||item.sourceName+' / '+item.sourceId};
 })]));
}
function restoreSelections(value={}){
 const result={};for(const kind of ['preset','world']){
  const entries=value[kind]??[];if(!Array.isArray(entries))fail();
  const selected=new Map();for(const item of entries){if(!item||item.kind!==kind||typeof item.sourceId!=='string'||typeof item.sourceName!=='string'||typeof item.name!=='string'||typeof item.content!=='string'||typeof item.origin!=='string')fail();selected.set(JSON.stringify([item.sourceName,item.sourceId]),clone(item));}
  result[kind]={name:entries[0]?.sourceName||'',query:'',entryQuery:'',selected,cache:new Map()};
 }return result;
}
export async function captureStitchDraft(session,name){
 ready(session);name=String(name??'').trim();if(!name||name.length>160)throw Error('草稿名称须为1–160个字符');
 const value={schemaVersion:1,id:session.draftName===name&&session.draftId||createIdentifier(),name,updatedAt:new Date().toISOString(),originalName:session.originalName,source:session.source??null,
  sources:sourcesOf(session.sources),selections:selectedSources(session.pickerState),manualDrafts:[...(session.manualDrafts??[''])],guidance:session.guidance||'',guidanceDraft:session.guidanceDraft??session.guidance??'',
  plan:session.plan?clone(session.plan):null,excluded:[...session.excluded],outputName:session.name,timeoutMinutes:session.timeoutMinutes??15,outputTokens:session.outputTokens??16384};
 value.baselineDigest=await fingerprint(session.baseline);return value;
}
export async function restoreStitchDraft(record,session,{isCurrent=()=>true}={}){
 ready(session);
 if(!record||record.schemaVersion!==1||typeof record.name!=='string'||typeof record.id!=='string'||!Array.isArray(record.manualDrafts)||record.manualDrafts.some(v=>typeof v!=='string')||typeof record.guidance!=='string'||typeof record.guidanceDraft!=='string'||!Array.isArray(record.excluded))fail();
 const sources=sourcesOf(record.sources),pickerState=restoreSelections(record.selections),revision=session.revision,baseline=session.baseline;
 const digest=await fingerprint(baseline);
 ready(session);if(!isCurrent()||session.baseline!==baseline||session.revision!==revision)throw Error('当前输入或页面已改变，请重新选择恢复草稿');
 const sameBaseline=!!digest&&digest===record.baselineDigest&&record.originalName===session.originalName&&(record.source??null)===(session.source??null);
 const planRestored=!!(sameBaseline&&validPlan(record.plan,sources)),plan=planRestored?clone(record.plan):null;
 session.touch();session.sources=sources;session.manualDrafts=[...record.manualDrafts];session.guidance=record.guidance;session.guidanceDraft=record.guidanceDraft;
 session.manualCount=sources.filter(s=>s.kind==='manual').length;session.pickerState=pickerState;session.saveMessage='';session.saveId=null;
 session.name=typeof record.outputName==='string'?record.outputName:session.name;
 if(Number.isInteger(record.timeoutMinutes)&&record.timeoutMinutes>=1&&record.timeoutMinutes<=60)session.timeoutMinutes=record.timeoutMinutes;
 if(Number.isInteger(record.outputTokens)&&record.outputTokens>=1024&&record.outputTokens<=131072)session.outputTokens=record.outputTokens;
 if(plan){plan.sessionId=session.id;plan.revision=session.revision;session.plan=plan;session.status='preview';session.excluded=new Set(record.excluded.filter(id=>sources.some(s=>s.id===id)));}
 session.draftId=sameBaseline?record.id:null;session.draftName=record.name;
 return {planRestored,sameBaseline};
}

// 正文与目录分开存储；目录加载不把全部长草稿读入内存。两个 store 在同一事务中提交。
export function createStitchDraftStore(factory=globalThis.indexedDB){
 async function open(){return new Promise((resolve,reject)=>{
  if(!factory){reject(Error('当前浏览器不支持本地草稿存储'));return;}
  const request=factory.open('preset-compare-ai-drafts',1);let failed=false;
  request.onupgradeneeded=()=>{for(const name of ['drafts','catalog'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
  request.onerror=()=>reject(request.error||Error('无法打开本地草稿库'));
  request.onblocked=()=>{failed=true;reject(Error('草稿库被其他页面占用，请关闭其他盒子页面后重试'));};
  request.onsuccess=()=>{if(failed){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });}
 async function transaction(mode,action){const db=await open();return new Promise((resolve,reject)=>{
  let result,tx;try{tx=db.transaction(['drafts','catalog'],mode);action(tx,value=>{result=value;});}catch(error){try{tx?.abort();}catch{}db.close();reject(error);return;}
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error||Error('本地草稿保存事务中止'));};tx.onerror=()=>{};
 });}
 return {
  put:record=>transaction('readwrite',tx=>{tx.objectStore('drafts').put(record);tx.objectStore('catalog').put({id:record.id,name:record.name,originalName:record.originalName,updatedAt:record.updatedAt,count:record.sources.length});}),
  get:id=>transaction('readonly',(tx,set)=>{tx.objectStore('drafts').get(id).onsuccess=e=>set(e.target.result);}),
  list:()=>transaction('readonly',(tx,set)=>{tx.objectStore('catalog').getAll().onsuccess=e=>set(e.target.result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}),
  delete:id=>transaction('readwrite',tx=>{tx.objectStore('drafts').delete(id);tx.objectStore('catalog').delete(id);}),
 };
}
