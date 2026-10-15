/**
 * dsh-milestone-guard — Client UI companion for DeepSeek Harness Web / Desktop.
 *
 * Registers the visual configuration form for `milestone-guard` into:
 * - `plugins.bundle.config` (`key: "dsh-milestone-guard"`) — shown directly on the installed plugin's detail page.
 * - `plugins.row.config` (`key: "dsh-milestone-guard#milestone-guard"`) — shown when clicking Configure on the component row.
 */
window.__ModuleLoader__.load({
  id: 'dsh-milestone-guard',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let react_jsx_runtime = require('react/jsx-runtime');
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const MILESTONE_GUARD_NS = 'milestone-guard';
    const BUNDLE_KEY = 'dsh-milestone-guard';
    const ROW_KEY = 'dsh-milestone-guard#milestone-guard';
    const NS = 'settings.milestoneGuard';

    const en = {
      title: 'Milestone Progress Guard',
      description:
        'Configure how often the agent must report visible milestone progress during tool calls.',
      maxSilentSteps: 'Max consecutive silent tool steps (maxSilentSteps)',
      maxSilentStepsHint:
        'How many consecutive tool-calling steps the agent may run without visible text before a reminder is injected. 0 = require visible progress on every step; N (e.g. 2) = allow N silent steps and remind on step N+1.',
      sectionOrder: 'System prompt section order (sectionOrder)',
      sectionOrderHint:
        'Placement order in the assembled System Prompt (default: 180; smaller values appear earlier).',
      reminderText: 'Custom soft-enforcement reminder text (reminderText)',
      reminderTextHint:
        'Injected as a notice when silent steps exceed the threshold. Leave blank or reset to use the default message.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not active right now, so its settings cannot be edited.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; please check your input.',
      invalidNumber: 'Enter a non-negative integer, or leave blank to use the default.',
      invalidText: 'Enter valid text, or leave blank to use the default.',
    };

    const zh = {
      title: '阶段性结论守卫',
      description: '配置模型在连续工具调用期间输出阶段性结论的步数间隔与提醒文案。',
      maxSilentSteps: '最大连续静默步数（maxSilentSteps）',
      maxSilentStepsHint:
        '允许模型连续多少步仅调用工具而不输出可见结论。设为 0 表示每步必报（漏发当步立即提醒）；设为 N（如 2）表示允许连续静默 N 步，第 N+1 步仍无正文时触发提醒（即每 N+1 步至少汇报一次）。',
      sectionOrder: 'System Prompt 排序权重（sectionOrder）',
      sectionOrderHint: '注入到 System Prompt 的段落位置权重（默认 180，数值越小位置越靠前）。',
      reminderText: '自定义软强制提醒文案（reminderText）',
      reminderTextHint:
        '当连续静默步数超出阈值时自动注入的提醒文案。留空或点击恢复默认将使用内置文案。',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未启用，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署未接受这些配置值，请检查输入格式后重试。',
      invalidNumber: '请输入非负整数（0、1、2…）；留空表示使用默认值。',
      invalidText: '请输入有效文本；留空表示使用默认值。',
    };

    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      };
    }

    function nonNegativeIntField(field) {
      return {
        field,
        format: (value) => (typeof value === 'number' ? String(value) : ''),
        parse: (text) => {
          const trimmed = text.trim();
          if (trimmed === '') return { kind: 'clear' };
          const parsed = Number(trimmed);
          return Number.isInteger(parsed) && parsed >= 0
            ? { kind: 'set', value: parsed }
            : undefined;
        },
      };
    }

    function MilestoneGuardCard(props) {
      const { t } = props;
      const state = props.useMilestoneGuardCard((snapshot) => snapshot);
      if (props.view === 'summary') return t('description');
      const disabled = !state.writable;

      return (0, react_jsx_runtime.jsxs)(primitives.SettingsForm, {
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            id: 'plugin-config-milestone-guard-max-silent-steps',
            label: t('maxSilentSteps'),
            hint: t('maxSilentStepsHint'),
            overriddenLabel: t('overridden'),
            resetLabel: t('reset'),
            invalidLabel: t('invalidNumber'),
            numeric: true,
            disabled,
            ...state.maxSilentSteps,
            onEdit: (text) => {
              props.edit('maxSilentSteps', text);
            },
            onReset: () => {
              props.resetField('maxSilentSteps');
            },
          }),
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            id: 'plugin-config-milestone-guard-section-order',
            label: t('sectionOrder'),
            hint: t('sectionOrderHint'),
            overriddenLabel: t('overridden'),
            resetLabel: t('reset'),
            invalidLabel: t('invalidNumber'),
            numeric: true,
            disabled,
            ...state.sectionOrder,
            onEdit: (text) => {
              props.edit('sectionOrder', text);
            },
            onReset: () => {
              props.resetField('sectionOrder');
            },
          }),
          (0, react_jsx_runtime.jsx)(primitives.SettingsValueField, {
            id: 'plugin-config-milestone-guard-reminder-text',
            label: t('reminderText'),
            hint: t('reminderTextHint'),
            overriddenLabel: t('overridden'),
            resetLabel: t('reset'),
            invalidLabel: t('invalidText'),
            disabled,
            ...state.reminderText,
            onEdit: (text) => {
              props.edit('reminderText', text);
            },
            onReset: () => {
              props.resetField('reminderText');
            },
          }),
        ],
      });
    }

    class MilestoneGuardCardController {
      constructor(scope) {
        this.form = new primitives.SettingsFormModel(scope, [
          nonNegativeIntField('maxSilentSteps'),
          (0, primitives.settingsNumberField)('sectionOrder'),
          (0, primitives.settingsTextField)('reminderText'),
        ]);
        this.store = this.form.bind(() => this.projection());
      }

      projection() {
        return {
          ...this.form.shell(),
          maxSilentSteps: this.form.field('maxSilentSteps'),
          sectionOrder: this.form.field('sectionOrder'),
          reminderText: this.form.field('reminderText'),
        };
      }

      inject() {
        return {
          hooks: { milestoneGuardCard: this.store },
          ...this.form.actions(),
        };
      }

      dispose() {
        this.form.dispose();
      }
    }

    const inject = ['slots', 'locale', 'configForms'];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-milestone-guard: dictionaries',
      );
      const card = new MilestoneGuardCardController(
        ctx.configForms.get(MILESTONE_GUARD_NS),
      );
      ctx.effect(
        () => () => {
          card.dispose();
        },
        'dsh-milestone-guard: form subscription',
      );
      ctx.effect(
        () =>
          ctx.configForms.whileServed([MILESTONE_GUARD_NS], () =>
            ctx.slots.inject('plugins.bundle.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.bundle.config',
                  key: BUNDLE_KEY,
                  locale: NS,
                  inject: () => card.inject(),
                },
                MilestoneGuardCard,
              ),
            ),
          ),
        'dsh-milestone-guard: bundle config page',
      );
      ctx.effect(
        () =>
          ctx.configForms.whileServed([MILESTONE_GUARD_NS], () =>
            ctx.slots.inject('plugins.row.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.row.config',
                  key: ROW_KEY,
                  locale: NS,
                  inject: () => card.inject(),
                },
                MilestoneGuardCard,
              ),
            ),
          ),
        'dsh-milestone-guard: row config page',
      );
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
