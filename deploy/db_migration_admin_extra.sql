-- ============================================
-- 2026-05-26 Admin 阶段 2（Slice 5）— Audit + Media / Credit 扩展列
-- 详见 docs/superpowers/plans/2026-05-26-feature-rollout/05-admin-media-credit-audit.md
-- ============================================

-- 1. admin_audit_logs: 管理员操作审计
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id SERIAL PRIMARY KEY,
    audit_id VARCHAR(50) UNIQUE NOT NULL,
    admin_user_id VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,                       -- user_disable | user_enable | credit_adjust | media_delete | rule_update | ...
    target_type VARCHAR(50),                             -- user | project | media_library_item | credit_account | credit_rule | project_group
    target_id VARCHAR(100),
    before_data JSONB DEFAULT '{}'::jsonb,
    after_data JSONB DEFAULT '{}'::jsonb,
    ip VARCHAR(64),
    user_agent VARCHAR(512),
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_admin   ON admin_audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);


-- 2. credit_accounts 扩展
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS status       VARCHAR(30) DEFAULT 'active';
ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS credit_limit INTEGER DEFAULT 0;


-- 3. credit_transactions 扩展（管理员操作字段）
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS operated_by      VARCHAR(50);
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS operation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_operated_by ON credit_transactions(operated_by);


-- 4. media_library_items 扩展（管理员删除字段）
ALTER TABLE media_library_items ADD COLUMN IF NOT EXISTS deleted_by     VARCHAR(50);
ALTER TABLE media_library_items ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
