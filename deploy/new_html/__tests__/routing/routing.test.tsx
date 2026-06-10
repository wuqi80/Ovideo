import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';

import { WorkflowLayout } from '../../layouts/WorkflowLayout';
import { EpisodeHubPage } from '../../pages/EpisodeHubPage';
import { ScriptPage } from '../../pages/ScriptPage';
import { MaterialsPage } from '../../pages/MaterialsPage';
import { AudioStagePage } from '../../pages/AudioStagePage';
import { DesignPage } from '../../pages/DesignPage';
import { GenerationPage } from '../../pages/GenerationPage';
import { EnhancePage } from '../../pages/EnhancePage';
import { HistoryPage } from '../../pages/HistoryPage';
import { CanvasPage } from '../../pages/CanvasPage';

vi.mock('../../services/apiService', () => ({
  getEpisodeScript: vi.fn().mockResolvedValue({ success: true, script: null }),
  getStoryboardItems: vi.fn().mockResolvedValue({ success: true, items: [] }),
  getAssets: vi.fn().mockResolvedValue({ success: true, assets: [] }),
  getAudioTracks: vi.fn().mockResolvedValue({ success: true, tracks: [] }),
  getVideoSegments: vi.fn().mockResolvedValue({ success: true, segments: [] }),
  updateStoryboardItem: vi.fn().mockResolvedValue({ success: true }),
  getHeaders: vi.fn().mockReturnValue({}),
}));

function TestRouter({ initialEntry }: { initialEntry: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/projects/:projectId" element={<Outlet />}>
          <Route path="episodes" element={<EpisodeHubPage />} />
          <Route path="ep/:episodeId">
            <Route index element={<EpisodeHubPage />} />
            <Route path="workflow" element={<WorkflowLayout />}>
              <Route index element={<Navigate to="script" replace />} />
              <Route path="script" element={<ScriptPage />} />
              <Route path="materials" element={<MaterialsPage />} />
              <Route path="audio" element={<AudioStagePage />} />
              <Route path="design" element={<DesignPage />} />
              <Route path="generation" element={<GenerationPage />} />
              <Route path="enhance" element={<EnhancePage />} />
              <Route path="history" element={<HistoryPage />} />
            </Route>
            <Route path="canvas" element={<CanvasPage />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Routing', () => {
  it('renders EpisodeHubPage at /projects/p1/episodes', () => {
    render(<TestRouter initialEntry="/projects/p1/episodes" />);
    expect(screen.getByRole('heading', { name: '分集管理' })).toBeInTheDocument();
  });

  it('renders ScriptPage at workflow/script', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/script" />);
    expect(screen.getByRole('heading', { name: '剧本编辑' })).toBeInTheDocument();
  });

  it('renders AudioStagePage at workflow/audio', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/audio" />);
    const main = document.querySelector('main');
    expect(main).toBeInTheDocument();
  });

  it('renders DesignPage at workflow/design', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/design" />);
    expect(screen.getByRole('heading', { name: '资产设计' })).toBeInTheDocument();
  });

  it('renders GenerationPage at workflow/generation', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/generation" />);
    const main = document.querySelector('main');
    expect(main).toBeInTheDocument();
  });

  it('renders EnhancePage at workflow/enhance', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/enhance" />);
    expect(screen.getByRole('heading', { name: '视频增强' })).toBeInTheDocument();
  });

  it('renders CanvasPage at canvas route', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/canvas" />);
    expect(screen.getByTestId('rf__wrapper')).toBeInTheDocument();
  });

  it('renders workflow nav with all tabs', () => {
    render(<TestRouter initialEntry="/projects/p1/ep/ep1/workflow/script" />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    expect(nav.textContent).toContain('剧本编辑');
    expect(nav.textContent).toContain('素材绑定');
    expect(nav.textContent).toContain('音频预演');
    expect(nav.textContent).toContain('资产设计');
    expect(nav.textContent).toContain('视频生成');
    expect(nav.textContent).toContain('视频增强');
    expect(nav.textContent).toContain('历史记录');
    expect(nav.textContent).toContain('自由创作');
  });
});
