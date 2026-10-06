// 名称搜索兼容中文/大小写且不改快照和绑定数据。
import test from 'node:test';import assert from 'node:assert/strict';
import {searchSnapshotNames} from '../src/features/snapshot/ui/snapshot-panel.js';
test('快照名称搜索支持中文、大小写、空白和无匹配，原数据不变',()=>{const snapshots=[{id:'a',name:'日常 Alpha',associations:{characters:['legacy']}},{id:'b',name:'战斗 Beta'},{id:'c',name:'日常 Gamma'}],before=structuredClone(snapshots);assert.deepEqual(searchSnapshotNames(snapshots,'日常').map(s=>s.id),['a','c']);assert.deepEqual(searchSnapshotNames(snapshots,' ALPHA ').map(s=>s.id),['a']);assert.deepEqual(searchSnapshotNames(snapshots,'不存在'),[]);assert.deepEqual(searchSnapshotNames(snapshots,'  '),snapshots);assert.deepEqual(snapshots,before);});
