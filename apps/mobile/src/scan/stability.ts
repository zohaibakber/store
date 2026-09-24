export type StabilityConfig = {
  readonly minimumTokens: number;
  readonly holdMillis: number;
  readonly cooldownMillis: number;
  readonly sameFrameSimilarity: number;
  readonly sameItemSimilarity: number;
};

export const AUTO_CAPTURE: StabilityConfig = {
  minimumTokens: 4,
  holdMillis: 700,
  cooldownMillis: 1500,
  sameFrameSimilarity: 0.7,
  sameItemSimilarity: 0.5,
};

export type StabilityState = {
  readonly tokens: ReadonlyArray<string>;
  readonly steadySince: number | null;
  readonly lastCaptured: ReadonlyArray<string> | null;
  readonly lastCaptureAt: number | null;
};

export const INITIAL_STABILITY: StabilityState = {
  tokens: [],
  steadySince: null,
  lastCaptured: null,
  lastCaptureAt: null,
};

export const textTokens = (text: string): ReadonlyArray<string> => [
  ...new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []),
];

export const tokenSimilarity = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number => {
  if (left.length === 0 && right.length === 0) return 1;
  const leftSet = new Set(left);
  const shared = right.filter((token) => leftSet.has(token)).length;
  const union = leftSet.size + right.length - shared;
  return union === 0 ? 0 : shared / union;
};

export type StabilityStep = {
  readonly state: StabilityState;
  readonly capture: boolean;
};

export const stepStability = (
  state: StabilityState,
  text: string,
  now: number,
  config: StabilityConfig = AUTO_CAPTURE,
): StabilityStep => {
  const tokens = textTokens(text);
  if (tokens.length < config.minimumTokens) {
    return { state: { ...state, tokens, steadySince: null }, capture: false };
  }
  const steady =
    state.steadySince !== null &&
    tokenSimilarity(state.tokens, tokens) >= config.sameFrameSimilarity;
  const steadySince = steady && state.steadySince !== null ? state.steadySince : now;
  const held = now - steadySince >= config.holdMillis;
  const cooled = state.lastCaptureAt === null || now - state.lastCaptureAt >= config.cooldownMillis;
  const newItem =
    state.lastCaptured === null ||
    tokenSimilarity(state.lastCaptured, tokens) < config.sameItemSimilarity;
  if (held && cooled && newItem) {
    return {
      state: { tokens, steadySince, lastCaptured: tokens, lastCaptureAt: now },
      capture: true,
    };
  }
  return { state: { ...state, tokens, steadySince }, capture: false };
};

export const markCaptured = (state: StabilityState, text: string, now: number): StabilityState => ({
  ...state,
  lastCaptured: textTokens(text),
  lastCaptureAt: now,
});
