'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

/** @brief 在隔离环境执行真实渲染逻辑，记录事件并模拟异步保存回执。 */
function createHarness() {
  const nodes = new Map();
  const pending = [];
  const makeNode = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, events: {}, children: [], value: '', hidden: true,
    addEventListener(name, handler) { (this.events[name] ||= []).push(handler); },
    setAttribute() {}, append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); }, insertBefore(item) { this.children.push(item); }, focus() {},
    querySelector() { return makeNode(); }
  });
  const context = vm.createContext({
    structuredClone, console, requestAnimationFrame() {},
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); },
      addEventListener() {},
      createElement: makeNode
    },
    window: { deskTodo: {
      load: () => new Promise(() => {}), onCommand() {},
      save: (payload) => new Promise((resolve) => pending.push({ payload, resolve }))
    }}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8'), context);
  vm.runInContext(`
    state.data = { activeListId: 'list', lists: [{id:'list',name:'清单'}],
      groups: [{id:'a',listId:'list',name:'A'}, {id:'b',listId:'list',name:'B'}], tasks: [] };
    state.settings = {};
    render = () => {};
  `, context);
  return { context, pending, nodes, run: (code) => vm.runInContext(code, context) };
}

test('保存回执后重复勾选同一个实际任务行，仍更新当前数据', async () => {
  const h = createHarness();
  h.run("const task = addTask('任务', 'a'); const row = renderTask(task); const check = row.children[0];");
  for (const checked of [true, false, true, false]) {
    h.run(`check.checked = ${checked}; check.events.click[0]({stopPropagation(){}});`);
    const request = h.pending.shift();
    request.resolve(structuredClone(request.payload));
    await new Promise(setImmediate);
    assert.equal(h.run('state.data.tasks[0].completed'), checked);
    assert.equal(h.run('state.data.tasks[0] === task'), true);
  }
});

test('旧保存回执不会覆盖保存期间新建的任务', async () => {
  const h = createHarness();
  h.run("addTask('第一条', 'a'); persist(); addTask('第二条', 'a');");
  const request = h.pending.shift();
  assert.equal(request.payload.data.tasks.length, 1);
  request.resolve(request.payload);
  await new Promise(setImmediate);
  assert.equal(h.run('state.data.tasks.length'), 2);
});

test('分组新增入口指定目标分组，拖入分组时父子任务一起迁移', () => {
  const h = createHarness();
  h.run("state.addGroupId = 'b'; elements.quickAddInput.value = 'B内任务'; elements.quickAdd.events.submit[0]({preventDefault(){}});");
  assert.equal(h.run('state.data.tasks[0].groupId'), 'b');
  h.run(`
    const root = addTask('父任务', 'a');
    addTask('子任务', 'a', root.id);
    state.draggedTaskId = root.id;
    const group = renderGroup(state.data.groups[1]);
    group.events.drop[0]({preventDefault(){}});
  `);
  assert.equal(h.run("state.data.tasks.every(task => task.groupId === 'b')"), true);
  assert.equal(h.run('state.data.tasks[2].parentId === root.id'), true);
});

test('主任务和子任务可按目标位置重新排序', () => {
  const h = createHarness();
  h.run(`
    const first = addTask('第一项', 'a');
    const second = addTask('第二项', 'a');
    const childA = addTask('子项A', 'a', first.id);
    const childB = addTask('子项B', 'a', first.id);
    reorderTask(second, first, false);
    reorderTask(childB, childA, false);
  `);
  assert.equal(h.run("JSON.stringify(getOrderedTasks('a').map(task => task.title))"), JSON.stringify(['第二项', '第一项', '子项B', '子项A']));
});
