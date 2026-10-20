// WebCrypto 与 HTTP 后备指纹在分块边界、中文及大文本上保持一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contentDigest} from '../src/shared/digest.js';
test('SHA-256 后备与标准实现逐字一致',async()=>{
 for(const value of ['', 'abc', '中文😀\r\n\ud800',...Array.from({length:130},(_,n)=>'a'.repeat(n)),'大预设😀'.repeat(80000)]){
  const expected=createHash('sha256').update(value).digest('hex');assert.equal(await contentDigest(value,null),expected);assert.equal(await contentDigest(value),expected);
 }
});
