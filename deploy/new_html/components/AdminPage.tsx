
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ProjectFile, UserAccount, MaterialLibrary, GenerationLog, UserPermissions, ServerNode } from '../types';
import { 
    Users, BarChart3, HardDrive, ShieldCheck, Search, Plus, 
    CheckCircle2, XCircle, Trash2, Edit2, Image as ImageIcon, Database, Server,
    Activity, Lock, Unlock, Zap, Clock, AlertTriangle, Terminal, Filter, ChevronRight, X, Settings, Network, Key,
    Calendar, TrendingUp, PieChart, Play, Loader2, Check
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getUsers, getSystemStats, getGenerationLogs, updateUserPermissions, createUser, deleteUser } from '../services/adminCompatService';
import { apiJson } from '../services/httpClient';
import { AdminFeatureTabs } from './AdminFeatureTabs';
import { formatProcessingNodeName, sanitizeProcessingTerminology } from '../utils/processingTerminology';
import { DEFAULT_SCRIPT_MODEL_OPTIONS } from '../services/scriptModelCatalogService';
import { SELECTABLE_MODELS, getModelDisplayName } from '../services/videoModelService';
import { STORYBOARD_GENERATION_MODEL_OPTIONS } from '../utils/storyboardGenerationModels';
import { PLATFORM_ROLE_OPTIONS, getPlatformRoleLabel, normalizePlatformRole } from '../utils/adminRoles';
import { getAdminRole } from '../admin/adminAuth';
import { formatChinaDateTime } from '../utils/dateTime';

interface AdminPageProps {
    // 2026-05-26：改为可选 — AdminPage 既可被 WorkspaceApp 内嵌（带文件/素材库降级数据），
    // 也可作为后台壳中的独立面板渲染（由后端 API 直接驱动，不需要本地兜底数据）。
    files?: ProjectFile[];
    materialLibrary?: MaterialLibrary;
    // 2026-05-26：embedded 模式 — 在 AdminLayout 内渲染时为 true，
    // 隐藏自身的左 sidebar（由 AdminLayout 接管），改用顶部横向 tab 条。
    embedded?: boolean;
    // 当前架构：统一后台壳通过 embedTab 直接驱动当前面板（菜单点哪个就显示哪个），
    // 同时隐藏 AdminPage 自带的侧栏与页头——避免「后台里又套一个后台」的割裂感。
    embedTab?: 'users' | 'stats' | 'results' | 'system' | 'features';
}

interface ClusterNodesResponse {
    success?: boolean;
    nodes?: Record<string, any> | any[];
    agent_only_mode?: boolean;
    message?: string;
}

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

const pickNumber = (row: any, keys: string[]): number | null => {
    for (const key of keys) {
        const value = toFiniteNumber(row?.[key]);
        if (value !== null) return value;
    }
    return null;
};

const normalizeClusterNodeRows = (nodes: ClusterNodesResponse['nodes']): Array<[string, any]> => {
    if (Array.isArray(nodes)) {
        return nodes.map((row, index) => [String(row?.id ?? row?.node_id ?? `node-${index + 1}`), row || {}]);
    }
    if (nodes && typeof nodes === 'object') {
        return Object.entries(nodes);
    }
    return [];
};

const normalizeClusterNodeStatus = (status: unknown): ServerNode['status'] => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'healthy' || normalized === 'online' || normalized === 'busy') return 'online';
    if (normalized === 'maintenance') return 'maintenance';
    return 'offline';
};

const mapClusterNode = ([nodeId, nodeData]: [string, any]): ServerNode => {
    const storageUsed = pickNumber(nodeData, ['storage_used', 'storageUsed', 'storage_used_gb', 'disk_used_gb']);
    const storageTotal = pickNumber(nodeData, ['storage_total', 'storageTotal', 'storage_total_gb', 'disk_total_gb']);
    const gpuUsage = pickNumber(nodeData, ['gpu_usage', 'gpuUsage', 'gpu_load', 'gpuLoad']);
    return {
        id: String(nodeData?.id ?? nodeData?.node_id ?? nodeId),
        name: formatProcessingNodeName(nodeData?.name ?? nodeData?.id ?? nodeId),
        status: normalizeClusterNodeStatus(nodeData?.status),
        ip: String(nodeData?.host ?? nodeData?.ip ?? nodeData?.url ?? '未上报'),
        storageUsed: storageUsed ?? 0,
        storageTotal: storageTotal ?? 0,
        gpuUsage: gpuUsage ?? -1,
    };
};

const MODEL_OPTIONS = Array.from(new Map([
    ...DEFAULT_SCRIPT_MODEL_OPTIONS.map(option => ({ value: String(option.value), label: option.label })),
    ...STORYBOARD_GENERATION_MODEL_OPTIONS.map(option => ({ value: option.value, label: option.label })),
    ...SELECTABLE_MODELS.map(model => ({ value: model, label: getModelDisplayName(model) })),
].map(option => [option.value, option])).values());

const formatModelAccess = (permissions: UserPermissions): string => {
    if (permissions.accessMode === 'blocked') return '禁止生成';
    if (permissions.accessMode === 'restricted') return `限制为 ${permissions.allowedModels.length} 个模型`;
    return '平台开放模型 · 按点数计费';
};

const formatTime = (value: number): string => value > 0
    ? formatChinaDateTime(value, '—')
    : '—';

// --- 图表组件 ---

const InteractiveHistogram = ({ data }: { data: { date: string, text: number, image: number, video: number }[] }) => {
    const sortedData = [...data].reverse();
    const maxVal = Math.max(...sortedData.map(d => d.text + d.image + d.video), 1) * 1.1;

    return (
        <div className="w-full h-64 flex items-end justify-between gap-2 pt-8 pb-6 px-2 relative border-b border-n40">
            {/* Y-Axis */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between text-[10px] text-n100 pb-8 pl-1">
                <div className="w-full border-t border-n40 relative"><span className="absolute -top-3 right-0">{Math.round(maxVal)}</span></div>
                <div className="w-full border-t border-n40 relative"><span className="absolute -top-3 right-0">{Math.round(maxVal * 0.75)}</span></div>
                <div className="w-full border-t border-n40 relative"><span className="absolute -top-3 right-0">{Math.round(maxVal * 0.5)}</span></div>
                <div className="w-full border-t border-n40 relative"><span className="absolute -top-3 right-0">{Math.round(maxVal * 0.25)}</span></div>
                <div className="w-full relative"></div>
            </div>

            {sortedData.map((d, i) => {
                const total = d.text + d.image + d.video;
                const safeTotal = total || 1;
                const barHeightPercent = (total / maxVal) * 100;
                const pctText = (d.text / safeTotal) * 100;
                const pctImage = (d.image / safeTotal) * 100;
                const pctVideo = (d.video / safeTotal) * 100;

                return (
                    <div key={i} className="flex-1 flex flex-col justify-end h-full group relative min-w-[20px] z-10">
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-n0 text-[10px] p-2 rounded-lg border border-n40 shadow-bottom opacity-0 group-hover:opacity-100 transition-all duration-200 z-50 w-32 pointer-events-none transform translate-y-2 group-hover:translate-y-0">
                            <div className="font-bold text-n700 border-b border-n40 pb-1 mb-1">{d.date}</div>
                            <div className="flex justify-between text-primary"><span>Text:</span><span>{d.text}</span></div>
                            <div className="flex justify-between text-success"><span>Image:</span><span>{d.image}</span></div>
                            <div className="flex justify-between text-primary"><span>Video:</span><span>{d.video}</span></div>
                            <div className="flex justify-between text-n800 font-bold mt-1 pt-1 border-t border-n40"><span>Total:</span><span>{total}</span></div>
                        </div>

                        {/* Bar */}
                        <div 
                            style={{ height: `${Math.max(barHeightPercent, 1)}%` }} 
                            className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end transition-all duration-300 hover:brightness-110 relative bg-n30"
                        >
                             {d.video > 0 && <div style={{ height: `${pctVideo}%` }} className="w-full bg-primary border-b border-primary"></div>}
                             {d.image > 0 && <div style={{ height: `${pctImage}%` }} className="w-full bg-success border-b border-success"></div>}
                             {d.text > 0 && <div style={{ height: `${pctText}%` }} className="w-full bg-primary"></div>}
                        </div>
                        
                        {/* Label */}
                        <div className="text-[9px] text-n100 mt-2 text-center truncate w-full font-mono group-hover:text-n800 transition-colors">
                            {d.date.slice(5)}
                        </div>
                    </div>
                )
            })}
        </div>
    );
};

const CyberSparkline = ({ data, color = '#5B49F0' }: { data: number[], color?: string }) => {
    if (data.length === 0) return null;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 50 - ((val - min) / range) * 40;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox="0 0 100 50" className="w-full h-full overflow-visible preserve-3d">
            <defs>
                <filter id={`glow-${color.replace('#','')}`}>
                    <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter={`url(#glow-${color.replace('#','')})`} />
        </svg>
    );
};

// --- 主组件 ---

// 2026-05-26：把后端任意形状的 user 行转成前端期望的 UserAccount。
// 即使后端漏字段 / permissions 是空对象 / 走老 snake_case 路径，渲染也不再崩。
// 这是 admin/list_users 的最后一道防线，与后端 _normalize_admin_user 形成双保险。
const normalizeUserRow = (raw: any): UserAccount => {
    const rp = (raw && raw.permissions && typeof raw.permissions === 'object') ? raw.permissions : {};
    const rs = (raw && raw.stats && typeof raw.stats === 'object') ? raw.stats : {};
    const rc = (raw && raw.creationPoints && typeof raw.creationPoints === 'object') ? raw.creationPoints : {};
    const lastLoginRaw = raw?.lastLogin ?? raw?.last_login_at ?? 0;
    let lastLoginMs = 0;
    if (typeof lastLoginRaw === 'number') lastLoginMs = lastLoginRaw;
    else if (typeof lastLoginRaw === 'string' && lastLoginRaw) {
        const t = Date.parse(lastLoginRaw);
        if (!isNaN(t)) lastLoginMs = t;
    }
    const isActiveRaw = raw?.isActive ?? raw?.is_active ?? (raw?.status ? raw.status !== 'disabled' : true);
    const allowedModels = Array.isArray(rp.allowedModels) ? rp.allowedModels : (Array.isArray(rp.allowed_models) ? rp.allowed_models : []);
    const accessMode = rp.accessMode === 'blocked' || rp.access_mode === 'blocked'
        ? 'blocked'
        : (rp.accessMode === 'restricted' || rp.access_mode === 'restricted' || allowedModels.length > 0)
            ? 'restricted'
            : 'inherit';
    const lastActiveRaw = raw?.lastActiveAt ?? raw?.last_active_at ?? 0;
    const lastActiveAt = typeof lastActiveRaw === 'number'
        ? lastActiveRaw
        : (typeof lastActiveRaw === 'string' && lastActiveRaw ? Date.parse(lastActiveRaw) : 0);
    return {
        id: String(raw?.id ?? raw?.user_id ?? ''),
        username: String(raw?.username ?? ''),
        email: String(raw?.email ?? ''),
        role: normalizePlatformRole(raw?.role),
        isActive: !!isActiveRaw,
        isOnline: !!raw?.isOnline,
        lastActiveAt: Number.isFinite(lastActiveAt) ? lastActiveAt : 0,
        lastLogin: lastLoginMs,
        creationPoints: {
            available: Number(rc.available ?? 0),
            account: Number(rc.account ?? 0),
            gift: Number(rc.gift ?? 0),
        },
        permissions: {
            accessMode,
            allowedModels,
            priority: (rp.priority ?? 'normal') as UserAccount['permissions']['priority'],
            canExport: rp.canExport !== undefined ? !!rp.canExport : (rp.can_export !== undefined ? !!rp.can_export : true),
        },
        stats: {
            todayCount: typeof rs.todayCount === 'number' ? rs.todayCount : (typeof rs.today_count === 'number' ? rs.today_count : 0),
            totalCount: typeof rs.totalCount === 'number' ? rs.totalCount : (typeof rs.total_count === 'number' ? rs.total_count : 0),
            byModel: (rs.byModel && typeof rs.byModel === 'object') ? rs.byModel : ((rs.by_model && typeof rs.by_model === 'object') ? rs.by_model : {}),
        },
    };
};

export const AdminPage: React.FC<AdminPageProps> = ({ files = [], materialLibrary = {} as MaterialLibrary, embedded = false, embedTab }) => {
    const isSuperAdmin = getAdminRole() === 'super_admin';
    const [activeTab, setActiveTab] = useState<'users' | 'stats' | 'results' | 'system' | 'features'>(embedTab ?? 'users');
    // 当前架构：统一壳的菜单切换会改变 embedTab（同一路由不卸载），此处同步到内部 activeTab。
    useEffect(() => { if (embedTab) setActiveTab(embedTab); }, [embedTab]);
    const [users, setUsers] = useState<UserAccount[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [nodes, setNodes] = useState<ServerNode[]>([]);
    const [clusterNodeMessage, setClusterNodeMessage] = useState('');
    const [systemStats, setSystemStats] = useState<any>(null);
    // 2026-05-26 组织管理 MVP — Slice 6
    const [statsGroupBy, setStatsGroupBy] = useState<'user' | 'org'>('user');
    const [statsBreakdown, setStatsBreakdown] = useState<any[]>([]);
    const [breakdownLoading, setBreakdownLoading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreatingUser, setIsCreatingUser] = useState(false);  // 🆕 创建用户loading
    
    // 🆕 自定义弹窗状态
    const [dialog, setDialog] = useState<{
        type: 'alert' | 'confirm';
        title: string;
        message: string;
        onConfirm?: () => void;
        confirmText?: string;
        cancelText?: string;
    } | null>(null);
    
    // 用户管理状态
    const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
    const [showAddUser, setShowAddUser] = useState(false);
    const [newUserForm, setNewUserForm] = useState({ username: '', email: '', role: 'user', password: '' });

    // 结果查看状态
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [inspectLog, setInspectLog] = useState<GenerationLog | null>(null);

    // 系统监控状态
    const [sshModalNode, setSshModalNode] = useState<ServerNode | null>(null);
    const [sshForm, setSshForm] = useState({ host: '', port: 22, user: 'root', keyPath: '/home/user/.ssh/id_rsa', password: '' });
    const [showAddNode, setShowAddNode] = useState(false);
    const [addNodeMode, setAddNodeMode] = useState<'manual' | 'quick'>('quick');
    const [newNodeForm, setNewNodeForm] = useState({ name: '', ip: '', storageTotal: 1000 });
    const [quickConfigText, setQuickConfigText] = useState('');
    const [connectionStep, setConnectionStep] = useState<'idle' | 'connecting' | 'verifying' | 'installing' | 'success'>('idle');
    const [connectionLogs, setConnectionLogs] = useState<string[]>([]);
    const terminalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadData();
    }, []);

    // 2026-05-26 Slice 6: 切到「生成统计分析」 + 选 group_by 时自动拉 breakdown
    useEffect(() => {
        if (activeTab !== 'stats') return;
        let cancelled = false;
        setBreakdownLoading(true);
        getSystemStats(statsGroupBy)
            .then(r => {
                if (cancelled) return;
                if (r.success) {
                    setSystemStats(r.stats);
                    setStatsBreakdown(r.breakdown || []);
                }
            })
            .catch(e => console.warn('breakdown 拉取失败:', e))
            .finally(() => { if (!cancelled) setBreakdownLoading(false); });
        return () => { cancelled = true; };
    }, [activeTab, statsGroupBy]);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [connectionLogs]);

    // 加载数据
    const loadData = async () => {
        setIsLoading(true);
        try {
            // 尝试从后端加载
            try {
                const [usersRes, statsRes, logsRes] = await Promise.all([
                    getUsers(),
                    getSystemStats(),
                    getGenerationLogs(1000)  // 🆕 增加获取数量到1000条
                ]);
                
                if (usersRes.success) {
                    // 2026-05-26：经过 normalizeUserRow 兜底，保证 permissions / stats / camelCase 字段一定存在
                    const normalized = (usersRes.users || []).map(normalizeUserRow);
                    setUsers(normalized);
                    console.log('✅ 加载用户数:', normalized.length);
                }
                if (statsRes.success) {
                    setSystemStats(statsRes.stats);
                    console.log('✅ 系统统计:', statsRes.stats);
                }
                if (logsRes.success) {
                    setLogs(logsRes.logs);
                    console.log('✅ 加载日志数:', logsRes.logs.length);
                }
                
                // 加载集群节点信息
                await loadClusterNodes();
                
            } catch (error) {
                console.error('从后端加载失败，使用本地数据:', error);
                
                // 降级：生成本地数据
                const localUsers = generateLocalUsers();
                const localLogs = generateLocalLogs(localUsers);
                const localStats = generateLocalStats(localLogs);
                
                setUsers(localUsers);
                setLogs(localLogs);
                setSystemStats(localStats);
                setNodes([]);
                setClusterNodeMessage('管理后台接口加载失败，集群节点状态暂不可用。');
            }
        } finally {
            setIsLoading(false);
        }
    };

    // 从后端加载集群节点
    const loadClusterNodes = async () => {
        try {
            const data = (await apiJson(
                '/api/cluster/nodes',
                { method: 'GET' },
                'Cluster Nodes',
            )) as ClusterNodesResponse;
            
            if (data.success) {
                const nodesList = normalizeClusterNodeRows(data.nodes).map(mapClusterNode);
                setNodes(nodesList);
                setClusterNodeMessage(data.agent_only_mode
                    ? sanitizeProcessingTerminology(data.message || '当前没有在线处理节点。')
                    : (nodesList.length === 0 ? '当前没有已注册的集群节点。' : '')
                );
                console.log('✅ 加载了', nodesList.length, '个集群节点');
            } else {
                setNodes([]);
                setClusterNodeMessage(data.message || '集群节点状态暂不可用。');
            }
        } catch (error) {
            console.error('加载集群节点失败:', error);
            setNodes([]);
            setClusterNodeMessage('集群节点状态加载失败，请查看后端日志。');
        }
    };

    // 生成本地用户数据
    const generateLocalUsers = (): UserAccount[] => {
        const currentUser = localStorage.getItem('username') || 'admin';
        return [
            {
                id: '1',
                username: currentUser,
                email: `${currentUser}@studio.com`,
                role: currentUser === 'admin' ? 'super_admin' : 'user',
                isActive: true,
                isOnline: true,
                lastActiveAt: Date.now(),
                lastLogin: Date.now(),
                creationPoints: { available: 0, account: 0, gift: 0 },
                permissions: {
                    accessMode: 'inherit',
                    allowedModels: [],
                    priority: currentUser === 'admin' ? 'high' : 'normal',
                    canExport: true
                },
                stats: {
                    todayCount: 0,
                    totalCount: files.length,
                    byModel: {
                        'gemini-2.5-flash': files.length
                    }
                }
            }
        ];
    };

    // 生成本地日志数据（基于实际项目）
    const generateLocalLogs = (users: UserAccount[]): GenerationLog[] => {
        const logs: GenerationLog[] = [];
        const now = Date.now();
        const DAY_MS = 86400000;

        files.forEach(file => {
            if (file.storyboard) {
                file.storyboard.items.forEach((item, index) => {
                    // 为每个分镜生成日志
                    if (item.generatedImages && item.generatedImages.length > 0) {
                        item.generatedImages.forEach((img, imgIndex) => {
                            logs.push({
                                id: uuidv4(),
                                userId: users[0].id,
                                username: users[0].username,
                                timestamp: img.timestamp || (now - Math.random() * DAY_MS * 7),
                                type: 'image',
                                model: 'gemini-2.5-flash-image',
                                status: 'success',
                                prompt: item.imagePrompt || `生成分镜 ${index + 1}`,
                                params: JSON.stringify({ temperature: 0.7 }),
                                executionTimeMs: 3000 + Math.random() * 5000,
                                queueTimeMs: Math.random() * 500,
                                resultPreview: img.url
                            });
                        });
                    } else {
                        // 文本生成日志
                        logs.push({
                            id: uuidv4(),
                            userId: users[0].id,
                            username: users[0].username,
                            timestamp: now - Math.random() * DAY_MS * 7,
                            type: 'text',
                            model: 'gemini-2.5-flash',
                            status: 'success',
                            prompt: item.scriptSegment || `生成剧本片段 ${index + 1}`,
                            params: JSON.stringify({ temperature: 0.7 }),
                            executionTimeMs: 1000 + Math.random() * 2000,
                            queueTimeMs: Math.random() * 300,
                        });
                    }
                });
            }
        });

        return logs.sort((a, b) => b.timestamp - a.timestamp);
    };

    // 生成本地统计
    const generateLocalStats = (logs: GenerationLog[]) => {
        const textCount = logs.filter(l => l.type === 'text').length;
        const imageCount = logs.filter(l => l.type === 'image').length;
        const videoCount = logs.filter(l => l.type === 'video').length;
        
        return {
            totalProjects: files.length,
            totalStoryboards: files.reduce((sum, f) => sum + (f.storyboard?.items.length || 0), 0),
            totalImages: imageCount,
            totalVideos: videoCount,
            totalText: textCount,
            totalMaterials: Object.values(materialLibrary).reduce((sum, mats) => sum + mats.length, 0),
            storageUsedMB: (imageCount + videoCount) * 0.5,
            activeUsers: 1,
            source: 'local'
        };
    };

    // --- 统计计算 ---

    const dailyStats = useMemo(() => {
        console.log('📊 计算每日统计，日志数量:', logs.length);
        if (logs.length > 0) {
            console.log('📊 日志示例:', logs[0]);
        }
        
        const stats: Record<string, { date: string, text: number, image: number, video: number }> = {};
        const now = new Date();
        
        for(let i=0; i<14; i++) {
            const d = new Date(now.getTime() - i * 86400000);
            const key = d.toISOString().split('T')[0];
            stats[key] = { date: key, text: 0, image: 0, video: 0 };
        }

        logs.forEach(log => {
            const key = new Date(log.timestamp).toISOString().split('T')[0];
            if (stats[key]) {
                if (log.type === 'text') stats[key].text++;
                else if (log.type === 'image') stats[key].image++;
                else if (log.type === 'video') stats[key].video++;
            }
        });
        
        const result = Object.values(stats).sort((a,b) => b.date.localeCompare(a.date));
        console.log('📊 每日统计结果:', result);
        return result;
    }, [logs]);

    const userPerformanceStats = useMemo(() => {
        return users.map(user => {
            const userLogs = logs.filter(l => l.userId === user.id);
            const total = userLogs.length;
            const avgWait = total > 0 
                ? userLogs.reduce((sum, l) => sum + l.queueTimeMs, 0) / total 
                : 0;
            
            const dailyCounts = new Array(7).fill(0);
            userLogs.forEach(l => {
                const dayDiff = Math.floor((Date.now() - l.timestamp) / 86400000);
                if (dayDiff < 7) dailyCounts[6 - dayDiff]++;
            });

            return {
                ...user,
                perf: {
                    avgWait,
                    totalGens: total,
                    dailyTrend: dailyCounts
                }
            };
        });
    }, [users, logs]);

    const modelStats = useMemo(() => {
        console.log('📊 计算模型统计，日志数量:', logs.length);
        const stats: Record<string, { count: number, totalWait: number }> = {};
        logs.forEach(l => {
            if (!stats[l.model]) stats[l.model] = { count: 0, totalWait: 0 };
            stats[l.model].count++;
            stats[l.model].totalWait += l.queueTimeMs;
        });
        const result = Object.entries(stats).map(([model, data]) => ({
            model,
            count: data.count,
            avgWait: data.count > 0 ? data.totalWait / data.count : 0
        })).sort((a, b) => b.count - a.count);
        console.log('📊 模型统计结果:', result);
        return result;
    }, [logs]);

    // --- 自定义弹窗辅助函数 ---
    const showAlert = (title: string, message: string) => {
        setDialog({
            type: 'alert',
            title,
            message,
            confirmText: '确定'
        });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void) => {
        setDialog({
            type: 'confirm',
            title,
            message,
            onConfirm,
            confirmText: '确定',
            cancelText: '取消'
        });
    };

    const closeDialog = () => {
        setDialog(null);
    };

    // --- 处理函数 ---

    const toggleUserStatus = async (user: UserAccount) => {
        try {
            await apiJson(`/api/admin/users/${user.id}/${user.isActive ? 'disable' : 'enable'}`, {
                method: 'POST',
                body: user.isActive ? JSON.stringify({ reason: '管理员操作' }) : undefined,
            }, user.isActive ? '禁用用户' : '启用用户');
            setUsers(users.map(item => item.id === user.id ? { ...item, isActive: !item.isActive } : item));
        } catch (error) {
            console.error('更新账号状态失败:', error);
            showAlert('错误', '账号状态更新失败');
        }
    };

    const handleDeleteUser = async (userId: string, username: string) => {
        showConfirm(
            '删除用户',
            `确定要删除用户 "${username}" 吗？此操作不可恢复。`,
            async () => {
                try {
                    await deleteUser(userId);
                    // 从列表中移除该用户
                    setUsers(users.filter(u => u.id !== userId));
                    showAlert('成功', '用户已删除');
                } catch (error) {
                    console.error('删除用户失败:', error);
                    showAlert('错误', '删除用户失败，请查看控制台');
                }
            }
        );
    };

    const saveUserPermissions = async (permissions: UserPermissions) => {
        if (!editingUser) return;
        
        try {
            await updateUserPermissions(editingUser.id, permissions);
            setUsers(users.map(u => u.id === editingUser.id ? { ...u, permissions } : u));
            setEditingUser(null);
            showAlert('成功', '用户权限已更新');
        } catch (error) {
            console.error('更新权限失败:', error);
            showAlert('错误', '更新权限失败，请查看控制台');
        }
    };

    const handleAddUser = async () => {
        // 必填项验证：只需要用户名和密码
        if (!newUserForm.username || !newUserForm.password) {
            showAlert('提示', '请填写用户名和密码');
            return;
        }
        if (newUserForm.password.length < 8) {
            showAlert('提示', '登录密码至少需要 8 位');
            return;
        }
        
        setIsCreatingUser(true);
        try {
            // 调用后端API创建用户
            const response = await createUser({
                username: newUserForm.username,
                password: newUserForm.password,
                email: newUserForm.email || `${newUserForm.username}@studio.com`, // 自动生成默认邮箱
                role: newUserForm.role
            });
            
            if (response.success) {
                // 重新加载用户列表（不触发全局loading）
                try {
                    const usersRes = await getUsers();
                    if (usersRes.success) {
                        setUsers((usersRes.users || []).map(normalizeUserRow));
                    }
                } catch (error) {
                    console.error('刷新用户列表失败:', error);
                }
                
                setShowAddUser(false);
                setNewUserForm({ username: '', email: '', role: 'user', password: '' });
                
                showAlert('成功', `用户 ${newUserForm.username} 创建成功！`);
            }
        } catch (error) {
            console.error('创建用户失败:', error);
            showAlert('错误', '创建用户失败: ' + (error as Error).message);
        } finally {
            setIsCreatingUser(false);
        }
    };

    const handleModelToggle = (model: string, currentModels: string[]) => {
        if (currentModels.includes(model)) {
            return currentModels.filter(m => m !== model);
        }
        return [...currentModels, model];
    };

    const openSshConfig = (node: ServerNode) => {
        setSshModalNode(node);
        setSshForm({
            host: node.ip,
            port: node.sshConfig?.port || 22,
            user: node.sshConfig?.user || 'root',
            keyPath: node.sshConfig?.keyPath || '/home/user/.ssh/id_rsa',
            password: node.sshConfig?.password || ''
        });
    };

    const saveSshConfig = () => {
        if (!sshModalNode) return;
        setNodes(nodes.map(n => n.id === sshModalNode.id ? {
            ...n,
            sshConfig: { ...sshForm }
        } : n));
        setSshModalNode(null);
    };

    const handleManualAddNode = () => {
        if (!newNodeForm.name || !newNodeForm.ip) return;
        const newNode: ServerNode = {
            id: uuidv4(),
            name: newNodeForm.name,
            ip: newNodeForm.ip,
            status: 'offline',
            storageTotal: newNodeForm.storageTotal,
            storageUsed: 0,
            gpuUsage: 0
        };
        setNodes([...nodes, newNode]);
        setShowAddNode(false);
        setNewNodeForm({ name: '', ip: '', storageTotal: 1000 });
    };

    const parseAndConnect = async () => {
        const sshRegex = /ssh\s+-p\s+(\d+)\s+([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)/;
        const pwdRegex = /(?:密码|Password)[:：]\s*([^\s]+)/i;

        const sshMatch = quickConfigText.match(sshRegex);
        const pwdMatch = quickConfigText.match(pwdRegex);

        if (!sshMatch) {
            setConnectionLogs(prev => [...prev, "Error: Could not parse SSH command. Expected format: ssh -p <port> <user>@<host>"]);
            return;
        }

        const port = sshMatch[1];
        const user = sshMatch[2];
        const host = sshMatch[3];
        const password = pwdMatch ? pwdMatch[1] : null;

        setConnectionStep('connecting');
        setConnectionLogs([`> Parsing successful. Target: ${user}@${host}:${port}`, `> Initiating connection...`]);

        await new Promise(r => setTimeout(r, 1000));
        setConnectionLogs(prev => [...prev, "> Host reachable. Handshaking..."]);
        
        await new Promise(r => setTimeout(r, 800));
        if (password) {
            setConnectionLogs(prev => [...prev, `> Authenticating with provided password...`, "> Auth Success."]);
        } else {
             setConnectionLogs(prev => [...prev, `> No password found in text. Attempting key auth...`, "> Auth Success."]);
        }
        setConnectionStep('verifying');

        await new Promise(r => setTimeout(r, 1200));
        setConnectionLogs(prev => [...prev, "> Checking processing node...", "> Processing node available", "> Installing node service..."]);
        setConnectionStep('installing');

        await new Promise(r => setTimeout(r, 1500));
        setConnectionLogs(prev => [...prev, "> Node service started", "> Joining Cluster...", "> Node Registered Successfully."]);
        setConnectionStep('success');

        await new Promise(r => setTimeout(r, 800));
        
        const newNode: ServerNode = {
            id: uuidv4(),
            name: `AutoNode-${host.split('.')[1] || 'New'}`,
            ip: host,
            status: 'online',
            storageTotal: 2000,
            storageUsed: 120,
            gpuUsage: 5,
            sshConfig: {
                host,
                port: parseInt(port),
                user,
                keyPath: '',
                password: password || undefined
            }
        };
        setNodes(prev => [...prev, newNode]);
        
        setTimeout(() => {
             setShowAddNode(false);
             setQuickConfigText('');
             setConnectionStep('idle');
             setConnectionLogs([]);
        }, 1500);
    };

    const filteredLogs = useMemo(() => {
        return selectedUserId ? logs.filter(l => l.userId === selectedUserId) : logs;
    }, [logs, selectedUserId]);

    if (isLoading) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-n20">
                <div className="text-center">
                    <Activity className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
                    <p className="text-n300">加载管理数据...</p>
                </div>
            </div>
        );
    }

    // `embedded` is retained as a compatibility argument. The operations route
    // owns the full viewport and supplies its own navigation back to Admin Hub.
    void embedded;

    return (
        // A definite viewport height is required for nested flex children to
        // establish their own overflow region. min-height would let the parent
        // expand and silently disable scrolling on long administration pages.
        <div className={`flex ${embedded ? 'h-full w-full' : 'h-screen w-screen'} bg-n0 text-n800 overflow-hidden font-sans relative`}>
            {/* 🆕 创建用户Loading遮罩 */}
            {isCreatingUser && (
                <div className="fixed inset-0 z-[100] bg-n900/50 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-n0 border border-n40 rounded-md p-8 shadow-bottom">
                        <div className="text-center">
                            <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
                            <p className="text-n700 text-lg font-medium">创建用户中...</p>
                            <p className="text-n100 text-sm mt-2">请稍候</p>
                        </div>
                    </div>
                </div>
            )}
            
          {/* 侧边栏 —— embedded（统一壳）模式下隐藏，导航交给壳的层级菜单 */}
          {!embedded && (
          <div className="w-64 bg-n0 border-r border-n40 flex flex-col flex-shrink-0">
            <div className="p-6 border-b border-n40">
              <h2 className="text-lg font-bold flex items-center gap-2 text-primary">
                <ShieldCheck className="w-6 h-6" />
                管理控制台
              </h2>
              <p className="text-xs text-n100 mt-2">
                数据源: {systemStats?.source === "backend" ? "后端数据库" : "本地存储"}
              </p>
            </div>
      
            <nav className="flex-1 p-4 space-y-2">
              <button
                onClick={() => setActiveTab("users")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "users"
                    ? "bg-primary text-white"
                    : "text-n300 hover:bg-n20 hover:text-n800"
                }`}
              >
                <Users className="w-4 h-4" />
                用户权限管理
              </button>
              <button
                onClick={() => setActiveTab("stats")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "stats"
                    ? "bg-primary text-white"
                    : "text-n300 hover:bg-n20 hover:text-n800"
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                生成统计分析
              </button>
              <button
                onClick={() => setActiveTab("results")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "results"
                    ? "bg-primary text-white"
                    : "text-n300 hover:bg-n20 hover:text-n800"
                }`}
              >
                <Terminal className="w-4 h-4" />
                生成结果审计
              </button>
              <button
                onClick={() => setActiveTab("system")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "system"
                    ? "bg-primary text-white"
                    : "text-n300 hover:bg-n20 hover:text-n800"
                }`}
              >
                <HardDrive className="w-4 h-4" />
                集群节点监控
              </button>
              {/* 2026-05-26 Slices 2/4/5 新增能力：账号 / 分组 / 创作点数 / 素材 / 审计 */}
              <button
                onClick={() => setActiveTab("features")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "features"
                    ? "bg-primary text-white"
                    : "text-n300 hover:bg-n20 hover:text-n800"
                }`}
              >
                <Settings className="w-4 h-4" />
                新功能管理
              </button>
            </nav>
          </div>
          )}

          {/* 主内容 */}
          <div className="flex-1 overflow-hidden flex flex-col bg-n20">
            {/* Header */}
            <div className="h-[60px] border-b border-n40 bg-n0 flex items-center px-8 justify-between">
              <h3 className="text-xl font-bold text-n700">
                {activeTab === "users" && "用户账号与使用状态"}
                {activeTab === "stats" && "生成数据与趋势分析"}
                {activeTab === "results" && "全局生成结果审计"}
                {activeTab === "system" && "集群节点状态监控"}
                {activeTab === "features" && "新功能管理（账号 / 分组 / 创作点数 / 素材 / 审计）"}
              </h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs text-n300 bg-n0 px-3 py-1.5 rounded-full border border-n40">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  在线: {users.filter((u) => u.isOnline).length} / {users.length}
                </div>
              </div>
            </div>
      
            {/* 内容主体 */}
            <div
              className={`flex-1 overflow-y-auto custom-scrollbar ${
                activeTab === "results" ? "p-0" : "p-6"
              }`}
            >
              {/* 用户管理Tab */}
              {activeTab === "users" && (
                <div className="w-full">
                  <div className="flex justify-between items-center mb-6">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-n100" />
                      <input
                        type="text"
                        placeholder="搜索用户..."
                        className="bg-n0 border border-n40 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-primary w-64"
                      />
                    </div>
                    <button
                      onClick={() => setShowAddUser(true)}
                      className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      添加用户
                    </button>
                  </div>
      
                  <div className="bg-n0 border border-n40 rounded-md overflow-hidden">
                    <table className="w-full text-left text-sm table-fixed">
                      <thead className="bg-n30 text-n300 uppercase font-medium text-xs">
                        <tr>
                          <th className="px-4 py-4 w-[15%]">用户</th>
                          <th className="px-4 py-4 w-[13%]">角色</th>
                          <th className="px-4 py-4 w-[11%]">在线状态</th>
                          <th className="px-4 py-4 w-[20%]">模型访问</th>
                          <th className="px-4 py-4 w-[11%]">创作点数</th>
                          <th className="px-4 py-4 w-[10%]">今日/累计</th>
                          <th className="px-4 py-4 w-[12%]">最近登录</th>
                          <th className="px-4 py-4 w-[8%] text-right">管理</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-n40">
                        {users.map((user) => (
                          <tr
                            key={user.id}
                            className="hover:bg-n20 transition-colors"
                          >
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-n700 ${
                                    user.isActive
                                      ? "bg-n0"
                                      : "bg-r50"
                                  }`}
                                >
                                  {user.username[0].toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-bold text-n700">
                                    {user.username}
                                  </div>
                                  <div className="max-w-[160px] truncate text-xs text-n100">{user.email || user.id}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-xs text-n700">{getPlatformRoleLabel(user.role)}</td>
                            <td className="px-4 py-4">
                              {user.isOnline ? (
                                <div className="flex items-center gap-1.5 text-xs text-success">
                                  <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                                  在线
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-center gap-1.5 text-xs text-n100"><span className="w-2 h-2 bg-n40 rounded-full"></span>离线</div>
                                  {user.lastActiveAt > 0 && <div className="mt-1 text-[10px] text-n100">活跃于 {formatTime(user.lastActiveAt)}</div>}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4"><span className={`text-xs ${user.permissions.accessMode === 'blocked' ? 'text-danger' : 'text-n700'}`}>{formatModelAccess(user.permissions)}</span></td>
                            <td className="px-4 py-4">
                              <div className="font-semibold tabular-nums text-n800">{user.creationPoints.available}</div>
                              <div className="text-[10px] text-n100">账户 {user.creationPoints.account} · 赠送 {user.creationPoints.gift}</div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-baseline gap-1">
                                <span className="text-n800 font-bold">
                                  {user.stats.todayCount}
                                </span>
                                <span className="text-n100 text-xs">
                                  / {user.stats.totalCount}
                                </span>
                              </div>
                              <div className="w-24 h-1 bg-n0 rounded-full mt-1 overflow-hidden">
                                <div
                                  className="h-full bg-success"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (user.stats.todayCount / 200) * 100
                                    )}%`,
                                  }}
                                ></div>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-[11px] text-n200">{formatTime(user.lastLogin)}</td>
                            <td className="px-4 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setEditingUser(user)}
                                  disabled={!isSuperAdmin && user.role !== 'user'}
                                  className="p-1.5 hover:bg-n20 rounded text-primary hover:text-primary disabled:cursor-not-allowed disabled:text-n70"
                                  title={!isSuperAdmin && user.role !== 'user' ? '只有超级管理员可以管理管理员账号' : '配置权限'}
                                >
                                  <Settings className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => toggleUserStatus(user)}
                                  disabled={!isSuperAdmin && user.role !== 'user'}
                                  className={`p-1.5 hover:bg-n20 rounded ${
                                    user.isActive
                                      ? "text-n300"
                                      : "text-danger"
                                  } disabled:cursor-not-allowed disabled:text-n70`}
                                  title={!isSuperAdmin && user.role !== 'user' ? '只有超级管理员可以管理管理员账号' : (user.isActive ? "冻结" : "解冻")}
                                >
                                  {user.isActive ? (
                                    <Lock className="w-4 h-4" />
                                  ) : (
                                    <Unlock className="w-4 h-4" />
                                  )}
                                </button>
                                {isSuperAdmin && <button
                                  onClick={() =>
                                    handleDeleteUser(user.id, user.username)
                                  }
                                  className="p-1.5 hover:bg-n20 rounded text-danger hover:text-danger"
                                  title="删除用户"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
      
              {/* 统计Tab */}
              {activeTab === "stats" && (
                <div className="space-y-6 w-full">
                  {/* 2026-05-26 Slice 6: 「按用户 / 按组织」切换 */}
                  <div className="flex items-center gap-2 bg-n0 rounded-lg px-3 py-2 border border-n40 w-fit">
                    <span className="text-xs text-n300">分组维度</span>
                    <button
                      onClick={() => setStatsGroupBy('user')}
                      className={`px-3 py-1 text-xs rounded ${statsGroupBy === 'user' ? 'bg-primary text-white' : 'text-n700 hover:bg-n20'}`}
                    >按用户</button>
                    <button
                      onClick={() => setStatsGroupBy('org')}
                      className={`px-3 py-1 text-xs rounded ${statsGroupBy === 'org' ? 'bg-primary text-white' : 'text-n700 hover:bg-n20'}`}
                    >按组织</button>
                    {breakdownLoading && <span className="text-xs text-n100">加载中…</span>}
                  </div>

                  {/* 概览卡片 */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-n0 border border-n40 rounded-md p-5 shadow-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-n100 uppercase">
                          文本生成
                        </span>
                        <Activity className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-3xl font-bold text-n800">
                        {systemStats?.totalText || 0}
                      </div>
                      <div className="text-xs text-n100 mt-1">总计</div>
                    </div>
      
                    <div className="bg-n0 border border-n40 rounded-md p-5 shadow-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-n100 uppercase">
                          图片生成
                        </span>
                        <ImageIcon className="w-4 h-4 text-success" />
                      </div>
                      <div className="text-3xl font-bold text-n800">
                        {systemStats?.totalImages || 0}
                      </div>
                      <div className="text-xs text-n100 mt-1">已生成图片</div>
                    </div>
      
                    <div className="bg-n0 border border-n40 rounded-md p-5 shadow-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-n100 uppercase">
                          视频生成
                        </span>
                        <Play className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-3xl font-bold text-n800">
                        {systemStats?.totalVideos || 0}
                      </div>
                      <div className="text-xs text-n100 mt-1">已生成视频</div>
                    </div>
      
                    <div className="bg-n0 border border-n40 rounded-md p-5 shadow-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-n100 uppercase">
                          项目总数
                        </span>
                        <Database className="w-4 h-4 text-warning" />
                      </div>
                      <div className="text-3xl font-bold text-n800">
                        {systemStats?.totalProjects || 0}
                      </div>
                      <div className="text-xs text-n100 mt-1">当前项目</div>
                    </div>
                  </div>
      
                  {/* 趋势图 */}
                  <div className="bg-n0 p-6 rounded-md border border-n40">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-sm font-bold text-n700 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-primary" />
                        每日生成量趋势 (Last 14 Days)
                      </h4>
                      <div className="flex gap-4 text-xs font-medium">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 bg-primary rounded"></div>
                          Text
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 bg-success rounded"></div>
                          Image
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 bg-primary rounded"></div>
                          Video
                        </div>
                      </div>
                    </div>
                    <InteractiveHistogram data={dailyStats} />
                  </div>
      
                  {/* 模型统计 */}
                  <div className="grid grid-cols-3 gap-6">
                    <div className="bg-n0 p-6 rounded-md border border-n40">
                      <h4 className="text-sm font-bold text-n700 mb-4 flex items-center gap-2">
                        <PieChart className="w-4 h-4 text-primary" />
                        模型使用分布
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {modelStats.map((m) => (
                          <div
                            key={m.model}
                            className="bg-n30 rounded-lg p-4 border border-n40 relative overflow-hidden"
                          >
                            <div className="flex justify-between items-start z-10 relative">
                              <div>
                                <div className="text-xs text-n300 font-mono mb-1">
                                  {m.model}
                                </div>
                                <div className="text-xl font-bold text-n800">
                                  {m.count}{" "}
                                  <span className="text-xs font-normal text-n100">
                                    次
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-n300">
                                  平均等待
                                </div>
                                <div
                                  className={`text-sm font-bold ${
                                    m.avgWait > 1000
                                      ? "text-warning"
                                      : "text-success"
                                  }`}
                                >
                                  {m.avgWait.toFixed(0)} ms
                                </div>
                              </div>
                            </div>
                            <div
                              className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary to-primary"
                              style={{
                                width: `${(m.count / (logs.length || 1)) * 100}%`,
                              }}
                            ></div>
                          </div>
                        ))}
                      </div>
                    </div>
      
                    {/* 用户活跃度 */}
                    <div className="bg-n0 border border-n40 rounded-md overflow-hidden">
                      <div className="p-6 border-b border-n40">
                        <h4 className="text-sm font-bold text-n700 flex items-center gap-2">
                          <Users className="w-4 h-4 text-primary" />
                          用户活跃度分析
                        </h4>
                      </div>
                      <div className="p-4">
                        {userPerformanceStats.map((u) => (
                          <div
                            key={u.id}
                            className="mb-4 pb-4 border-b border-n40 last:border-0"
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold text-n700">
                                {u.username}
                              </span>
                              <span className="text-xs text-n100">
                                {u.perf.totalGens} 次生成
                              </span>
                            </div>
                            <div className="h-8 w-full">
                              <CyberSparkline
                                data={u.perf.dailyTrend}
                                color={
                                  u.permissions.priority === "high"
                                    ? "#8B6BFF"
                                    : "#5B49F0"
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 2026-05-26 Slice 6: breakdown 表 */}
                  <div className="bg-n0 border border-n40 rounded-md">
                    <div className="px-6 py-4 border-b border-n40 flex justify-between items-center">
                      <h4 className="text-sm font-bold text-n700">
                        {statsGroupBy === 'user' ? '按用户聚合' : '按组织聚合'}
                      </h4>
                      <span className="text-xs text-n100">{statsBreakdown.length} 条</span>
                    </div>
                    {statsBreakdown.length === 0 ? (
                      <div className="px-6 py-12 text-center text-sm text-n100">
                        {breakdownLoading ? '加载中…' : (statsGroupBy === 'org' ? '尚无组织数据（请先到「组织管理」创建）' : '暂无数据')}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-n30 text-[11px] uppercase text-n100">
                            <tr>
                              <th className="text-left px-6 py-2 font-medium">{statsGroupBy === 'user' ? '用户' : '组织'}</th>
                              {statsGroupBy === 'org' && <th className="text-right px-3 py-2 font-medium">成员数</th>}
                              <th className="text-right px-3 py-2 font-medium">项目</th>
                              <th className="text-right px-3 py-2 font-medium">图片</th>
                              <th className="text-right px-3 py-2 font-medium">视频</th>
                              <th className="text-right px-3 py-2 font-medium">音频</th>
                              <th className="text-right px-6 py-2 font-medium">合计</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsBreakdown.map((row: any) => {
                              const total = (row.projects || 0) + (row.images || 0) + (row.videos || 0) + (row.audios || 0);
                              return (
                                <tr key={row.user_id || row.org_id} className="border-t border-n40 hover:bg-n20">
                                  <td className="px-6 py-2 text-n700">
                                    {statsGroupBy === 'user' ? row.username : row.name}
                                    <span className="ml-2 text-[10px] text-n100 font-mono">{row.user_id || row.org_id}</span>
                                  </td>
                                  {statsGroupBy === 'org' && (
                                    <td className="px-3 py-2 text-right text-n700">{row.member_count}</td>
                                  )}
                                  <td className="px-3 py-2 text-right text-warning">{row.projects}</td>
                                  <td className="px-3 py-2 text-right text-success">{row.images}</td>
                                  <td className="px-3 py-2 text-right text-primary">{row.videos}</td>
                                  <td className="px-3 py-2 text-right text-b400">{row.audios}</td>
                                  <td className="px-6 py-2 text-right font-medium text-n800">{total}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
      
              {/* 结果审计Tab */}
              {activeTab === "results" && (
                <div className="flex h-full gap-6 p-8">
                  {/* 用户过滤侧边栏 */}
                  <div className="w-56 bg-n0 border border-n40 rounded-md overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-n40 bg-n30 font-bold text-xs text-n300 uppercase">
                      筛选用户
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      <button
                        onClick={() => setSelectedUserId(null)}
                        className={`w-full text-left px-3 py-2 rounded text-xs font-medium ${
                          !selectedUserId
                            ? "bg-primary text-white"
                            : "text-n300 hover:bg-n20"
                        }`}
                      >
                        全部用户 (All)
                      </button>
                      {users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => setSelectedUserId(u.id)}
                          className={`w-full text-left px-3 py-2 rounded text-xs font-medium flex items-center justify-between ${
                            selectedUserId === u.id
                              ? "bg-primary text-white"
                              : "text-n300 hover:bg-n20"
                          }`}
                        >
                          {u.username}
                          <ChevronRight className="w-3 h-3 opacity-50" />
                        </button>
                      ))}
                    </div>
                  </div>
      
                  {/* 日志列表 */}
                  <div className="flex-1 bg-n0 border border-n40 rounded-md overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-n40 bg-n30 flex justify-between items-center">
                      <span className="font-bold text-xs text-n300 uppercase">
                        生成日志列表 ({filteredLogs.length})
                      </span>
                      <div className="flex gap-2">
                        <button className="p-1 hover:bg-n20 rounded text-n300">
                          <Filter className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left text-xs table-fixed">
                        <thead className="bg-n30 text-n100 sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 w-[12%]">时间</th>
                            <th className="px-4 py-3 w-[15%]">用户</th>
                            <th className="px-4 py-3 w-[28%]">类型/模型</th>
                            <th className="px-4 py-3 w-[12%]">耗时</th>
                            <th className="px-4 py-3 w-[13%]">状态</th>
                            <th className="px-4 py-3 w-[20%] text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-n40">
                          {filteredLogs.slice(0, 200).map((log) => (
                            <tr
                              key={log.id}
                              className="hover:bg-n20 cursor-pointer group"
                              onClick={() => setInspectLog(log)}
                            >
                              <td className="px-4 py-3 text-n300 font-mono">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="px-4 py-3 font-medium text-n700">
                                {log.username}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col">
                                  <span
                                    className="text-n700 truncate"
                                    title={log.model}
                                  >
                                    {log.model.length > 18
                                      ? log.model.substring(0, 15) + "..."
                                      : log.model}
                                  </span>
                                  <span className="text-[10px] text-n100 uppercase">
                                    {log.type}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-n300 font-mono">
                                {(log.executionTimeMs / 1000).toFixed(2)}s
                              </td>
                              <td className="px-4 py-3">
                                {log.status === "success" ? (
                                  <span className="text-success flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Success
                                  </span>
                                ) : (
                                  <span className="text-danger flex items-center gap-1">
                                    <XCircle className="w-3 h-3" /> Failed
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button className="px-2 py-1 bg-n0 hover:bg-primary text-n300 hover:text-white rounded transition-colors opacity-0 group-hover:opacity-100">
                                  查看详情
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
      
              {/* 系统监控Tab */}
              {activeTab === "system" && (
                <div className="space-y-6 w-full">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-sm font-bold text-n300 uppercase tracking-wider flex items-center gap-2">
                      <Server className="w-4 h-4" />
                      集群节点状态 ({nodes.length} Nodes)
                    </h4>
                    <button
                      onClick={() => setShowAddNode(true)}
                      className="bg-primary hover:bg-primary-hover text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加节点
                    </button>
                  </div>
      
                  {nodes.length === 0 ? (
                    <div className="bg-n0 border border-n40 rounded-md p-6 text-sm text-n300 shadow-card">
                      {clusterNodeMessage || '当前没有可展示的集群节点。'}
                    </div>
                  ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                    {nodes.map((node) => {
                      const hasStorageMetric = node.storageTotal > 0;
                      const storagePercent = hasStorageMetric
                        ? Math.min(100, Math.max(0, (node.storageUsed / node.storageTotal) * 100))
                        : 0;
                      const hasGpuMetric = node.gpuUsage >= 0;
                      const gpuPercent = hasGpuMetric ? Math.min(100, Math.max(0, node.gpuUsage)) : 0;
                      return (
                      <div
                        key={node.id}
                        className="bg-n0 border border-n40 rounded-md p-5 shadow-card hover:shadow-atlas hover:border-primary transition-colors"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-lg ${
                                node.status === "online"
                                  ? "bg-g50 text-success"
                                  : node.status === "maintenance"
                                  ? "bg-y50 text-warning"
                                  : "bg-r50 text-danger"
                              }`}
                            >
                              <Server className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="font-bold text-n700">
                                {node.name}
                              </h3>
                              <div className="flex items-center gap-2 text-xs text-n100 font-mono">
                                <Network className="w-3 h-3" />
                                {sanitizeProcessingTerminology(node.ip)}
                              </div>
                            </div>
                          </div>
                          <div
                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                              node.status === "online"
                                ? "bg-g50 text-success border border-success"
                                : node.status === "maintenance"
                                ? "bg-y50 text-warning border border-warning"
                                : "bg-r50 text-danger border border-danger"
                            }`}
                          >
                            {node.status}
                          </div>
                        </div>
      
                        <div className="space-y-4">
                          {/* Storage */}
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-n300 flex items-center gap-1">
                                <Database className="w-3 h-3" /> Storage
                              </span>
                              <span className="text-n700 font-mono">
                                {hasStorageMetric ? `${node.storageUsed} GB / ${node.storageTotal} GB` : '未上报'}
                              </span>
                            </div>
                            <div className="h-2 bg-n0 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  hasStorageMetric && storagePercent > 90
                                    ? "bg-danger"
                                    : hasStorageMetric
                                    ? "bg-b400"
                                    : "bg-n40"
                                }`}
                                style={{ width: `${storagePercent}%` }}
                              ></div>
                            </div>
                          </div>
      
                          {/* GPU */}
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-n300 flex items-center gap-1">
                                <Zap className="w-3 h-3" /> 处理负载
                              </span>
                              <span className="text-n700 font-mono">
                                {hasGpuMetric ? `${node.gpuUsage}%` : '未上报'}
                              </span>
                            </div>
                            <div className="h-2 bg-n0 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  hasGpuMetric && node.gpuUsage > 90
                                    ? "bg-danger"
                                    : hasGpuMetric
                                    ? "bg-primary"
                                    : "bg-n40"
                                }`}
                                style={{ width: `${gpuPercent}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
      
                        <div className="mt-5 pt-4 border-t border-n40 flex justify-end">
                          <button
                            onClick={() => openSshConfig(node)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-n0 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors border border-n40"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            配置 SSH
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}

              {/* 2026-05-26 Slices 2/4/5: 新功能管理 */}
              {activeTab === "features" && (
                <AdminFeatureTabs />
              )}
            </div>
          </div>

            {/* Modals (权限编辑、添加用户、SSH配置、添加节点、日志详情) */}
            
            {/* 用户权限编辑 Modal */}
            {editingUser && (
                <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
                    <div className="bg-n0 border border-n40 rounded-md w-[720px] max-w-[94vw] shadow-bottom animate-in fade-in zoom-in-95">
                        <div className="p-4 border-b border-n40 flex justify-between items-center bg-n30 rounded-t-md">
                            <h3 className="font-bold text-n700">配置模型访问：{editingUser.username}</h3>
                            <button onClick={() => setEditingUser(null)}><X className="w-5 h-5 text-n100 hover:text-n800" /></button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">访问方式</label>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    {([
                                        ['inherit', '平台开放模型', '默认；开放模型均可按创作点数使用'],
                                        ['restricted', '限制模型范围', '只允许下方勾选的模型'],
                                        ['blocked', '禁止生成', '暂停该用户调用所有生成模型'],
                                    ] as const).map(([value, label, description]) => (
                                        <label key={value} className={`cursor-pointer rounded-md border p-3 ${editingUser.permissions.accessMode === value ? 'border-primary bg-primary-light' : 'border-n40 bg-n0'}`}>
                                            <input type="radio" className="mr-2" checked={editingUser.permissions.accessMode === value} onChange={() => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, accessMode: value } })} />
                                            <span className="text-sm font-semibold text-n700">{label}</span>
                                            <div className="mt-1 pl-5 text-[11px] text-n200">{description}</div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            {editingUser.permissions.accessMode === 'restricted' && (
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">允许使用的模型（至少选择 1 个）</label>
                                <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-n40 bg-n0 p-3 md:grid-cols-2">
                                    {MODEL_OPTIONS.map(model => (
                                        <label key={model.value} className="flex items-center gap-2 cursor-pointer hover:bg-n20 p-1.5 rounded transition-colors">
                                            <input 
                                                type="checkbox" 
                                                checked={editingUser.permissions.allowedModels.includes(model.value)}
                                                onChange={() => {
                                                    const newModels = handleModelToggle(model.value, editingUser.permissions.allowedModels);
                                                    setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, allowedModels: newModels } });
                                                }}
                                                className="rounded bg-n0 border-n40 text-primary focus:ring-0"
                                            />
                                            <span className="text-sm text-n700">{model.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-n300 block mb-2">优先级队列</label>
                                    <select 
                                        value={editingUser.permissions.priority}
                                        onChange={(e) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, priority: e.target.value as any } })}
                                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                    >
                                        <option value="low">Low (Free)</option>
                                        <option value="normal">Normal</option>
                                        <option value="high">High (VIP)</option>
                                    </select>
                                </div>
                                <div className="flex items-center pt-6">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="checkbox"
                                            checked={editingUser.permissions.canExport}
                                            onChange={(e) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canExport: e.target.checked } })}
                                            className="rounded bg-n0 border-n40 text-primary"
                                        />
                                        <span className="text-sm text-n700">允许导出结果</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-n40 bg-n30 rounded-b-md flex justify-end gap-3">
                            <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-n0 hover:bg-n20 rounded text-n700 text-sm">取消</button>
                            <button onClick={() => saveUserPermissions(editingUser.permissions)} className="px-4 py-2 bg-primary hover:bg-primary-hover rounded text-white text-sm font-bold">保存配置</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 添加用户 Modal */}
            {showAddUser && (
                <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
                    <div className="bg-n0 border border-n40 rounded-md w-[400px] shadow-bottom">
                         <div className="p-4 border-b border-n40 flex justify-between items-center bg-n30 rounded-t-md">
                            <h3 className="font-bold text-n700">添加新用户</h3>
                            <button onClick={() => setShowAddUser(false)}><X className="w-5 h-5 text-n100 hover:text-n800" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">
                                    用户名 <span className="text-danger">*</span>
                                </label>
                                <input 
                                    type="text" 
                                    value={newUserForm.username}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                    placeholder="输入用户名"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">
                                    登录密码 <span className="text-danger">*</span>
                                </label>
                                <input 
                                    type="password" 
                                    value={newUserForm.password}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                    placeholder="设置初始密码"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">
                                    邮箱 <span className="text-n100 text-[10px]">(可选)</span>
                                </label>
                                <input 
                                    type="email" 
                                    value={newUserForm.email}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                    placeholder="留空则自动生成"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">初始角色</label>
                                <select 
                                    value={newUserForm.role}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                                    disabled={!isSuperAdmin}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                >
                                    {PLATFORM_ROLE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                </select>
                                {!isSuperAdmin && <div className="mt-1 text-[11px] text-n200">管理员只能创建“创作者”账号；角色调整由超级管理员完成。</div>}
                            </div>
                        </div>
                        <div className="p-4 border-t border-n40 bg-n30 rounded-b-md flex justify-end gap-3">
                            <button onClick={() => setShowAddUser(false)} className="px-4 py-2 bg-n0 hover:bg-n20 rounded text-n700 text-sm">取消</button>
                            <button onClick={handleAddUser} className="px-4 py-2 bg-primary hover:bg-primary-hover rounded text-white text-sm font-bold">创建用户</button>
                        </div>
                    </div>
                </div>
            )}

            {/* SSH配置 Modal */}
            {sshModalNode && (
                <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
                    <div className="bg-n0 border border-n40 rounded-md w-[450px] shadow-bottom">
                         <div className="p-4 border-b border-n40 flex justify-between items-center bg-n30 rounded-t-md">
                            <div className="flex items-center gap-2">
                                <Terminal className="w-5 h-5 text-primary" />
                                <h3 className="font-bold text-n700">配置 SSH: {sshModalNode.name}</h3>
                            </div>
                            <button onClick={() => setSshModalNode(null)}><X className="w-5 h-5 text-n100 hover:text-n800" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-n30 p-3 rounded border border-n40 text-xs text-n300 font-mono mb-4">
                                Connection: ssh {sshForm.user}@{sshForm.host} -p {sshForm.port}
                            </div>
                            
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-2">
                                    <label className="text-xs font-bold text-n300 block mb-2">Host / IP</label>
                                    <input 
                                        type="text" 
                                        value={sshForm.host}
                                        onChange={(e) => setSshForm({ ...sshForm, host: e.target.value })}
                                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-n300 block mb-2">Port</label>
                                    <input 
                                        type="number" 
                                        value={sshForm.port}
                                        onChange={(e) => setSshForm({ ...sshForm, port: parseInt(e.target.value) })}
                                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">Username</label>
                                <input 
                                    type="text" 
                                    value={sshForm.user}
                                    onChange={(e) => setSshForm({ ...sshForm, user: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 block mb-2">Password (Optional)</label>
                                <input 
                                    type="password" 
                                    value={sshForm.password}
                                    onChange={(e) => setSshForm({ ...sshForm, password: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                    placeholder="Leave blank if using key"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-n300 flex items-center gap-2 mb-2">
                                    <Key className="w-3 h-3" />
                                    Private Key Path
                                </label>
                                <input 
                                    type="text" 
                                    value={sshForm.keyPath}
                                    onChange={(e) => setSshForm({ ...sshForm, keyPath: e.target.value })}
                                    className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                />
                            </div>
                        </div>
                        <div className="p-4 border-t border-n40 bg-n30 rounded-b-md flex justify-end gap-3">
                            <button onClick={() => setSshModalNode(null)} className="px-4 py-2 bg-n0 hover:bg-n20 rounded text-n700 text-sm">取消</button>
                            <button onClick={saveSshConfig} className="px-4 py-2 bg-primary hover:bg-primary-hover rounded text-white text-sm font-bold">保存连接配置</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 添加节点 Modal */}
            {showAddNode && (
                <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
                    <div className="bg-n0 border border-n40 rounded-md w-[550px] shadow-bottom flex flex-col max-h-[90vh]">
                         <div className="p-4 border-b border-n40 flex justify-between items-center bg-n30 rounded-t-md">
                            <div className="flex items-center gap-2">
                                <Server className="w-5 h-5 text-primary" />
                                <h3 className="font-bold text-n700">Add Compute Node</h3>
                            </div>
                            <button onClick={() => setShowAddNode(false)}><X className="w-5 h-5 text-n100 hover:text-n800" /></button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-n40">
                             <button 
                                onClick={() => setAddNodeMode('quick')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${addNodeMode === 'quick' ? 'border-primary text-primary bg-n30' : 'border-transparent text-n100 hover:text-n700'}`}
                             >
                                 Quick Import (SSH)
                             </button>
                             <button 
                                onClick={() => setAddNodeMode('manual')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${addNodeMode === 'manual' ? 'border-primary text-primary bg-n30' : 'border-transparent text-n100 hover:text-n700'}`}
                             >
                                 Manual Config
                             </button>
                        </div>

                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            {addNodeMode === 'quick' ? (
                                <div className="space-y-4">
                                    <div className="bg-primary-light border border-primary rounded p-3 text-xs text-primary">
                                        <p className="mb-2 font-bold">Paste your connection string below.</p>
                                        <p className="opacity-70">Supported format:</p>
                                        <code className="block bg-n0 border border-n40 p-2 rounded mt-1 text-n700 font-mono">
                                            通道：ssh -p 37174 root@connect.westd.seetacloud.com<br/>
                                            密码：D6JTE9P
                                        </code>
                                    </div>

                                    {connectionStep === 'idle' ? (
                                        <textarea 
                                            value={quickConfigText}
                                            onChange={(e) => setQuickConfigText(e.target.value)}
                                            className="w-full h-32 bg-n20 border border-n40 rounded p-3 font-mono text-xs text-success focus:border-primary focus:outline-none resize-none"
                                            placeholder="Paste configuration here..."
                                        />
                                    ) : (
                                        <div className="bg-n20 rounded-lg border border-n40 p-4 font-mono text-xs h-48 overflow-y-auto custom-scrollbar" ref={terminalRef}>
                                            {connectionLogs.map((log, i) => (
                                                <div key={i} className="mb-1">
                                                    <span className="text-success">root@admin-console:~$</span> <span className="text-n700">{log}</span>
                                                </div>
                                            ))}
                                            {connectionStep !== 'success' && (
                                                <div className="animate-pulse text-primary">_</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-n300 block mb-2">节点名称</label>
                                        <input 
                                            type="text" 
                                            value={newNodeForm.name}
                                            onChange={(e) => setNewNodeForm({ ...newNodeForm, name: e.target.value })}
                                            className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none"
                                            placeholder="e.g. Render-Node-05"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-n300 block mb-2">IP 地址</label>
                                        <input 
                                            type="text" 
                                            value={newNodeForm.ip}
                                            onChange={(e) => setNewNodeForm({ ...newNodeForm, ip: e.target.value })}
                                            className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                            placeholder="192.168.x.x"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-n300 block mb-2">总存储容量 (GB)</label>
                                        <input 
                                            type="number" 
                                            value={newNodeForm.storageTotal}
                                            onChange={(e) => setNewNodeForm({ ...newNodeForm, storageTotal: parseInt(e.target.value) })}
                                            className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-sm text-n800 focus:border-primary outline-none font-mono"
                                            placeholder="2000"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-n40 bg-n30 rounded-b-md flex justify-end gap-3">
                            <button onClick={() => setShowAddNode(false)} className="px-4 py-2 bg-n0 hover:bg-n20 rounded text-n700 text-sm">Cancel</button>
                            
                            {addNodeMode === 'quick' ? (
                                <button 
                                    onClick={parseAndConnect}
                                    disabled={connectionStep !== 'idle' || !quickConfigText.trim()}
                                    className="px-4 py-2 bg-primary hover:bg-primary-hover rounded text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {connectionStep === 'idle' ? (
                                        <>
                                            <Terminal className="w-4 h-4" />
                                            Parse & Connect
                                        </>
                                    ) : connectionStep === 'success' ? (
                                        <>
                                            <Check className="w-4 h-4" />
                                            Done
                                        </>
                                    ) : (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Processing...
                                        </>
                                    )}
                                </button>
                            ) : (
                                <button onClick={handleManualAddNode} className="px-4 py-2 bg-primary hover:bg-primary-hover rounded text-white text-sm font-bold">Add Node</button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 日志详情 Modal */}
            {inspectLog && (
                <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
                     <div className="bg-n0 border border-n40 rounded-md w-[800px] max-h-[90vh] flex flex-col shadow-bottom">
                        <div className="p-4 border-b border-n40 flex justify-between items-center bg-n30 rounded-t-md">
                            <div className="flex items-center gap-3">
                                <Terminal className="w-5 h-5 text-success" />
                                <h3 className="font-bold text-n700 font-mono">Log ID: {inspectLog.id}</h3>
                            </div>
                            <button onClick={() => setInspectLog(null)}><X className="w-5 h-5 text-n100 hover:text-n800" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <span className="text-xs font-bold text-n100 uppercase">Timestamp</span>
                                    <div className="text-sm text-n700">{new Date(inspectLog.timestamp).toLocaleString()}</div>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-n100 uppercase">User</span>
                                    <div className="text-sm text-n700 flex items-center gap-2">
                                        <span className="w-6 h-6 rounded-full bg-n0 flex items-center justify-center text-xs font-bold">{inspectLog.username[0]}</span>
                                        {inspectLog.username}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-n100 uppercase">Model Config</span>
                                    <div className="text-sm text-primary font-mono bg-n20 p-2 rounded border border-n40 mt-1">
                                        {inspectLog.model}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-n100 uppercase">Prompt Content</span>
                                    <div className="text-xs text-n700 bg-n20 p-3 rounded border border-n40 mt-1 h-32 overflow-y-auto leading-relaxed custom-scrollbar whitespace-pre-wrap">
                                        {inspectLog.prompt}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-n100 uppercase">Parameters (JSON)</span>
                                    <div className="text-xs text-success font-mono bg-n20 p-3 rounded border border-n40 mt-1">
                                        {inspectLog.params}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col h-full">
                                <span className="text-xs font-bold text-n100 uppercase mb-2">Generation Result</span>
                                <div className="flex-1 bg-n30 rounded-lg border border-n40 flex items-center justify-center overflow-hidden relative">
                                    {/* 根据类型显示不同的结果 */}
                                    {inspectLog.type === 'video' && inspectLog.resultVideo ? (
                                        <video 
                                            src={inspectLog.resultVideo} 
                                            controls 
                                            className="w-full h-full object-contain"
                                            preload="metadata"
                                        />
                                    ) : inspectLog.type === 'text' ? (
                                        <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar">
                                            <div className="text-n700 text-sm leading-relaxed whitespace-pre-wrap">
                                                {inspectLog.resultText || '（流式输出，无法回放完整内容）'}
                                            </div>
                                        </div>
                                    ) : inspectLog.resultPreview ? (
                                        <img src={inspectLog.resultPreview} loading="lazy" className="w-full h-full object-contain" alt="Result" />
                                    ) : (
                                        <div className="text-n100 flex flex-col items-center">
                                            <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                                            <span>No Preview Available</span>
                                        </div>
                                    )}
                                    <div className="absolute top-2 right-2 flex gap-2">
                                        <span className="bg-n0 text-n700 text-[10px] px-2 py-1 rounded border border-n40">
                                            {inspectLog.executionTimeMs.toFixed(0)}ms exec
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-4 p-3 bg-n30 rounded-lg border border-n40">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-n300">Queue Time</span>
                                        <span className="text-xs font-mono text-n700">{inspectLog.queueTimeMs.toFixed(2)}ms</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-n300">Status</span>
                                        <span className="text-xs font-bold text-success uppercase">{inspectLog.status}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                     </div>
                </div>
            )}

            {/* 🆕 自定义弹窗 */}
            {dialog && (
                <div className="fixed inset-0 z-[200] bg-n900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-n0 border border-n40 rounded-md w-[420px] shadow-bottom animate-in zoom-in-95 duration-200">
                        {/* 标题栏 */}
                        <div className="p-5 border-b border-n40 bg-gradient-to-r from-n30 to-n0">
                            <div className="flex items-center gap-3">
                                {dialog.type === 'confirm' ? (
                                    <AlertTriangle className="w-6 h-6 text-warning" />
                                ) : (
                                    <CheckCircle2 className="w-6 h-6 text-primary" />
                                )}
                                <h3 className="text-lg font-bold text-n800">{dialog.title}</h3>
                            </div>
                        </div>
                        
                        {/* 内容 */}
                        <div className="p-6">
                            <p className="text-n700 leading-relaxed">{dialog.message}</p>
                        </div>
                        
                        {/* 按钮区 */}
                        <div className="p-5 border-t border-n40 bg-n30 rounded-b-md flex justify-end gap-3">
                            {dialog.type === 'confirm' && (
                                <button 
                                    onClick={closeDialog}
                                    className="px-5 py-2.5 bg-n0 hover:bg-n20 rounded-lg text-n700 text-sm font-medium transition-colors"
                                >
                                    {dialog.cancelText || '取消'}
                                </button>
                            )}
                            <button 
                                onClick={() => {
                                    if (dialog.onConfirm) {
                                        dialog.onConfirm();
                                    }
                                    closeDialog();
                                }}
                                className={`px-5 py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${
                                    dialog.type === 'confirm' 
                                        ? 'bg-danger hover:bg-r50' 
                                        : 'bg-primary hover:bg-primary-hover'
                                }`}
                            >
                                {dialog.confirmText || '确定'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
