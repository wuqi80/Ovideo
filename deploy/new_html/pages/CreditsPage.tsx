/**
 * CreditsPage.tsx
 * 2026-05-26 Slice 2 — 用户积分页面
 *
 * 路由: /credits
 * 显示: 余额卡片 + 流水表格 + 筛选
 *
 * 详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, RefreshCw, ArrowDownCircle, ArrowUpCircle, Snowflake } from 'lucide-react';
import {
  getCreditBalance, listCreditTransactions,
  CreditBalance, CreditTransaction,
} from '../services/creditService';

const CHANGE_TYPE_LABEL: Record<string, { label: string; color: string; sign: 1 | -1 | 0 }> = {
  freeze:        { label: '冻结',       color: 'text-amber-400', sign: -1 },
  release:       { label: '退还',       color: 'text-emerald-400', sign:  1 },
  consume:       { label: '消耗',       color: 'text-red-400',   sign: -1 },
  admin_credit:  { label: '管理员充值', color: 'text-emerald-400', sign:  1 },
  admin_debit:   { label: '管理员扣减', color: 'text-red-400',   sign: -1 },
  recharge:      { label: '充值',       color: 'text-emerald-400', sign:  1 },
  gift:          { label: '赠送',       color: 'text-emerald-400', sign:  1 },
  expire:        { label: '过期',       color: 'text-zinc-400',  sign: -1 },
};

export const CreditsPage: React.FC = () => {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [filterChangeType, setFilterChangeType] = useState<string>('');
  const [filterFeature, setFilterFeature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([
        getCreditBalance(),
        listCreditTransactions({
          change_type: filterChangeType || undefined,
          feature_key: filterFeature || undefined,
          limit: 200,
        }),
      ]);
      setBalance(b);
      setTransactions(t.transactions || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [filterChangeType, filterFeature]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-zinc-400 hover:text-zinc-100">← 返回</button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            我的积分
          </h1>
          <button onClick={reload} className="ml-auto p-2 rounded bg-zinc-800 hover:bg-zinc-700">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="p-3 text-sm text-red-300 bg-red-950/50 border border-red-900 rounded">
            {error}
          </div>
        )}

        {/* 余额卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BalanceCard
            title="可用积分"
            value={balance?.available_credits ?? 0}
            color="from-emerald-500/20 to-emerald-500/5"
            icon={<Coins size={20} className="text-emerald-400" />}
          />
          <BalanceCard
            title="冻结中"
            value={balance?.frozen_credits ?? 0}
            color="from-amber-500/20 to-amber-500/5"
            icon={<Snowflake size={20} className="text-amber-400" />}
          />
          <BalanceCard
            title="累计消耗"
            value={balance?.total_used_credits ?? 0}
            color="from-zinc-500/20 to-zinc-500/5"
            icon={<ArrowDownCircle size={20} className="text-zinc-400" />}
          />
        </div>

        {/* 筛选 + 流水 */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 text-sm">
            <span className="font-medium">积分流水</span>
            <select
              value={filterChangeType}
              onChange={e => setFilterChangeType(e.target.value)}
              className="ml-3 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="">全部类型</option>
              {Object.keys(CHANGE_TYPE_LABEL).map(k => (
                <option key={k} value={k}>{CHANGE_TYPE_LABEL[k].label}</option>
              ))}
            </select>
            <input
              value={filterFeature}
              onChange={e => setFilterFeature(e.target.value)}
              placeholder="按功能筛选 (feature_key)"
              className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-56"
            />
            <span className="ml-auto text-xs text-zinc-500">共 {transactions.length} 条</span>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 bg-zinc-950">
                <tr>
                  <th className="text-left py-2 px-3">时间</th>
                  <th className="text-left py-2 px-3">类型</th>
                  <th className="text-left py-2 px-3">功能</th>
                  <th className="text-right py-2 px-3">金额</th>
                  <th className="text-right py-2 px-3">余额前</th>
                  <th className="text-right py-2 px-3">余额后</th>
                  <th className="text-left py-2 px-3">任务</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => {
                  const meta = CHANGE_TYPE_LABEL[t.change_type] || { label: t.change_type, color: 'text-zinc-300', sign: 0 as const };
                  const sign = meta.sign;
                  return (
                    <tr key={t.transaction_id} className="border-t border-zinc-800/60">
                      <td className="py-2 px-3 text-zinc-400">
                        {new Date(t.created_at).toLocaleString('zh-CN')}
                      </td>
                      <td className={`py-2 px-3 ${meta.color}`}>{meta.label}</td>
                      <td className="py-2 px-3 text-zinc-300">{t.feature_key || '-'}</td>
                      <td className={`py-2 px-3 text-right font-mono ${meta.color}`}>
                        {sign === 1 ? '+' : sign === -1 ? '-' : ''}{t.amount}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-zinc-400">{t.balance_before}</td>
                      <td className="py-2 px-3 text-right font-mono text-zinc-300">{t.balance_after}</td>
                      <td className="py-2 px-3 text-zinc-500 font-mono truncate max-w-[200px]">
                        {t.task_id || '-'}
                      </td>
                    </tr>
                  );
                })}
                {!transactions.length && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-zinc-500">
                      暂无流水
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};


const BalanceCard: React.FC<{
  title: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}> = ({ title, value, color, icon }) => (
  <div className={`relative rounded-lg border border-zinc-800 p-4 bg-gradient-to-br ${color}`}>
    <div className="flex items-center justify-between">
      <div className="text-xs text-zinc-400">{title}</div>
      {icon}
    </div>
    <div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
  </div>
);

export default CreditsPage;
