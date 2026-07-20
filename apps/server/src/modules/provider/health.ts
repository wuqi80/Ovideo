import type { ModelConfig, PrismaClient, ProviderConfig } from '@prisma/client';
import { notFound } from '../../lib/errors.js';
import { chatComplete, LlmHttpError, LlmNetworkError } from './adapters/openai-compatible.js';

/**
 * 模型体检：对已启用模型逐个问一句"你在这个账号下真的能用吗"。
 *
 * 为什么不用现成的 discoverModels：厂商的 /models 是平台商品目录，不是本账号的权限清单。
 * 方舟列着 126 个模型、doubao-seed-1-6-250615 赫然在列，实际调用却是
 * 404 InvalidEndpointOrModel.NotFound。基于清单的体检只会给出虚假的安心——
 * 那比没有体检更糟，因为人会以为自己查过了。所以：只有发一次真实请求才能问出真话。
 */

export type HealthStatus = 'ok' | 'no_json' | 'dead' | 'auth' | 'unreachable' | 'error' | 'untested';

export interface ModelHealthResult {
  modelConfigId: string;
  key: string;
  modality: string;
  status: HealthStatus;
  detail: string;
  latencyMs?: number;
}

export interface ProviderHealthResult {
  providerConfigId: string;
  providerName: string;
  checkedAt: string;
  models: ModelHealthResult[];
  /** 该厂商整轮体检没跑成时的原因。有它才能把"没测成"和"没什么可测"分开 */
  failure?: string;
}

/**
 * 走真实请求的模态。两者都打 /chat/completions，配合 max_tokens=1 后单次成本可忽略。
 * image/video/tts 是按张/按秒/按字符计费的真实生成，批量跑一遍就是几十块——
 * 体检不替用户花这个钱，如实标 untested。
 */
const LIVE_TESTED_MODALITIES: ReadonlySet<string> = new Set(['text', 'vision']);

/** 未实测的原因要具体到"你自己怎么验"，否则 untested 就成了又一句正确的废话 */
const UNTESTED_REASON: Record<string, string> = {
  image:
    '未实测：出图按张计费，体检不会替你消费。若要确认它在本账号下可用，请到分镜页用该模型单独试生成一张。',
  video:
    '未实测：出视频是这里单次最贵的调用，绝不批量试跑。若要确认它在本账号下可用，请到视频页用该模型单独试生成一段。',
  tts: '未实测：语音合成按字符计费，体检不会替你消费。若要确认它在本账号下可用，请到配音页用该模型单独试合成一句。',
};

/** 探针超时：比正常生成短得多——只发一个 token，久等就说明不是"慢"而是"不通" */
const PROBE_TIMEOUT_MS = 20_000;

/** 同时在跑的探针数。太高会撞厂商限流，把 429 误读成模型有问题 */
const PROBE_CONCURRENCY = 4;

/** 落库的 detail 上限，防止厂商吐一大坨 HTML 撑爆行 */
const DETAIL_MAX = 500;

/**
 * 400 里哪些措辞算"这个模型不存在/没开通"。
 * 只匹配明确指向模型本身的说法——把泛泛的参数错误也算成 dead，
 * 等于反过来冤枉一个好模型，和漏报一样有害。
 */
const MODEL_MISSING_PATTERN =
  /(does\s*not\s*exist|no\s*such\s*model|unknown\s*model|invalid[\s_-]*(endpoint|model)|model[\s_-]*(not\s*found|not\s*exist|invalid)|endpoint[\s_-]*not\s*found|模型.*(不存在|未开通|无权限|没有权限)|(不存在|未开通|无权限|没有权限).*模型)/i;

function truncate(s: string, max = 200): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 把一次失败翻译成状态 + 可行动的中文说明。绝不回显 apiKey——这里只取厂商响应体。 */
function classifyFailure(err: unknown, modelKey?: string): { status: HealthStatus; detail: string } {
  if (err instanceof LlmNetworkError) {
    if (err.timeout) {
      /**
       * 超时不是"网络不通"。握手成功、请求也发出去了，只是没等到回答。
       * 归到 unreachable 会让徽标显示"网络不通"、而 tooltip 里的原文却写着
       * "连接本身是通的"——两句话把用户指向相反的排查方向。
       * 而且探针只要 1 个 token，"输出太长"这个通用解释在体检语境下也不成立。
       */
      return {
        status: 'error',
        detail:
          `探针在 ${Math.round(PROBE_TIMEOUT_MS / 1000)} 秒内没等到响应，本次未下结论。` +
          `只发 1 个 token 还超时，通常是厂商侧排队或该模型当前异常，可稍后重测。`,
      };
    }
    return { status: 'unreachable', detail: err.message };
  }
  if (err instanceof LlmHttpError) {
    const body = truncate(err.body);
    if (err.status === 401 || err.status === 403) {
      return {
        status: 'auth',
        detail: `鉴权失败（HTTP ${err.status}）：API Key 无效、已过期或没有该模型的权限。请到厂商控制台重新签发 Key 并更新此厂商配置。厂商原话：${body}`,
      };
    }
    /**
     * 404 不能无条件判 dead：Base URL 路径写错（漏了 /v1、/v3）时网关也回 404，
     * 而且正文常是 HTML 或一句干巴巴的 Not Found，压根不提模型名。
     * 那种情况下把整个厂商的模型集体标成"你没权限"，会把人送去控制台白折腾一趟，
     * 真正要改的只是一个输入框。dead 这个标签一旦开始误报，红色横幅就会被学会无视——
     * 所以只在厂商确实"说了是模型的问题"时才下这个结论。
     */
    const bodyNamesModel =
      MODEL_MISSING_PATTERN.test(err.body) || (modelKey !== undefined && err.body.includes(modelKey));
    const looksLikeVendorJson = (() => {
      try {
        const parsed: unknown = JSON.parse(err.body);
        return typeof parsed === 'object' && parsed !== null && 'error' in parsed;
      } catch {
        return false;
      }
    })();

    if ((err.status === 404 || err.status === 400) && bodyNamesModel) {
      return {
        status: 'dead',
        detail:
          `该模型在你的账号下不可用（HTTP ${err.status}）。它出现在厂商的模型清单里不代表你有权调用——` +
          `请到厂商控制台确认是否需要单独开通该模型，或改用「推理接入点 / endpoint ID」作为模型 key。厂商原话：${body}`,
      };
    }
    if (err.status === 404) {
      return {
        status: 'error',
        detail: looksLikeVendorJson
          ? `HTTP 404，但厂商没有说明是模型的问题，未下结论。厂商原话：${body}`
          : `HTTP 404，且响应不像厂商的业务报错（可能是网关返回）。` +
            `最常见的原因是 Base URL 路径写错（例如漏掉 /v1、/v3），请先核对这个厂商的 Base URL。厂商原话：${body}`,
      };
    }
    if (err.status === 429) {
      return {
        status: 'error',
        detail: `被限流（HTTP 429），本次没测出结论。模型未必有问题，稍后重新体检即可。厂商原话：${body}`,
      };
    }
    return {
      status: 'error',
      detail: `调用失败（HTTP ${err.status}），原因不指向"模型不可用"，未下结论。厂商原话：${body}`,
    };
  }
  // 走到这里说明 HTTP 已经 2xx，只是响应体不合 OpenAI 形状（max_tokens=1 常让
  // content 被截成 null 就是典型）。而体检问的是"这个模型我能不能调"——2xx 就是能。
  // 若因为解析不了而报 dead，才是真的冤案。
  return {
    status: 'ok',
    detail: `真实调用成功（HTTP 2xx）。响应体不是标准 OpenAI 形状，但不影响可用性判断：${truncate(
      err instanceof Error ? err.message : String(err),
      120,
    )}`,
  };
}

/** 一次真实但最小的请求：prompt 两个字符 + max_tokens=1，成本约等于 0 */
async function probeLiveModel(
  provider: Pick<ProviderConfig, 'baseUrl' | 'apiKey'>,
  model: Pick<ModelConfig, 'key'>,
): Promise<{ status: HealthStatus; detail: string; latencyMs: number }> {
  const startedAt = Date.now();
  const cfg = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: model.key };
  const probe = [{ role: 'user' as const, content: 'hi' }];

  try {
    /**
     * 【第一发带 jsonMode】探针的形状必须与被查路径同源。
     * 所有真实文本路径（剧本、分镜、提示词改写）jsonMode 默认为 true；
     * 探针若不带它，对 response_format 回 400 的模型（deepseek-reasoner 一类）
     * 就会给出绿色徽标，而分镜生成必挂——那又是一次"查过了"的虚假安心。
     */
    await chatComplete(cfg, probe, { timeoutMs: PROBE_TIMEOUT_MS, maxTokens: 1, jsonMode: true });
    return { status: 'ok', detail: '真实调用成功', latencyMs: Date.now() - startedAt };
  } catch (jsonErr) {
    /**
     * 网络不通/超时再探一发只是把用户的等待翻倍，结论一个字都不会变；
     * 2xx-但结构怪（max_tokens=1 截断成 content:null）本来就算调通，更不必对照。
     */
    if (!(jsonErr instanceof LlmHttpError)) {
      return { ...classifyFailure(jsonErr, model.key), latencyMs: Date.now() - startedAt };
    }
    /**
     * 结论已经确定的 HTTP 错误也不必对照：
     * 401/403 是这个 key 不行、429 是被限流，两者都与"支不支持 JSON 模式"无关，
     * 再发一发只会把请求数与体检耗时翻倍——而成本红线是体检的立身之本。
     */
    if (jsonErr.status === 401 || jsonErr.status === 403 || jsonErr.status === 429) {
      return { ...classifyFailure(jsonErr, model.key), latencyMs: Date.now() - startedAt };
    }

    // 【第二发素探做对照】用来区分"这个模型不能用"与"这个模型不支持 JSON 模式"
    try {
      await chatComplete(cfg, probe, { timeoutMs: PROBE_TIMEOUT_MS, maxTokens: 1 });
      /**
       * 素探通了 = 模型活得好好的，只是不吃 response_format。
       * 判 ok 是骗人（分镜必挂），判 dead/error 也是骗人（模型本身没毛病）——
       * 两种归法都会把人指向错误的排查方向，所以单列一档。
       */
      return {
        status: 'no_json',
        detail:
          `可调用，但不支持 JSON 模式（response_format）。剧本与分镜生成必须让模型按 JSON 结构输出，` +
          `所以这个模型无法用于分镜生成；用于纯文本改写则没问题。厂商原话：${truncate(jsonErr.body)}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (plainErr) {
      // 素探也挂 → 素探才是"这个模型能不能调"的答案，按它定性
      return { ...classifyFailure(plainErr, model.key), latencyMs: Date.now() - startedAt };
    }
  }
}

/** 单个模型的体检（不落库）。任何异常都收敛成一条结果，绝不向上抛——一个挂了要接着测下一个。 */
async function checkModel(
  provider: Pick<ProviderConfig, 'baseUrl' | 'apiKey'>,
  model: Pick<ModelConfig, 'id' | 'key' | 'modality'>,
): Promise<ModelHealthResult> {
  const base = { modelConfigId: model.id, key: model.key, modality: model.modality };

  if (!LIVE_TESTED_MODALITIES.has(model.modality)) {
    return {
      ...base,
      status: 'untested',
      detail: UNTESTED_REASON[model.modality] ?? '未实测：该模态没有可忽略成本的探针，体检不会自动调用。',
    };
  }

  if (!provider.baseUrl || !provider.apiKey) {
    return {
      ...base,
      status: 'unreachable',
      detail: '厂商缺少 Base URL 或 API Key，没法发出真实请求。请先补全厂商配置再体检。',
    };
  }

  try {
    return { ...base, ...(await probeLiveModel(provider, model)) };
  } catch (err) {
    // probeLiveModel 内部已兜底；这里是最后一道保险，确保单个模型的意外不会中断整轮体检
    return {
      ...base,
      status: 'error',
      detail: `体检本身出错，未下结论：${truncate(err instanceof Error ? err.message : String(err), 160)}`,
    };
  }
}

/** 简易并发池：按序取任务，最多 limit 个同时在跑 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 把结果写回 ModelConfig。铁律：只标注，绝不自动停用任何模型——
 * 一次网络抖动就把用户的模型关掉是越权；标出来让人自己决定。
 */
async function persist(db: PrismaClient, results: ModelHealthResult[], checkedAt: Date): Promise<void> {
  for (const r of results) {
    /**
     * 逐条独立落库。体检期间别处把某个模型删了，那一条 update 会抛 P2025；
     * 若让它中断整个循环，后面所有结论就都丢了——而探针的钱已经花完了，
     * 用户只能再花一遍重跑。模型没了就跳过它，不该牵连其余 N-1 条。
     */
    try {
      await db.modelConfig.update({
        where: { id: r.modelConfigId },
        data: {
          healthStatus: r.status,
          healthCheckedAt: checkedAt,
          healthDetail: truncate(r.detail, DETAIL_MAX),
        },
      });
    } catch (err) {
      console.warn(
        `[health] 体检结果落库失败（其余结果不受影响）：model=${r.modelConfigId}`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** 体检单个厂商下的全部已启用模型 */
export async function healthCheckProvider(
  db: PrismaClient,
  providerId: string,
): Promise<ProviderHealthResult> {
  const provider = await db.providerConfig.findUnique({ where: { id: providerId } });
  if (!provider) throw notFound('厂商配置');

  const models = await db.modelConfig.findMany({
    where: { providerConfigId: providerId, enabled: true },
    orderBy: { sortOrder: 'asc' },
  });

  const results = await mapWithConcurrency(models, PROBE_CONCURRENCY, (m) => checkModel(provider, m));
  const checkedAt = new Date();
  await persist(db, results, checkedAt);

  return {
    providerConfigId: provider.id,
    providerName: provider.name,
    checkedAt: checkedAt.toISOString(),
    models: results,
  };
}

/** 体检所有已启用厂商。某个厂商整体失败也不影响其余厂商继续体检。 */
export async function healthCheckAll(db: PrismaClient): Promise<{ providers: ProviderHealthResult[] }> {
  const providers = await db.providerConfig.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: ProviderHealthResult[] = [];
  for (const p of providers) {
    try {
      results.push(await healthCheckProvider(db, p.id));
    } catch (err) {
      /**
       * 单个厂商的意外（如体检期间被删除）不该让整轮体检白跑。
       * 但必须把 failure 说出来：只回一个空 models，它和"这个厂商本来就没有已启用模型"
       * 长得一模一样，界面会显示成"无异常"——那正是这个功能立项要消灭的虚假安心，
       * 只不过换到了全局入口上。
       */
      results.push({
        providerConfigId: p.id,
        providerName: p.name,
        checkedAt: new Date().toISOString(),
        models: [],
        failure: truncate(err instanceof Error ? err.message : String(err), 200),
      });
    }
  }
  return { providers: results };
}
