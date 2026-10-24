// random 分块纯状态：无损区间、嵌套去重和组合输入时的结构保留。
import {scanRandomMacros} from './random-macros.js';
export function partitionRandomSource(text, scan = scanRandomMacros) {
 const result = scan(text), macros = (Array.isArray(result)?result:result.macros || []).filter(n => n.name?.toLowerCase() === 'random').sort((a,b)=>a.start-b.start || b.end-a.end);
 const blocks = []; let cursor = 0, index = 0;
 for (const macro of macros) {
  if (macro.start < cursor) continue;
  blocks.push({key:`text-${index}`,type:'text',start:cursor,end:macro.start,text:text.slice(cursor,macro.start)});
  blocks.push({key:`random-${index++}`,type:'random',start:macro.start,end:macro.end,text:text.slice(macro.start,macro.end),complete:macro.complete !== false,macro}); cursor = macro.end;
 }
 blocks.push({key:`text-${index}`,type:'text',start:cursor,end:text.length,text:text.slice(cursor)}); return blocks;
}
export function createRandomEditorState(text, scan) {return {text,blocks:partitionRandomSource(text,scan),activeBlockKey:null,selection:{start:0,end:0},revision:0,pendingReparse:false};}
export function updateRandomBlock(state, blockKey, nextText, selection, {composing=false} = {}) {
 const block = state.blocks.find(b=>b.key===blockKey); if(!block)throw new Error('编辑块已失效');
 const text = state.text.slice(0,block.start)+nextText+state.text.slice(block.end), delta=nextText.length-(block.end-block.start);
 const blocks = state.blocks.map(b=> b===block?{...b,text:nextText,end:b.start+nextText.length,complete:b.type==='random'?false:b.complete}:b.start>=block.end?{...b,start:b.start+delta,end:b.end+delta}:b);
 const next = {...state,text,blocks,activeBlockKey:blockKey,selection,revision:state.revision+1,pendingReparse:true};
 return {state:next,text,selection,needsReparse:!composing};
}
