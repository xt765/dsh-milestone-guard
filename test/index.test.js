import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, {
  apply,
  Config,
  normalizeConfig,
  unwrapVolatile,
  DEFAULT_PROMPT_SECTION_TEXT,
  DEFAULT_PROMPT_SECTION_TEXT_EN,
  DEFAULT_REMINDER_TEXT,
  DEFAULT_REMINDER_TEXT_EN,
  REMINDER_SOURCE,
  REMINDER_SOURCE_EN,
} from '../lib/index.js';

function createMockContext() {
  const sections = [];
  const handlers = new Map();

  return {
    sections,
    handlers,
    systemPrompt: {
      section(spec) {
        sections.push(spec);
      },
    },
    on(eventName, listener) {
      handlers.set(eventName, listener);
    },
    async triggerPostExecute(exec, result = {}, downstreamReturn = { kind: 'allow' }) {
      const handler = handlers.get('tools/post-execute');
      assert.equal(typeof handler, 'function', 'tools/post-execute listener should be registered');
      return handler(exec, result, async () => downstreamReturn);
    },
  };
}

test('registers default Chinese system prompt section when enabled', () => {
  const ctx = createMockContext();
  apply(ctx, {});

  assert.equal(ctx.sections.length, 1);
  assert.deepEqual(ctx.sections[0], {
    name: 'milestone-guard',
    order: 180,
    text: DEFAULT_PROMPT_SECTION_TEXT,
  });
});

test('does not register section or listener when enabled is false', () => {
  const ctx = createMockContext();
  apply(ctx, { enabled: false });

  assert.equal(ctx.sections.length, 0);
  assert.equal(ctx.handlers.size, 0);
});

test('supports English preset via locale: "en"', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'en' });

  assert.equal(ctx.sections.length, 1);
  assert.equal(ctx.sections[0].text, DEFAULT_PROMPT_SECTION_TEXT_EN);

  const agent = {
    session: {
      events: [
        {
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [{ type: 'thinking', text: 'silent thought' }],
            },
          },
        },
      ],
    },
  };

  const out = await ctx.triggerPostExecute({ agent });
  assert.equal(out.additionalContexts.length, 1);
  assert.equal(out.additionalContexts[0].content[0].text, DEFAULT_REMINDER_TEXT_EN);
  assert.deepEqual(out.additionalContexts[0].source, REMINDER_SOURCE_EN);
});

test('does not inject reminder when assistant message contains visible text', async () => {
  const ctx = createMockContext();
  apply(ctx, {});

  const agent = {
    session: {
      events: [
        {
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [
                { type: 'thinking', text: 'internal reasoning' },
                { type: 'text', text: '我将先读取配置文件以确认插件入口。' },
                { type: 'tool_use', name: 'read' },
              ],
            },
          },
        },
      ],
    },
  };

  const out = await ctx.triggerPostExecute({ agent }, {}, { kind: 'allow' });
  assert.deepEqual(out, { kind: 'allow' });
});

test('injects reminder once per (agent, turn, step) even with parallel tool calls', async () => {
  const ctx = createMockContext();
  apply(ctx, {});

  const agent = {
    session: {
      snapshotEvents() {
        return [
          {
            type: 'assistant/message',
            data: {
              turn: 2,
              step: 3,
              message: {
                content: [
                  { type: 'thinking', text: 'only thinking, no visible text' },
                  { type: 'text', text: '   ' },
                  { type: 'tool_use', name: 'read' },
                  { type: 'tool_use', name: 'glob' },
                ],
              },
            },
          },
        ];
      },
    },
  };

  // First tool call in (turn 2, step 3) -> injects reminder
  const firstOut = await ctx.triggerPostExecute(
    { agent },
    {},
    { kind: 'allow', additionalContexts: [{ role: 'user', content: [] }] },
  );
  assert.equal(firstOut.additionalContexts.length, 2);
  assert.equal(firstOut.additionalContexts[0].content[0].text, DEFAULT_REMINDER_TEXT);
  assert.deepEqual(firstOut.additionalContexts[0].source, REMINDER_SOURCE);

  // Second parallel tool call in the same (turn 2, step 3) -> deduplicated
  const secondOut = await ctx.triggerPostExecute({ agent }, {}, { kind: 'allow' });
  assert.deepEqual(secondOut, { kind: 'allow' });
});

test('preserves block feedback when downstream returns kind === "block"', async () => {
  const ctx = createMockContext();
  apply(ctx, {});

  const agent = {
    session: {
      events: [
        {
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [{ type: 'tool_use', name: 'bash' }],
            },
          },
        },
      ],
    },
  };

  const out = await ctx.triggerPostExecute(
    { agent },
    {},
    { kind: 'block', feedback: 'Blocked by downstream guard' },
  );

  assert.equal(out.kind, 'block');
  assert.equal(out.feedback, 'Blocked by downstream guard');
  assert.equal(out.additionalContexts.length, 1);
  assert.equal(out.additionalContexts[0].content[0].text, DEFAULT_REMINDER_TEXT);
});

test('respects maxSilentSteps tolerance and resets counter on visible text', async () => {
  const ctx = createMockContext();
  apply(ctx, { maxSilentSteps: 1 });

  const events = [];
  const agent = { session: { events } };

  // Step 1: silent (1st silent step <= maxSilentSteps: 1 -> no reminder)
  events.push({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'tool_use', name: 'read' }] },
    },
  });
  const step1Out = await ctx.triggerPostExecute({ agent });
  assert.equal(step1Out.additionalContexts, undefined);

  // Step 2: has visible text -> resets consecutive silent counter to 0
  events.push({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 2,
      message: {
        content: [
          { type: 'text', text: '已完成读取，下面继续检查。' },
          { type: 'tool_use', name: 'read' },
        ],
      },
    },
  });
  const step2Out = await ctx.triggerPostExecute({ agent });
  assert.equal(step2Out.additionalContexts, undefined);

  // Step 3: silent (1st silent step after reset -> no reminder)
  events.push({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 3,
      message: { content: [{ type: 'tool_use', name: 'read' }] },
    },
  });
  const step3Out = await ctx.triggerPostExecute({ agent });
  assert.equal(step3Out.additionalContexts, undefined);

  // Step 4: silent (2nd consecutive silent step > maxSilentSteps: 1 -> triggers reminder!)
  events.push({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 4,
      message: { content: [{ type: 'tool_use', name: 'read' }] },
    },
  });
  const step4Out = await ctx.triggerPostExecute({ agent });
  assert.equal(step4Out.additionalContexts?.length, 1);
});

test('skips reminder for tools listed in ignoreTools', async () => {
  const ctx = createMockContext();
  apply(ctx, { ignoreTools: ['todo_write', 'glob'] });

  const agent = {
    session: {
      events: [
        {
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 1,
            message: {
              content: [{ type: 'tool_use', name: 'todo_write' }],
            },
          },
        },
      ],
    },
  };

  const out = await ctx.triggerPostExecute({ agent, toolName: 'todo_write' });
  assert.equal(out.additionalContexts, undefined);
  assert.equal(plugin.name, 'milestone-guard');
});

test('supports live volatile config values and everySteps alias', async () => {
  let liveMaxSilent = 2;
  const volatileConfig = {
    maxSilentSteps: { get: () => liveMaxSilent },
    reminderText: { get: () => '自定义动态提醒' },
  };

  assert.equal(unwrapVolatile(volatileConfig.maxSilentSteps), 2);
  assert.equal(normalizeConfig({ everySteps: 3 }).maxSilentSteps, 2);
  assert.equal(typeof Config.toJSON, 'function');

  const ctx = createMockContext();
  apply(ctx, volatileConfig);

  const events = [];
  const agent = { session: { events } };

  // Step 1: silent (1 <= 2 -> no reminder)
  events.push({
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', name: 'read' }] } },
  });
  assert.equal((await ctx.triggerPostExecute({ agent })).additionalContexts, undefined);

  // Hot-update liveMaxSilent from 2 down to 0
  liveMaxSilent = 0;

  // Step 2: silent -> immediately triggers custom reminder due to live volatile update!
  events.push({
    type: 'assistant/message',
    data: { turn: 1, step: 2, message: { content: [{ type: 'tool-call', name: 'read' }] } },
  });
  const step2Out = await ctx.triggerPostExecute({ agent });
  assert.equal(step2Out.additionalContexts?.length, 1);
  assert.equal(step2Out.additionalContexts[0].content[0].text, '自定义动态提醒');
});
