// 一键迁移的开关差异、手动覆盖与写入；预览只读两份来源，确认时才生成新结果。
import {clone,findPromptOrderEntry} from './core.js';
import {comparePromptPairs} from './prompt-pairs.js';
const meta=p=>p?.extensions?.baibaiToolkit?.presetPromptGroups;
const owner=(p,id)=>{const members=meta(p)?.prompts;return members&&Object.hasOwn(members,id)?members[id]?.groupId:null;};
const idOf=r=>typeof r==='string'?r:r?.identifier;
const order=p=>findPromptOrderEntry({prompts:p?.prompts,prompt_order:p?.prompt_order})?.order||[];
const read=(row,p)=>typeof row?.enabled==='boolean'?row.enabled:p?.enabled!==false;
const validFlag=o=>o?.enabled===undefined||typeof o.enabled==='boolean';
const reliableRead=(row,p)=>validFlag(row)&&(typeof row?.enabled==='boolean'||validFlag(p));
const title=p=>String(p?.name||'').trim();

export function analyzeSwitchSync(source,target,ignoreWhitespace=false){
  const pairs=comparePromptPairs(source,target,{ignoreWhitespace});
  const sides=[source,target], ids=sides.map(p=>new Map(p.prompts.map(e=>[e.identifier,e])));
  const rows=sides.map(p=>new Map(order(p).map(r=>[idOf(r),r])));
  const changes=new Map(),trusted=new Map(),reverse=new Map();let skipped=0,skippedGroups=0;
  for(const p of pairs.old.values()){
    const a=ids[0].get(p.oldId),b=ids[1].get(p.newId);
    // Similarity by itself is useful for reading, not sufficient for automatic writing.
    const sameName=b&&title(a)&&title(a)===title(b);
    const equalBody=b&&typeof a.content==='string'&&a.content.trim()&&a.content===b.content;
    if(!b||p.kind==='similar'||(!sameName&&!(equalBody&&(a.content.trim().length>=32||a.identifier===b.identifier)))){
      if(rows[0].has(p.oldId))skipped++;continue;
    }
    trusted.set(a.identifier,b.identifier);reverse.set(b.identifier,a.identifier);
    if(!rows[0].has(a.identifier)||!rows[1].has(b.identifier)){if(rows[0].has(a.identifier))skipped++;continue;}
    const left=rows[0].get(a.identifier),right=rows[1].get(b.identifier);
    if(!reliableRead(left,a)||!reliableRead(right,b)){skipped++;continue;}
    const oldValue=read(left,a),newValue=read(right,b);
    if(oldValue!==newValue)changes.set('p:'+b.identifier,oldValue);
  }
  const oldGroups=meta(source)?.groups||[],newGroups=meta(target)?.groups||[];
  const safeMembers=new Map();
  for(const g of newGroups){
    const members=target.prompts.filter(p=>owner(target,p.identifier)===g.id);
    const owners=new Set(members.map(p=>owner(source,reverse.get(p.identifier))));
    const old=owners.size===1&&oldGroups.find(s=>s.id===[...owners][0]);
    // No inheritance across splits, merges, or a target group containing new unmatched members.
    if(!old||!validFlag(old)||!validFlag(g)||!members.length||!members.every(p=>reverse.has(p.identifier))||
      !(old.id===g.id||title(old)===title(g)||members.length>=2)||
      source.prompts.some(p=>owner(source,p.identifier)===old.id&&trusted.has(p.identifier)&&owner(target,trusted.get(p.identifier))!==g.id)){
      skippedGroups++;continue;
    }
    if((g.enabled!==false)!==(old.enabled!==false)){
      changes.set('g:'+g.id,old.enabled!==false);safeMembers.set(g.id,new Set(members.map(p=>p.identifier)));
    }
  }
  return {changes,safeMembers,skipped,skippedGroups};
}

export function previewSwitches(preset,sync,manual){
  const rows=new Map(order(preset).map(r=>[idOf(r),r])),base=new Map(),defaults=new Map(),values=new Map(),tags=new Map(),writes=new Map();
  let skippedGroups=sync?.skippedGroups||0;
  for(const p of preset.prompts)base.set('p:'+p.identifier,read(rows.get(p.identifier),p));
  for(const g of meta(preset)?.groups||[])base.set('g:'+g.id,g.enabled!==false);
  for(const [key,was] of base){
    let value=was;
    if(sync?.changes.has(key)){
      const allowed=key.startsWith('g:')?sync.safeMembers.get(key.slice(2)):null;
      if(allowed&&preset.prompts.some(p=>owner(preset,p.identifier)===key.slice(2)&&!allowed.has(p.identifier)))skippedGroups++;
      else {value=sync.changes.get(key);if(value!==was)tags.set(key,'开关已同步');}
    }
    defaults.set(key,value);
    if(manual.has(key)&&manual.get(key)!==value){value=manual.get(key);tags.set(key,'手动调整');}
    values.set(key,value);if(value!==was)writes.set(key,value);
  }
  return {defaults,values,tags,writes,skippedGroups};
}

export function finalizeMigrationSwitches(plan,view){
  if(!view.writes.size)return {...plan,switchCount:0};
  const result=clone(plan.result),seq=order(result),indices=new Map(seq.map((r,i)=>[idOf(r),i]));
  for(const p of result.prompts){
    const key='p:'+p.identifier;if(!view.writes.has(key))continue;
    const enabled=view.writes.get(key),i=indices.get(p.identifier);
    // For an explicitly edited un-injected row, store the preference without injecting it.
    if(i===undefined)p.enabled=enabled;
    else seq[i]={...(typeof seq[i]==='object'?seq[i]:{}),identifier:p.identifier,enabled};
  }
  for(const g of meta(result)?.groups||[])if(view.writes.has('g:'+g.id))g.enabled=view.writes.get('g:'+g.id);
  return {...plan,result,switchCount:view.writes.size};
}
