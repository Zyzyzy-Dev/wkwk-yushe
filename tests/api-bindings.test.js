// 绑定替换/取消与已启用连接判断回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import {bindApiSnapshot,isApiProfileActive} from '../src/features/api/api-bindings.js';
test('双向绑定保持一对一，替换双方旧配对且不改原数据',()=>{const old=[{apiId:'a',snapshotId:'s'},{apiId:'b',snapshotId:'t'}];assert.deepEqual(bindApiSnapshot(old,'a','t'),[{apiId:'a',snapshotId:'t'}]);assert.equal(old.length,2);assert.deepEqual(bindApiSnapshot(old,'a',null),[{apiId:'b',snapshotId:'t'}]);});
test('已启用必须同时匹配地址、来源、密钥引用和模型',()=>{const p={source:'custom',connection:{custom_url:'https://x/v1'},model:'relay-model',secretId:'key'};assert.ok(isApiProfileActive(p,{...p,connection:{custom_url:'https://x/v1/'}}));for(const patch of [{model:'other'},{secretId:'other'},{source:'openai'},{connection:{custom_url:'https://y/v1'}}])assert.equal(isApiProfileActive(p,{...p,...patch}),false);});
