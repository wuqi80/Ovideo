/**
 * CreditsPage.tsx
 * 2026-05-26 Slice 2 — 用户创作点数页面
 *
 * 路由: /credits
 * 显示: 余额卡片 + 流水表格 + 筛选
 *
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, RefreshCw, ArrowDownCircle, Info, Snowflake } from 'lucide-react';
import {
  getCreditBalance, listCreditTransactions,
  CreditBalance, CreditTransaction,
} from '../services/creditService';
import WechatCreationPointRecharge from '../components/WechatCreationPointRecharge';

const CHANGE_TYPE_LABEL: Record<string, { label: string; color: string; sign: 1 | -1 | 0 }> = {
  freeze:        { label: '冻结（暂占）', color: 'text-warning', sign: 0 },
  release:       { label: '退还',       color: 'text-success', sign:  1 },
  consume:       { label: '消耗',       color: 'text-danger',   sign: -1 },
  admin_credit:  { label: '管理员充值', color: 'text-success', sign:  1 },
  admin_debit:   { label: '管理员扣减', color: 'text-danger',   sign: -1 },
  recharge:      { label: '充值',       color: 'text-success', sign:  1 },
  gift:          { label: '赠送',       color: 'text-success', sign:  1 },
  expire:        { label: '过期',       color: 'text-n300',  sign: -1 },
};

const FEATURE_LABEL: Record<string, string> = {
  design_image_generation: 'AI 生图',
  storyboard_image_generation: '分镜生图',
  storyboard_design_generation: '分镜设计',
  script_model_call: '剧本 AI',
};

const IMAGE_TIER_LABEL: Record<string, string> = {
  image_tier_1: 'Gemini 2.5 Flash Image',
  image_tier_2: 'Gemini 3.1 Flash Image Preview',
  image_tier_3: 'Doubao-Seedream-5.0-lite',
};

/**
 * 默认流水中，同一 task 的 freeze + consume/release 是一次业务结算，
 * 不是两次扣费。隐藏已结算的中间冻结行，但在用户明确筛选“冻结”时保留原始审计流水。
 */
export function collapseSettledFreezeRows(
  transactions: CreditTransaction[],
  filterChangeType = '',
): CreditTransaction[] {
  if (filterChangeType) return transactions;
  const settledTaskIds = new Set(
    transactions
      .filter(item => item.task_id && (item.change_type === 'consume' || item.change_type === 'release'))
      .map(item => item.task_id as string),
  );
  return transactions.filter(item => !(
    item.change_type === 'freeze'
    && item.task_id
    && settledTaskIds.has(item.task_id)
  ));
}

export function formatCreditBillingDetail(transaction: CreditTransaction): string {
  const params = transaction.metadata?.billing_params || {};
  const count = Number(params.image_count || 0);
  const model = String(params.model || '');
  const parts: string[] = [];
  if (count > 0) parts.push(`${count} 张`);
  if (model) parts.push(IMAGE_TIER_LABEL[model] || model);
  if (params.resolution) parts.push(String(params.resolution));
  if (params.aspect_ratio) parts.push(String(params.aspect_ratio));
  return parts.join(' · ') || '-';
}

export const CreditsPage: React.FC = () => {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [filterChangeType, setFilterChangeType] = useState<string>('');
  const [filterFeature, setFilterFeature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleTransactions = collapseSettledFreezeRows(transactions, filterChangeType);

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
    <div className="min-h-screen bg-n0 text-n800">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-n300 hover:text-n800">← 返回</button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Coins size={20} className="text-warning" />
            我的创作点数
          </h1>
          <button onClick={reload} className="ml-auto p-2 rounded bg-n0 hover:bg-n20">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="p-3 text-sm text-danger bg-r50 border border-r75 rounded">
            {error}
          </div>
        )}

        {/* 余额卡片 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <BalanceCard
            title="可用创作点数"
            value={balance?.available_credits ?? 0}
            color="from-g50 to-n0"
            icon={<Coins size={20} className="text-success" />}
          />
          <BalanceCard
            title="账户点数"
            value={balance?.account_credits ?? 0}
            color="from-b50 to-n0"
            icon={<Coins size={20} className="text-primary" />}
          />
          <BalanceCard
            title="赠送点数"
            value={balance?.gift_credits ?? 0}
            subtitle={balance?.gift_expires_at ? `${new Date(balance.gift_expires_at).toLocaleString('zh-CN')} 过期` : '暂无当日赠送'}
            color="from-y50 to-n0"
            icon={<Coins size={20} className="text-warning" />}
          />
          <BalanceCard
            title="冻结中"
            value={balance?.frozen_credits ?? 0}
            color="from-y50 to-n0"
            icon={<Snowflake size={20} className="text-warning" />}
          />
          <BalanceCard
            title="累计消耗"
            value={balance?.total_used_credits ?? 0}
            color="from-n30 to-n0"
            icon={<ArrowDownCircle size={20} className="text-n300" />}
          />
        </div>

        <WechatCreationPointRecharge onPaymentSuccess={reload} />

        {/* 筛选 + 流水 */}
        <section className="rounded-md border border-n40 bg-n0 shadow-card">
          <div className="flex items-start gap-2 border-b border-n40 bg-b50/50 px-4 py-3 text-xs text-n300">
            <Info size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              任务提交时会先暂时冻结预估创作点数；成功后从冻结额结算为消耗，不会再扣一次，失败则自动退还。
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-n40 text-sm">
            <span className="font-medium whitespace-nowrap">创作点数流水</span>
            <select
              value={filterChangeType}
              onChange={e => setFilterChangeType(e.target.value)}
              className="sm:ml-3 text-xs bg-n0 border border-n40 rounded px-2 py-1"
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
              className="order-last w-full text-xs bg-n0 border border-n40 rounded px-2 py-1 sm:order-none sm:w-56"
            />
            <span className="ml-auto text-xs text-n100">
              共 {visibleTransactions.length} 笔
              {!filterChangeType && visibleTransactions.length !== transactions.length
                ? `（已合并 ${transactions.length - visibleTransactions.length} 条中间冻结流水）`
                : ''}
            </span>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="text-n100 bg-n20">
                <tr>
                  <th className="text-left py-2 px-3">时间</th>
                  <th className="text-left py-2 px-3">类型</th>
                  <th className="text-left py-2 px-3">功能</th>
                  <th className="text-left py-2 px-3">计费详情</th>
                  <th className="text-right py-2 px-3">金额</th>
                  <th className="text-right py-2 px-3">余额前</th>
                  <th className="text-right py-2 px-3">余额后</th>
                  <th className="text-left py-2 px-3">任务</th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map(t => {
                  const meta = CHANGE_TYPE_LABEL[t.change_type] || { label: t.change_type, color: 'text-n700', sign: 0 as const };
                  const sign = meta.sign;
                  return (
                    <tr key={t.transaction_id} className="border-t border-n40">
                      <td className="py-2 px-3 text-n300">
                        {new Date(t.created_at).toLocaleString('zh-CN')}
                      </td>
                      <td className={`py-2 px-3 ${meta.color}`}>{meta.label}</td>
                      <td className="py-2 px-3 text-n700">
                        {FEATURE_LABEL[t.feature_key || ''] || t.feature_key || '-'}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-n300">
                        {formatCreditBillingDetail(t)}
                      </td>
                      <td className={`py-2 px-3 text-right font-mono ${meta.color}`}>
                        {t.change_type === 'freeze'
                          ? `暂占 ${t.amount}`
                          : `${sign === 1 ? '+' : sign === -1 ? '-' : ''}${t.amount}`}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-n300">{t.balance_before}</td>
                      <td className="py-2 px-3 text-right font-mono text-n700">{t.balance_after}</td>
                      <td className="py-2 px-3 text-n100 font-mono truncate max-w-[200px]">
                        {t.task_id || '-'}
                      </td>
                    </tr>
                  );
                })}
                {!visibleTransactions.length && (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-n100">
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
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}> = ({ title, value, subtitle, color, icon }) => (
  <div className={`relative rounded-md border border-n40 p-4 shadow-card bg-gradient-to-br ${color}`}>
    <div className="flex items-center justify-between">
      <div className="text-xs text-n300">{title}</div>
      {icon}
    </div>
    <div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    {subtitle && <div className="mt-2 text-[11px] leading-4 text-n200">{subtitle}</div>}
  </div>
);

export default CreditsPage;
