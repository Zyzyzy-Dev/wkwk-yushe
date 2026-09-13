// 源码结构回归：检查相对模块与静态资源路径、用途注释及测试隔离。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('运行源文件用途明确、相对引用有效且不依赖 tests',()=>{
 for(const file of [...files(path.join(root,'src')),path.join(root,'index.js')].filter(f=>/\.(js|css|html)$/.test(f))){
  const text=fs.readFileSync(file,'utf8');assert.match(text.trimStart(),/^(\/\/|\/\*|<!--)/,file);
  for(const [,ref]of text.matchAll(/['"](\.{1,2}\/[^'"\r\n]+)['"]/g)){
   if(!/\.(js|css|html|png)$/.test(ref))continue;
   const target=path.resolve(path.dirname(file),ref);assert.ok(fs.existsSync(target),file+' -> '+ref);
   assert.ok(!target.startsWith(path.join(root,'tests')+path.sep),'runtime imports tests');
  }
 }
});
