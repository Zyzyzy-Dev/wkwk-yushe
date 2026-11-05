// 自动识别跨版本条目；两侧独立索引，不改输入、开关、顺序或分组。
import {findPromptOrderEntry} from './core.js';

const text = value => String(value ?? '');
const keyName = value => text(value).normalize('NFC').trim().replace(/\s+/gu,' ');
const informative = body => !!body.trim() && !/^(?:\s|\{\{\s*trim\s*\}\})+$/iu.test(body);
function buckets(rows,key) {
    const result=new Map();
    for(const row of rows){const k=key(row);if(!k)continue;const list=result.get(k);if(list)list.push(row);else result.set(k,[row]);}
    return result;
}
function records(preset,loose) {
    const prompts=preset?.prompts||[], meta=preset?.extensions?.baibaiToolkit?.presetPromptGroups;
    const groups=new Map((Array.isArray(meta?.groups)?meta.groups:[]).map(g=>[g?.id,keyName(g?.name)]));
    const node=findPromptOrderEntry({prompts,prompt_order:preset?.prompt_order}), order=(node?.order||[]).map(x=>typeof x==='string'?x:x?.identifier);
    const at=new Map(order.map((id,i)=>[id,i]));
    return prompts.map(p=>{
        const raw=text(p.content), i=at.get(p.identifier), groupId=meta?.prompts?.[p.identifier]?.groupId;
        return {id:p.identifier,name:keyName(p.name),body:loose?raw.replace(/\s+/gu,''):raw,marker:!!p.marker,
            group:groups.get(groupId)||'',inOrder:i!==undefined,before:order[i-1],after:order[i+1]};
    });
}
const sameType=(a,b)=>a.marker===b.marker;
function profile(row) {
    if(row.marker||row.body.trim().length<32)return null;
    const grams=new Map();let count=0;
    for(let i=0;i<row.body.length-2;i++){const g=row.body.slice(i,i+3);if(!g.trim())continue;grams.set(g,(grams.get(g)||0)+1);count++;}
    return grams.size>=16?{row,grams,count}:null;
}
function fuzzyMatches(oldRows,newRows,link,flag) {
    if(!oldRows.length||!newRows.length)return;
    const target=newRows.map(profile).filter(Boolean),index=new Map(),left=new Map(),right=new Map();
    for(const n of target)for(const [g,count] of n.grams){const list=index.get(g);if(list)list.push([n,count]);else index.set(g,[[n,count]]);}
    const rank=(map,row,edge)=>{const list=map.get(row)||[];list.push(edge);map.set(row,list);};
    for(const row of oldRows){
        const o=profile(row);if(!o)continue;
        const sums=new Map();
        for(const [g,count] of o.grams)for(const [n,c] of index.get(g)||[]){
            if(2*Math.min(n.count,o.count)/(n.count+o.count)>=.76)sums.set(n,(sums.get(n)||0)+Math.min(c,count));
        }
        for(const [n,common] of sums){
            const score=2*common/(n.count+o.count);if(score<.76)continue;
            const edge={o:row,n:n.row,score,eligible:score>=((row.name&&row.name===n.row.name)?.82:.92)};
            rank(left,row,edge);rank(right,n.row,edge);
        }
    }
    for(const list of [...left.values(),...right.values()])list.sort((a,b)=>b.score-a.score);
    for(const list of left.values()){
        const e=list[0],back=right.get(e.n);
        if(e.eligible&&back[0]===e&&e.score-(list[1]?.score||0)>=.06&&e.score-(back[1]?.score||0)>=.06)link(e.o,e.n,'similar');
        else for(const rival of list)if(rival.eligible)flag(rival.o,rival.n);
    }
}

// previous is scoped by the caller to the same two loaded presets and whitespace mode.
export function comparePromptPairs(oldPreset,newPreset,{ignoreWhitespace=false,previous,edited}={}) {
    const rows={old:records(oldPreset,ignoreWhitespace),new:records(newPreset,ignoreWhitespace)};
    const sides=['old','new'];
    const unchanged=(a,b)=>a.length===b.length&&a.every((r,i)=>{const s=b[i];return r.id===s.id&&r.name===s.name&&r.body===s.body&&r.marker===s.marker&&r.group===s.group&&r.inOrder===s.inOrder&&r.before===s.before&&r.after===s.after;});
    if(previous&&sides.every(s=>unchanged(rows[s],previous.rows[s])))return previous;
    const byId={},names={},byBody={},result={old:new Map(),new:new Map(),rows};
    for(const s of sides){
        byId[s]=new Map(rows[s].map(r=>[r.id,r]));names[s]=buckets(rows[s],r=>r.name);
        byBody[s]=buckets(rows[s],r=>informative(r.body)&&r.body);
    }
    const free=(s,r)=>r&&!result[s].has(r.id);
    const rivals=new Map();
    const flag=(o,n)=>{if(!sameType(o,n))return;let set=rivals.get(o);if(!set){set=new Set();rivals.set(o,set);}set.add(n);};
    function link(o,n,kind) {
        if(!free('old',o)||!free('new',n)||!sameType(o,n))return;
        const pair={oldId:o.id,newId:n.id,kind,status:o.body===n.body?'same':'changed'};
        result.old.set(o.id,pair);result.new.set(n.id,pair);
    }
    // Keep an established pair while the user edits its body in this workspace.
    if(previous&&edited)for(const p of previous.old.values())if(p.newId&&(edited.old.has(p.oldId)||edited.new.has(p.newId)))link(byId.old.get(p.oldId),byId.new.get(p.newId),p.kind);
    // A distinctive full name AND exact body can contradict a recycled ID.
    for(const [name,os] of names.old){
        const ns=names.new.get(name);if(!ns)continue;
        const a=buckets(os,r=>informative(r.body)&&r.body), b=buckets(ns,r=>informative(r.body)&&r.body);
        for(const [body,group] of a)if(group.length===1&&b.get(body)?.length===1){
            const o=group[0],n=b.get(body)[0];
            // A newly duplicated title + old body must not steal the edited original.
            // Exchanging two existing bodies in equally sized duplicate-title sets is different.
            if(os.length!==ns.length&&o.id!==n.id&&(byId.new.get(o.id)?.name===name||byId.old.get(n.id)?.name===name))continue;
            link(o,n,'content');
        }
    }
    for(const o of rows.old){const n=byId.new.get(o.id);if(n&&o.name&&o.name===n.name)link(o,n,'id');}
    // For the remaining unique names require independent group, confirmed neighbour or text evidence.
    const adjacent=(o,n,key)=>o[key]!=null&&n[key]!=null&&result.old.get(o[key])?.newId===n[key];
    // Group names sometimes change too. Infer them from members already independently matched.
    const groupVotes={old:new Map(),new:new Map()};
    function vote(side,a,b){if(!groupVotes[side].has(a))groupVotes[side].set(a,new Map());const votes=groupVotes[side].get(a);votes.set(b,(votes.get(b)||0)+1);}
    for(const p of result.old.values()){const a=byId.old.get(p.oldId).group,b=byId.new.get(p.newId).group;if(a&&b){vote('old',a,b);vote('new',b,a);}}
    function majority(s,a,b){const votes=groupVotes[s].get(a),v=votes?.get(b)||0;return v>=2&&2*v>[...votes.values()].reduce((x,y)=>x+y,0);}
    const corpusAnchored=result.old.size>=5&&result.old.size*2>=Math.max(rows.old.length,rows.new.length);
    const contextual=(o,n)=>(o.group&&(o.group===n.group||(majority('old',o.group,n.group)&&majority('new',n.group,o.group))))||adjacent(o,n,'before')||adjacent(o,n,'after')||
        (corpusAnchored&&o.body===n.body&&o.inOrder===n.inOrder&&/[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(o.name));
    const pending=[];
    for(const [name,os] of names.old){const ns=names.new.get(name);if(os.length===1&&ns?.length===1&&sameType(os[0],ns[0]))pending.push([os[0],ns[0]]);}
    function matchNames(){
        let count;
        do{count=result.old.size;const batch=pending.filter(([o,n])=>free('old',o)&&free('new',n)&&contextual(o,n));for(const [o,n] of batch)link(o,n,'context');}while(count!==result.old.size);
    }
    matchNames();
    // An extensively edited unique title can survive a move to a different group.
    // Require varied shared text and a majority of counted trigrams, not just a short prefix.
    for(const [o,n] of pending)if(free('old',o)&&free('new',n)&&informative(o.body)&&informative(n.body)){
        const a=profile(o),b=profile(n);if(!a||!b)continue;
        let shared=0,distinct=0;for(const [g,v] of a.grams)if(b.grams.has(g)){shared+=Math.min(v,b.grams.get(g));distinct++;}
        if(distinct>=16&&2*shared/(a.count+b.count)>=.55)link(o,n,'name-text');
    }
    // Estimate ID reuse by identifier format; numeric slots have no identity on their own.
    const family=id=>/^\d+$/u.test(id)?'number':/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(id)?'uuid':'named';
    const counts=new Map();
    for(const o of rows.old){if(!byId.new.has(o.id))continue;const k=family(o.id),v=counts.get(k)||[0,0];v[0]++;if((result.old.has(o.id)&&result.old.get(o.id).newId!==o.id)||(result.new.has(o.id)&&result.new.get(o.id).oldId!==o.id))v[1]++;counts.set(k,v);}
    for(const o of rows.old){
        const n=byId.new.get(o.id);if(!n||!sameType(o,n))continue;
        const k=family(o.id),[all,shifts]=counts.get(k);
        // Conflicting unique names remain candidates; let corroborating text decide.
        const displaced=(names.new.get(o.name)?.length===1||names.old.get(n.name)?.length===1)&&o.name!==n.name;
        const uniqueBody=byBody.old.get(o.body)?.length===1&&byBody.new.get(n.body)?.length===1;
        if((informative(o.body)&&o.body===n.body&&!displaced&&(uniqueBody||contextual(o,n)))||(!displaced&&k!=='number'&&!(shifts>=2&&shifts/all>=.2)&&contextual(o,n)))link(o,n,'id');
    }
    for(const [body,os] of byBody.old){
        const ns=byBody.new.get(body)||[],a=os.filter(o=>free('old',o)),b=ns.filter(n=>free('new',n));
        if(a.length===1&&b.length===1)link(a[0],b[0],'content');
        else for(const o of a)for(const n of b)flag(o,n);
    }
    matchNames();
    fuzzyMatches(rows.old.filter(r=>free('old',r)),rows.new.filter(r=>free('new',r)),link,flag);
    matchNames();
    // Empty headings occasionally lose a subtitle. Require a complete bounded label,
    // identical placeholder, an independently matched immediate neighbour and no rivals.
    const headings=side=>rows[side].filter(r=>free(side,r)&&!informative(r.body)&&r.name&&names[side].get(r.name).length===1);
    const shortLabel=(a,b)=>a.length<b.length&&b.startsWith(a)&&/[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(a)&&
        (!/[\p{L}\p{N}]$/u.test(a)||!/^[\p{L}\p{N}]/u.test(b.slice(a.length)));
    const heads=headings('new'),edges=[];
    for(const o of headings('old'))for(const n of heads)if(sameType(o,n)&&o.body===n.body&&
        (shortLabel(o.name,n.name)||shortLabel(n.name,o.name))&&(adjacent(o,n,'before')||adjacent(o,n,'after')))edges.push({o,n});
    const ol=buckets(edges,e=>e.o),nl=buckets(edges,e=>e.n);
    for(const {o,n} of edges){if(ol.get(o).length===1&&nl.get(n).length===1)link(o,n,'heading');else flag(o,n);}
    for(const [name,os] of names.old)for(const o of os.filter(r=>free('old',r)))for(const n of (names.new.get(name)||[]).filter(r=>free('new',r)))flag(o,n);
    for(const o of rows.old){const n=byId.new.get(o.id);if(!free('old',o)||!free('new',n))continue;
        const [all,shifts]=counts.get(family(o.id));if(!(shifts>=2&&shifts/all>=.2))flag(o,n);}
    const unclear={old:new Set(),new:new Set()};
    for(const [o,ns] of rivals)if(free('old',o))for(const n of ns)if(free('new',n)){unclear.old.add(o.id);unclear.new.add(n.id);}
    for(const side of sides)for(const r of rows[side])if(free(side,r))result[side].set(r.id,{oldId:side==='old'?r.id:null,newId:side==='new'?r.id:null,kind:null,status:unclear[side].has(r.id)?'uncertain':side==='old'?'removed':'added'});
    return result;
}
