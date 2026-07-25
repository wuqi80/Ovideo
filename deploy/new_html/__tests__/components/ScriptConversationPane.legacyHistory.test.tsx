// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptConversationPane, StoryboardVersionBody } from '../../components/ScriptConversationPane';
import { AiModel, FileStatus, type ProjectFile, type ScriptConversation, type ScriptStoryboardVersion } from '../../types';

afterEach(cleanup);

describe('ScriptConversationPane legacy history', () => {
  it('renders the complete immutable legacy reply as formatted segment cards', () => {
    const content = [
      '### **镜头1**',
      '- **时长（秒）**：4',
      '- **画面描述**：小悟站在办公室中央，右手紧握智能跳绳。',
      '- **光影色调**：明亮自然光。',
      '',
      '### **镜头2**',
      '- **时长（秒）**：3',
      '- **画面描述**：小悟转身看向同事。',
      '- **镜头运动**：缓慢推进。',
    ].join('\n');
    const version: ScriptStoryboardVersion = {
      id: 'ver_legacy_script_yuan',
      scriptId: 'script_yuan',
      messageId: 'msg_legacy_assistant_script_yuan',
      versionNo: 1,
      content,
      storyboardItems: [
        {
          id: 'shot-1',
          shotNumber: '镜头01',
          originalText: '镜头01',
          scriptSegment: '旧版摘要一',
          imagePrompt: '',
          videoPrompt: '',
          dialogue: '',
          characters: [],
        },
        {
          id: 'shot-2',
          shotNumber: '镜头02',
          originalText: '镜头02',
          scriptSegment: '旧版摘要二',
          imagePrompt: '',
          videoPrompt: '',
          dialogue: '',
          characters: [],
        },
      ],
      source: 'legacy',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    render(<StoryboardVersionBody version={version} />);

    const body = screen.getByTestId('legacy-storyboard-version-body-ver_legacy_script_yuan');
    expect(body).toHaveTextContent('画面描述：小悟站在办公室中央，右手紧握智能跳绳。');
    expect(body).toHaveTextContent('镜头运动：缓慢推进。');
    expect(body).toHaveTextContent('分段');
    expect(body).toHaveTextContent('镜头1-1');
    expect(body).toHaveTextContent('镜头1-2');
    expect(body.textContent).not.toMatch(/###|\*\*/);
  });

  it('keeps Yuan-style legacy history visible after collapsing and expanding the reply', () => {
    const content = Array.from({ length: 8 }, (_, index) => [
      `镜头${index + 1}`,
      '时长（秒）：4',
      `画面描述：第${index + 1}个历史镜头的完整内容。`,
      '光影色调：明亮自然光。',
    ].join('\n')).join('\n');
    const version: ScriptStoryboardVersion = {
      id: 'ver_legacy_script_yuan',
      scriptId: 'script_yuan',
      messageId: 'msg_legacy_assistant_script_yuan',
      versionNo: 1,
      content,
      storyboardItems: [],
      source: 'legacy',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conversation: ScriptConversation = {
      scriptId: 'script_yuan',
      currentVersionId: version.id,
      messages: [
        {
          id: 'msg_legacy_user_script_yuan',
          role: 'user',
          content: '最初输入的文字剧本',
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: version.messageId!,
          role: 'assistant',
          content,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      versions: [version],
    };
    const selectedFile: ProjectFile = {
      id: 'script_yuan',
      name: '分集剧本',
      originalContent: '最初输入的文字剧本',
      scriptContent: content,
      storyboard: null,
      extractedCharacters: [],
      extractedScenes: [],
      status: FileStatus.Completed,
      lastUpdated: Date.now(),
      versions: [],
    };

    render(
      <ScriptConversationPane
        selectedFile={selectedFile}
        conversation={conversation}
        aiModel={AiModel.DeepseekChat}
        isWorkflowScript
        isLoading={false}
        isSending={false}
        onChangeModel={() => undefined}
        onSend={async () => undefined}
        onGenerateDesign={() => undefined}
        onEditVersion={async () => undefined}
        onExportVersion={() => undefined}
        onOpenStoryboard={() => undefined}
        storyboardItemCount={0}
      />,
    );

    const body = screen.getByTestId('legacy-storyboard-version-body-ver_legacy_script_yuan');
    const collapseButton = screen.getByTestId('script-message-collapse-top-msg_legacy_assistant_script_yuan');
    expect(body).toHaveTextContent('画面描述：第8个历史镜头的完整内容。');

    fireEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(body).toHaveTextContent('画面描述：第8个历史镜头的完整内容。');
  });
});
