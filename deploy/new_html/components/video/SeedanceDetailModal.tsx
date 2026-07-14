// new_html/components/video/SeedanceDetailModal.tsx
//
// Modal wrapper around <SeedanceMultimodalPanel> used by the list view (Issue 7).
// Lets the list keep each row tight (~64px) while still letting the user reach
// the full driving-cabin of media_inputs / output params.
//
// Behavior: real-time save (value/onChange bind directly to caller state).
// Single ✕ close button. Click backdrop = close. Esc to close.

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../../services/videoModelService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';

export interface SeedanceDetailModalProps {
    open: boolean;
    title: string;
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    onClose: () => void;
    /** 2026-05-20 (Bug 4)：转发到内部 MentionTokensRow，让列表视图也能预览。 */
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
}

export const SeedanceDetailModal: React.FC<SeedanceDetailModalProps> = (p) => {
    useEffect(() => {
        if (!p.open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [p.open, p.onClose]);

    if (!p.open) return null;
    return (
        <div
            role="dialog"
            aria-label="Seedance 详情"
            className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4"
            onClick={p.onClose}
        >
            <div
                className="w-[520px] max-w-full max-h-[85vh] bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-n40">
                    <div className="text-xs text-n800">
                        <span className="opacity-60">Seedance 详情 ·</span>
                        <span className="ml-1.5 font-semibold">{p.title}</span>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        aria-label="关闭"
                        className="p-1 text-n300 hover:text-primary transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <SeedanceMultimodalPanel
                        value={p.value}
                        onChange={p.onChange}
                        candidates={p.candidates}
                        onPreviewMedia={p.onPreviewMedia}
                        onUsePreviousVideoAudio={p.onUsePreviousVideoAudio}
                        previousVideoAudioBusy={p.previousVideoAudioBusy}
                        audioReferenceNotice={p.audioReferenceNotice}
                    />
                </div>
            </div>
        </div>
    );
};

export default SeedanceDetailModal;
