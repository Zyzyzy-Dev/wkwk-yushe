// Reject names before native filename sanitization can redirect a write to another template.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReasoningTemplateName} from '../src/host/reasoning-templates.js';
test('template names cannot collide after control stripping, Unicode replacement or UTF-8 truncation',()=>{
  for(const name of ['Keep\u0085me','A\u009fB','中'.repeat(84),'A'.repeat(121),'bad\ud800',' CON ','COM1.txt','NUL','bad/name','bad.',''])assert.throws(()=>validateReasoningTemplateName(name),/模板名称/);
  for(const name of ['Think XML','果实之心','🧊 推理格式','中'.repeat(83)])assert.equal(validateReasoningTemplateName(name),name);
});
