-- Project-level voice references extracted from generated video takes.
-- These are intentionally separate from character_voices, which stores TTS voices.

CREATE TABLE IF NOT EXISTS video_voice_references (
    id SERIAL PRIMARY KEY,
    reference_id VARCHAR(50) UNIQUE NOT NULL,
    project_id VARCHAR(50) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    episode_id VARCHAR(50) REFERENCES episodes(episode_id) ON DELETE SET NULL,
    storyboard_item_id VARCHAR(50) REFERENCES storyboard_items(item_id) ON DELETE SET NULL,
    video_segment_id VARCHAR(50) REFERENCES video_segments(segment_id) ON DELETE SET NULL,
    character_name VARCHAR(200) NOT NULL,
    source_video_url TEXT NOT NULL,
    reference_audio_url TEXT NOT NULL,
    video_model VARCHAR(100),
    created_by VARCHAR(100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_video_voice_reference_character UNIQUE (project_id, character_name)
);

CREATE INDEX IF NOT EXISTS idx_video_voice_references_project
    ON video_voice_references(project_id);
CREATE INDEX IF NOT EXISTS idx_video_voice_references_episode
    ON video_voice_references(episode_id);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my2_user') THEN
        EXECUTE 'ALTER TABLE video_voice_references OWNER TO my2_user';
        EXECUTE 'ALTER SEQUENCE video_voice_references_id_seq OWNER TO my2_user';
        EXECUTE 'GRANT ALL PRIVILEGES ON TABLE video_voice_references TO my2_user';
        EXECUTE 'GRANT ALL PRIVILEGES ON SEQUENCE video_voice_references_id_seq TO my2_user';
    END IF;
END $$;
