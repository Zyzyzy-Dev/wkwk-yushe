// 符号编辑回归：保留选区外文本、换行、Unicode 与模板宏，计划可交由现有适配器撤销。
import test from 'node:test';
import assert from 'node:assert/strict';
import {CREATOR_SYMBOLS,planCreatorSymbol} from '../src/features/preset/creator-symbols.js';
import {applySourceEdit} from '../src/features/preset/random-macros.js';
import {createContentEditorState,recordContentChange,undoContentChange} from '../src/features/preset/content-editor-state.js';

test('all paired symbols wrap only the exact selected text without interpreting macros',()=>{
  const text='之前😀{{getvar::角色}}之后',start=2,end=text.length-2;
  for(const {id,open,close} of CREATOR_SYMBOLS.filter(x=>x.open)){
    const edit=planCreatorSymbol(text,start,end,id),result=applySourceEdit(text,edit);
    assert.equal(result.text,'之前'+open+'😀{{getvar::角色}}'+close+'之后');
    assert.equal(result.text.slice(result.selectionStart,result.selectionEnd),edit.replacement);
  }
});
test('prefixes preserve CRLF and blank lines, including a selection ending at a line boundary',()=>{
  const text='前言\r\n第一行\r\n\r\n  \r\n第二行\r\n后记';
  for(const {id,prefix} of CREATOR_SYMBOLS.filter(x=>x.prefix)){
    const result=applySourceEdit(text,planCreatorSymbol(text,4,text.length-2,id));
    assert.equal(result.text,'前言\r\n'+prefix+'第一行\r\n\r\n  \r\n'+prefix+'第二行\r\n后记');
  }
});
test('mid-line selection inserts at its start and does not rewrite unselected text',()=>{
  const text='不要改前面，选中这里，别动后面';
  assert.equal(applySourceEdit(text,planCreatorSymbol(text,6,10,'h2')).text,'不要改前面，## 选中这里，别动后面');
});
test('each symbol operation has one reversible content history step',()=>{
  const text='abc\ndef',state=createContentEditorState(text),result=applySourceEdit(text,planCreatorSymbol(text,0,7,'list'));
  const changed=recordContentChange(state,result.text,{start:result.selectionStart,end:result.selectionEnd});
  assert.equal(undoContentChange(changed).text,text);
});
test('stale plans, empty or invalid selections and unknown symbols cannot overwrite text',()=>{
  const edit=planCreatorSymbol('原文',0,2,'bold');assert.throws(()=>applySourceEdit('新原文',edit));
  for(const [text,start,end,id] of [['abc',1,1,'bold'],[' \n',0,2,'h1'],['abc',-1,2,'h1'],['abc',0,4,'h1'],['abc',0,2,'bad']])assert.throws(()=>planCreatorSymbol(text,start,end,id));
});

test('numbered lists count only selected nonblank lines and preserve CRLF and surrounding content',()=>{
  const text='前文\r\n甲\r\n\r\n  \r\n乙\r\n后文',end=text.length-2;
  const result=applySourceEdit(text,planCreatorSymbol(text,4,end,'ordered'));
  assert.equal(result.text,'前文\r\n1. 甲\r\n\r\n  \r\n2. 乙\r\n后文');
});

test('custom paired tags accept Chinese and namespace names without interpreting selected source',()=>{
  const text='前{{getvar::人物}}后',start=1,end=text.length-1;
  for(const tagName of ['规则','prompt:rules','_context','场景_1']){
    const result=applySourceEdit(text,planCreatorSymbol(text,start,end,'tag',{tagName}));
    assert.equal(result.text,`前<${tagName}>{{getvar::人物}}</${tagName}>后`);
  }
  for(const tagName of ['', 'two words','<rules>','/rules','rules x="y"','a'.repeat(65),'1rule'])assert.throws(()=>planCreatorSymbol(text,start,end,'tag',{tagName}));
});

test('separator stays on its own line with blank separation instead of turning preceding text into a heading',()=>{
  for(const [text,start,expected] of [
    ['甲乙',1,'甲\n\n---\n\n乙'],['甲\n乙',2,'甲\n\n---\n\n乙'],['甲\n\n乙',3,'甲\n\n---\n\n乙'],['乙',0,'---\n\n乙'],['甲\r\n乙',3,'甲\r\n\r\n---\r\n\r\n乙']
  ])assert.equal(applySourceEdit(text,planCreatorSymbol(text,start,text.length,'separator')).text,expected);
});
