// Tests for source-preserving macro scanning and random edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMacroSource } from '../src/features/preset/macro-source.js';
import { scanRandomMacros, planRandomAppend, planRandomWrap, applySourceEdit } from '../src/features/preset/random-macros.js';

test('append and wrap preserve exact candidate whitespace and selection', () => {
  const before = '{{random::A::B}}';
  const result = applySourceEdit(before, planRandomAppend(before, 0));
  assert.equal(result.text, '{{random::A::B:: }}');
  assert.equal(result.text.slice(result.selectionStart, result.selectionEnd), ' ');
  assert.equal(applySourceEdit('A', planRandomWrap('A', {start:0,end:1})).text, '{{random::A:: }}');
});
test('nested delimiters, adjacent blocks, CRLF and emoji use UTF16 offsets', () => {
  const text = '😀\r\n{{random::A{{getvar::x}}\r\nB::C}}{{random::D::E}}尾';
  const {macros} = scanRandomMacros(text);
  assert.equal(macros.length, 2);
  assert.equal(macros[0].start, 4);
  assert.deepEqual(macros[0].args.map(a=>a.raw), ['A{{getvar::x}}\r\nB','C']);
  const out = applySourceEdit(text, planRandomAppend(text, macros[1])).text;
  assert.equal(out, text.slice(0, macros[1].end-2)+':: '+text.slice(macros[1].end-2));
});
test('identical blocks target their positions and incomplete or legacy blocks remain untouched', () => {
  const text='{{random::A::B}}{{random::A::B}}';
  const nodes=scanRandomMacros(text).macros;
  assert.equal(applySourceEdit(text,planRandomAppend(text,nodes[1])).text,'{{random::A::B}}{{random::A::B:: }}');
  assert.equal(scanRandomMacros('{{random A,B}} {{random::A').macros.length,0);
  assert.ok(scanMacroSource('{{outer::{{getvar::x}}').issues.length);
  assert.throws(()=>planRandomAppend('{{random::A',0));
});
test('wrap rejects partial macros, cross-block selections, top-level delimiters and existing random', () => {
  for (const [text,start,end] of [['{{getvar::x}}',1,7],['{{random::A}}{{random::B}}',0,26],['A::B',0,4],['{{random::A}}',10,11],['',0,0]]) {
    assert.throws(()=>planRandomWrap(text,{start,end}));
  }
  const t='x{{getvar::k}}y';
  assert.equal(applySourceEdit(t,planRandomWrap(t,{start:0,end:t.length})).text,'{{random::x{{getvar::k}}y:: }}');
});
test('stale plans and malformed edit ranges are rejected', () => {
  const plan=planRandomWrap('A',{start:0,end:1});
  assert.throws(()=>applySourceEdit('B',plan));
  assert.throws(()=>applySourceEdit('A',{...plan,start:-1}));
});
test('scanner reports unmatched shells and keeps child and argument source ranges', () => {
  const text='}} {{RANDOM::{{getvar::x}}:: }}';
  const scan=scanMacroSource(text);
  assert.equal(scan.issues[0].start,0);
  const node=scan.nodes[0];
  assert.equal(node.name,'random');
  assert.equal(node.children[0].raw,'{{getvar::x}}');
  assert.equal(text.slice(node.args[0].start,node.args[0].end),node.args[0].raw);
});
test('nested random has independent candidates and unfinished parent disables child shortcuts', () => {
  const t='{{random::{{random::A::B}}::C}}';
  const {macros}=scanRandomMacros(t);
  assert.equal(macros.length,2);
  assert.deepEqual(macros[0].args.map(a=>a.raw),['{{random::A::B}}','C']);
  assert.equal(scanRandomMacros('{{outer::{{random::A::B}}').macros.length,0);
  assert.equal(applySourceEdit('😀A\r\n尾',planRandomWrap('😀A\r\n尾',{start:2,end:5})).text,'😀{{random::A\r\n:: }}尾');
});
test('unsafe delimiter and shell splice boundaries reject without changing source', () => {
  for (const text of ['A:']) {
    assert.throws(()=>planRandomWrap(text,{start:0,end:text.length}), error => error.code === 'random-edit-unsafe-boundary' && /无法无损/.test(error.message));
  }
  const text='{{random::A:}}';
  assert.throws(()=>planRandomAppend(text,0), error => error.code === 'random-edit-unsafe-boundary');
  assert.deepEqual(scanRandomMacros(text).macros[0].args.map(a=>a.raw),['A:']);
  assert.throws(()=>planRandomWrap('{A',{start:1,end:2}), error => error.code === 'random-edit-unsafe-boundary');
});
test('safe splice boundaries retain original candidates and one new space candidate', () => {
  const text='{{random::A::::B}}';
  const out=applySourceEdit(text,planRandomAppend(text,0)).text;
  assert.deepEqual(scanRandomMacros(out).macros[0].args.map(a=>a.raw),['A','','B',' ']);
  const source='{x A}';
  const wrapped=applySourceEdit(source,planRandomWrap(source,{start:3,end:4})).text;
  assert.equal(wrapped,'{x {{random::A:: }}}');
  assert.deepEqual(scanRandomMacros(wrapped).macros[0].args.map(a=>a.raw),['A',' ']);
  const endingBrace=applySourceEdit('A}',planRandomWrap('A}',{start:0,end:2})).text;
  assert.deepEqual(scanRandomMacros(endingBrace).macros[0].args.map(a=>a.raw),['A}',' ']);
});
