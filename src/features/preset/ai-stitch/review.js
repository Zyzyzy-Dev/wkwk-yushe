// 模型正文的保守差异判断与精确确认凭据；不把模型自述当作无损证明。
import {scanVariables} from '../variables.js';

export function validateAdaptedContent(source,item,baseline){
 if(typeof item.adaptedContent!=='string'||!item.adaptedContent.trim())throw Error('AI未返回完整的适配正文');
 if(item.format!==undefined)throw Error('完整正文方案不能同时使用旧版format操作');
 if(typeof item.adaptation!=='string'||!item.adaptation.trim())throw Error('缺少格式调整说明');
 if(!Array.isArray(item.referenceIds)||!item.referenceIds.length||new Set(item.referenceIds).size!==item.referenceIds.length||item.referenceIds.some(id=>!baseline.prompts.some(p=>p.identifier===id&&!p.marker)))throw Error('格式参考条目缺失或已失效');
 const text=item.adaptedContent;
 if(/<%|<script\b/i.test(text))throw Error('适配正文含脚本模板，无法静态验证；请重新生成非脚本方案');
 const spans=[],stack=[];
 for(let i=0;i<text.length-1;i++){
  const pair=text.slice(i,i+2);
  if(pair==='{{'){stack.push(i);i++;}
  else if(pair==='}}'){if(!stack.length)throw Error('适配正文宏括号未配对');spans.push(text.slice(stack.pop(),i+2));i++;}
 }
 if(stack.length)throw Error('适配正文宏括号未配对');
 const variables=scanVariables(text);
 for(const raw of spans){
  if(variables.some(v=>v.raw===raw)||/^\{\{(?:user|char)\}\}$/i.test(raw)||text===source.content)continue;
  throw Error('适配正文新增了无法验证的宏，请使用正文格式及已支持的变量宏');
 }
}

export function reviewStitchItem(input,item){
 const source=input.sources.find(s=>s.id===item.sourceId);
 if(!source)throw Error('材料已失效');
 validateAdaptedContent(source,item,input.baseline);
 const original=source.content,adapted=item.adaptedContent;
 let kind='changed';
 if(original===adapted)kind='unchanged';
 else {
  // 只自动认定添加Markdown行首标记，不忽略空白/数字，也不推断语义相同。
  const a=original.split('\n'),b=adapted.split('\n');
  if(a.length===b.length&&a.every((line,i)=>line===b[i]||(line.trim()&&/^(?:#{1,6} |[-*+] |> )/.test(b[i])&&b[i].replace(/^(?:#{1,6} |[-*+] |> )/,'')===line)))kind='structure';
 }
 return {sourceId:source.id,kind,needsApproval:true,token:JSON.stringify([input.sessionId,input.revision,source,item]),label:item.mode==='assign'?'将重新赋值已有变量，请核对最终内容和读取位置':kind==='unchanged'?'材料正文逐字一致':kind==='structure'?'仅添加 Markdown 标记，正文未改动':'存在正文变化或无法确认为纯格式，需要核对'};
}
