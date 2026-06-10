/**
 * CreditEstimateModal.tsx
 * 2026-05-26 Slice 2 — 通用积分估算弹窗
 *
 * 用法:
 *   <CreditEstimateModal
 *     open={open}
 *     featureKey="video_reverse_prompt"
 *     params={{ duration_seconds: 20 }}
 *     onCancel={() => setOpen(false)}
 *     onConfirm={(estimate) => start()}
 *   />
 *
 * 详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
 */

import React, { useEffect, useState } from 'react';
import { Coins, AlertTriangle, Loader2 } from 'lucide-react';
import { estimateCredits, CreditEstimateResult } from '../services/creditService';

interface CreditEstimateModalProps {
  open: boolean;
  featureKey: string;
  params?: Record<string, any>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (estimate: CreditEstimateResult) => void;
}

export const CreditEstimateModal: React.FC<CreditEstimateModalProps> = ({
  open, featureKey, params, title = '积分预估',
  description, confirmLabel = '确认并继续', cancelLabel = '取消',
  onCancel, onConfirm,
}) => {
  const [estimate, setEstimate] = useState<CreditEstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    estimateCredits(featureKey, params || {})
      .then(r => { if (!cancelled) setEstimate(r); })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, featureKey, JSON.stringify(params || {})]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
          <Coins size={18} className="text-yellow-400" />
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {description && <p className="text-zinc-400">{description}</p>}

          {loading && (
            <div className="flex items-center justify-center py-6 text-zinc-500">
              <Loader2 size={18} className="animate-spin mr-2" /> 估算中…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900 rounded">
              <AlertTriangle size={16} className="text-red-400 mt-0.5" />
              <span className="text-xs text-red-300">{error}</span>
            </div>
          )}

          {estimate && !loading && (
            <div className="space-y-2.5">
              {!estimate.enabled && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-900 rounded text-xs text-emerald-200">
                  该功能未配置积分规则，可免费使用
                </div>
              )}

              {estimate.enabled && (
                <>
                  <Row label="预计消耗" value={`${estimate.estimated_cost} 积分`} highlight />
                  <Row label="规则版本" value={estimate.rule_version || '-'} mono />
                  {estimate.base_cost !== undefined && (
                    <Row label="基础消耗" value={`${estimate.base_cost} (${estimate.billing_unit || 'task'})`} />
                  )}
                  {estimate.min_cost !== undefined && (
                    <Row label="区间" value={`${estimate.min_cost} - ${estimate.max_cost ?? '∞'}`} />
                  )}
                  <Row
                    label="账户余额"
                    value={estimate.balance != null ? `${estimate.balance} 积分` : '-'}
                    valueClass={estimate.enough ? 'text-emerald-300' : 'text-red-300'}
                  />
                  {!estimate.enough && (
                    <div className="flex items-start gap-2 p-2 bg-red-950/40 border border-red-900 rounded text-xs text-red-200">
                      <AlertTriangle size={14} className="text-red-400 mt-0.5" />
                      余额不足，无法继续
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => estimate && onConfirm(estimate)}
            disabled={!estimate || loading || (estimate?.enabled && !estimate?.enough)}
            className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; highlight?: boolean; mono?: boolean; valueClass?: string }> = ({
  label, value, highlight, mono, valueClass,
}) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-zinc-500">{label}</span>
    <span className={`${highlight ? 'text-yellow-300 text-base font-semibold' : 'text-zinc-200'} ${mono ? 'font-mono' : ''} ${valueClass || ''}`}>
      {value}
    </span>
  </div>
);

export default CreditEstimateModal;
