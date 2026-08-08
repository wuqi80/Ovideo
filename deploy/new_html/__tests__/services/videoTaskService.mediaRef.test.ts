import {
    buildComfyUIVideoTaskPayload,
    normalizeVideoMediaRef,
    submitSeedanceTask,
    submitTask,
} from '../../services/videoTaskService';

describe('normalizeVideoMediaRef', () => {
    it('preserves persistent application URLs for MiniMax frames', () => {
        expect(normalizeVideoMediaRef('/storage/image/storyboard-real.png'))
            .toBe('/storage/image/storyboard-real.png');
        expect(normalizeVideoMediaRef('/api/files/file_real123/download'))
            .toBe('/api/files/file_real123/download');
    });

    it('preserves file ids and public URLs', () => {
        expect(normalizeVideoMediaRef('file_real123')).toBe('file_real123');
        expect(normalizeVideoMediaRef('https://cdn.example.test/frame.png'))
            .toBe('https://cdn.example.test/frame.png');
    });

    it('maps actual temporary upload filenames to the uploads mount', () => {
        expect(normalizeVideoMediaRef('uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
        expect(normalizeVideoMediaRef('uploads/uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
    });
});

describe('MiniMax submission validation', () => {
    it('rejects an unsupported resolution and duration pair before calling the API', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await expect(submitTask(
            '/storage/frame.png',
            null,
            'move gently',
            'MINI',
            undefined,
            undefined,
            'single',
            undefined,
            {
                duration: 10,
                minimax_resolution: '1080P',
            },
        )).rejects.toThrow('1080P 仅支持 6 秒');

        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

describe('Seedance model scope submission', () => {
    it('passes model_scope through to the backend task body', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_1' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'standard',
            model_scope: 'studio',
            prompt: 'make a shot',
            media_inputs: [],
        });

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}')).model_scope).toBe('studio');
        fetchSpy.mockRestore();
    });

    it('passes Seedance Mini sub_model and downgrades 1080p to 720p', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_mini' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'mini',
            prompt: 'make a low cost shot',
            media_inputs: [],
            resolution: '1080p',
        });

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            sub_model: 'mini',
            resolution: '720p',
        });
        fetchSpy.mockRestore();
    });

    it('keeps Seedance Mini multimodal media roles and 15-second duration without agent-plan normalization', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_mini_multi' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'mini',
            prompt: 'make a multimodal shot',
            duration: 15,
            media_inputs: [
                { kind: 'image', url: '/ref-a.png', role: 'reference_image' },
                { kind: 'image', url: '/ref-b.png', role: 'reference_image' },
                { kind: 'video', url: '/ref.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/ref.mp3', role: 'reference_audio' },
            ],
            resolution: '720p',
        });

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'seedance_multi',
            sub_model: 'mini',
            duration: 15,
            media_inputs: [
                { kind: 'image', url: '/ref-a.png', role: 'reference_image' },
                { kind: 'image', url: '/ref-b.png', role: 'reference_image' },
                { kind: 'video', url: '/ref.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/ref.mp3', role: 'reference_audio' },
            ],
        });
        fetchSpy.mockRestore();
    });

    it('maps two images to first and last frame only when agent-plan compatibility is enabled', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_plan_morph' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'standard',
            prompt: 'morph between frames',
            media_inputs: [
                { kind: 'image', url: '/start.png', role: 'reference_image' },
                { kind: 'image', url: '/end.png', role: 'reference_image' },
            ],
        }, undefined, undefined, true);

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'seedance_morph',
            media_inputs: [
                { kind: 'image', url: '/start.png', role: 'first_frame' },
                { kind: 'image', url: '/end.png', role: 'last_frame' },
            ],
        });
        fetchSpy.mockRestore();
    });
});

describe('ComfyUI video duration contract', () => {
    it('preserves the storyboard segment duration for GPU i2v and morph tasks', () => {
        expect(buildComfyUIVideoTaskPayload(
            'i2v',
            'first.png',
            null,
            'slow camera push',
            'Wan2',
            { duration: 14 },
        )).toMatchObject({
            task_type: 'i2v',
            image_path: 'first.png',
            duration: 14,
        });

        expect(buildComfyUIVideoTaskPayload(
            'morph',
            'first.png',
            'last.png',
            'continuous transition',
            'Wan2',
        )).toMatchObject({
            task_type: 'morph',
            image_path: 'first.png',
            image_path_end: 'last.png',
            duration: 5,
        });
    });

    it('forwards only the capability-backed workflow parameters', () => {
        expect(buildComfyUIVideoTaskPayload(
            'i2v',
            'first.png',
            null,
            'slow camera push',
            '一阶',
            {
                duration: 10,
                seed: 42,
                negative_prompt: 'blur, flicker',
            },
        )).toMatchObject({
            duration: 10,
            seed: 42,
            negative_prompt: 'blur, flicker',
        });
    });
});

describe('MiniMax H3 local routing', () => {
    it('preserves the capability-selected GPU2 agent when submitting local H3 tasks', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(JSON.stringify({
                success: true,
                nodes: [
                    {
                        id: 'agent_gpu2',
                        agent_id: 'agent_gpu2',
                        node_id: 'agent_gpu2',
                        name: 'GPU2',
                        status: 'busy',
                        tasks: 1,
                        max_concurrent: 1,
                    },
                    {
                        id: 'agent_gpu1',
                        agent_id: 'agent_gpu1',
                        node_id: 'agent_gpu1',
                        name: 'GPU1',
                        status: 'online',
                        tasks: 0,
                        max_concurrent: 1,
                    },
                ],
            }), { status: 200, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                queue_mode: 'gpu2_serial',
                runtime_profile: 'h3',
                tasks_ahead: 0,
                estimated_wait_seconds: 0,
                requires_confirmation: false,
                can_cancel_before_submit: true,
            }), { status: 200, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(
                JSON.stringify({ task_id: 'task_h3_1' }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ));

        await submitTask(
            'first.png',
            null,
            'slow camera push',
            'MiniMaxH3',
            undefined,
            undefined,
            'multi',
            {
                entity_type: 'video_segment',
                entity_id: 'seg_1',
                preferred_agent_id: 'agent_gpu2',
                preferred_node_id: 'agent_gpu2',
            },
            { duration: 5 },
        );

        expect(String(fetchSpy.mock.calls[1][0])).toContain('/api/generate/preflight');
        const [, options] = fetchSpy.mock.calls[2];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'i2v',
            model: 'MiniMaxH3',
            preferred_agent_id: 'agent_gpu2',
            preferred_node_id: 'agent_gpu2',
        });
        fetchSpy.mockRestore();
    });
});
