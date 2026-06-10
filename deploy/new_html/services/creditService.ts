/**
 * creditService.ts
 * 2026-05-26 Slice 2 — 用户侧积分 API
 * 详见 docs/superpowers/plans/2026-05-26-feature-rollout/02-credits.md
 */

import { handleResponse, getHeaders } from './apiService';

const API_BASE = '';

export interface CreditBalance {
  success: boolean;
  account_id: string;
  available_credits: number;
  frozen_credits: number;
  total_used_credits: number;
}

export interface CreditEstimateResult {
  success: boolean;
  feature_key: string;
  enabled: boolean;
  estimated_cost: number;
  rule_id?: string;
  rule_version?: string;
  base_cost?: number;
  billing_unit?: string;
  min_cost?: number;
  max_cost?: number | null;
  balance: number | null;
  enough: boolean;
  message?: string;
}

export interface CreditTransaction {
  transaction_id: string;
  account_id: string;
  user_id: string | null;
  team_id: string | null;
  project_id: string | null;
  task_id: string | null;
  feature_key: string | null;
  change_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  rule_version: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export async function getCreditBalance(): Promise<CreditBalance> {
  const resp = await fetch(`${API_BASE}/api/credits/balance`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'getCreditBalance');
}

export async function estimateCredits(
  featureKey: string,
  params: Record<string, any> = {},
): Promise<CreditEstimateResult> {
  const resp = await fetch(`${API_BASE}/api/credits/estimate`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ feature_key: featureKey, params }),
  });
  return handleResponse(resp, 'estimateCredits');
}

export interface ListTransactionsParams {
  feature_key?: string;
  change_type?: string;
  from_dt?: string;
  to_dt?: string;
  limit?: number;
  offset?: number;
}

export async function listCreditTransactions(
  params: ListTransactionsParams = {},
): Promise<{ success: boolean; transactions: CreditTransaction[]; limit: number; offset: number }> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const resp = await fetch(`${API_BASE}/api/credits/transactions${qs}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'listCreditTransactions');
}


// ============================================
// Admin endpoints — credit rules
// ============================================

export interface CreditRule {
  rule_id: string;
  feature_key: string;
  feature_name: string;
  enabled: boolean;
  base_cost: number;
  billing_unit: string;
  factors: any[];
  min_cost: number;
  max_cost: number | null;
  rule_version: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export async function adminListCreditRules(): Promise<{ success: boolean; rules: CreditRule[] }> {
  const resp = await fetch(`${API_BASE}/api/admin/credit-rules`, {
    method: 'GET',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'adminListCreditRules');
}

export async function adminCreateCreditRule(payload: Partial<CreditRule> & {
  feature_key: string; feature_name: string; base_cost: number;
}): Promise<{ success: boolean; rule: CreditRule }> {
  const resp = await fetch(`${API_BASE}/api/admin/credit-rules`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'adminCreateCreditRule');
}

export async function adminUpdateCreditRule(
  ruleId: string,
  payload: Partial<CreditRule>,
): Promise<{ success: boolean; rule: CreditRule }> {
  const resp = await fetch(`${API_BASE}/api/admin/credit-rules/${ruleId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(resp, 'adminUpdateCreditRule');
}

export async function adminDeleteCreditRule(ruleId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_BASE}/api/admin/credit-rules/${ruleId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return handleResponse(resp, 'adminDeleteCreditRule');
}
