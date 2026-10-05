// JEV 评分题的文案常量（03 §3.2）。修改须提升 SCORING_VERSION 并重跑 pnpm calibrate:scoring。

export const SCORING_VERSION = 'blend-v1';

export const CHOICE_INSTRUCTIONS =
  'Which option is the wisest path for the asker to take, given the question in state?';

export const FIT_QUESTION =
  'How wise would it be for the asker to take this option, given the question in state?';

export const FIT_LEVELS = [
  "Unwise: likely to backfire, or clearly misaligned with the asker's situation and goals",
  'Questionable: has some merit, but its downsides outweigh its benefits for this asker',
  'Reasonable: benefits and costs are roughly balanced; acceptable but not compelling',
  "Wise: well suited to the asker's situation; benefits clearly outweigh manageable downsides",
  'Excellent: the kind of path a thoughtful advisor would strongly recommend to this asker',
] as const;

export const FIT_MAX = FIT_LEVELS.length - 1; // 4

/** 键名必须是非数字字符串（o1 而不是 1），否则 JS 会重排整数键，反序题失效 */
export const OPTION_KEYS = ['o1', 'o2', 'o3', 'o4'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const QUESTION_KEYS = ['best_fwd', 'best_rev', 'fit_o1', 'fit_o2', 'fit_o3', 'fit_o4'] as const;
