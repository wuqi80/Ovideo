/**
 * adminMenu.ts — 统一后台的一级 / 二级 / 三级菜单配置（单一事实来源）
 *
 * 当前架构：把原本散落的后台功能收拢进一棵层级菜单树，
 * 由 AdminSidebar 渲染、AdminLayout 持久承载。
 *
 * 约定：
 *  - 一级（section）：可折叠分组，带图标，本身不跳转。
 *  - 二级（item）：可点击跳转；若带 children 则同时可展开三级。
 *  - 三级（leaf）：带圆点的末级项，点击跳转。
 *  - 后台入口由 adminRoute.ts 统一提供，避免各组件硬编码。
 */

import { adminPath } from './adminRoute';

export interface MenuLeaf {
  id: string;
  label: string;
  to: string;
}

export interface MenuItem {
  id: string;
  label: string;
  to?: string;          // 二级自身可跳转
  children?: MenuLeaf[]; // 或承载三级
}

export interface MenuSection {
  id: string;
  label: string;
  icon: string;         // lucide 图标名（在 AdminSidebar 内映射成组件）
  children: MenuItem[];
}

export const ADMIN_MENU: MenuSection[] = [
  {
    id: 'overview',
    label: '概览',
    icon: 'LayoutDashboard',
    children: [
      { id: 'dashboard', label: '运营概览', to: adminPath() },
    ],
  },
  {
    id: 'org',
    label: '用户与组织',
    icon: 'Users',
    children: [
      { id: 'accounts', label: '账号管理', to: adminPath('features?tab=accounts') },
      { id: 'permissions', label: '用户权限', to: adminPath('operations?tab=users') },
      { id: 'groups', label: '项目分组', to: adminPath('features?tab=groups') },
      { id: 'organizations', label: '组织管理', to: adminPath('features?tab=organizations') },
    ],
  },
  {
    id: 'credits',
    label: '创作点数体系',
    icon: 'Coins',
    children: [
      { id: 'credit_rules', label: '创作点数规则', to: adminPath('features?tab=credit_rules') },
      { id: 'credit_accounts', label: '创作点数账户', to: adminPath('features?tab=credit_accounts') },
      { id: 'credit_transactions', label: '创作点数台账', to: adminPath('features?tab=credit_transactions') },
      { id: 'recharge_orders', label: '充值台账', to: adminPath('features?tab=recharge_orders') },
    ],
  },
  {
    id: 'content',
    label: '内容与审计',
    icon: 'ImageIcon',
    children: [
      { id: 'media', label: '素材库管理', to: adminPath('features?tab=media') },
      { id: 'recyclebin', label: '文件回收站', to: adminPath('settings?item=recyclebin') },
      { id: 'results', label: '生成结果审计', to: adminPath('operations?tab=results') },
      { id: 'audit', label: '审计日志', to: adminPath('features?tab=audit') },
    ],
  },
  {
    id: 'monitor',
    label: '数据监控',
    icon: 'BarChart3',
    children: [
      { id: 'tasks', label: '任务监控', to: adminPath('settings?item=dashboard') },
      { id: 'stats', label: '生成统计分析', to: adminPath('operations?tab=stats') },
      { id: 'cluster_monitor', label: '集群节点监控', to: adminPath('operations?tab=system') },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: 'Settings',
    children: [
      { id: 'apiconfig', label: 'API 厂商配置', to: adminPath('settings?item=apiconfig') },
      { id: 'cluster', label: '集群节点', to: adminPath('settings?item=cluster') },
      { id: 'workflows', label: '工作流模板', to: adminPath('settings?item=workflows') },
    ],
  },
];

/** 返回当前地址对应的菜单路径（用于顶栏面包屑），如 ['系统设置','API 与模型','API 厂商配置']。 */
export function getActiveTrail(pathname: string, search: string): string[] {
  const cur = new URLSearchParams(search);
  if (pathname === adminPath('settings') && cur.get('item') === 'legacy-apiconfig') {
    return ['系统设置', 'API 厂商配置'];
  }

  for (const sec of ADMIN_MENU) {
    for (const item of sec.children) {
      if (item.to && isToActive(item.to, pathname, search)) return [sec.label, item.label];
      for (const leaf of item.children ?? []) {
        if (isToActive(leaf.to, pathname, search)) return [sec.label, item.label, leaf.label];
      }
    }
  }
  return ['概览', '运营概览'];
}

/** 判断某 `to`（可能带 query）是否对应当前地址。 */
export function isToActive(to: string, pathname: string, search: string): boolean {
  const [toPath, toQuery] = to.split('?');
  if (toPath !== pathname) return false;
  if (!toQuery) {
    // 无 query 的项（如 /admin 概览）要求当前也无关键 query
    return true;
  }
  const cur = new URLSearchParams(search);
  const want = new URLSearchParams(toQuery);
  for (const [k, v] of want.entries()) {
    if (cur.get(k) !== v) return false;
  }
  return true;
}
