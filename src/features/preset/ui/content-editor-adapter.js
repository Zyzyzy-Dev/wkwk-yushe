// 正文适配器：保留原 textarea 的表单与草稿 input 通道，管理视图和局部撤销。
import {createContentEditorState, recordContentChange, undoContentChange, clampSelection} from '../content-editor-state.js';
import {applySourceEdit} from '../random-macros.js';
// initial/onState：由调用方按条目保存撤销历史，关闭详情再打开仍可撤回未保存的正文修改。
export function createContentEditorAdapter({area, onInput, initial = null, onState} = {}) {
 if (!area) throw new TypeError('正文输入框不存在');
 let state = initial?.text === area.value ? {...initial, group:null} : createContentEditorState(area.value), view = null, disposed = false, writing = false, composing = false, group = 0, lastInput = 0;
 const listeners = new Set();
 const sourceSelection = () => ({start:area.selectionStart || 0,end:area.selectionEnd || 0});
 state.selection = sourceSelection();
 const notify = () => { onState?.(state); for (const listener of listeners) listener(state.text, state.selection, state); };
 const sync = (emit = true) => {
  writing = true; area.value = state.text; area.setSelectionRange(state.selection.start,state.selection.end);
  if (emit) { area.dispatchEvent(new area.ownerDocument.defaultView.Event('input',{bubbles:true})); onInput?.(state.text); }
  writing = false; notify();
 };
 const input = () => {
  if (writing || disposed) return;
  const now = Date.now(); if (!composing && now-lastInput > 750) group++;
  state = recordContentChange(state,area.value,sourceSelection(),{group:`native-${group}`}); lastInput = now;
  view?.render(state.text,state.selection); notify();
 };
 const beforeInput = () => { if (!writing && !disposed) state = {...state,selection:clampSelection(state.text,sourceSelection())}; };
 const begin = () => { composing = true; group++; state = {...state,selection:sourceSelection(),group:null}; };
 const end = () => { composing = false; group++; state = {...state,group:null}; };
 area.addEventListener('beforeinput',beforeInput); area.addEventListener('input',input); area.addEventListener('compositionstart',begin); area.addEventListener('compositionend',end);
 const api = {
  area,
  get revision(){return state.revision;},
  getText(){ if (area.value !== state.text) input(); return state.text; },
  getSelection(){ return clampSelection(state.text,view?.getSelection?.() || sourceSelection()); },
  setSelection(start,end = start){state = {...state,selection:clampSelection(state.text,{start,end})}; area.setSelectionRange(state.selection.start,state.selection.end); view?.focusRange?.(state.selection.start,state.selection.end);},
  focusRange(start,end = start){api.setSelection(start,end); if (!view) area.focus();},
  replace(edit, options = {}) {
   api.getText(); state = {...state,selection:api.getSelection()};
   const result = applySourceEdit(state.text,edit);
   if (result?.ok === false) return result;
   const text = typeof result === 'string' ? result : result.text;
   if (typeof text !== 'string') return {ok:false,reason:'编辑结果无效'};
   state = recordContentChange(state,text,result.selection || (Number.isInteger(result.selectionStart) ? {start:result.selectionStart,end:result.selectionEnd} : null) || edit.selection || state.selection,options);
   sync(); view?.render(state.text,state.selection); view?.focusRange?.(state.selection.start,state.selection.end); return {ok:true,text:state.text,selection:state.selection};
  },
  captureBeforeInput(selection = api.getSelection()){ state = {...state,selection:clampSelection(state.text,selection)}; },
  updateText(text,selection,options = {}) { state = recordContentChange(state,text,selection,options); sync(); if(!options.deferRender)view?.render(state.text,state.selection); return state; },
  subscribe(listener){listeners.add(listener); return () => listeners.delete(listener);},
  attachView(next){view = next; view?.render(state.text,state.selection); return () => {if(view === next)view = null;};},
  canUndo(){ return state.history.length > 0; },
  // 条目保存后已保存内容成为新起点，未保存修改的撤销记录随之清空。
  clearHistory(){ state = {...state,history:[],group:null}; notify(); },
  undo(){ const next = undoContentChange(state); if(next === state)return false; state = next; sync(); view?.render(state.text,state.selection); view?.focusRange?.(state.selection.start,state.selection.end); return true; },
  dispose(){disposed = true; area.removeEventListener('beforeinput',beforeInput); area.removeEventListener('input',input); area.removeEventListener('compositionstart',begin);area.removeEventListener('compositionend',end);view?.dispose?.();view=null;listeners.clear();if(area._pcmContentEditor===api)delete area._pcmContentEditor;}
 };
 area._pcmContentEditor = api; return api;
}
