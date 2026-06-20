import { apiJson } from './httpClient';

export async function createAudioTrack(episodeId: string, data: any) {
    return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, {
        method: 'POST',
        body: JSON.stringify(data)
    }, 'createAudioTrack');
}

export async function deleteAudioTrack(trackId: string) {
    return apiJson<any>(`/api/audio-tracks/${trackId}`, { method: 'DELETE' }, 'deleteAudioTrack');
}

export async function generateSpeech(data: {
    text: string; persona?: string; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
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
    speed?: number; pitch?: number; emotion?: string;
    entity_type?: string; entity_id?: string; file_role?: string; episode_id?: string;
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
    speed?: number;
    pitch?: number;
    emotion?: string;
    entity_type?: string;
    entity_id?: string;
    file_role?: string;
    episode_id?: string;
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
