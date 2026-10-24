// 正文编辑状态回归：选区、编辑分组、撤销与模式无关性。
import test from 'node:test';import assert from 'node:assert/strict';
import {createContentEditorState,recordContentChange,undoContentChange} from '../src/features/preset/content-editor-state.js';
import {planRandomWrap,applySourceEdit} from '../src/features/preset/random-macros.js';
test('conversion preserves outside selection and undo restores exact source',()=>{const s=createContentEditorState('前你好后');const edit=applySourceEdit(s.text,planRandomWrap(s.text,{start:1,end:3}));const n=recordContentChange(s,edit.text,{start:edit.selectionStart,end:edit.selectionEnd});assert.equal(n.text,'前{{random::你好:: }}后');assert.equal(undoContentChange(n).text,s.text);});
test('composition and continuous input merge only within explicit unit',()=>{let s=createContentEditorState('');s=recordContentChange(s,'n',{start:1,end:1},{group:'ime1'});s=recordContentChange(s,'你',{start:1,end:1},{group:'ime1'});s=recordContentChange(s,'你好',{start:2,end:2},{group:'typing2'});assert.equal(undoContentChange(s).text,'你');assert.equal(undoContentChange(undoContentChange(s)).text,'');});
test('selection-only changes do not add undo entries or change revision',()=>{const s=recordContentChange(createContentEditorState('abc'),'abc',{start:1,end:2});assert.equal(s.revision,0);assert.equal(s.history.length,0);assert.deepEqual(s.selection,{start:1,end:2});});
import {createContentEditorAdapter} from '../src/features/preset/ui/content-editor-adapter.js';
class SourceArea extends EventTarget {
 constructor(){super();this.value='abcdef';this.selectionStart=0;this.selectionEnd=0;this.ownerDocument={defaultView:{Event}};}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
}
for(const mode of ['source','block'])for(const end of [1,4])test(`${mode} undo restores beforeinput insertion/replacement selection [1,${end}]`,()=>{
 const area=new SourceArea(),adapter=createContentEditorAdapter({area});area.setSelectionRange(1,end);
 if(mode==='source'){area.dispatchEvent(new Event('beforeinput'));area.value='aXY'+area.value.slice(end);area.setSelectionRange(3,3);area.dispatchEvent(new Event('input'));}
 else {let selected={start:1,end};adapter.attachView({getSelection:()=>selected,render(){},focusRange(start,end){selected={start,end};}});adapter.captureBeforeInput();selected={start:3,end:3};adapter.updateText('aXYabcdef'.slice(0,3)+'abcdef'.slice(end),selected);}
 adapter.undo();assert.equal(adapter.getText(),'abcdef');assert.deepEqual(adapter.getSelection(),{start:1,end});adapter.dispose();
});
test('persisted history survives reopening the same unsaved text and resets when text differs',()=>{
 const area=new SourceArea();let saved=null;const first=createContentEditorAdapter({area,onState:s=>{saved=s;}});
 area.value='abcXdef';area.setSelectionRange(4,4);area.dispatchEvent(new Event('input'));assert.equal(first.canUndo(),true);first.dispose();
 const again=new SourceArea();again.value='abcXdef';const second=createContentEditorAdapter({area:again,initial:saved});
 assert.equal(second.canUndo(),true);second.undo();assert.equal(again.value,'abcdef');assert.equal(second.canUndo(),false);second.dispose();
 const other=new SourceArea();other.value='changed elsewhere';const third=createContentEditorAdapter({area:other,initial:saved});assert.equal(third.canUndo(),false);third.dispose();
});
test('clearHistory makes the saved text the new undo baseline',()=>{
 const area=new SourceArea(),adapter=createContentEditorAdapter({area});area.value='abcZ';area.dispatchEvent(new Event('input'));
 adapter.clearHistory();assert.equal(adapter.canUndo(),false);assert.equal(adapter.undo(),false);assert.equal(area.value,'abcZ');adapter.dispose();
});
