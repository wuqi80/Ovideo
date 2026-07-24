import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../services/taskRegistry';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function registerCompletedTask(registry: TaskRegistry, taskId: string) {
  registry.register({
    taskId,
    kind: 'script-segment',
    title: taskId,
    targetPage: 'script',
  });
  registry.complete(taskId);
}

describe('TaskRegistry user scope', () => {
  it('does not rehydrate another account task cache', () => {
    const storage = new MemoryStorage();
    const yuanRegistry = new TaskRegistry(storage);
    yuanRegistry.setUserScope('Yuan');
    registerCompletedTask(yuanRegistry, 'yuan-task');

    const wuqiRegistry = new TaskRegistry(storage);
    wuqiRegistry.setUserScope('wuqi80');
    expect(wuqiRegistry.rehydrate()).toEqual([]);

    const restoredYuanRegistry = new TaskRegistry(storage);
    restoredYuanRegistry.setUserScope('Yuan');
    expect(restoredYuanRegistry.rehydrate().map(task => task.taskId)).toEqual(['yuan-task']);
  });

  it('ignores and removes the legacy cache without an account namespace', () => {
    const storage = new MemoryStorage();
    storage.setItem('h-my2:task-registry:v1', JSON.stringify({
      active: [],
      done: [{ taskId: 'legacy-other-user-task' }],
    }));

    const registry = new TaskRegistry(storage);
    registry.setUserScope('wuqi80');

    expect(registry.rehydrate()).toEqual([]);
    expect(storage.getItem('h-my2:task-registry:v1')).toBeNull();
  });
});
