// 条目表单草稿转换：只应用用户改变的可编辑字段，保留未知字段、多触发器和原始预设。
const copy=value=>JSON.parse(JSON.stringify(value));
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const triggers=new Set(['normal','continue','impersonate','swipe','regenerate','quiet']);
const shownTrigger=prompt=>{
  const first=Array.isArray(prompt?.injection_trigger)?String(prompt.injection_trigger[0]||''):'';
  return triggers.has(first)?first:'';
};

export function applyPromptDraft(prompt,draft){
  const next=copy(prompt);
  if(!draft||typeof draft!=='object')return next;
  for(const [key,fallback] of [['name',''],['role','system'],['content','']]){
    if(!owns(draft,key))continue;
    const value=String(draft[key]??fallback),previous=String(prompt[key]??fallback);
    if(value!==previous)next[key]=value;
  }
  if(owns(draft,'trigger')){
    const value=String(draft.trigger||'');
    if(value!==shownTrigger(prompt))next.injection_trigger=value?[value]:[];
  }
  const previousPosition=Number(prompt.injection_position??0);
  const position=owns(draft,'injection_position')?Number(draft.injection_position||0):previousPosition;
  if(position!==previousPosition)next.injection_position=position;
  if(position===1){
    for(const [key,fallback] of [['injection_depth',4],['injection_order',100]]){
      if(!owns(draft,key))continue;
      const value=Number(draft[key]===''?fallback:draft[key]);
      if(value!==Number(prompt[key]??fallback)||previousPosition!==1)next[key]=value;
    }
  }
  return next;
}

export function isPendingPromptDraft(prompt,draft){
  return !!draft&&JSON.stringify(applyPromptDraft(prompt,draft))!==JSON.stringify(prompt);
}

export function buildPresetDraftSnapshot(preset,inlineDrafts){
  const snapshot=copy(preset);
  snapshot.prompts=(preset.prompts||[]).map(prompt=>applyPromptDraft(prompt,inlineDrafts.get(prompt)));
  return snapshot;
}
