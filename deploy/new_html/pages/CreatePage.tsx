/**
 * CreatePage.tsx — 「一句话，从创意到成片」新建创作首页
 * 完全对齐 docs/design-standard 模板 Home 屏：徽章 → Hero 标题 → 输入卡
 * （题材 / 时长 chips + 渐变生成按钮）→ 示例句 → 四张流水线卡。
 * 生成动作：创建项目 → 创建首个分集 → 进入 剧本创作 阶段；
 * 一句话创意暂存 sessionStorage（key: create:idea）供剧本页取用。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import AppSidebar from '../components/AppSidebar';

const GENRES = ['悬疑', '爱情', '科幻', '喜剧', '温情', '恐怖'];
const DURATIONS = ['30s', '60s 竖屏', '90s', '180s'];
const EXAMPLES = [
  '深夜便利店的收银员发现，每晚午夜都有一个从不离开的顾客。',
  '外卖骑手接到一单，送餐地址是三年前已经拆掉的老房子。',
  '相亲对象太完美，直到我发现他是我自己训练的 AI。',
];
const PIPELINE_CARDS = [
  { n: '1', title: '剧本创作', sub: '分场景、对白，AI 编剧协作', bg: '#ECE9FF', fg: '#5B49F0' },
  { n: '2', title: '美术设定', sub: '角色三视图、场景、道具', bg: '#FFF0EB', fg: '#FF6A3D' },
  { n: '3', title: '分镜设计', sub: '景别、运镜、时长、站位图', bg: '#E4F7EE', fg: '#12B76A' },
  { n: '4', title: '短片生成', sub: '逐镜出片，一键合成', bg: '#E6F0FF', fg: '#3B7BE5' },
];

const chipClass = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all ${
    active ? 'border-b300 bg-primary-light text-primary' : 'border-n40 bg-n0 text-n300 hover:border-b300 hover:text-primary'
  }`;

export const CreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [sentence, setSentence] = useState('');
  const [genre, setGenre] = useState('悬疑');
  const [duration, setDuration] = useState('60s 竖屏');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canGenerate = !!sentence.trim() && !busy;

  const generate = async () => {
    const idea = sentence.trim();
    if (!idea || busy) return;
    setBusy(true);
    setError('');
    try {
      const projectName = idea.length > 14 ? `${idea.slice(0, 14)}…` : idea;
      const created = await apiJson<any>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          project_name: projectName,
          description: `一句话创意：${idea}（题材：${genre} · 时长：${duration}）`,
          visibility: 'private',
          member_usernames: [],
        }),
      }, '创建项目');
      const newProjectId = created?.project?.project_id;
      if (!created?.success || !newProjectId) throw new Error(created?.error || '创建项目失败');

      const epCreated = await apiJson<any>(`/api/projects/${newProjectId}/episodes`, {
        method: 'POST',
        body: JSON.stringify({ episode_name: '第一集' }),
      }, '创建分集');
      if (!epCreated?.success) throw new Error(epCreated?.error || '创建分集失败');

      const list = await apiJson<any>(`/api/projects/${newProjectId}/episodes`, {}, '读取分集');
      const row = (list?.episodes ?? [])[0];
      const newEpisodeId = row?.episode_id ?? row?.episodeId;
      if (!newEpisodeId) throw new Error('未找到新建分集');

      sessionStorage.setItem('create:idea', JSON.stringify({ sentence: idea, genre, duration }));
      navigate(`/projects/${newProjectId}/ep/${newEpisodeId}/workflow/script`);
    } catch (e: any) {
      console.error('一句话创建失败:', e);
      setError(e?.message || '创建失败，请稍后再试');
      setBusy(false);
    }
  };

  return (
    <div className="layout-safe flex min-h-screen bg-n20 text-n800">
      <AppSidebar className="sticky top-0 hidden h-screen lg:flex" />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-8 pb-16 pt-[6vh]">
          {/* 徽章 */}
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-primary-light px-3.5 py-1.5 font-mono text-xs font-bold tracking-[0.03em] text-primary">
            <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-primary" />
            剧本 · 美术 · 分镜 · 成片 一站式
          </div>

          <h1 className="mb-3.5 font-display text-[44px] font-extrabold leading-[1.08] tracking-[-1.5px] text-n900">
            一句话，
            <br />
            从创意到成片。
          </h1>
          <p className="mb-7 max-w-[560px] text-base leading-relaxed text-n300">
            输入一个创意，自动生成<strong className="font-bold text-n800">剧本、角色美术设定、分镜脚本</strong>
            ，直到可播放的短片。专为短视频创作者打造。
          </p>

          {/* Hero 输入卡 */}
          <div className="rounded-[20px] border border-n40 bg-n0 p-2" style={{ boxShadow: '0 14px 44px rgba(20,20,25,.07)' }}>
            <textarea
              value={sentence}
              onChange={e => setSentence(e.target.value)}
              placeholder={'用一句话描述你的故事创意…\n例：深夜便利店的收银员发现，每晚午夜都会进来同一个从不离开的顾客。'}
              className="min-h-[104px] w-full resize-none border-none bg-transparent px-4 pb-2 pt-4 text-base leading-[1.55] text-n800 outline-none placeholder:text-n100 focus:ring-0"
              style={{ boxShadow: 'none' }}
            />
            <div className="flex flex-wrap items-end justify-between gap-3.5 px-3 pb-2.5 pt-2">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[11px] text-n100">题材</span>
                  {GENRES.map(g => (
                    <button key={g} type="button" onClick={() => setGenre(g)} className={chipClass(genre === g)}>
                      {g}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[11px] text-n100">时长</span>
                  {DURATIONS.map(d => (
                    <button key={d} type="button" onClick={() => setDuration(d)} className={chipClass(duration === d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                className={`inline-flex items-center gap-2 rounded-[11px] border-none px-5 py-3 text-[14.5px] font-semibold text-n0 transition-all ${
                  canGenerate ? 'shadow-glow hover:brightness-105' : 'cursor-not-allowed opacity-100'
                }`}
                style={{ background: canGenerate ? 'linear-gradient(135deg,#5B49F0,#7A5BFF)' : '#c9c5e8' }}
              >
                <Sparkles size={16} />
                {busy ? '正在创建…' : '生成剧本 Generate'}
              </button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          {/* 示例句 */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-n100">试试这些 ↴</span>
            {EXAMPLES.map(example => (
              <button
                key={example}
                type="button"
                onClick={() => setSentence(example)}
                className="rounded-full border border-n40 bg-n0 px-3.5 py-1.5 text-left text-[12.5px] text-n400 transition-colors hover:border-b300 hover:text-primary"
              >
                {example}
              </button>
            ))}
          </div>

          {/* 四张流水线卡 */}
          <div className="mt-9 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {PIPELINE_CARDS.map(card => (
              <div key={card.n} className="rounded-[14px] border border-n40 bg-n0 p-4">
                <div
                  className="mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-[9px] font-mono text-[13px] font-extrabold"
                  style={{ background: card.bg, color: card.fg }}
                >
                  {card.n}
                </div>
                <div className="mb-1 font-display text-[13.5px] font-bold">{card.title}</div>
                <div className="text-xs leading-normal text-n200">{card.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreatePage;
