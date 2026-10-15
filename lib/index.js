/**
 * DeepSeek Harness 阶段性结论软强制守卫插件 (dsh-milestone-guard)
 *
 * 1. 通过 `ctx.systemPrompt.section` 常驻注入高优先级阶段性进展规范，防止长链路执行中注意力衰减。
 * 2. 通过 `ctx.on('tools/post-execute', ...)` 瀑布流拦截检查最新一条 `assistant/message` 是否包含
 *    非空可见文本块；若模型直接从 `</thought>` 跳到工具调用而漏发阶段性结论，则按
 *    `(exec.agent, event.data.turn, event.data.step)` 使用 `WeakMap` 去重并统计连续静默步数，
 *    当超出 `maxSilentSteps` 容忍度时向 `downstream.additionalContexts` 前置注入一条 `notice` 软强制纠偏提醒。
 *
 * @module dsh-milestone-guard
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function importHostPackage(specifier) {
  try {
    return await import(specifier);
  } catch {
    const anchors = [
      process.argv[1],
      typeof process.resourcesPath === 'string'
        ? path.join(process.resourcesPath, 'app.asar', 'dsh', 'package.json')
        : undefined,
    ].filter((item) => typeof item === 'string' && item.length > 0);

    for (const anchor of anchors) {
      try {
        const req = createRequire(anchor);
        const resolved = req.resolve(specifier);
        return await import(pathToFileURL(resolved).href);
      } catch {
        // try next anchor
      }
    }
    return null;
  }
}

const dshLlm = await importHostPackage('@deepseek-ai/dsh-llm');
const schemasteryMod = await importHostPackage('@deepseek-ai/schemastery');
const schemastery = schemasteryMod ? (schemasteryMod.default ?? schemasteryMod) : null;

export const name = 'milestone-guard';
export const inject = ['systemPrompt'];

export const DEFAULT_PROMPT_SECTION_TEXT = [
  '## 阶段性结论与工具调用强约束 (Milestone Progress Reporting Guard)',
  '1. **每次发起工具调用必须附带可见阶段性结论**：在未完成全部任务前，每次发起工具调用（Tool Call）时，必须在 `</thought>` 结束之后、工具调用（如 `<call:...>`）之前，输出 1~2 句简明的人类可见阶段性结论或进展说明（例如：说明上一步验证的结论、当前关键发现或下一步动作意图）。严禁从 `</thought>` 直接跳到工具调用而省略可见正文。',
  '2. **严禁中途单独输出纯文本**：在未完成全部任务前，严格禁止单独输出不附带任何工具调用的纯文本消息（单独纯文本会导致 Agent 循环误判回合结束而中断停顿）。所有阶段性结论必须与下一步工具调用（或 `todo_write`）在同一回复中并发发出。',
].join('\n');

export const DEFAULT_PROMPT_SECTION_TEXT_EN = [
  '## Milestone Progress Reporting Guard',
  '1. **Every tool call must include a concise visible milestone note**: Before the overall task is finished, whenever you invoke any tool call, you MUST output 1–2 concise sentences of human-visible progress or milestone conclusions after `</thought>` and before the tool call (e.g., summarizing what the previous step verified, key findings, or the intent of the next action). Never jump directly from `</thought>` to a tool call without visible text.',
  '2. **Never output standalone plain text mid-task**: Before the entire task is complete, never send a plain-text-only reply without a tool call (standalone text causes the agent loop to treat the turn as finished and halt prematurely). Always emit your milestone progress note alongside the next tool call (or `todo_write`) in the same response.',
].join('\n');

export const DEFAULT_REMINDER_TEXT =
  '【阶段性结论守卫提醒】检测到你在本步发起工具调用时未输出任何人类可见的正文（直接从 `</thought>` 跳到了工具调用）。在下一步继续调用工具时，请务必在 `</thought>` 之后、工具调用之前附带 1~2 句简明的阶段性结论或进展说明（注意：未完成全部任务前严禁单独输出不带工具调用的纯文本）。';

export const DEFAULT_REMINDER_TEXT_EN =
  '[Milestone Guard Reminder] You invoked a tool call in this step without outputting any human-visible text (jumping directly from `</thought>` to a tool call). On your next tool call, please include 1–2 concise sentences summarizing your milestone conclusion or next-step intent after `</thought>` and before the tool call (Note: do not output standalone plain text without a tool call before the task is complete).';

export const REMINDER_SOURCE = Object.freeze({
  kind: 'milestone-guard',
  form: 'notice',
  summary: '漏发阶段性结论提醒',
});

export const REMINDER_SOURCE_EN = Object.freeze({
  kind: 'milestone-guard',
  form: 'notice',
  summary: 'Missing milestone progress reminder',
});

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof AbortSignal || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return value;
}

function fallbackCreateUserMessage(input) {
  return deepFreeze(
    structuredClone({
      ...input,
      id: randomUUID(),
      role: 'user',
    }),
  );
}

const createUserMessage =
  typeof dshLlm?.createUserMessage === 'function'
    ? dshLlm.createUserMessage
    : fallbackCreateUserMessage;

/**
 * 解包 Schemastery `.volatile()` 包装的响应式配置值。
 */
export function unwrapVolatile(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value;
}

export function normalizeConfig(raw = {}) {
  const unwrappedRoot = unwrapVolatile(raw);
  const input = unwrappedRoot && typeof unwrappedRoot === 'object' ? unwrappedRoot : {};

  const enabledVal = unwrapVolatile(input.enabled);
  const localeVal = unwrapVolatile(input.locale);
  const sectionOrderVal = unwrapVolatile(input.sectionOrder);
  const maxSilentStepsVal = unwrapVolatile(input.maxSilentSteps);
  const everyStepsVal = unwrapVolatile(input.everySteps ?? input.reportEverySteps);
  const ignoreToolsVal = unwrapVolatile(input.ignoreTools);
  const promptTextVal = unwrapVolatile(input.promptText);
  const reminderTextVal = unwrapVolatile(input.reminderText);

  const locale = localeVal === 'en' ? 'en' : 'zh';
  const defaultPrompt =
    locale === 'en' ? DEFAULT_PROMPT_SECTION_TEXT_EN : DEFAULT_PROMPT_SECTION_TEXT;
  const defaultReminder =
    locale === 'en' ? DEFAULT_REMINDER_TEXT_EN : DEFAULT_REMINDER_TEXT;

  const rawPrompt = typeof promptTextVal === 'string' ? promptTextVal.trim() : '';
  const promptText =
    rawPrompt.length > 0 &&
    !(locale === 'en' && promptTextVal === DEFAULT_PROMPT_SECTION_TEXT)
      ? promptTextVal
      : defaultPrompt;

  const rawReminder = typeof reminderTextVal === 'string' ? reminderTextVal.trim() : '';
  const reminderText =
    rawReminder.length > 0 &&
    !(locale === 'en' && reminderTextVal === DEFAULT_REMINDER_TEXT)
      ? reminderTextVal
      : defaultReminder;

  let maxSilentSteps = 0;
  if (
    typeof maxSilentStepsVal === 'number' &&
    Number.isFinite(maxSilentStepsVal) &&
    maxSilentStepsVal >= 0
  ) {
    maxSilentSteps = Math.floor(maxSilentStepsVal);
  } else if (
    typeof everyStepsVal === 'number' &&
    Number.isFinite(everyStepsVal) &&
    everyStepsVal >= 1
  ) {
    maxSilentSteps = Math.floor(everyStepsVal) - 1;
  }

  const ignoreTools = Array.isArray(ignoreToolsVal)
    ? ignoreToolsVal
        .map(unwrapVolatile)
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];

  return {
    enabled: typeof enabledVal === 'boolean' ? enabledVal : true,
    locale,
    sectionOrder:
      typeof sectionOrderVal === 'number' && Number.isFinite(sectionOrderVal)
        ? sectionOrderVal
        : 180,
    maxSilentSteps,
    ignoreTools,
    promptText,
    reminderText,
  };
}

function makeFallbackFieldNode(uid, type, meta) {
  return {
    uid,
    type,
    meta,
    toJSON() {
      return {
        uid,
        refs: {
          [uid]: { type, meta: { ...meta } },
        },
      };
    },
  };
}

function createFallbackSchema() {
  const schema = (value) => normalizeConfig(value);
  const dict = {
    enabled: makeFallbackFieldNode(1, 'boolean', { default: true }),
    locale: makeFallbackFieldNode(2, 'string', { default: 'zh' }),
    sectionOrder: makeFallbackFieldNode(3, 'number', { default: 180, volatile: true }),
    maxSilentSteps: makeFallbackFieldNode(4, 'number', {
      default: 0,
      min: 0,
      step: 1,
      volatile: true,
    }),
    promptText: makeFallbackFieldNode(5, 'string', {
      default: DEFAULT_PROMPT_SECTION_TEXT,
      volatile: true,
    }),
    reminderText: makeFallbackFieldNode(6, 'string', {
      default: DEFAULT_REMINDER_TEXT,
      volatile: true,
    }),
  };

  schema.uid = 0;
  schema.type = 'object';
  schema.meta = {};
  schema.dict = dict;
  schema.toJSON = () => ({
    uid: 0,
    refs: {
      0: {
        type: 'object',
        meta: {},
        dict: {
          enabled: 1,
          locale: 2,
          sectionOrder: 3,
          maxSilentSteps: 4,
          promptText: 5,
          reminderText: 6,
        },
      },
      1: { type: 'boolean', meta: { default: true } },
      2: { type: 'string', meta: { default: 'zh' } },
      3: { type: 'number', meta: { default: 180, volatile: true } },
      4: { type: 'number', meta: { default: 0, min: 0, step: 1, volatile: true } },
      5: { type: 'string', meta: { default: DEFAULT_PROMPT_SECTION_TEXT, volatile: true } },
      6: { type: 'string', meta: { default: DEFAULT_REMINDER_TEXT, volatile: true } },
    },
  });

  Object.defineProperty(schema, '~standard', {
    value: {
      version: 1,
      vendor: 'dsh-milestone-guard',
      validate(value) {
        return { value: normalizeConfig(value) };
      },
    },
    enumerable: false,
    configurable: true,
  });
  return schema;
}

function withVolatile(fieldSchema) {
  return typeof fieldSchema?.volatile === 'function' ? fieldSchema.volatile() : fieldSchema;
}

function createPluginSchema() {
  if (!schemastery) return createFallbackSchema();
  try {
    return schemastery.object({
      enabled: schemastery.boolean().default(true),
      locale:
        typeof schemastery.union === 'function' && typeof schemastery.const === 'function'
          ? schemastery.union([schemastery.const('zh'), schemastery.const('en')]).default('zh')
          : schemastery.string().default('zh'),
      sectionOrder: withVolatile(schemastery.number().default(180)),
      maxSilentSteps: withVolatile(schemastery.number().step(1).min(0).default(0)),
      ignoreTools:
        typeof schemastery.array === 'function'
          ? schemastery.array(schemastery.string()).default([])
          : schemastery.any().default([]),
      promptText: withVolatile(schemastery.string().default(DEFAULT_PROMPT_SECTION_TEXT)),
      reminderText: withVolatile(schemastery.string().default(DEFAULT_REMINDER_TEXT)),
    });
  } catch {
    return createFallbackSchema();
  }
}

export const Config = createPluginSchema();

/**
 * 读取会话事件列表，兼容 `session.events`（数组属性）与 `session.snapshotEvents()`（DSH 0.1.5+/0.2.0+ 方法）。
 */
function resolveSessionEvents(session) {
  if (!session) return undefined;
  if (Array.isArray(session.events)) return session.events;
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents();
  if (Array.isArray(session.log)) return session.log;
  return undefined;
}

/**
 * 逆序查找最新一条 `assistant/message` 事件。
 */
function findLatestAssistantMessageEvent(events) {
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === 'assistant/message') {
      return event;
    }
  }
  return undefined;
}

/**
 * 判断消息内容块数组中是否包含非空的人类可见文本块。
 */
function hasNonEmptyVisibleTextBlock(content) {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      block?.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.trim().length > 0,
  );
}

/**
 * 判断当前工具调用或当前步是否属于被忽略的工具集合。
 */
function isIgnoredToolExecution(exec, content, ignoreSet) {
  if (!ignoreSet || ignoreSet.size === 0) return false;

  const directToolName =
    exec?.toolName ?? exec?.call?.name ?? exec?.tool?.name ?? exec?.name;
  if (typeof directToolName === 'string' && ignoreSet.has(directToolName)) {
    return true;
  }

  if (Array.isArray(content)) {
    const toolBlocks = content.filter(
      (block) =>
        (block?.type === 'tool_use' || block?.type === 'tool_call' || block?.type === 'tool-call') &&
        typeof block?.name === 'string',
    );
    if (toolBlocks.length > 0 && toolBlocks.every((block) => ignoreSet.has(block.name))) {
      return true;
    }
  }

  return false;
}

/**
 * 将提醒消息前置合并到 downstream.additionalContexts。
 */
function prependContext(reminder, existing) {
  return [reminder, ...(Array.isArray(existing) ? existing : [])];
}

/**
 * 挂载阶段性结论软强制守卫。
 * @param ctx - Cordis 插件上下文（注入 `systemPrompt` 服务与 `tools/post-execute` 事件）。
 * @param config - 插件配置项（支持 Schemastery `.volatile()` 热更新属性）。
 */
export function apply(ctx, config) {
  const initialResolved = normalizeConfig(config);
  if (!initialResolved.enabled) return;

  // 1. System Prompt 常驻注入
  ctx.systemPrompt.section({
    name: 'milestone-guard',
    order: initialResolved.sectionOrder,
    text: initialResolved.promptText,
  });

  // 2. 工具执行后软强制纠偏：按 (exec.agent, turn, step) 用 WeakMap 去重并追踪连续静默步数
  const stateByAgent = new WeakMap();

  function getAgentState(agent) {
    let state = stateByAgent.get(agent);
    if (!state) {
      state = {
        evaluatedStepsByTurn: new Map(),
        consecutiveSilentSteps: 0,
      };
      stateByAgent.set(agent, state);
    }
    return state;
  }

  function observeMissingMilestone(exec) {
    // 每次动态读取最新配置（支持 GUI 保存 volatile 字段后实时生效）
    const resolved = normalizeConfig(config);
    if (!resolved.enabled) return undefined;

    const agent = exec?.agent;
    if (!agent || typeof agent !== 'object') return undefined;

    const events = resolveSessionEvents(agent.session);
    const latestAssistantEvent = findLatestAssistantMessageEvent(events);
    if (!latestAssistantEvent?.data?.message) return undefined;

    const { turn, step, message } = latestAssistantEvent.data;
    const ignoreSet = new Set(resolved.ignoreTools);
    if (isIgnoredToolExecution(exec, message.content, ignoreSet)) {
      return undefined;
    }

    const state = getAgentState(agent);
    let stepsSet = state.evaluatedStepsByTurn.get(turn);
    if (!stepsSet) {
      stepsSet = new Set();
      state.evaluatedStepsByTurn.set(turn, stepsSet);
    }

    // 同一 (agent, turn, step) 的并发多工具调用只评估并提醒一次
    if (stepsSet.has(step)) {
      return undefined;
    }
    stepsSet.add(step);

    if (hasNonEmptyVisibleTextBlock(message.content)) {
      state.consecutiveSilentSteps = 0;
      return undefined;
    }

    state.consecutiveSilentSteps += 1;
    if (state.consecutiveSilentSteps <= resolved.maxSilentSteps) {
      return undefined;
    }

    // 触发提醒后重置连续静默计数
    state.consecutiveSilentSteps = 0;

    const reminderSource =
      resolved.locale === 'en' ? REMINDER_SOURCE_EN : REMINDER_SOURCE;

    return createUserMessage({
      content: [
        {
          type: 'text',
          text: resolved.reminderText,
        },
      ],
      source: {
        ...reminderSource,
      },
    });
  }

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const reminder = observeMissingMilestone(exec);
    const downstream = await next();
    if (!reminder) return downstream;

    if (downstream?.kind === 'block') {
      return {
        kind: 'block',
        feedback: downstream.feedback,
        additionalContexts: prependContext(reminder, downstream.additionalContexts),
      };
    }

    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream?.additionalContexts),
    };
  });
}

export default {
  name,
  inject,
  Config,
  apply,
};
