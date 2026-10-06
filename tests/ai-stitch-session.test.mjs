// 生成取消/过期与保存失败必须保留材料和名称。
import test from 'node:test';import assert from 'node:assert/strict';
import {createStitchSession} from '../src/features/preset/ai-stitch/session.js';
test('修改输入后迟到结果被丢弃，取消不清空材料',()=>{const s=createStitchSession({side:'new',name:'主',baseline:{prompts:[]}});s.sources.push({id:'s',content:'原文'});let token=s.begin();s.touch();assert.equal(s.accept(token,{items:[]}),false);assert.equal(s.sources[0].content,'原文');token=s.begin();s.cancel();assert.equal(s.accept(token,{}),false);assert.match(s.name,/主-AI缝合/);});
test('同一生成不能重复开始，失败保留输入',()=>{const s=createStitchSession({side:'old',name:'主',baseline:{}});s.sources.push({id:'s',content:'原文'});s.guidance='指导';const name=s.name;s.begin();assert.throws(()=>s.begin(),/已有任务/);s.cancel();assert.equal(s.status,'idle');assert.deepEqual(s.sources,[{id:'s',content:'原文'}]);assert.equal(s.guidance,'指导');assert.equal(s.name,name);});
test('重新生成立即使旧方案失效',()=>{const s=createStitchSession({side:'old',name:'主',baseline:{}});s.plan={items:[]};s.begin();assert.equal(s.plan,null);});
