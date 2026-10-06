// 虚拟时钟验证真实生成截止时间，避免等待数分钟且不调用外部服务。
import test from 'node:test';import assert from 'node:assert/strict';
import {stitchTimeoutMs,createStitchDeadline,stitchAbortMessage} from '../src/features/preset/ai-stitch/timeout.js';
test('默认长请求超过旧120秒仍等待，到15分钟才超时',t=>{t.mock.timers.enable({apis:['setTimeout']});const d=createStitchDeadline();t.mock.timers.tick(121000);assert.equal(d.controller.signal.aborted,false);t.mock.timers.tick(779000);assert.equal(d.controller.signal.aborted,true);assert.match(stitchAbortMessage(d.controller.signal),/等待超时/);d.dispose();});
test('用户等待时间生效，取消与超时提示分开，清理停止计时',t=>{t.mock.timers.enable({apis:['setTimeout']});const d=createStitchDeadline(30);t.mock.timers.tick(900000);assert.equal(d.controller.signal.aborted,false);d.controller.abort();assert.match(stitchAbortMessage(d.controller.signal),/手动取消/);d.dispose();const done=createStitchDeadline(1);done.dispose();t.mock.timers.tick(60000);assert.equal(done.controller.signal.aborted,false);});
test('非法等待值被拒绝，RPC可使用同一时限加余量',()=>{for(const v of [0,61,NaN,Infinity,'15'])assert.throws(()=>stitchTimeoutMs(v));assert.equal(stitchTimeoutMs(60)+30000,3630000);});
