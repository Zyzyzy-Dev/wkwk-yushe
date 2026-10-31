// 两份预设的纯迁移分析、位置规划和原子应用；不读取DOM或外部数据。
import { clone, findPromptOrderEntry } from './core.js';

const idOf = item => typeof item === 'string' ? item : item?.identifier;
const metaOf = preset => preset?.extensions?.baibaiToolkit?.presetPromptGroups;
const own = (value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined;
const setOwn = (value, key, data) => Object.defineProperty(value, key, {value:data, enumerable:true, writable:true, configurable:true});
const normalize = (value, loose) => loose ? value.replace(/\s+/g, '') : value;
const nameOf = prompt => String(prompt?.name || '未命名条目');
// Full snapshots intentionally include unknown fields; sampling settings or metadata edits invalidate a preview too.
const signature = value => JSON.stringify(value);

function read(preset, label, errors) {
    const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
    if (!Array.isArray(preset?.prompts)) errors.push(`${label}缺少条目列表`);
    const map = new Map();
    for (const prompt of prompts) {
        if (!prompt || typeof prompt.identifier !== 'string' || !prompt.identifier) { errors.push(`${label}存在无效条目标识`); continue; }
        if (map.has(prompt.identifier)) errors.push(`${label}的“${nameOf(prompt)}”条目标识重复`);
        map.set(prompt.identifier, prompt);
    }
    // core's selector initializes missing prompt_order; give it a shallow wrapper, never the caller's object.
    if (preset?.prompt_order != null && !Array.isArray(preset.prompt_order)) errors.push(`${label}生效顺序格式无效`);
    const node = findPromptOrderEntry({prompts:[...map.values()], prompt_order:Array.isArray(preset?.prompt_order)?preset.prompt_order:[]});
    const order = node?.order || [], seen = new Set(), rows = new Map();
    for (const row of order) {
        const id = idOf(row);
        if (!map.has(id)) errors.push(`${label}生效顺序存在失效引用`);
        if (seen.has(id)) errors.push(`${label}的“${nameOf(map.get(id))}”在生效顺序中重复`);
        seen.add(id); rows.set(id,row);
    }
    const meta = metaOf(preset), groups = new Map();
    if (meta && (!Array.isArray(meta.groups) || !meta.prompts || typeof meta.prompts !== 'object' || Array.isArray(meta.prompts))) errors.push(`${label}分组元数据无效`);
    for (const group of Array.isArray(meta?.groups) ? meta.groups : []) {
        if (!group?.id || typeof group.id !== 'string' || group.id === '__ungrouped' || groups.has(group.id)) errors.push(`${label}分组标识无效或重复`);
        else groups.set(group.id,group);
    }
    const groupFor = id => groups.get(own(meta?.prompts,id)?.groupId) || null;
    const ordered = [...seen].filter(id=>map.has(id)).concat([...map.keys()].filter(id=>!seen.has(id)));
    return {preset,map,node,order,rows,ordered,groups,meta,groupFor};
}

function profile(prompt, loose) {
    if (typeof prompt.content !== 'string') return null;
    const body = normalize(prompt.content,loose), grams = new Map();
    if (body.trim().length < 32) return null;
    let count=0;
    for(let i=0;i<body.length-2;i++){const gram=body.slice(i,i+3);if(!gram.trim())continue;grams.set(gram,(grams.get(gram)||0)+1);count++;}
    return grams.size < 16 ? null : {id:prompt.identifier,name:normalize(String(prompt.name||''),loose).trim(),grams,count};
}

function evidence(source,target,loose) {
    const errors=[], s=read(source,'来源',errors),t=read(target,'目标',errors),anchors=new Map(),buckets=new Map();
    for(const id of s.map.keys())if(t.map.has(id)) anchors.set(id,id);
    for(const [side,data,used] of [['s',s,new Set(anchors.keys())],['t',t,new Set(anchors.values())]]) {
        for(const [id,prompt] of data.map) {
            if(used.has(id)||prompt.marker||typeof prompt.content!=='string'||!prompt.content.trim())continue;
            const body=normalize(prompt.content,loose);let b=buckets.get(body);if(!b){b={s:[],t:[]};buckets.set(body,b);}b[side].push(id);
        }
    }
    const exact=new Map();
    for(const b of buckets.values())if(b.s.length&&b.t.length){
        for(const id of b.s)exact.set(id,b.t);
        if(b.s.length===1&&b.t.length===1)anchors.set(b.s[0],b.t[0]);
    }
    const usedTargets=new Set(anchors.values()),old=[...s.map.values()].filter(p=>!anchors.has(p.identifier)&&!p.marker).map(p=>profile(p,loose)).filter(Boolean);
    const newer=[...t.map.values()].filter(p=>!usedTargets.has(p.identifier)&&!p.marker).map(p=>profile(p,loose)).filter(Boolean);
    const fuzzy=new Map(), reverse=new Map(),index=new Map();
    for(const n of newer)for(const [gram,count]of n.grams){let list=index.get(gram);if(!list){list=[];index.set(gram,list);}list.push([n,count]);}
    for(const o of old){
        const shared=new Map();
        for(const [gram,count]of o.grams)for(const [n,c]of index.get(gram)||[]){if(2*Math.min(o.count,n.count)/(o.count+n.count)>=.76)shared.set(n,(shared.get(n)||0)+Math.min(count,c));}
        for(const [n,count]of shared){const score=2*count/(o.count+n.count);if(score<.76)continue;const match={id:n.id,score,eligible:score>=((o.name&&o.name===n.name)?.82:.92)};let list=fuzzy.get(o.id);if(!list){list=[];fuzzy.set(o.id,list);}list.push(match);let back=reverse.get(n.id);if(!back){back=[];reverse.set(n.id,back);}back.push({id:o.id,score});}
    }
    for(const list of [...fuzzy.values(),...reverse.values()])list.sort((a,b)=>b.score-a.score);
    const candidates=[];
    for(const id of s.ordered){
        const prompt=s.map.get(id);if(!s.rows.has(id)||t.map.has(id)||prompt.marker)continue;
        const same=exact.get(id)||[],near=fuzzy.get(id)||[],eligible=near.filter(x=>x.eligible);
        const sameName=[...t.map.values()].filter(p=>String(prompt.name||'').trim()&&normalize(String(p.name||''),loose).trim()===normalize(String(prompt.name||''),loose).trim());
        let kind='unique';const matches=new Map();
        for(const other of same)matches.set(other,{id:other,name:nameOf(t.map.get(other)),kind:'same-content'});
        for(const n of near)if(n.eligible||eligible.length)matches.set(n.id,{id:n.id,name:nameOf(t.map.get(n.id)),kind:'similar'});
        for(const p of sameName)if(!matches.has(p.identifier))matches.set(p.identifier,{id:p.identifier,name:nameOf(p),kind:'same-name'});
        if(same.length)kind=anchors.has(id)?'same-content':'ambiguous';
        else if(eligible.length){const best=near[0],back=reverse.get(best.id);kind=best.eligible&&back?.[0].id===id&&best.score-(near[1]?.score||0)>=.06&&best.score-(back[1]?.score||0)>=.06?'similar':'ambiguous';}
        const sourceName=normalize(String(prompt.name||''),loose).trim();
        const repeatedName=sourceName&&[...s.map.values()].some(p=>p.identifier!==id&&normalize(String(p.name||''),loose).trim()===sourceName);
        if(sameName.length||repeatedName)kind='ambiguous';
        const group=s.groupFor(id);
        candidates.push({id,name:nameOf(prompt),kind,matches:[...matches.values()],sourceGroup:group?{id:group.id,name:String(group.name||'未命名分组'),enabled:group.enabled!==false}:null,injected:s.rows.has(id),defaultSelected:false});
    }
    return {s,t,anchors,candidates,errors};
}

function resolve(data,candidate,placement={}) {
    const {s,t,anchors}=data,{id,name,injected}=candidate,prompt=s.map.get(id),errors=[],warnings=[];
    let gap=null,reason='未注入，保持列表尾部',group=null;
    const before=Object.hasOwn(placement,'beforeId'),after=Object.hasOwn(placement,'afterId');
    if(before&&after)errors.push(`“${name}”只能选择一个目标位置`);
    if(injected){
        if(before||after){
            const reference=before?placement.beforeId:placement.afterId;
            if(before&&reference===null){gap=t.order.length;reason='手动放在生效顺序末尾';}
            else {const at=t.order.findIndex(row=>idOf(row)===reference);if(at<0)errors.push(`“${name}”的目标位置已变化`);else{gap=at+(after?1:0);reason=`手动放在“${nameOf(t.map.get(reference))}”${after?'之后':'之前'}`;}}
        }else{
            const at=s.order.findIndex(row=>idOf(row)===id);let left=null,right=null;
            for(let i=at-1;i>=0;i--){const matched=anchors.get(idOf(s.order[i]));if(matched&&t.rows.has(matched)){left=matched;break;}}
            for(let i=at+1;i<s.order.length;i++){const matched=anchors.get(idOf(s.order[i]));if(matched&&t.rows.has(matched)){right=matched;break;}}
            const li=t.order.findIndex(row=>idOf(row)===left),ri=t.order.findIndex(row=>idOf(row)===right);
            if(left&&right&&li>=ri)errors.push(`“${name}”的前后参照顺序反转，无法自动定位，请取消勾选该条目`);
            else if(left||right){gap=left?li+1:ri;reason=left?`紧跟“${nameOf(t.map.get(left))}”之后`:`位于“${nameOf(t.map.get(right))}”之前`;if(!left||!right)warnings.push(`“${name}”仅有单侧位置参照`);}
            else errors.push(`“${name}”没有可靠位置参照，无法自动定位，请取消勾选该条目`);
        }
    } else if(before||after)warnings.push(`“${name}”未注入，目标位置不创建生效顺序记录`);
    const sourceGroup=s.groupFor(id),explicitGroup=Object.hasOwn(placement,'groupId');
    if(explicitGroup){if(placement.groupId&&placement.groupId!=='__ungrouped'){group=t.groups.get(placement.groupId);if(!group)errors.push(`“${name}”的目标分组已不存在`);}}
    else if(sourceGroup){
        group=t.groups.get(sourceGroup.id);
        if(!group){
            const matches=[...t.groups.values()].filter(g=>String(g.name||'').trim()===String(sourceGroup.name||'').trim());
            if(matches.length>1)errors.push(`“${name}”对应多个同名分组，无法自动归组，请取消勾选该条目`);
            group=matches.length===1?matches[0]:sourceGroup;
        }
    }
    // Existing target groups are authoritative, including absent enabled fields; members retain their own switches.
    if(injected&&gap!==null){
        if(group&&t.groups.has(group.id)){
            const positions=t.ordered.flatMap((id,index)=>t.groupFor(id)?.id===group.id?[index]:[]);
            if(positions.length&&(gap<positions[0]||gap>positions.at(-1)+1))errors.push(`“${name}”的位置与目标分组分离，无法自动迁移，请取消勾选该条目`);
        }
        const leftGroups=new Set(t.ordered.slice(0,gap).map(id=>t.groupFor(id)?.id).filter(Boolean));
        const split=t.ordered.slice(gap).map(id=>t.groupFor(id)?.id).find(g=>g&&leftGroups.has(g)&&g!==group?.id);
        if(split)errors.push(`“${name}”的位置会拆分目标已有分组，无法自动迁移，请取消勾选该条目`);
    }
    if(prompt.injection_position===1)warnings.push(`“${name}”是聊天深度条目，列表位置不等于最终发送位置`);
    const row=s.rows.get(id),enabled=typeof row==='object'&&row!==null&&Object.hasOwn(row,'enabled')?row.enabled:prompt.enabled!==false;
    return {entry:{id,name,beforeId:gap===null?null:idOf(t.order[gap])??null,afterId:gap===null?null:idOf(t.order[gap-1])??null,groupId:group?.id||'',groupName:String(group?.name||'未分组'),injected,enabled,reason},gap,group,errors,warnings};
}

function globalErrors(resolutions) {
    const errors=[];let previous=-1;
    for(const r of resolutions){if(!r.entry.injected||r.gap===null)continue;if(r.gap<previous)errors.push(`“${r.entry.name}”与其他选中区段的来源顺序冲突，请减少选择`);previous=r.gap;}
    // A newly copied group must remain a single block, without splitting another incoming/target group.
    return errors;
}

export function analyzeMigration(source,target,{ignoreWhitespace=false}={}) {
    const data=evidence(source,target,ignoreWhitespace),defaults=[];
    for(const candidate of data.candidates){
        const r=resolve(data,candidate);const prompt=data.s.map.get(candidate.id);
        candidate.defaultSelected=!data.errors.length&&candidate.kind==='unique'&&typeof prompt.content==='string'&&!!prompt.content.trim()&&!r.errors.length;
        if(!candidate.defaultSelected)candidate.defaultReason=r.errors.join('；')||(candidate.kind!=='unique'?'存在对应或重名线索，请核对后选择':'正文为空，请核对后选择');
        if(candidate.defaultSelected)defaults.push(r);
    }
    // Exclude both sides of every inversion, without choosing an arbitrary winning segment.
    const conflicts=new Set(),injected=defaults.filter(r=>r.entry.injected&&r.gap!==null);
    for(let i=0;i<injected.length;i++)for(let j=i+1;j<injected.length;j++)if(injected[i].gap>injected[j].gap){conflicts.add(injected[i].entry.id);conflicts.add(injected[j].entry.id);}
    for(const candidate of data.candidates)if(conflicts.has(candidate.id)){candidate.defaultSelected=false;candidate.defaultReason='与其他区段的来源顺序冲突，请核对后减少选择';}
    return {candidates:data.candidates,errors:data.errors};
}

export function planMigration(source,target,selectedIds,{ignoreWhitespace=false,placements={}}={}) {
    // Recompute evidence rather than trusting a stale or caller-edited analysis object.
    const data=evidence(source,target,ignoreWhitespace),chosen=new Set(selectedIds||[]),available=new Set(data.candidates.map(c=>c.id));
    const errors=[...data.errors],warnings=[],resolutions=[];
    for(const id of chosen)if(!available.has(id))errors.push('所选条目未注入、已存在、属于内置标记或已变化，请重新分析');
    for(const candidate of data.candidates)if(chosen.has(candidate.id)){
        const r=resolve(data,candidate,own(placements,candidate.id)||{});resolutions.push(r);errors.push(...r.errors);warnings.push(...r.warnings);
    }
    errors.push(...globalErrors(resolutions));
    const entries=resolutions.map(r=>r.entry),orderedIds=entries.map(e=>e.id);
    const plan={entries,errors,warnings,previewOrder:[],sourceSignature:signature(source),targetSignature:signature(target),selectedIds:orderedIds};
    const incoming=new Map(entries.map(e=>[e.id,e])),merged=[];
    for(let gap=0;gap<=data.t.order.length;gap++){
        for(const r of resolutions)if(r.entry.injected&&r.gap===gap)merged.push(r.entry.id);
        if(gap<data.t.order.length)merged.push(idOf(data.t.order[gap]));
    }
    const full=[...merged,...data.t.ordered.filter(id=>!data.t.rows.has(id)),...entries.filter(e=>!e.injected).map(e=>e.id)];
    // Reject non-contiguous newly created groups: preserving source order cannot silently fragment a group.
    for(const group of new Map(resolutions.filter(r=>r.group&&!data.t.groups.has(r.group.id)).map(r=>[r.group.id,r.group])).values()){
        const positions=full.map((id,i)=>incoming.get(id)?.groupId===group.id?i:-1).filter(i=>i>=0);
        if(positions.length&&positions.at(-1)-positions[0]+1!==positions.length)errors.push(`新分组“${group.name||'未命名分组'}”跨越其他条目，无法自动迁移，请减少该组选择`);
    }
    plan.previewOrder=full.map(id=>{const entry=incoming.get(id);return{id,name:entry?.name||nameOf(data.t.map.get(id)),incoming:!!entry,groupName:entry?.groupName||String(data.t.groupFor(id)?.name||'未分组'),injected:entry?.injected??data.t.rows.has(id)};});
    if(errors.length)return plan;
    const result=clone(target);
    result.prompts.push(...entries.map(entry=>clone(data.s.map.get(entry.id))));
    if(entries.some(e=>e.injected)){
        let node=findPromptOrderEntry(result);if(!node){node={character_id:100001,order:[]};result.prompt_order.push(node);}
        node.order=merged.map(id=>clone(incoming.has(id)?data.s.rows.get(id):data.t.rows.get(id)));
    }
    // No metadata writes are needed for entirely ungrouped copies with no member metadata.
    const copyMeta=entries.some(e=>e.groupId||own(data.s.meta?.prompts,e.id));
    if(copyMeta){
        result.extensions??={};result.extensions.baibaiToolkit??={};
        const meta=result.extensions.baibaiToolkit.presetPromptGroups??={groups:[],prompts:{}};
        for(const r of resolutions){
            const e=r.entry;
            if(r.group&&!meta.groups.some(g=>g.id===r.group.id)){
                const nextGroup=full.slice(full.indexOf(e.id)+1).map(id=>data.t.groupFor(id)?.id).find(id=>id&&meta.groups.some(g=>g.id===id));
                const at=nextGroup?meta.groups.findIndex(g=>g.id===nextGroup):meta.groups.length;meta.groups.splice(at,0,clone(r.group));
            }
            const member=own(data.s.meta?.prompts,e.id);
            if(member||e.groupId){const copied=clone(member||{});if(e.groupId)copied.groupId=e.groupId;else delete copied.groupId;setOwn(meta.prompts,e.id,copied);}
        }
    }
    plan.result=result;return plan;
}

export function applyMigration(source,target,plan) {
    if(!plan||plan.errors?.length||!plan.result)throw new Error(`迁移计划不可应用${plan?.errors?.length?'：'+plan.errors.join('；'):''}`);
    if(signature(source)!==plan.sourceSignature||signature(target)!==plan.targetSignature)throw new Error('来源或目标已变化，请重新分析并预览迁移');
    return clone(plan.result);
}
