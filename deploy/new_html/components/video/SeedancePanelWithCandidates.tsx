import React from 'react';
import type { SeedanceMediaInput, SeedanceParams } from '../../services/videoModelService';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';

export interface SeedancePanelWithCandidatesProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    autoOpenMentionOnMount?: boolean;
    storyboardItemId?: string;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

export const SeedancePanelWithCandidates: React.FC<SeedancePanelWithCandidatesProps> = ({
    value,
    onChange,
    disabled,
    autoOpenMentionOnMount,
    storyboardItemId,
    onPreviewMedia,
}) => {
    const { candidates } = useSeedanceCandidates({
        currentParams: value,
        currentStoryboardItemId: storyboardItemId,
    });

    return (
        <SeedanceMultimodalPanel
            value={value}
            onChange={onChange}
            disabled={disabled}
            candidates={candidates}
            autoOpenMentionOnMount={autoOpenMentionOnMount}
            onPreviewMedia={onPreviewMedia}
        />
    );
};

export default SeedancePanelWithCandidates;
