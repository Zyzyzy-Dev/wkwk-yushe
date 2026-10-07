// 只在可证明的读取容器内插入宏；保留原字串、换行和简单读取分隔符。
import {scanVariables,appendVariableText} from '../variables.js';
const HTML_VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
export function insertStitchRead(text,macro,scope,readTag){
 text=String(text??'');if(readTag===null||readTag==='')readTag=undefined;
 const fail=message=>{throw Error('读取宏位置：'+message);};
 if(readTag!==undefined&&(typeof readTag!=='string'||!readTag.trim()))fail('容器名称无效');
 const macros=scanVariables(text),reads=macros.filter(m=>m.scope===scope&&m.kind.startsWith('get'));
 for(const m of reads){const prefix=text.slice(0,m.start);if((prefix.match(/\{\{/g)||[]).length!==(prefix.match(/\}\}/g)||[]).length)fail('读取宏位于嵌套宏中');}
 const stack=[],containers=[];
 if(/<!--|```/.test(text))fail('含注释或代码围栏，无法确定标签容器');
 for(const match of text.matchAll(/<(\/?)([\p{L}_][\p{L}\p{N}_:.-]*)([^<>]*?)>/gu)){
  if(macros.some(m=>match.index>=m.start&&match.index<m.end))continue;
  const [,closing,name,attributes]=match;
  if(!closing&&HTML_VOID.has(name.toLowerCase()))continue;
  if(/\/\s*$/.test(attributes)&&!closing)continue;
  if(closing){const top=stack.pop();if(!top||top.name!==name||attributes.trim())fail('标签不配对，不能猜测插入位置');top.end=match.index;containers.push(top);}
  else stack.push({name,start:match.index+match[0].length});
 }
 if(stack.length)fail('标签未闭合，不能追加到条目外');
 const parent=m=>containers.filter(c=>c.start<=m.start&&m.end<=c.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
 let container;
 if(readTag!==undefined){
  const matches=containers.filter(c=>c.name===readTag);if(matches.length!==1)fail('指定容器不存在或不唯一');container=matches[0];
  if(!reads.some(m=>parent(m)===container))fail('指定容器中没有同作用域读取范例');
 }else if(containers.length){
  const candidates=new Set(reads.map(parent));
  if(candidates.size===1&&candidates.has(undefined)){
   // 读取全在容器外：沿用容器内路径的分隔符逻辑，追加到最后一个顶层读取之后。
   const last=reads.at(-1),newline=text.includes('\r\n')?'\r\n':'\n';let separator=newline;
   if(reads.length>1){const gap=text.slice(reads.at(-2).end,last.start);if(/^\s*(?:---\s*)?$/.test(gap)&&gap.includes('\n'))separator=gap;}
   const offset=last.end,inserted=separator+macro;
   return {after:text.slice(0,offset)+inserted+text.slice(offset),offset,inserted,container:null};
  }
  if(candidates.size!==1||candidates.has(undefined))fail('存在多个或不确定读取容器，请在方案中指定readTag');
  container=[...candidates][0];
 }
 if(!container){const after=appendVariableText(text,macro);return {after,offset:text.length,inserted:after.slice(text.length),container:null};}
 const within=reads.filter(m=>parent(m)===container);
 if(!within.length)fail('目标容器没有直属读取宏，请选择实际读取容器');
 const last=within.at(-1),newline=text.includes('\r\n')?'\r\n':'\n';
 let separator=newline;
 if(within.length>1){const gap=text.slice(within.at(-2).end,last.start);if(/^\s*(?:---\s*)?$/.test(gap)&&gap.includes('\n'))separator=gap;}
 const offset=last.end,inserted=separator+macro;
 return {after:text.slice(0,offset)+inserted+text.slice(offset),offset,inserted,container:container.name};
}
