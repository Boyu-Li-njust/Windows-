'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDefaultData, normalizeData, getOrderedTasks } = require('../src/task-model');

test('默认数据包含可立即使用的清单和分组', () => {
  const data = createDefaultData();
  assert.equal(data.lists.length, 1);
  assert.equal(data.groups.length, 1);
  assert.equal(data.tasks.length, 0);
  assert.equal(data.activeListId, data.lists[0].id);
});

test('损坏的数据会回退到安全默认值', () => {
  const data = normalizeData({ lists: [], groups: [], tasks: [{ title: 1 }] });
  assert.equal(data.lists.length, 1);
  assert.equal(data.groups.length, 1);
  assert.deepEqual(data.tasks, []);
});

test('旧分组数据会补齐可持久化的排序字段', () => {
  const data = normalizeData({
    activeListId: 'list',
    lists: [{ id: 'list', name: '清单' }],
    groups: [{ id: 'b', listId: 'list', name: 'B' }, { id: 'a', listId: 'list', name: 'A' }],
    tasks: []
  });
  assert.deepEqual(data.groups.map((group) => group.order), [0, 1]);
});

test('任务按主任务后紧跟子任务的顺序返回', () => {
  const data = createDefaultData();
  const groupId = data.groups[0].id;
  data.tasks = [
    { id: 'child', groupId, parentId: 'root', title: '子任务', completed: false, order: 0, createdAt: 2 },
    { id: 'other', groupId, parentId: null, title: '第二项', completed: false, order: 1, createdAt: 3 },
    { id: 'root', groupId, parentId: null, title: '第一项', completed: false, order: 0, createdAt: 1 }
  ];
  assert.deepEqual(getOrderedTasks(data, groupId).map((task) => task.id), ['root', 'child', 'other']);
});

test('任务完成状态可以反复切换，且父任务可同步撤回子任务', () => {
  const data = createDefaultData();
  const groupId = data.groups[0].id;
  data.tasks = [
    { id: 'root', groupId, parentId: null, title: '主任务', completed: false, order: 0, createdAt: 1 },
    { id: 'child', groupId, parentId: 'root', title: '子任务', completed: false, order: 0, createdAt: 2 }
  ];
  data.tasks[0].completed = true;
  data.tasks[1].completed = true;
  data.tasks[0].completed = false;
  data.tasks[1].completed = false;
  assert.equal(data.tasks[0].completed, false);
  assert.equal(data.tasks[1].completed, false);
});
