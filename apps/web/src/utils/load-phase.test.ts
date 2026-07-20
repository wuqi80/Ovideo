import { describe, expect, it } from 'vitest';
import { resolveLoadPhase, type LoadPhaseQuery } from './load-phase';

/** TanStack Query v5 各状态在这几位上的真实取值 */
const loading: LoadPhaseQuery = { isLoading: true, isError: false, isSuccess: false };
const failed: LoadPhaseQuery = { isLoading: false, isError: true, isSuccess: false };
const ok: LoadPhaseQuery = { isLoading: false, isError: false, isSuccess: true };
/**
 * 被 enabled:false 关掉的查询：status 是 'pending'（所以 isPending 为 true），
 * 但 fetchStatus 是 'idle'，因此 isLoading = isPending && isFetching = false。
 * 这就是 isPending 当 loading 用会永远转圈的原因。
 */
const disabled: LoadPhaseQuery = { isLoading: false, isError: false, isSuccess: false };

describe('resolveLoadPhase', () => {
  it('列表查询进行中 → loading', () => {
    expect(resolveLoadPhase([loading, null], false)).toBe('loading');
  });

  it('列表成功、详情进行中 → loading', () => {
    expect(resolveLoadPhase([ok, loading], false)).toBe('loading');
  });

  it('任一查询失败 → error（而不是被画成空态）', () => {
    expect(resolveLoadPhase([failed, null], true)).toBe('error');
    expect(resolveLoadPhase([ok, failed], true)).toBe('error');
  });

  it('错误优先于加载：并发查询里有一个挂了就立刻报错', () => {
    expect(resolveLoadPhase([loading, failed], false)).toBe('error');
  });

  it('成功且数据为空 → empty', () => {
    expect(resolveLoadPhase([ok, null], true)).toBe('empty');
  });

  it('成功且有数据 → ready', () => {
    expect(resolveLoadPhase([ok, ok], false)).toBe('ready');
  });

  /**
   * 本次缺陷 C 的回归钉子：storyboardId 为 null 时 detailQuery 被 disable。
   * 它既不 loading 也不 success，早先会把整页卡在转圈，空态那段引导成了死代码。
   *
   * 【断言为什么变了】这条最初写的是"传 null 才对，传 disabled 查询就该 loading"——
   * 那是把调用方必须记得的绕法当成了规格。而两个调用方当场就都漏了同一个
   * （useStoryboards 自身也是条件启用的）。现在由函数自己认出未启动的查询，
   * 两种传法都得到正确结果；这条改为同时钉住这两种传法。
   */
  it('依赖查询被 disable 时空态可达（传 null 或直接传进来都算数）', () => {
    expect(resolveLoadPhase([ok, null], true)).toBe('empty');
    expect(resolveLoadPhase([ok, disabled], true)).toBe('empty');
  });

  it('三态互斥：同一组输入只会命中一个分支', () => {
    const cases: Array<[Array<LoadPhaseQuery | null>, boolean]> = [
      [[loading, null], false],
      [[failed, null], true],
      [[ok, null], true],
      [[ok, ok], false],
    ];
    const phases = cases.map(([qs, empty]) => resolveLoadPhase(qs, empty));
    expect(phases).toEqual(['loading', 'error', 'empty', 'ready']);
    expect(new Set(phases).size).toBe(4);
  });
});

describe('自动识别被 disable 的查询（不依赖调用方记得传 null）', () => {
  const idle = { isLoading: false, isError: false, isSuccess: false };
  const ok = { isLoading: false, isError: false, isSuccess: true };

  it('调用方忘了排除 disabled 查询时，不会把整页永久卡在 loading', () => {
    // 两个调用方都曾无条件传入 useStoryboards，而它是 enabled: episodeId !== ''。
    // 约定只写在注释里就迟早被违反，所以这里由函数自己认出来。
    expect(resolveLoadPhase([ok, idle], true)).toBe('empty');
    expect(resolveLoadPhase([ok, idle], false)).toBe('ready');
  });

  it('全部查询都没启动时按 loading 处理，不假装已经知道结果', () => {
    expect(resolveLoadPhase([idle, idle], true)).toBe('loading');
  });
});

describe('重试被挂起（网络不可用）要与"被 disable"分开', () => {
  const ok = { isLoading: false, isError: false, isSuccess: true, fetchStatus: 'idle' as const };
  // 实测撞到的真实形状：三个布尔位与 disabled 完全相同，只有 fetchStatus 不同
  const paused = { isLoading: false, isError: false, isSuccess: false, fetchStatus: 'paused' as const };
  const disabled = { isLoading: false, isError: false, isSuccess: false, fetchStatus: 'idle' as const };

  it('挂起态单独成一相，不被当成"没在参与"而排除掉', () => {
    expect(resolveLoadPhase([ok, paused], false)).toBe('paused');
    // 对照：同样三假、但 fetchStatus 是 idle 的 disabled 查询仍应被排除
    expect(resolveLoadPhase([ok, disabled], false)).toBe('ready');
  });

  it('挂起优先于加载——正在等网络这件事比"转圈"更该被说出来', () => {
    const loading = { isLoading: true, isError: false, isSuccess: false, fetchStatus: 'fetching' as const };
    expect(resolveLoadPhase([loading, paused], false)).toBe('paused');
  });
});
