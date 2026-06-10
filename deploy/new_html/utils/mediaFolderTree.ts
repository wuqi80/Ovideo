/**
 * mediaFolderTree.ts — 素材库文件夹树构建/扁平化工具
 * 后端返回扁平 folder 列表，前端在此建成可嵌套树，并提供下拉用的缩进扁平列表。
 */
import type { MediaFolder } from '../services/mediaLibraryService';

export interface FolderNode extends MediaFolder {
  children: FolderNode[];
}

export interface FlatFolderOption {
  folder_id: string;
  name: string;
  depth: number;
}

/** 把扁平 folder 列表建成树（按 folder_order 再 name 稳定排序）。孤儿节点（父不存在）挂到根。 */
export function buildFolderTree(folders: MediaFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.folder_id, { ...f, children: [] });

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.folder_id)!;
    const parent = f.parent_folder_id ? byId.get(f.parent_folder_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => (a.folder_order - b.folder_order) || a.name.localeCompare(b.name));
    nodes.forEach(n => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** 深度优先扁平化为带缩进深度的列表，供 <select> 下拉显示（前缀缩进由 depth 决定）。 */
export function flattenForSelect(nodes: FolderNode[], depth = 0): FlatFolderOption[] {
  const out: FlatFolderOption[] = [];
  for (const n of nodes) {
    out.push({ folder_id: n.folder_id, name: n.name, depth });
    if (n.children.length) out.push(...flattenForSelect(n.children, depth + 1));
  }
  return out;
}

/** 收集某文件夹自身 + 全部后代的 id（删除确认提示用）。 */
export function collectDescendantIds(node: FolderNode): string[] {
  const ids = [node.folder_id];
  for (const c of node.children) ids.push(...collectDescendantIds(c));
  return ids;
}
