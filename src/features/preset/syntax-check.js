// 预设源码检查器：不执行宏，以有界分支与原文 UTF16 区间报告结构问题。
import { scanMacroSource } from './macro-source.js';
export const MAX_CHECK_BRANCHES = 32;
const pairs = new Map([['「','」'],['【','】'],['（','）'],['(',')'],['[',']'],['{','}']]);
const closes = new Set(pairs.values());
const escaped = (s,i) => { let n=0;while(i>0&&s[--i]==='\\')n++;return n%2===1; };
function location(e,start,end) { const head=e.text.slice(0,start),lines=head.split('\n');return {entryId:e.id,entryName:e.name,start,end,line:lines.length,column:lines.at(-1).length+1}; }
function issue(e,code,start,end,message,severity='error',related) {return {code,severity,...location(e,start,end),message,...(related?{related}: {})};}
// 围栏/内联代码仅屏蔽普通符号和标签；宏始终先独立扫描。
function codeMask(text) {
    const mask=new Uint8Array(text.length);let fence=null,offset=0;
    for(const line of text.split(/(?<=\n)/)) {
        const m=/^\s*(`{3,})([^\r\n]*)/.exec(line);
        if(fence) {mask.fill(1,offset,offset+line.length);if(m&&m[1].length>=fence&&m[2].trim()==='')fence=null;}
        else if(m) {fence=m[1].length;mask.fill(1,offset,offset+line.length);}
        else {const re=/(`+)([\s\S]*?)\1/g;let hit;while((hit=re.exec(line)))mask.fill(1,offset+hit.index,offset+re.lastIndex);}
        offset+=line.length;
    }
    return {mask,fence};
}
export function checkEntrySymbols(entry) {
    const e={...entry,text:String(entry.text||'')}, scanned=scanMacroSource(e.text), issues=[];
    for(const i of scanned.issues)issues.push(issue(e,i.code.includes('macro')?i.code:`macro-${i.code}`,i.start,i.end,i.message));
    function checkRegion(start,end,nodes,severity='error') {
        const text=e.text.slice(start,end), {mask,fence}=codeMask(text), stack=[];
        for(const n of nodes)mask.fill(1,n.start-start,n.end-start);
        // A stray shell closer is already diagnosed by the macro scanner.
        for(const i of scanned.issues)if(i.code==='macro-unexpected-close'&&i.start>=start&&i.end<=end)mask.fill(1,i.start-start,i.end-start);
        for(let at=0;at<text.length;at++) {
            const i=start+at;if(mask[at]||escaped(e.text,i))continue;const c=e.text[i];
            if(pairs.has(c))stack.push({c,i});
            else if(closes.has(c)) {const prev=stack.at(-1);if(prev&&pairs.get(prev.c)===c)stack.pop();else issues.push(issue(e,'symbol-unexpected',i,i+1,`多余或交叉的 ${c}`,severity,prev?location(e,prev.i,prev.i+1):undefined));}
        }
        for(const p of stack)issues.push(issue(e,'symbol-unclosed',p.i,p.i+1,`未闭合的 ${p.c}`,severity));
        if(fence) {const at=start+text.lastIndexOf('`'.repeat(fence));issues.push(issue(e,'fence-unclosed',at,at+fence,'代码围栏未闭合',severity));}
        for(const n of nodes) {
            const stored=/^(setvar|setglobalvar|addvar|addglobalvar)$/.test(n.name);
            const args=stored?(n.args||[]).slice(1):(n.args||[]);
            // Every candidate/value owns its own bracket and fence stack. A nested shell
            // is masked here then visits its own arguments, never counted twice.
            for(const a of args)checkRegion(a.start,a.end,(n.children||[]).filter(c=>c.start>=a.start&&c.end<=a.end),stored?'review':severity);
        }
    }
    checkRegion(0,e.text.length,scanned.nodes);
    return {issues,coverage:'complete',incompleteReasons:[]};
}
// 只有独占一行的标签参与配对；句中提及的 <tag> 视为普通文字。random 候选的
// 起止与换行同样算行边界，注释/trim/存储宏和同行其他标签视为空白。
const STORED=/^(setvar|setglobalvar|addvar|addglobalvar)$/;
const TAG=/<\/?([\p{L}_][\p{L}\p{N}_.:\-]*)(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gu;
const INLINE_PAIR=/<([\p{L}_][\p{L}\p{N}_.:\-]*)(?:\s[^<>\n]*)?>[^<>\n]*<\/\1\s*>/gu;
const silent=n=>n.name.startsWith('//')||n.name==='trim'||n.name==='noop'||STORED.test(n.name);
function lineKinds(text,nodes) {
    const kind=new Uint8Array(text.length); // 0 文字，1 空白，2 行边界
    for(let i=0;i<text.length;i++)kind[i]=text[i]==='\n'?2:/\s/.test(text[i])?1:0;
    for(const m of text.matchAll(TAG))kind.fill(1,m.index,m.index+m[0].length);
    // 同一行内无嵌套的成对标签（如 <summary>标题</summary>）整体视为空白。
    for(const m of text.matchAll(INLINE_PAIR))kind.fill(1,m.index,m.index+m[0].length);
    const visit=list=>{for(const n of list) {
        if(silent(n)) {kind.fill(1,n.start,n.end);continue;}
        if(n.name==='random'&&n.complete&&n.args?.length) {
            const inside=new Uint8Array(n.end-n.start);for(const a of n.args)inside.fill(1,a.start-n.start,a.end-n.start);
            for(let i=n.start;i<n.end;i++)if(!inside[i-n.start])kind[i]=2;
        }
        else if(n.complete) {kind.fill(1,n.start,n.end);continue;}
        visit(n.children||[]);
    }};
    visit(nodes);return kind;
}
function standalone(kind,start,end) {
    for(let i=start-1;i>=0&&kind[i]!==2;i--)if(kind[i]===0)return false;
    for(let i=end;i<kind.length&&kind[i]!==2;i++)if(kind[i]===0)return false;
    return true;
}
function plainTokens(e,start,end,mask,kind) {
    const tokens=[],re=new RegExp(TAG.source,'gu');re.lastIndex=start;let m;
    while((m=re.exec(e.text))&&m.index<end) {
        if(re.lastIndex>end||mask[m.index]||escaped(e.text,m.index)||/^(user|char|bot)$/i.test(m[1])||m[0].endsWith('/>'))continue;
        tokens.push({e,start:m.index,end:re.lastIndex,name:m[1],close:m[0][1]==='/',mention:!standalone(kind,m.index,re.lastIndex)});
    }return tokens;
}
const signature=path=>path.map(t=>t.boundary?'?':(t.mention?'~':'')+(t.close?'/':'')+t.name).join('\u0000');
function distinct(list) {const seen=new Map();for(const v of list){const k=signature(v);if(!seen.has(k))seen.set(k,v);}return [...seen.values()];}
// collapse：分支超限时把有差异的 random 换成未知边界，保留其前后的固定标签。
function variants(e,start,end,nodes,mask,kind,reasons,collapse=false) {
    let result=[[]],cursor=start;
    for(const n of nodes.filter(n=>n.start>=start&&n.end<=end)) {
        const before=plainTokens(e,cursor,n.start,mask,kind);result=result.map(v=>v.concat(before));let options=[[]];
        if(n.name==='random'&&n.complete&&n.args?.length) {options=distinct(n.args.flatMap(a=>variants(e,a.start,a.end,n.children||[],mask,kind,reasons,collapse)));if(collapse&&options.length>1)options=[[{boundary:true}]];}
        else if(/^get(global)?var$/.test(n.name))reasons.add('变量读取宏未展开，其内容不计入标签配对。');
        if(result.length*options.length>MAX_CHECK_BRANCHES) {reasons.add(`随机分支超过 ${MAX_CHECK_BRANCHES} 条分析路径。`);options=[[{boundary:true}]];}
        result=distinct(result.flatMap(v=>options.map(o=>v.concat(o))));cursor=n.end;
    }
    const tail=plainTokens(e,cursor,end,mask,kind);return result.map(v=>v.concat(tail));
}
function pathIssues(path) {
    const stack=[],pending=new Map(),mentions=new Set(),found=[];
    for(const t of path) {
        if(t.boundary)continue;
        if(t.mention) {if(!t.close)mentions.add(t.name);continue;}
        if(!t.close) {stack.push(t);continue;}
        const at=stack.findLastIndex(o=>o.name===t.name);
        if(at<0) {
            const skipped=pending.get(t.name)?.shift();
            if(skipped)found.push([t,'tag-crossing',`标签交叉嵌套：${t.name}`,skipped.outer]);
            else if(mentions.has(t.name))found.push([t,'tag-unexpected',`没有匹配开始标签：${t.name}（前文只有句中提及的同名标签）`,undefined,true]);
            else found.push([t,'tag-unexpected',`没有匹配开始标签：${t.name}`,stack.at(-1)]);
            continue;
        }
        for(const open of stack.slice(at+1)) {if(!pending.has(open.name))pending.set(open.name,[]);pending.get(open.name).push({open,outer:t});}
        stack.splice(at);
    }
    for(const list of pending.values())for(const {open,outer} of list)found.push([open,'tag-unclosed',`标签未闭合：${open.name}（在 </${outer.name}> 之前没有关闭）`,outer]);
    for(const t of stack)found.push([t,'tag-unclosed',t.afterChat?`标签未闭合：${t.name}（位于聊天记录之后，可能留给模型输出时闭合）`:`标签未闭合：${t.name}`,undefined,t.afterChat]);
    return found;
}
export function checkPresetStructure(context,{ignoredOccurrences=[]}={}) {
    const reasons=new Set(context.uncertainties||[]),issues=[],byId=new Map(context.entries.map(e=>[e.id,e])),parsed=new Map();
    const parse=e=>{if(!parsed.has(e.id)){const nodes=scanMacroSource(e.text).nodes;parsed.set(e.id,{nodes,mask:codeMask(e.text).mask,kind:lineKinds(e.text,nodes)});}return parsed.get(e.id);};
    for(const e of context.entries)issues.push(...checkEntrySymbols(e).issues);
    for(const stream of context.streams) {
        let paths=[[]];
        for(const f of stream.fragments) {
            if(f.type==='boundary') {reasons.add(f.reason||'动态内容未检查。');paths=paths.map(p=>p.concat({boundary:true}));continue;}
            const e=byId.get(f.entryId);if(!e)continue;const {nodes,mask,kind}=parse(e);
            const mark=list=>list.map(v=>f.afterChat?v.map(t=>t.boundary?t:{...t,afterChat:true}):v);
            let options=mark(variants(e,f.start??0,f.end??e.text.length,nodes,mask,kind,reasons));
            if(paths.length*options.length>MAX_CHECK_BRANCHES) {reasons.add(`随机分支超过 ${MAX_CHECK_BRANCHES} 条分析路径。`);options=mark(variants(e,f.start??0,f.end??e.text.length,nodes,mask,kind,reasons,true));}
            paths=distinct(paths.flatMap(p=>options.map(o=>p.concat(o))));
        }
        // 每条随机路径都出现、且路径内没有未知边界的问题才算明确错误。
        const seen=new Map();
        for(const path of paths) {
            const dynamic=path.some(t=>t.boundary);
            for(const [t,code,message,related,soft] of pathIssues(path)) {
                const key=`${t.e.id}:${t.start}:${t.end}:${code}`,hit=seen.get(key);
                if(hit) {hit.count++;hit.dynamic||=dynamic;}
                else seen.set(key,{count:1,dynamic:dynamic||Boolean(soft),make:severity=>issue(t.e,code,t.start,t.end,message,severity,related?location(related.e,related.start,related.end):undefined)});
            }
        }
        for(const hit of seen.values())issues.push(hit.make(hit.dynamic||hit.count<paths.length?'review':'error'));
    }
    const ignored=ignoredOccurrences instanceof Set?ignoredOccurrences:new Set(ignoredOccurrences.map(i=>typeof i==='string'?i:`${i.entryId}:${i.start}:${i.end}`));
    const unique=new Map();for(const i of issues) {const key=`${i.entryId}:${i.start}:${i.end}`;if(!ignored.has(key))unique.set(`${key}:${i.code}`,i);}
    return {issues:[...unique.values()],coverage:reasons.size?'partial':'complete',incompleteReasons:[...reasons]};
}
