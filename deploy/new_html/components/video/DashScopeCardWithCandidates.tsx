import React, { useCallback, useMemo } from 'react';
import type {
    DashScopeVideoParams,
    SeedanceMediaInput,
    SeedanceParams,
} from '../../services/videoModelService';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { SeedanceMentionPromptEditor } from '../SeedanceMentionPromptEditor';
import { DashScopeVideoCard, type DashScopePromptEditorProps } from './DashScopeCards';

export interface DashScopeCardWithCandidatesProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    onPickImage: (cb: (media: SeedanceMediaInput) => void) => void;
    onPreviewImage?: (url: string) => void;
    disabled?: boolean;
    storyboardItemId?: string;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

export const DashScopeCardWithCandidates: React.FC<DashScopeCardWithCandidatesProps> = (props) => {
    const adapted = useMemo<SeedanceParams>(() => ({
        sub_model: 'standard',
        prompt: props.params.prompt || '',
        media_inputs: props.params.media_inputs || [],
    }), [props.params.prompt, props.params.media_inputs]);

    const { candidates } = useSeedanceCandidates({
        currentParams: adapted,
        currentStoryboardItemId: props.storyboardItemId,
    });

    const PromptEditor = useCallback<React.FC<DashScopePromptEditorProps>>((editorProps) => {
        const fakeSeedanceParams: SeedanceParams = {
            sub_model: 'standard',
            prompt: editorProps.params.prompt || '',
            media_inputs: editorProps.params.media_inputs || [],
        };

        return (
            <SeedanceMentionPromptEditor
                value={fakeSeedanceParams}
                onChange={(next) => editorProps.onChange({
                    ...editorProps.params,
                    prompt: next.prompt,
                    media_inputs: next.media_inputs,
                })}
                candidates={candidates}
                disabled={editorProps.disabled}
                placeholder={editorProps.placeholder}
                onPreviewMedia={props.onPreviewMedia}
                hideTokensRow={true}
            />
        );
    }, [candidates, props.onPreviewMedia]);

    return (
        <DashScopeVideoCard
            params={props.params}
            onChange={props.onChange}
            onPickImage={props.onPickImage}
            onPreviewImage={props.onPreviewImage}
            disabled={props.disabled}
            PromptEditor={PromptEditor}
        />
    );
};

export default DashScopeCardWithCandidates;
