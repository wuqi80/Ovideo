/**
 * adminMenu.ts — 统一后台的一级 / 二级 / 三级菜单配置（单一事实来源）
 *
 * refactor/v2：把原本散落在 4 个台子（/admin Hub、/admin/operations 的 5 tab、
 * AdminFeatureTabs 的 8 子 tab、/admin-legacy 的 4 页）的全部功能，
 * 收拢进一棵层级菜单树，由 AdminSidebar 渲染、AdminLayout 持久承载。
 *
 * 约定：
 *  - 一级（section）：可折叠分组，带图标，本身不跳转。
 *  - 二级（item）：可点击跳转；若带 children 则同时可展开三级。
 *  - 三级（leaf）：带圆点的末级项，点击跳转。
 *  - `to` 形如 `/admin/features?tab=accounts`——同一路由用 query 切面板（组件不卸载、不重复拉数）。
 */

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
      { id: 'dashboard', label: '运营概览', to: '/admin' },
    ],
  },
  {
    id: 'org',
    label: '用户与组织',
    icon: 'Users',
    children: [
      { id: 'accounts', label: '账号管理', to: '/admin/features?tab=accounts' },
      { id: 'permissions', label: '用户权限', to: '/admin/operations?tab=users' },
      { id: 'groups', label: '项目分组', to: '/admin/features?tab=groups' },
      { id: 'organizations', label: '组织管理', to: '/admin/features?tab=organizations' },
    ],
  },
  {
    id: 'credits',
    label: '积分体系',
    icon: 'Coins',
    children: [
      { id: 'credit_rules', label: '积分规则', to: '/admin/features?tab=credit_rules' },
      { id: 'credit_accounts', label: '积分账户', to: '/admin/features?tab=credit_accounts' },
      { id: 'credit_transactions', label: '积分流水', to: '/admin/features?tab=credit_transactions' },
    ],
  },
  {
    id: 'content',
    label: '内容与审计',
    icon: 'ImageIcon',
    children: [
      { id: 'media', label: '素材库管理', to: '/admin/features?tab=media' },
      { id: 'results', label: '生成结果审计', to: '/admin/operations?tab=results' },
      { id: 'audit', label: '审计日志', to: '/admin/features?tab=audit' },
    ],
  },
  {
    id: 'monitor',
    label: '数据监控',
    icon: 'BarChart3',
    children: [
      { id: 'stats', label: '生成统计分析', to: '/admin/operations?tab=stats' },
      { id: 'cluster_monitor', label: '集群节点监控', to: '/admin/operations?tab=system' },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: 'Settings',
    children: [
      {
        id: 'api_model',
        label: 'API 与模型',
        children: [
          { id: 'apiconfig', label: 'API 厂商配置', to: '/admin/settings?item=apiconfig' },
          { id: 'routing', label: '模型路由', to: '/admin/settings?item=routing' },
          { id: 'ratelimit', label: '速率限制', to: '/admin/settings?item=ratelimit' },
        ],
      },
      {
        id: 'gen_cluster',
        label: '生成集群',
        children: [
          { id: 'cluster', label: '集群节点', to: '/admin/settings?item=cluster' },
          { id: 'workflows', label: '工作流模板', to: '/admin/settings?item=workflows' },
        ],
      },
      {
        id: 'rules',
        label: '通知与规则',
        children: [
          { id: 'notify', label: '通知映射', to: '/admin/settings?item=notify' },
        ],
      },
    ],
  },
];

/** 返回当前地址对应的菜单路径（用于顶栏面包屑），如 ['系统设置','API 与模型','API 厂商配置']。 */
export function getActiveTrail(pathname: string, search: string): string[] {
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
