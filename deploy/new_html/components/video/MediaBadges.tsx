// new_html/components/video/MediaBadges.tsx
//
// Compact badge row used in the list view (Issue 7) to summarize
// media_inputs without rendering the full SeedanceMultimodalPanel.
//
// Visual: [图3] [视0] [音1]
//   - color-coded per kind (cyan-blue / purple / orange)
//   - zero counts get a muted slate variant + data-zero='true' for tests
//   - hover tooltip shows up to first 3 filenames per kind, "+N more" suffix

import React from 'react';
import type { SeedanceParams } from '../../services/videoService';

export interface MediaBadgesProps {
    params: SeedanceParams;
}

const KIND_LABEL: Record<'image' | 'video' | 'audio', string> = {
    image: '图', video: '视', audio: '音',
};

function tooltipFor(params: SeedanceParams, kind: 'image' | 'video' | 'audio'): string {
    const items = params.media_inputs.filter(m => m.kind === kind);
    if (items.length === 0) return `没有${KIND_LABEL[kind]}片输入`;
    const top = items.slice(0, 3).map(m => (m.url || '').split('/').pop() || '').filter(Boolean);
    const extra = items.length - top.length;
    return extra > 0 ? `${top.join(' · ')}  +${extra} more` : top.join(' · ');
}

const TONE: Record<'image' | 'video' | 'audio', { active: string; zero: string }> = {
    image: {
        active: 'bg-blue-500/15 text-blue-300 border border-blue-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
    video: {
        active: 'bg-purple-500/15 text-purple-300 border border-purple-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
    audio: {
        active: 'bg-orange-500/15 text-orange-300 border border-orange-700/40',
        zero:   'bg-slate-800 text-slate-600 border border-slate-700/40',
    },
};

export const MediaBadges: React.FC<MediaBadgesProps> = ({ params }) => {
    const counts = {
        image: params.media_inputs.filter(m => m.kind === 'image').length,
        video: params.media_inputs.filter(m => m.kind === 'video').length,
        audio: params.media_inputs.filter(m => m.kind === 'audio').length,
    };
    return (
        <div className="flex items-center gap-1 shrink-0">
            {(['image', 'video', 'audio'] as const).map(kind => {
                const n = counts[kind];
                const isZero = n === 0;
                return (
                    <span
                        key={kind}
                        data-kind={kind}
                        data-zero={isZero ? 'true' : 'false'}
                        title={tooltipFor(params, kind)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isZero ? TONE[kind].zero : TONE[kind].active
                        }`}
                    >
                        {KIND_LABEL[kind]}{n}
                    </span>
                );
            })}
        </div>
    );
};

export default MediaBadges;
