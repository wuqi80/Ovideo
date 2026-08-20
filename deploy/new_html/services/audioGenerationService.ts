import { apiJson } from './httpClient';
import { checkComfyUITaskStatus } from './comfyuiTaskWaitService';
import { confirmProcessingQueue } from './processingQueueService';

class TerminalMusicTaskError extends Error {}

export async function createAudioTrack(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createAudioTrack');
}

export async function updateAudioTrack(trackId: string, data: Record<string, any>) {
    return apiJson<any>(`/api/audio-tracks/${trackId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateAudioTrack');
}

export async function deleteAudioTrack(trackId: string) {
    return apiJson<any>(`/api/audio-tracks/${trackId}`, { method: 'DELETE' }, 'deleteAudioTrack');
}

export async function generateSpeech(data: {
    text: string; persona?: string; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; project_id?: string; episode_id?: string;
}) {
    return apiJson<any>('/api/audio/generate-speech', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateSpeech');
}

export async function generateSFX(data: { description: string }) {
    return apiJson<any>('/api/audio/generate-sfx', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateSFX');
}

export async function generateMusic(data: { description: string; duration_ms?: number }) {
    return apiJson<any>('/api/audio/generate-music', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'generateMusic');
}

export async function createCharacterVoice(data: {
    project_id: string; character_name: string;
    asset_id?: string; voice_provider?: string;
    voice_model_id?: string; voice_name?: string;
    voice_params?: Record<string, any>; sample_audio_url?: string;
}) {
    return apiJson<any>('/api/character-voices', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createCharacterVoice');
}

export async function updateCharacterVoice(voiceId: string, data: Record<string, any>) {
    return apiJson<any>(`/api/character-voices/${voiceId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }, 'updateCharacterVoice');
}

export async function deleteCharacterVoice(voiceId: string) {
    return apiJson<any>(`/api/character-voices/${voiceId}`, { method: 'DELETE' }, 'deleteCharacterVoice');
}

export async function minimaxVoiceDesign(prompt: string, previewText: string, voiceId?: string) {
    return apiJson<any>('/api/minimax/voice-design', {
        method: 'POST',
        body: JSON.stringify({ prompt, preview_text: previewText, voice_id: voiceId })
    }, 'minimaxVoiceDesign');
}

export async function minimaxVoiceClone(
    fileId: string,
    voiceId?: string,
    demoText = '你好，这是一段测试语音。',
    voiceIdPrefix = 'clone',
) {
    return apiJson<any>('/api/minimax/voice-clone', {
        method: 'POST',
        body: JSON.stringify({
            file_id: fileId,
            voice_id: voiceId,
            demo_text: demoText,
            voice_id_prefix: voiceIdPrefix,
        })
    }, 'minimaxVoiceClone');
}

export async function minimaxListVoices(voiceType = 'all') {
    return apiJson<any>(`/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`, { method: 'GET' }, 'minimaxListVoices');
}

export async function minimaxGetVoice(voiceId: string) {
    return apiJson<any>(`/api/minimax/voices/${voiceId}`, { method: 'GET' }, 'minimaxGetVoice');
}

export async function minimaxDeleteVoice(voiceId: string, voiceType = 'voice_cloning') {
    return apiJson<any>(`/api/minimax/voices/${voiceId}?voice_type=${encodeURIComponent(voiceType)}`, { method: 'DELETE' }, 'minimaxDeleteVoice');
}

export async function minimaxTTS(data: {
    text: string; voice_id: string; model?: string;
    model_scope?: string;
    speed?: number; pitch?: number; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; project_id?: string; episode_id?: string;
    storyboard_lineage_id?: string;
    bind_to_character_voice_id?: string;
}, signal?: AbortSignal): Promise<{ success: true; task_id: string }> {
    return apiJson<any>('/api/minimax/tts', {
        method: 'POST',
        body: JSON.stringify(data),
        signal,
    }, 'minimaxTTS');
}

export async function minimaxTTSSync(data: {
    text: string;
    voice_id: string;
    model?: string;
    model_scope?: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
    entity_type?: string;
    entity_id?: string;
    file_role?: string;
    project_id?: string;
    episode_id?: string;
    storyboard_lineage_id?: string;
    bind_to_character_voice_id?: string;
}, signal?: AbortSignal): Promise<{
    success: true;
    audio_url: string;
    file_id: string;
    file_url: string;
    duration_ms?: number;
    minimax_trace_id?: string;
}> {
    return apiJson<any>('/api/minimax/tts/sync', {
        method: 'POST',
        body: JSON.stringify(data),
        signal,
    }, 'minimaxTTSSync');
}

export async function minimaxMusic(lyrics = '', referVoice = '', referInstrumental = '') {
    return apiJson<any>('/api/minimax/music', {
        method: 'POST',
        body: JSON.stringify({ lyrics, refer_voice: referVoice, refer_instrumental: referInstrumental })
    }, 'minimaxMusic');
}

export type LocalMiniMaxMusic3Request = {
    caption: string;
    lyrics?: string;
    durationSeconds?: number;
    seed?: number;
    projectId?: string;
    episodeId: string;
};

export async function submitLocalMiniMaxMusic3(data: LocalMiniMaxMusic3Request): Promise<{
    task_id: string;
    tasks_ahead?: number;
    estimated_wait_seconds?: number;
}> {
    const duration = Math.max(10, Math.min(300, Math.round(data.durationSeconds || 30)));
    const payload = {
        task_type: 'minimax_music3',
        model: 'MiniMax-Music3',
        prompt: data.caption.trim(),
        caption: data.caption.trim(),
        lyrics: data.lyrics?.trim() || '[Instrumental]',
        duration,
        duration_seconds: duration,
        seed: Number.isFinite(data.seed) ? data.seed : -1,
        project_id: data.projectId,
        episode_id: data.episodeId,
        file_role: 'generated_audio',
        priority: 2,
    };
    await confirmProcessingQueue(payload);
    return apiJson<any>('/api/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
    }, 'submitLocalMiniMaxMusic3');
}

export async function waitForLocalMiniMaxMusic3(
    taskId: string,
    onProgress?: (progress: number) => void,
    timeoutMs = 90 * 60 * 1000,
): Promise<{ url: string; fileId?: string | null; result: any }> {
    const startedAt = Date.now();
    let consecutiveErrors = 0;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const status = await checkComfyUITaskStatus(taskId);
            consecutiveErrors = 0;
            onProgress?.(status.progress || 0);
            if (status.status === 'completed') {
                const audio = status.result?.audios?.[0]
                    || status.result?.output_files?.find((item: any) => item?.file_type === 'audio');
                if (!audio?.url) throw new TerminalMusicTaskError('音乐任务完成，但没有返回可用音频');
                return { url: audio.url, fileId: audio.file_id || null, result: status.result };
            }
            if (status.status === 'failed' || status.status === 'cancelled') {
                throw new TerminalMusicTaskError(
                    status.error || (status.status === 'cancelled' ? '音乐任务已取消' : '音乐生成失败'),
                );
            }
        } catch (error) {
            if (error instanceof TerminalMusicTaskError) throw error;
            consecutiveErrors += 1;
            if (consecutiveErrors >= 5) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('音乐生成等待超时');
}

export async function cancelLocalMiniMaxMusic3(taskId: string) {
    return apiJson<any>(`/api/task/${taskId}`, { method: 'DELETE' }, 'cancelLocalMiniMaxMusic3');
}

export async function minimaxLyrics(text: string, language = 'zh') {
    return apiJson<any>('/api/minimax/lyrics', {
        method: 'POST',
        body: JSON.stringify({ text, language })
    }, 'minimaxLyrics');
}

export async function minimaxFileUpload(file: File, purpose = 'voice_clone') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    return apiJson<any>('/api/minimax/files/upload', {
        method: 'POST',
        body: formData
    }, 'minimaxFileUpload', { includeContentType: false });
}

export async function minimaxFileRetrieve(fileId: string) {
    return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'GET' }, 'minimaxFileRetrieve');
}

export async function minimaxFileDelete(fileId: string) {
    return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'DELETE' }, 'minimaxFileDelete');
}
