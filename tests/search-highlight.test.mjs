// 正文搜索回归：字面量/Unicode、原文保真、diff 跨片段/跨行和安全 DOM 渲染。
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRows, diffLines} from '../src/core.js';
import {findSearchRanges, normalizeSearchQuery, plainSearchRows, buildSearchRows, appendSearchText} from '../src/ui/search-highlight.js';

test('literal search trims query, ignores case and never treats punctuation as a regex',()=>{
  assert.equal(normalizeSearchQuery('  HeLLo  '),'hello');
  assert.deepEqual(findSearchRanges('Hello HELLO hello',' hello '),[[0,5],[6,11],[12,17]]);
  for(const needle of ['[a]+','.*','${x}','\\','<>&"', '{{getvar::name}}'])assert.deepEqual(findSearchRanges('X'+needle+'Y',needle),[[1,needle.length+1]]);
  assert.deepEqual(findSearchRanges('aaa','aa'),[[0,2]]);
  for(const query of ['', '  ', null, undefined])assert.deepEqual(findSearchRanges('abc',query),[]);
  assert.deepEqual(findSearchRanges('abc','missing'),[]);
});

test('Unicode ranges address original UTF-16 text after case expansion',()=>{
  assert.deepEqual(findSearchRanges('İx İX','x'),[[1,2],[4,5]]);
  assert.deepEqual(findSearchRanges('İx','i'),[[0,1]]);
  assert.deepEqual(findSearchRanges('😀你好😀你好','你好'),[[2,4],[6,8]]);
  assert.deepEqual(findSearchRanges('😀😀','😀'),[[0,2],[2,4]]);
});

const body=rows=>rows.map(r=>r.segs.map(s=>s.text).join('')).join('\n');
const hits=rows=>rows.flatMap(r=>r.segs.filter(s=>s.hit).map(s=>s.text)).join('');

test('plain preview retains blank lines, HTML, macros and CRLF exactly',()=>{
  const text='\r\n<img src=x onerror=alert(1)>&amp;\r\n{{getvar::name}}\n\n';
  const rows=buildSearchRows(plainSearchRows(text),'old','<img');
  assert.equal(body(rows),text);assert.equal(hits(rows),'<img');
  assert.equal(body(buildSearchRows(plainSearchRows(''),'new','x')),'');
});

test('matches cross diff segments without matching text hidden on the other side',()=>{
  const left='你好世界\nHello brave world',right='你好世间\nHello new world';
  const rows=buildRows(diffLines(left,right)),snapshot=structuredClone(rows);
  const old=buildSearchRows(rows,'old','世界');
  assert.equal(hits(old),'世界');assert.equal(body(old),left);
  assert.ok(old[0].segs.some(s=>s.t==='-'&&s.hit));
  assert.ok(old[0].segs.some(s=>s.t===' '&&s.hit));
  assert.equal(hits(buildSearchRows(rows,'new','世界')),'');
  assert.equal(hits(buildSearchRows(rows,'new','Hello new world')),'Hello new world');
  assert.equal(body(buildSearchRows(rows,'new','new')),right);
  assert.deepEqual(rows,snapshot);
});

test('cross-line search and query-only refresh preserve context and diff flags',()=>{
  const rows=buildRows(diffLines('first\nsecond\nremoved','first\nsecond\nadded'));
  assert.equal(hits(buildSearchRows(rows,'old','st\nsec')),'stsec');
  assert.equal(hits(buildSearchRows(rows,'old','removed')),'removed');
  assert.equal(hits(buildSearchRows(rows,'new','added')),'added');
  assert.equal(hits(buildSearchRows(rows,'new','')),'');
  const whole=buildRows(diffLines('only old\nextra',''));
  assert.equal(hits(buildSearchRows(whole,'old','extra')),'extra');
  assert.equal(body(buildSearchRows(whole,'new','extra')),'');
});

test('preview renderer creates text nodes and fixed mark elements, never HTML',()=>{
  const doc={createTextNode:text=>({text}),createElement:tag=>({tag})};
  const children=[],parent={ownerDocument:doc,append:node=>children.push(node)};
  const text='<img onerror=alert(1)> &amp; </mark><script>';
  appendSearchText(parent,text,'</mark>');
  assert.equal(children.map(n=>n.text??n.textContent).join(''),text);
  assert.deepEqual(children.filter(n=>n.tag),[{tag:'mark',className:'pcm-search-hit',textContent:'</mark>'}]);
});

test('long repeated text has bounded non-overlapping hits and reconstructs without loss',()=>{
  const text='needle '.repeat(15000);
  const rows=buildSearchRows(plainSearchRows(text),'old','needle');
  assert.equal(rows[0].segs.filter(s=>s.hit).length,15000);assert.equal(body(rows),text);
});
