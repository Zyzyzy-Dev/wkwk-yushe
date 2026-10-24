// 正文编辑纯状态：原文、UTF-16 选区和模式内撤销边界。
export function clampSelection(text, selection = {}) {
 const start = Math.max(0, Math.min(text.length, Number(selection.start) || 0));
 return {start, end: Math.max(start, Math.min(text.length, Number(selection.end) || start))};
}
export function createContentEditorState(text = '') { return {text, selection: {start:0,end:0}, revision:0, history:[], group:null}; }
export function recordContentChange(state, text, selection, {group = null} = {}) {
 if (text === state.text) return {...state, selection:clampSelection(text, selection)};
 const history = state.history.slice();
 if (!group || group !== state.group) history.push({text:state.text, selection:state.selection});
 return {text, selection:clampSelection(text, selection), revision:state.revision+1, history:history.slice(-100), group};
}
export function undoContentChange(state) {
 if (!state.history.length) return state;
 const previous = state.history[state.history.length-1];
 return {...state,...previous, revision:state.revision+1, history:state.history.slice(0,-1),group:null};
}
