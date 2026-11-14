// 跨预设拖入的不可变批量规划：可靠同 ID／唯一完整同名覆盖，歧义或关闭覆盖时创建编号副本。
import {clone,createIdentifier} from './core.js';

const promptsOf=preset=>Array.isArray(preset?.prompts)?preset.prompts:[];
const nameOf=prompt=>String(prompt?.name??'');
const hasName=name=>!!name.trim();
function namesOf(prompts){
  const result=new Map();
  for(const prompt of prompts){const name=nameOf(prompt);if(!hasName(name))continue;const entries=result.get(name)||[];entries.push(prompt);result.set(name,entries);}
  return result;
}
function reservedIds(preset){
  const result=new Set(promptsOf(preset).map(prompt=>prompt.identifier));
  for(const entry of preset?.prompt_order||[])for(const item of Array.isArray(entry?.order)?entry.order:[])result.add(typeof item==='string'?item:item?.identifier);
  for(const id of Object.keys(preset?.extensions?.baibaiToolkit?.presetPromptGroups?.prompts||{}))result.add(id);
  return result;
}
function freshId(reserved,createId){
  let identifier;
  do{identifier=createId();}while(!identifier||reserved.has(identifier));
  reserved.add(identifier);return identifier;
}
function numberedCopy(prompt,reserved,names,createId){
  const identifier=freshId(reserved,createId),rawName=nameOf(prompt),base=hasName(rawName)?rawName:'(未命名)';
  let number=1,name;do{name=base+'（'+number+++'）';}while(names.has(name));
  names.add(name);return {...clone(prompt),identifier,name};
}

// 保留整组复制调用接口；其覆盖开启时仍沿用既有的独立整组复制语义。
export function createSameIdDropCopy(prompt,target,overwriteSameId=true,createId=createIdentifier) {
  const prompts=promptsOf(target),name=nameOf(prompt);
  if(overwriteSameId!==false||!prompts.some(item=>item.identifier===prompt.identifier||(hasName(name)&&nameOf(item)===name)))return null;
  const reserved=reservedIds(target);reserved.add(prompt.identifier);
  return numberedCopy(prompt,reserved,new Set(prompts.map(nameOf)),createId);
}

// counterpartId 只确认已有同 ID 是否可靠；同名扩展不改变普通对比配对算法。
export function planPromptDrops(source,target,ids,{overwriteSameIdOnDrop=true,counterpartId=()=>null,createId=createIdentifier}={}){
  const sourcePrompts=promptsOf(source),targetPrompts=promptsOf(target),sourceMap=new Map(sourcePrompts.map(prompt=>[prompt.identifier,prompt]));
  const selected=[...new Set(ids||[])].map(id=>sourceMap.get(id)).filter(Boolean),targetMap=new Map(targetPrompts.map(prompt=>[prompt.identifier,prompt]));
  const sourceNames=namesOf(sourcePrompts),targetNames=namesOf(targetPrompts),targetReserved=reservedIds(target);
  const reserved=new Set([...reservedIds(source),...targetReserved]),claimed=new Set();
  // 先预留整批原名，避免前一条副本占用后一条正常插入的名称。
  const names=new Set([...targetPrompts,...selected].map(nameOf)),result=new Map();
  for(const prompt of selected){
    const name=nameOf(prompt),idMatch=targetMap.get(prompt.identifier),named=hasName(name)?targetNames.get(name)||[]:[];
    let reason=null,match=null,copy=false;
    if(overwriteSameIdOnDrop===false){copy=!!idMatch||named.length>0;}
    else if((idMatch||named.length)&&((sourceNames.get(name)?.length||0)>1||named.length>1)){copy=true;reason='duplicate-name';}
    else if(idMatch&&named.length===1&&named[0].identifier!==idMatch.identifier){copy=true;reason='id-name-conflict';}
    else{
      match=idMatch||named[0]||null;
      if(match&&!!match.marker!==!!prompt.marker){copy=true;reason='type-mismatch';}
      else if(idMatch&&counterpartId(prompt.identifier)!==idMatch.identifier){copy=true;reason='unsafe-id';}
      else if(match&&claimed.has(match.identifier)){copy=true;reason='target-claimed';}
    }
    if(!copy&&!match&&targetReserved.has(prompt.identifier)){copy=true;reason='reserved-id';}
    let planned;
    if(copy)planned={prompt:numberedCopy(prompt,reserved,names,createId),action:'copy',reason};
    else{
      const identifier=match?.identifier??prompt.identifier;
      claimed.add(identifier);reserved.add(identifier);
      planned={prompt:{...clone(prompt),identifier},action:match?'overwrite':'insert',reason:null};
    }
    result.set(prompt.identifier,planned);
  }
  return result;
}
