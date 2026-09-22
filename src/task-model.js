'use strict';

const DEFAULT_LIST_ID = 'list-inbox';
const DEFAULT_GROUP_ID = 'group-default';

/**
 * @brief 创建首次启动时使用的空白任务数据。
 * @return 包含默认清单、默认分组和空任务集合的数据对象。
 */
function createDefaultData() {
  return {
    version: 1,
    activeListId: DEFAULT_LIST_ID,
    lists: [{ id: DEFAULT_LIST_ID, name: '我的任务' }],
    groups: [{ id: DEFAULT_GROUP_ID, listId: DEFAULT_LIST_ID, name: '任务' }],
    tasks: [],
    trash: []
  };
}

/**
 * @brief 清洗磁盘中的任务数据，避免损坏或旧数据导致界面无法启动。
 * @param input 从本地文件读取的未知数据。
 * @return 可供界面直接使用的任务数据。
 */
function normalizeData(input) {
  const fallback = createDefaultData();
  if (!input || typeof input !== 'object') return fallback;

  const lists = Array.isArray(input.lists)
    ? input.lists.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
    : [];
  if (lists.length === 0) lists.push(...fallback.lists);

  const listIds = new Set(lists.map((item) => item.id));
  const groups = Array.isArray(input.groups)
    ? input.groups.filter((item) => item && typeof item.id === 'string' && listIds.has(item.listId))
    : [];
  if (groups.length === 0) {
    groups.push({ ...fallback.groups[0], listId: lists[0].id });
  }

  const groupIds = new Set(groups.map((item) => item.id));
  const tasks = Array.isArray(input.tasks)
    ? input.tasks.filter((task) => task && typeof task.id === 'string' && typeof task.title === 'string' && groupIds.has(task.groupId))
    : [];
  const taskIds = new Set(tasks.map((task) => task.id));

  return {
    version: 1,
    activeListId: listIds.has(input.activeListId) ? input.activeListId : lists[0].id,
    lists,
    groups,
    tasks: tasks.map((task, index) => ({
      id: task.id,
      groupId: task.groupId,
      parentId: taskIds.has(task.parentId) && task.parentId !== task.id ? task.parentId : null,
      title: task.title.trim() || '未命名任务',
      completed: Boolean(task.completed),
      dueAt: typeof task.dueAt === 'string' ? task.dueAt : null,
      order: Number.isFinite(task.order) ? task.order : index,
      createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now()
    })),
    trash: Array.isArray(input.trash) ? input.trash.filter((item) => item && typeof item.id === 'string') : []
  };
}

/**
 * @brief 返回某个分组中按层级和顺序排列的任务，最多保留主任务与子任务两层。
 * @param data 标准化后的任务数据。
 * @param groupId 需要排序的分组标识。
 * @return 适合直接渲染的扁平任务数组。
 */
function getOrderedTasks(data, groupId) {
  const source = data.tasks.filter((task) => task.groupId === groupId);
  const byOrder = (a, b) => a.order - b.order || a.createdAt - b.createdAt;
  const roots = source.filter((task) => !task.parentId).sort(byOrder);
  const children = new Map();
  source.filter((task) => task.parentId).sort(byOrder).forEach((task) => {
    if (!children.has(task.parentId)) children.set(task.parentId, []);
    children.get(task.parentId).push(task);
  });
  return roots.flatMap((root) => [root, ...(children.get(root.id) || [])]);
}

module.exports = { createDefaultData, normalizeData, getOrderedTasks };
