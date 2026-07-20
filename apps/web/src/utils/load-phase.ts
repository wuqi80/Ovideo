/**
 * 「正在加载 / 加载失败 / 加载完但是空 / 有数据」这四态的唯一判定。
 *
 * 【为什么要单独抽出来】原本每个页面自己拼一串三元表达式，于是同一个错误
 * 犯了两遍、还是两种犯法：
 *   - StoryboardWorkspace 用 isPending 当 loading。TanStack Query v5 下
 *     被 disable 的查询 status 恒为 'pending'（fetchStatus 才是 'idle'），
 *     于是「这一集还没有分镜」这个新剧集的常态永远卡在转圈，
 *     为空态写的引导按钮成了从没人见过的死代码。
 *   - StoryboardStage 压根没有错误分支，请求挂了就渲染「暂无分镜版本」，
 *     把故障画成空态——用户会以为自己没生成过，然后再生成一遍。
 *
 * 两种写法都是「只考虑了正在加载」。判定挪到这里，三态互斥且都可达，
 * 也才有一个能被测试直接钉住的东西。
 */

export type LoadPhase = 'loading' | 'paused' | 'error' | 'empty' | 'ready';

/** 只取判定所需的那几位。用结构类型，免得测试要造一整个 QueryResult */
export interface LoadPhaseQuery {
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  /**
   * TanStack 的取数子状态。**必须传**，否则"被 disable"与"重试被挂起"分不开。
   * 【为什么】两者的三个布尔位完全相同（全假）：paused 时 isFetching 为假故 isLoading 也为假，
   * 而它既没成功也没失败。只靠布尔位判断，就会把一条"正在等网络恢复"的查询
   * 当成"没在参与"排除掉——页面于是永远转圈，且没有任何东西告诉用户为什么。
   * 这是实测撞到的：浏览器 navigator.onLine 为 true，TanStack 仍把重试判成 paused。
   */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
}

/**
 * @param queries 参与判定的查询。**被 disable 的依赖查询请传 null**——
 *   它既不 loading 也不 success，混进来会让整页永远停在 loading，
 *   那正是本次要修的那个 bug。
 * @param isEmpty 全部成功之后，数据是否确实为空。
 */
export function resolveLoadPhase(
  queries: ReadonlyArray<LoadPhaseQuery | null | undefined>,
  isEmpty: boolean,
): LoadPhase {
  /**
   * 【自己认出被 disable 的查询，不靠调用方记得传 null】
   * 原本这条约定只写在上面的注释里，而两个调用方都漏了同一个：useStoryboards 自身是
   * enabled: episodeId !== ''，却被无条件传了进来。约定只写在注释里，就迟早会被违反——
   * 这正是本轮反复出现的病根「约束只写在一侧」。
   *
   * 好在这个状态是可判定的：v5 里被 disable / 尚未启动的查询三者皆假
   * （isLoading 要 isPending && isFetching 才为真），而真正在跑的必有 isLoading，
   * 已落定的必有 isSuccess 或 isError。所以"三者皆假"就是"没在参与"，直接排除。
   */
  const given = queries.filter((q): q is LoadPhaseQuery => q !== null && q !== undefined);

  /**
   * 重试被挂起（TanStack 判定网络不可用）要单独报，不能混进下面的排除逻辑。
   * 实测：它的三个布尔位与"被 disable"完全一致，不先捞出来就会被当成"没在参与"，
   * 页面永远转圈且不说明原因——而这一态恰恰是最需要告诉用户的：不是在加载，是在等网络。
   */
  if (given.some((q) => q.fetchStatus === 'paused')) return 'paused';

  const active = given.filter((q) => q.isLoading || q.isError || q.isSuccess);

  // 错误优先于加载：并发查询里只要有一个挂了，页面就该给出可重试的说明，
  // 而不是等另一个转完圈再假装一切正常。
  if (active.some((q) => q.isError)) return 'error';
  if (active.some((q) => q.isLoading)) return 'loading';

  // 空态只在「确实成功了」之后出现。任何一个查询还没落定（idle 等），
  // 都按 loading 处理——绝不能把「还不知道」渲染成「没有」。
  if (active.length > 0 && active.every((q) => q.isSuccess)) {
    return isEmpty ? 'empty' : 'ready';
  }
  return 'loading';
}
