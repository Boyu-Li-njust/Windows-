'use strict';

const state = {
  data: null,
  settings: null,
  showCompleted: true,
  childEditorParentId: null,
  collapsedTaskIds: new Set(),
  draggedTaskId: null,
  addGroupId: null,
  compact: false
};

const elements = {
  app: document.getElementById('app'),
  titlebar: document.getElementById('titlebar'),
  listTitle: document.getElementById('list-title'),
  taskCount: document.getElementById('task-count'),
  listTabs: document.getElementById('list-tabs'),
  quickAdd: document.getElementById('quick-add'),
  quickAddInput: document.getElementById('quick-add-input'),
  taskBoard: document.getElementById('task-board'),
  saveStatus: document.getElementById('save-status'),
  completedToggle: document.getElementById('completed-toggle'),
  pinButton: document.getElementById('pin-button'),
  lockButton: document.getElementById('lock-button'),
  settingsButton: document.getElementById('settings-button'),
  settingsPopover: document.getElementById('settings-popover'),
  windowMode: document.getElementById('window-mode'),
  opacityRange: document.getElementById('opacity-range'),
  completedBehavior: document.getElementById('completed-behavior'),
  nameDialog: document.getElementById('name-dialog'),
  nameDialogTitle: document.getElementById('name-dialog-title'),
  nameDialogInput: document.getElementById('name-dialog-input'),
  nameDialogConfirm: document.getElementById('name-dialog-confirm'),
  nameDialogCancel: document.getElementById('name-dialog-cancel')
  ,deleteDialog: document.getElementById('delete-dialog')
  ,deleteDialogTitle: document.getElementById('delete-dialog-title')
  ,deleteDialogMessage: document.getElementById('delete-dialog-message')
  ,deleteDialogAction: document.getElementById('delete-dialog-action')
  ,deleteDialogConfirm: document.getElementById('delete-dialog-confirm')
  ,deleteDialogCancel: document.getElementById('delete-dialog-cancel')
  ,startupToggle: document.getElementById('startup-toggle')
  ,shortcutButton: document.getElementById('shortcut-button')
  ,shortcutStatus: document.getElementById('shortcut-status')
  ,listContextMenu: document.getElementById('list-context-menu')
  ,compactButton: document.getElementById('compact-button')
  ,timeDialog: document.getElementById('time-dialog')
  ,timeDialogTask: document.getElementById('time-dialog-task')
  ,taskDueInput: document.getElementById('task-due-input')
  ,timeDialogSave: document.getElementById('time-dialog-save')
  ,timeDialogClear: document.getElementById('time-dialog-clear')
  ,timeDialogCancel: document.getElementById('time-dialog-cancel')
  ,windowContextMenu: document.getElementById('window-context-menu')
};

let pendingNameAction = null;
let pendingDelete = null;
let contextListId = null;
let timeTaskId = null;
let draggedListId = null;

/**
 * @brief 生成不依赖外部服务的本地唯一标识。
 * @param prefix 用于区分任务、分组等数据类型的前缀。
 * @return 带业务前缀的唯一字符串。
 */
function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @brief 返回当前选中清单，异常状态下回退到第一个清单。
 * @return 当前清单对象。
 */
function getActiveList() {
  return state.data.lists.find((list) => list.id === state.data.activeListId) || state.data.lists[0];
}

/**
 * @brief 返回当前清单下的全部分组。
 * @return 分组对象数组。
 */
function getActiveGroups() {
  const activeList = getActiveList();
  return state.data.groups.filter((group) => group.listId === activeList.id);
}

/**
 * @brief 保存任务和窗口状态，并在状态栏反馈结果。
 */
async function persist() {
  elements.saveStatus.textContent = '保存中…';
  try {
    // 保存回执只确认写入，不能替换仍被界面事件引用的对象或覆盖期间的新操作。
    await window.deskTodo.save(structuredClone({ data: state.data, settings: state.settings }));
    elements.saveStatus.textContent = '已保存';
  } catch {
    elements.saveStatus.textContent = '保存失败';
  }
}

/**
 * @brief 在指定分组中创建主任务或子任务，并保持同级顺序稳定。
 * @param title 新任务标题。
 * @param groupId 所属分组标识。
 * @param parentId 父任务标识；主任务传入 null。
 * @return 新创建的任务对象，标题为空时返回 null。
 */
function addTask(title, groupId, parentId = null) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;
  const siblings = state.data.tasks.filter((task) => task.groupId === groupId && task.parentId === parentId);
  const task = {
    id: makeId('task'),
    groupId,
    parentId,
    title: cleanTitle.slice(0, 200),
    completed: false,
    dueAt: null,
    order: siblings.length ? Math.max(...siblings.map((item) => item.order)) + 1 : 0,
    createdAt: Date.now()
  };
  state.data.tasks.push(task);
  return task;
}

/**
 * @brief 获取按主任务和子任务排列的分组任务。
 * @param groupId 分组标识。
 * @return 带层级顺序的任务数组。
 */
function getOrderedTasks(groupId) {
  const source = state.data.tasks.filter((task) => task.groupId === groupId);
  const sorter = (a, b) => a.order - b.order || a.createdAt - b.createdAt;
  const roots = source.filter((task) => !task.parentId).sort(sorter);
  return roots.flatMap((root) => [root, ...source.filter((task) => task.parentId === root.id).sort(sorter)]);
}

/**
 * @brief 渲染清单、分组和任务树的完整当前状态。
 */
function render() {
  elements.app.classList.toggle('compact', state.compact);
    elements.compactButton.textContent = '—';
  elements.compactButton.title = state.compact ? '展开任务框' : '缩小为悬浮条';
  elements.compactButton.setAttribute('aria-label', state.compact ? '展开任务框' : '缩小为悬浮条');
  const activeList = getActiveList();
  elements.listTitle.textContent = activeList.name;
  const visibleTaskIds = new Set(getActiveGroups().flatMap((group) => state.data.tasks.filter((task) => task.groupId === group.id).map((task) => task.id)));
  const pendingCount = state.data.tasks.filter((task) => visibleTaskIds.has(task.id) && !task.completed).length;
  elements.taskCount.textContent = `${pendingCount} 未完成`;
  elements.pinButton.classList.toggle('active', state.settings.alwaysOnTop);
  elements.pinButton.textContent = state.settings.alwaysOnTop ? '◆' : '◇';
  elements.lockButton.classList.toggle('active', state.settings.locked);
  elements.lockButton.textContent = state.settings.locked ? '♜' : '♙';
  elements.windowMode.value = state.settings.alwaysOnTop ? 'top' : 'desktop';
  elements.opacityRange.value = Math.round(state.settings.opacity * 100);
  elements.completedBehavior.value = state.settings.completedBehavior || 'keep';
  elements.completedToggle.textContent = state.showCompleted ? '隐藏已完成' : '显示已完成';

  const listButtons = state.data.lists.map((list) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'list-tab-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.draggable = true;
    button.className = `list-tab${list.id === activeList.id ? ' active' : ''}`;
    button.textContent = list.name;
    button.addEventListener('click', () => {
      state.data.activeListId = list.id;
      render();
      persist();
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openListContextMenu(list.id, event.clientX, event.clientY);
    });
    button.addEventListener('dragstart', (event) => {
      draggedListId = list.id;
      event.dataTransfer.setData('text/plain', list.id);
      event.dataTransfer.effectAllowed = 'move';
      wrapper.classList.add('dragging-list');
    });
    button.addEventListener('dragend', () => {
      draggedListId = null;
      wrapper.classList.remove('dragging-list');
      elements.listTabs.querySelectorAll('.list-tab-wrap').forEach((item) => item.classList.remove('drop-list'));
    });
    wrapper.addEventListener('dragover', (event) => {
      if (!draggedListId || draggedListId === list.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      wrapper.classList.add('drop-list');
    });
    wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drop-list'));
    wrapper.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      wrapper.classList.remove('drop-list');
      if (!draggedListId || draggedListId === list.id) return;
      const fromIndex = state.data.lists.findIndex((item) => item.id === draggedListId);
      const toIndex = state.data.lists.findIndex((item) => item.id === list.id);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = state.data.lists.splice(fromIndex, 1);
      state.data.lists.splice(toIndex, 0, moved);
      draggedListId = null;
      render();
      persist();
    });
    wrapper.append(button);
    return wrapper;
  });
  const addListButton = document.createElement('button');
  addListButton.type = 'button';
  addListButton.className = 'list-tab add-list';
  addListButton.textContent = '＋ 清单';
  addListButton.addEventListener('click', addList);
  elements.listTabs.replaceChildren(...listButtons, addListButton);

  const groups = getActiveGroups();
  elements.taskBoard.replaceChildren(...groups.map(renderGroup));
  if (!groups.some((group) => getOrderedTasks(group.id).some((task) => state.showCompleted || !task.completed))) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '点击分组右侧的 ＋ 添加任务';
    elements.taskBoard.appendChild(empty);
  }
}

/**
 * @brief 创建一个分组区域及其中的任务树 DOM。
 * @param group 需要渲染的分组对象。
 * @return 分组 section 元素。
 */
function renderGroup(group) {
  const section = document.createElement('section');
  section.className = 'group';
  section.dataset.groupId = group.id;
  const hideCompleted = !state.showCompleted || state.settings.completedBehavior === 'hide';
  const tasks = getOrderedTasks(group.id).filter((task) => !hideCompleted || !task.completed);
  section.innerHTML = `<header class="group-header"><span class="group-dot"></span><input class="group-name" maxlength="40"><span>${tasks.filter((task) => !task.completed).length}</span></header>`;
  const nameInput = section.querySelector('.group-name');
  nameInput.value = group.name;
  nameInput.addEventListener('change', () => {
    group.name = nameInput.value.trim() || '未命名分组';
    persist();
  });
  section.querySelector('.group-header').appendChild(makeAction('在此分组新增任务', '＋', () => {
    state.addGroupId = group.id;
    elements.quickAdd.hidden = false;
    section.querySelector('.group-header').after(elements.quickAdd);
    elements.quickAddInput.focus();
  }, 'icon-button'));
  section.querySelector('.group-header').appendChild(makeAction(`管理分组：${group.name}`, '⋯', () => openDeleteDialog('group', group.id), 'group-menu'));
  section.addEventListener('dragover', (event) => {
    if (!state.draggedTaskId) return;
    event.preventDefault();
    section.classList.add('drop-group');
  });
  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget)) section.classList.remove('drop-group');
  });
  section.addEventListener('drop', (event) => {
    event.preventDefault();
    section.classList.remove('drop-group');
    const dragged = state.data.tasks.find((item) => item.id === state.draggedTaskId);
    if (!dragged) return;
    dragged.parentId = null;
    dragged.groupId = group.id;
    state.data.tasks.filter((item) => item.parentId === dragged.id).forEach((child) => { child.groupId = group.id; });
    dragged.order = Math.max(0, ...state.data.tasks.filter((item) => item.groupId === group.id).map((item) => item.order)) + 1;
    render();
    persist();
  });
  if (state.addGroupId === group.id) section.appendChild(elements.quickAdd);

  for (const task of tasks) {
    if (task.parentId && state.collapsedTaskIds.has(task.parentId)) continue;
    section.appendChild(renderTask(task));
    if (state.childEditorParentId === task.id) section.appendChild(renderChildEditor(task));
  }
  return section;
}

/**
 * @brief 创建单个任务行，并绑定完成、编辑、层级和拖拽操作。
 * @param task 需要渲染的任务对象。
 * @return 任务行元素。
 */
function renderTask(task) {
  const row = document.createElement('article');
  const children = state.data.tasks.filter((item) => item.parentId === task.id);
  row.className = `task-row${task.parentId ? ' child' : ''}${task.completed ? ' completed' : ''}`;
  row.draggable = false;
  row.dataset.taskId = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-check';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', `完成任务：${task.title}`);
  const toggleCompletion = () => {
    task.completed = checkbox.checked;
    if (!task.parentId && children.length) children.forEach((child) => { child.completed = checkbox.checked; });
    render();
    persist();
  };
  checkbox.addEventListener('click', (event) => {
    event.stopPropagation();
    // 复选框采用 click 作为唯一状态入口，避免透明窗口中 change 与拖拽事件竞争。
    toggleCompletion();
  });
  checkbox.addEventListener('pointerdown', (event) => event.stopPropagation());

  const content = document.createElement('div');
  content.className = 'task-content';
  const title = document.createElement('input');
  title.className = 'task-title';
  title.maxLength = 200;
  title.value = task.title;
  title.addEventListener('change', () => {
    task.title = title.value.trim() || '未命名任务';
    // 失焦时不要移除下一次点击的复选框，否则鼠标按下和抬起落在不同元素上。
    persist();
  });
  title.addEventListener('keydown', (event) => handleTaskKeydown(event, task));
  content.appendChild(title);
  if (!task.parentId && children.length) {
    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = `${children.filter((child) => child.completed).length}/${children.length} 子任务`;
    content.appendChild(meta);
  }
  if (task.dueAt) {
    const due = document.createElement('span');
    due.className = 'task-meta';
    due.textContent = `时间：${new Date(task.dueAt).toLocaleString()}`;
    content.appendChild(due);
  }

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  const dragHandle = document.createElement('span');
  dragHandle.className = 'task-drag';
  dragHandle.textContent = '⠿';
  dragHandle.title = '拖到分组标题换组，拖到主任务上设为子任务';
  dragHandle.draggable = true;
  actions.appendChild(dragHandle);
  if (!task.parentId) {
    if (children.length) actions.appendChild(makeAction(state.collapsedTaskIds.has(task.id) ? '展开' : '收起', state.collapsedTaskIds.has(task.id) ? '›' : '⌄', () => toggleCollapsed(task.id), 'collapse-button'));
    actions.appendChild(makeAction('添加子任务', '＋', () => openChildEditor(task.id), 'add-child'));
  }
  actions.appendChild(makeAction('删除任务', '×', () => deleteTask(task.id), 'delete-task'));
  row.append(checkbox, content, actions);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openTimeDialog(task);
  });
  bindDragEvents(row, task);
  return row;
}

/**
 * @brief 创建任务行中的语义化操作按钮。
 * @param label 无障碍和悬停提示文字。
 * @param text 按钮显示内容。
 * @param handler 点击处理函数。
 * @param className 按钮样式类名。
 * @return 已绑定事件的按钮元素。
 */
function makeAction(label, text, handler, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = text;
  button.addEventListener('click', handler);
  return button;
}

/**
 * @brief 创建父任务下方的连续子任务输入框。
 * @param parent 父任务对象。
 * @return 子任务输入框元素。
 */
function renderChildEditor(parent) {
  const input = document.createElement('input');
  input.className = 'child-editor';
  input.maxLength = 200;
  input.placeholder = '输入子任务，Enter 继续添加，Esc 结束';
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.childEditorParentId = null;
      render();
    } else if (event.key === 'Enter' && input.value.trim()) {
      event.preventDefault();
      addTask(input.value, parent.groupId, parent.id);
      input.value = '';
      render();
      persist().then(() => requestAnimationFrame(() => document.querySelector('.child-editor')?.focus()));
    }
  });
  requestAnimationFrame(() => input.focus());
  return input;
}

/**
 * @brief 处理任务输入框的 Enter、Tab 与 Shift+Tab 层级快捷操作。
 * @param event 键盘事件。
 * @param task 当前编辑任务。
 */
function handleTaskKeydown(event, task) {
  if (event.key === 'Enter') {
    event.preventDefault();
    task.title = event.currentTarget.value.trim() || '未命名任务';
    const created = addTask('新任务', task.groupId, task.parentId);
    render();
    persist().then(() => requestAnimationFrame(() => {
      const nextInput = document.querySelector(`[data-task-id="${created.id}"] .task-title`);
      nextInput?.focus();
      nextInput?.select();
    }));
    return;
  }
  if (event.key !== 'Tab') return;
  event.preventDefault();
  if (event.shiftKey && task.parentId) {
    task.parentId = null;
  } else if (!event.shiftKey && !task.parentId) {
    const roots = getOrderedTasks(task.groupId).filter((item) => !item.parentId);
    const index = roots.findIndex((item) => item.id === task.id);
    if (index > 0) task.parentId = roots[index - 1].id;
  }
  render();
  persist();
}

/**
 * @brief 绑定拖动任务的反馈和落点逻辑；放到主任务上会成为其子任务。
 * @param row 任务行 DOM。
 * @param task 任务对象。
 */
function bindDragEvents(row, task) {
  row.addEventListener('dragstart', (event) => {
    if (event.target.closest('input, button')) {
      event.preventDefault();
      return;
    }
    state.draggedTaskId = task.id;
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('pointerdown', (event) => {
    if (event.target.closest('input, button')) event.stopPropagation();
  });
  row.addEventListener('dragend', () => {
    state.draggedTaskId = null;
    row.classList.remove('dragging');
  });
  row.addEventListener('dragover', (event) => {
    const dragged = state.data.tasks.find((item) => item.id === state.draggedTaskId);
    if (!dragged || dragged.id === task.id || task.parentId) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('drag-over');
    const dragged = state.data.tasks.find((item) => item.id === state.draggedTaskId);
    if (!dragged || dragged.id === task.id || task.parentId) return;
    if (state.data.tasks.some((item) => item.parentId === dragged.id)) {
      state.data.tasks.filter((item) => item.parentId === dragged.id).forEach((item) => { item.parentId = task.id; item.groupId = task.groupId; });
    }
    dragged.parentId = task.id;
    dragged.groupId = task.groupId;
    render();
    persist();
  });
}

/**
 * @brief 展开指定父任务下方的子任务输入框。
 * @param taskId 父任务标识。
 */
function openChildEditor(taskId) {
  state.childEditorParentId = taskId;
  state.collapsedTaskIds.delete(taskId);
  render();
}

/**
 * @brief 切换父任务子项的折叠状态。
 * @param taskId 父任务标识。
 */
function toggleCollapsed(taskId) {
  if (state.collapsedTaskIds.has(taskId)) state.collapsedTaskIds.delete(taskId);
  else state.collapsedTaskIds.add(taskId);
  render();
}

/**
 * @brief 删除任务；删除父任务时同步删除其直接子任务。
 * @param taskId 待删除任务标识。
 */
function deleteTask(taskId) {
  state.data.tasks = state.data.tasks.filter((task) => task.id !== taskId && task.parentId !== taskId);
  render();
  persist();
}

/**
 * @brief 新建任务清单及其默认分组，并立即切换到新清单。
 */
function addList() {
  openNameDialog('新建清单', (name) => {
    const listId = makeId('list');
    state.data.lists.push({ id: listId, name: name.trim().slice(0, 40) });
    state.data.groups.push({ id: makeId('group'), listId, name: '任务' });
    state.data.activeListId = listId;
    render();
    elements.saveStatus.textContent = `已创建清单：${name.trim()}`;
    persist();
  });
}

/**
 * @brief 显示应用内命名对话框，避免桌面透明窗口中的原生 prompt 无法聚焦。
 * @param title 对话框标题。
 * @param onConfirm 用户确认后的命名回调。
 */
function openNameDialog(title, onConfirm) {
  pendingNameAction = onConfirm;
  elements.nameDialogTitle.textContent = title;
  elements.nameDialogInput.value = '';
  elements.nameDialog.hidden = false;
  requestAnimationFrame(() => elements.nameDialogInput.focus());
}

/**
 * @brief 关闭应用内命名对话框并清理待执行回调。
 */
function closeNameDialog() {
  pendingNameAction = null;
  elements.nameDialog.hidden = true;
}

/** @brief 打开任务时间配置对话框，任务和子任务均可设置。 */
function openTimeDialog(task) {
  timeTaskId = task.id;
  elements.timeDialogTask.textContent = task.title;
  elements.taskDueInput.value = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : '';
  elements.timeDialog.hidden = false;
  elements.taskDueInput.focus();
}

function closeTimeDialog() {
  timeTaskId = null;
  elements.timeDialog.hidden = true;
}

/** @brief 打开紧凑悬浮条的右键窗口设置菜单。 */
function openWindowContextMenu(x, y) {
  const bounds = elements.app.getBoundingClientRect();
  elements.windowContextMenu.style.left = `${Math.max(4, Math.min(x - bounds.left, bounds.width - 155))}px`;
  elements.windowContextMenu.style.top = `${Math.max(4, Math.min(y - bounds.top, bounds.height - 110))}px`;
  elements.windowContextMenu.hidden = false;
}

/** @brief 显示清单右键菜单，并限制菜单位置在组件范围内。 */
function openListContextMenu(listId, x, y) {
  contextListId = listId;
  const bounds = elements.app.getBoundingClientRect();
  elements.listContextMenu.style.left = `${Math.max(4, Math.min(x - bounds.left, bounds.width - 150))}px`;
  elements.listContextMenu.style.top = `${Math.max(4, Math.min(y - bounds.top, bounds.height - 78))}px`;
  elements.listContextMenu.hidden = false;
}

function closeListContextMenu() {
  contextListId = null;
  elements.listContextMenu.hidden = true;
}

/** @brief 打开清单或分组删除确认框，并准备可用的任务处理方式。 */
function openDeleteDialog(type, id) {
  const item = type === 'list' ? state.data.lists.find((entry) => entry.id === id) : state.data.groups.find((entry) => entry.id === id);
  if (!item) return;
  const groupIds = type === 'list' ? state.data.groups.filter((group) => group.listId === id).map((group) => group.id) : [id];
  const taskCount = state.data.tasks.filter((task) => groupIds.includes(task.groupId)).length;
  if ((type === 'list' && state.data.lists.length <= 1) || (type === 'group' && state.data.groups.filter((group) => group.listId === getActiveList().id).length <= 1)) {
    elements.saveStatus.textContent = `至少保留一个${type === 'list' ? '清单' : '分组'}`;
    return;
  }
  pendingDelete = { type, id };
  elements.deleteDialogConfirm.textContent = '确认删除';
  elements.deleteDialogTitle.textContent = `删除${type === 'list' ? '清单' : '分组'}`;
  elements.deleteDialogMessage.textContent = `“${item.name}”包含 ${taskCount} 个任务。请选择任务处理方式。`;
  const targets = type === 'list' ? state.data.lists.filter((list) => list.id !== id) : state.data.groups.filter((group) => group.id !== id && group.listId === getActiveList().id);
  elements.deleteDialogAction.replaceChildren();
  const trashOption = document.createElement('option');
  trashOption.value = 'trash';
  trashOption.textContent = '删除任务并放入回收站';
  elements.deleteDialogAction.appendChild(trashOption);
  targets.forEach((target) => {
    const moveOption = document.createElement('option');
    moveOption.value = `move:${target.id}`;
    moveOption.textContent = `移动任务到“${target.name}”`;
    elements.deleteDialogAction.appendChild(moveOption);
  });
  elements.deleteDialog.hidden = false;
}

/** @brief 执行确认后的清单或分组删除，并保留回收站快照。 */
function confirmDelete() {
  if (!pendingDelete) return;
  const { type, id } = pendingDelete;
  const item = type === 'list' ? state.data.lists.find((entry) => entry.id === id) : state.data.groups.find((entry) => entry.id === id);
  const groupIds = type === 'list' ? state.data.groups.filter((group) => group.listId === id).map((group) => group.id) : [id];
  const taskIds = new Set(state.data.tasks.filter((task) => groupIds.includes(task.groupId)).map((task) => task.id));
  const action = elements.deleteDialogAction.value;
  const record = {
    id: makeId('trash'), deletedAt: Date.now(), sourceType: type,
    lists: type === 'list' ? [structuredClone(item)] : [],
    groups: structuredClone(state.data.groups.filter((group) => groupIds.includes(group.id))),
    tasks: structuredClone(state.data.tasks.filter((task) => taskIds.has(task.id))),
    moved: action.startsWith('move:')
  };
  state.data.trash ||= [];
  state.data.trash.push(record);
  if (action.startsWith('move:')) {
    const targetId = action.slice(5);
    if (type === 'list') {
      // 移动整个分组，任务仍引用原分组，父子关系也保持不变。
      state.data.groups.filter((group) => groupIds.includes(group.id)).forEach((group) => { group.listId = targetId; });
    } else {
      state.data.tasks.filter((task) => taskIds.has(task.id)).forEach((task) => { task.groupId = targetId; });
    }
  }
  state.data.tasks = state.data.tasks.filter((task) => !taskIds.has(task.id) || action.startsWith('move:'));
  if (type === 'list') {
    state.data.groups = state.data.groups.filter((group) => group.listId !== id);
    state.data.lists = state.data.lists.filter((list) => list.id !== id);
    if (state.data.activeListId === id) state.data.activeListId = state.data.lists[0].id;
  } else state.data.groups = state.data.groups.filter((group) => group.id !== id);
  pendingDelete = null;
  elements.deleteDialog.hidden = true;
  render();
  elements.saveStatus.textContent = `已删除${type === 'list' ? '清单' : '分组'}`;
  persist();
  showUndo(record.id);
}

/** @brief 为最近删除提供十秒撤销入口；超时后仍可从回收站恢复。 @param id 删除记录标识。 */
function showUndo(id) {
  const button = document.getElementById('undo-delete');
  button.hidden = false;
  button.onclick = () => restoreDeleted(id);
  setTimeout(() => { if (button.dataset.recordId === id) button.hidden = true; }, 10000);
  button.dataset.recordId = id;
}

/** @brief 恢复删除记录中的容器及任务；迁移任务仅恢复归属，保留后续编辑。 @param id 删除记录标识。 */
function restoreDeleted(id) {
  const record = (state.data.trash || []).find((entry) => entry.id === id);
  if (!record?.groups) return;
  for (const list of record.lists) {
    if (!state.data.lists.some((entry) => entry.id === list.id)) state.data.lists.push(list);
  }
  for (const group of record.groups) {
    if (!state.data.lists.some((entry) => entry.id === group.listId)) group.listId = getActiveList().id;
    const existing = state.data.groups.find((entry) => entry.id === group.id);
    if (existing) existing.listId = group.listId;
    else state.data.groups.push(group);
  }
  for (const task of record.tasks) {
    const existing = state.data.tasks.find((entry) => entry.id === task.id);
    if (existing && record.moved) { existing.groupId = task.groupId; existing.parentId = task.parentId; }
    else if (!existing) state.data.tasks.push(task);
  }
  state.data.trash = state.data.trash.filter((entry) => entry.id !== id);
  document.getElementById('undo-delete').hidden = true;
  render();
  persist();
}

/** @brief 在应用内列出可恢复的删除记录。 */
function openTrash() {
  pendingDelete = null;
  elements.deleteDialogTitle.textContent = '回收站';
  elements.deleteDialogMessage.textContent = '选择需要恢复的清单或分组。';
  elements.deleteDialogAction.replaceChildren();
  for (const record of state.data.trash || []) {
    if (!record.groups) continue;
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = (record.lists[0] || record.groups[0]).name;
    elements.deleteDialogAction.appendChild(option);
  }
  elements.deleteDialogConfirm.textContent = '恢复';
  elements.deleteDialog.hidden = false;
}

/**
 * @brief 关闭分组内的临时新增任务输入框，并清理未提交内容。
 */
function closeGroupQuickAdd() {
  state.addGroupId = null;
  elements.quickAddInput.value = '';
  elements.quickAdd.hidden = true;
  elements.app.insertBefore(elements.quickAdd, elements.taskBoard);
}

elements.quickAdd.addEventListener('submit', (event) => {
  event.preventDefault();
  const group = getActiveGroups().find((item) => item.id === state.addGroupId);
  if (!group || !addTask(elements.quickAddInput.value, group.id)) return;
  closeGroupQuickAdd();
  render();
  persist();
});

// 清单栏使用横向布局，鼠标滚轮转换为横向滚动，避免清单数量增加后被截断。
elements.listTabs.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  elements.listTabs.scrollLeft += event.deltaY;
}, { passive: false });

// 点击分组新增框以外的位置时，关闭这个临时输入框。
document.addEventListener('pointerdown', (event) => {
  if (!state.addGroupId || elements.quickAdd.hidden) return;
  if (!elements.quickAdd.contains(event.target)) closeGroupQuickAdd();
});

elements.completedToggle.addEventListener('click', () => {
  state.showCompleted = !state.showCompleted;
  elements.completedToggle.textContent = state.showCompleted ? '隐藏已完成' : '显示已完成';
  render();
});
elements.pinButton.addEventListener('click', () => { state.settings.alwaysOnTop = !state.settings.alwaysOnTop; render(); persist(); });
elements.lockButton.addEventListener('click', () => { state.settings.locked = !state.settings.locked; render(); persist(); });
elements.settingsButton.addEventListener('click', () => { elements.settingsPopover.hidden = !elements.settingsPopover.hidden; });
elements.compactButton.addEventListener('click', () => {
  state.compact = !state.compact;
  if (state.compact) state.settings.alwaysOnTop = true;
  window.deskTodo.setCompact(state.compact);
  render();
  persist();
});
elements.titlebar.addEventListener('dblclick', (event) => {
  if (!state.compact || event.target.closest('button')) return;
  state.compact = false;
  window.deskTodo.setCompact(false);
  render();
  persist();
});
// 图标本身单独监听双击，避免 Chromium 将紧凑窗口的拖拽区域吞掉双击事件。
document.getElementById('floating-icon-wrap').addEventListener('dblclick', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!state.compact) return;
  state.compact = false;
  window.deskTodo.setCompact(false);
  render();
  persist();
});
// 紧凑图标采用自定义位移，避免原生拖拽区域吞掉右键、双击和悬停事件。
let floatingDrag = null;
document.getElementById('floating-icon-wrap').addEventListener('pointerdown', async (event) => {
  if (!state.compact || event.button !== 0 || state.settings.locked) return;
  event.preventDefault();
  const drag = { startX: event.screenX, startY: event.screenY, x: 0, y: 0, frame: 0, nextX: 0, nextY: 0, ready: false };
  floatingDrag = drag;
  event.currentTarget.setPointerCapture(event.pointerId);
  const [x, y] = await window.deskTodo.getWindowPosition();
  if (floatingDrag !== drag) return;
  drag.x = drag.nextX = x;
  drag.y = drag.nextY = y;
  drag.ready = true;
});
document.getElementById('floating-icon-wrap').addEventListener('pointermove', (event) => {
  if (!floatingDrag || !floatingDrag.ready) return;
  floatingDrag.nextX = floatingDrag.x + event.screenX - floatingDrag.startX;
  floatingDrag.nextY = floatingDrag.y + event.screenY - floatingDrag.startY;
  if (!floatingDrag.frame) {
    floatingDrag.frame = requestAnimationFrame(() => {
      if (!floatingDrag) return;
      window.deskTodo.setWindowPosition(floatingDrag.nextX, floatingDrag.nextY);
      floatingDrag.frame = 0;
    });
  }
});
document.getElementById('floating-icon-wrap').addEventListener('pointerup', () => { floatingDrag = null; });
document.getElementById('floating-icon-wrap').addEventListener('pointercancel', () => { floatingDrag = null; });
  elements.app.addEventListener('contextmenu', (event) => {
    if (state.compact && event.target.closest('.titlebar')) {
      event.preventDefault();
      window.deskTodo.showWindowMenu();
    }
  });
elements.timeDialogSave.addEventListener('click', () => {
  const task = state.data.tasks.find((item) => item.id === timeTaskId);
  if (task) task.dueAt = elements.taskDueInput.value ? new Date(elements.taskDueInput.value).toISOString() : null;
  closeTimeDialog();
  render();
  persist();
});
elements.timeDialogClear.addEventListener('click', () => { elements.taskDueInput.value = ''; });
elements.timeDialogCancel.addEventListener('click', closeTimeDialog);
elements.windowContextMenu.addEventListener('click', (event) => {
  const mode = event.target.closest('button')?.dataset.mode;
  if (mode === 'top') state.settings.alwaysOnTop = true;
  if (mode === 'desktop') state.settings.alwaysOnTop = false;
  if (mode === 'opacity') elements.settingsPopover.hidden = false;
  elements.windowContextMenu.hidden = true;
  render();
  persist();
});
document.getElementById('hide-button').addEventListener('click', () => window.deskTodo.quit());
document.getElementById('add-group-button').addEventListener('click', () => {
  openNameDialog('新建分组', (name) => {
    state.data.groups.push({ id: makeId('group'), listId: getActiveList().id, name: name.trim().slice(0, 40) });
    render();
    elements.saveStatus.textContent = `已创建分组：${name.trim()}`;
    persist();
  });
});
elements.nameDialogConfirm.addEventListener('click', () => {
  const name = elements.nameDialogInput.value.trim();
  if (!name || !pendingNameAction) return;
  const action = pendingNameAction;
  closeNameDialog();
  action(name);
});
elements.nameDialogCancel.addEventListener('click', closeNameDialog);
elements.deleteDialogConfirm.addEventListener('click', () => {
  if (pendingDelete) confirmDelete();
  else { restoreDeleted(elements.deleteDialogAction.value); elements.deleteDialog.hidden = true; }
});
document.getElementById('open-trash').addEventListener('click', openTrash);
elements.deleteDialogCancel.addEventListener('click', () => { pendingDelete = null; elements.deleteDialog.hidden = true; });
elements.listContextMenu.addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  const list = state.data.lists.find((item) => item.id === contextListId);
  if (!action || !list) return closeListContextMenu();
  closeListContextMenu();
  if (action === 'delete') openDeleteDialog('list', list.id);
  if (action === 'rename') openNameDialog('重命名清单', (name) => {
    list.name = name.trim().slice(0, 40);
    render();
    persist();
  });
});
document.addEventListener('pointerdown', (event) => {
  if (!elements.listContextMenu.hidden && !elements.listContextMenu.contains(event.target)) closeListContextMenu();
  if (!elements.settingsPopover.hidden && !elements.settingsPopover.contains(event.target) && event.target !== elements.settingsButton) elements.settingsPopover.hidden = true;
  if (!elements.windowContextMenu.hidden && !elements.windowContextMenu.contains(event.target)) elements.windowContextMenu.hidden = true;
  if (!elements.timeDialog.hidden && !elements.timeDialog.contains(event.target)) closeTimeDialog();
});
elements.nameDialogInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') elements.nameDialogConfirm.click();
  if (event.key === 'Escape') closeNameDialog();
});
elements.windowMode.addEventListener('change', () => { state.settings.alwaysOnTop = elements.windowMode.value === 'top'; render(); persist(); });
elements.opacityRange.addEventListener('input', () => { state.settings.opacity = Number(elements.opacityRange.value) / 100; persist(); });
elements.completedBehavior.addEventListener('change', () => {
  state.settings.completedBehavior = elements.completedBehavior.value;
  render();
  persist();
});
elements.startupToggle.addEventListener('change', async () => {
  const enabled = await window.deskTodo.setStartup(elements.startupToggle.checked);
  elements.startupToggle.checked = enabled;
  elements.saveStatus.textContent = enabled ? '已设置开机自启动' : '已关闭开机自启动';
});
elements.shortcutButton.addEventListener('click', async () => {
  const result = await window.deskTodo.createShortcut();
  elements.shortcutStatus.textContent = result.created ? '桌面快捷方式已创建' : '快捷方式创建失败';
});
window.deskTodo.onCommand((command) => {
  if (command === 'focus-add') {
    const group = document.querySelector('[data-group-id] .icon-button');
    if (state.addGroupId && elements.quickAdd.isConnected) elements.quickAddInput.focus();
    else group?.focus();
  }
  if (command === 'toggle-always-on-top') { state.settings.alwaysOnTop = !state.settings.alwaysOnTop; render(); persist(); }
  if (command === 'set-top') { state.settings.alwaysOnTop = true; render(); persist(); }
  if (command === 'set-desktop') { state.settings.alwaysOnTop = false; render(); persist(); }
  if (command.startsWith('set-opacity:')) { state.settings.opacity = Number(command.slice(12)); render(); persist(); }
  if (command === 'restore-window' && state.compact) {
    state.compact = false;
    window.deskTodo.setCompact(false);
    render();
    persist();
  }
});

window.deskTodo.load().then((store) => {
  state.data = store.data;
  state.settings = store.settings;
  render();
  window.deskTodo.getStartup().then((enabled) => { elements.startupToggle.checked = enabled; });
});
