// new_html/components/SeedanceAssetPickerModal.tsx
import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { SeedanceParams } from '../services/videoService';
import type { SeedanceAssetCandidate } from '../utils/seedanceMedia';
import { insertMention, parseArkAssetId } from '../utils/seedanceMedia';

export interface SeedanceAssetPickerModalProps {
    open: boolean;
    onClose: () => void;
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
}

const GROUP_LABELS: Record<string, string> = {
    current_card: '当前卡',
    storyboard_data: '分镜',
    assets: '素材库',
    audio: '音频',
    video_segments: '视频片段',
    user_files: '媒体库',
    ark_asset_id: '远程 ID',
};

export const SeedanceAssetPickerModal: React.FC<SeedanceAssetPickerModalProps> = (p) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [arkRaw, setArkRaw] = useState('');

    if (!p.open) return null;

    const grouped: Record<string, SeedanceAssetCandidate[]> = {};
    for (const c of p.candidates) (grouped[c.group] ||= []).push(c);

    const apply = () => {
        let next = p.value;
        for (const cand of p.candidates) {
            if (selected.has(cand.id)) {
                if (cand.group === 'ark_asset_id') {
                    const valid = parseArkAssetId(arkRaw);
                    if (!valid) continue;
                    next = insertMention(next, { ...cand, arkAssetId: valid });
                } else {
                    next = insertMention(next, cand);
                }
            }
        }
        p.onChange(next);
        p.onClose();
        setSelected(new Set());
        setArkRaw('');
    };

    return (
        <div className="fixed inset-0 z-50 bg-n900/50 flex items-center justify-center" onClick={p.onClose}>
            <div className="w-[600px] max-h-[80vh] bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-n40">
                    <div className="text-sm text-n700">插入素材（多选）</div>
                    <button onClick={p.onClose} className="p-1 text-n300 hover:text-n800"><X size={14} /></button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                    {Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                            <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">{GROUP_LABELS[group] || group}</div>
                            {group === 'ark_asset_id' ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={arkRaw}
                                        onChange={e => setArkRaw(e.target.value)}
                                        placeholder="asset://abc-123"
                                        className="flex-1 px-2 py-1 text-xs bg-n0 border border-n40 rounded text-n700"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const id = items[0]?.id;
                                            if (id) setSelected(s => {
                                                const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns;
                                            });
                                        }}
                                        className="px-2 py-1 text-[10px] bg-n0 hover:bg-n20 rounded text-n700"
                                    >
                                        {selected.has(items[0]?.id || '') ? '已勾选' : '勾选'}
                                    </button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {items.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelected(s => {
                                                const ns = new Set(s); ns.has(c.id) ? ns.delete(c.id) : ns.add(c.id); return ns;
                                            })}
                                            className={`relative p-2 rounded border text-left ${selected.has(c.id) ? 'border-primary bg-primary-light' : 'border-n40 hover:bg-n20'}`}
                                        >
                                            {c.thumbnailUrl && (
                                                <img src={c.thumbnailUrl} alt="" className="w-full h-16 object-cover rounded mb-1" />
                                            )}
                                            <div className="text-[11px] text-n700 truncate">{c.label}</div>
                                            <div className="text-[9px] text-n100">{c.kind}</div>
                                            {selected.has(c.id) && (
                                                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                                    <Plus size={10} className="text-white rotate-45" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-n40">
                    <button onClick={p.onClose} className="px-3 py-1 text-xs text-n700">取消</button>
                    <button onClick={apply} disabled={selected.size === 0} className="px-3 py-1 text-xs bg-primary hover:bg-primary-hover disabled:opacity-40 rounded text-white">
                        插入 {selected.size} 项
                    </button>
                </div>
            </div>
        </div>
    );
};
