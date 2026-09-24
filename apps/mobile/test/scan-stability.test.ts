import { describe, expect, it } from "vitest";

import {
  INITIAL_STABILITY,
  type StabilityState,
  markCaptured,
  stepStability,
  textTokens,
  tokenSimilarity,
} from "../src/scan/stability";

const panadol = "PANADOL Extra Paracetamol 500mg B.No AB1234 EXP 08/27";
const brufen = "BRUFEN Ibuprofen 400mg tablets LOT 99X EXP 01/28";

const feed = (texts: ReadonlyArray<readonly [string, number]>, start = INITIAL_STABILITY) => {
  let state: StabilityState = start;
  const captures: Array<number> = [];
  for (const [text, now] of texts) {
    const step = stepStability(state, text, now);
    state = step.state;
    if (step.capture) captures.push(now);
  }
  return { state, captures };
};

describe("textTokens", () => {
  it("keeps unique lowercase words of two or more characters", () => {
    expect(textTokens("EXP 08/27 exp a")).toEqual(["exp", "08", "27"]);
  });

  it("measures overlap between frames", () => {
    expect(tokenSimilarity(textTokens(panadol), textTokens(panadol))).toBe(1);
    expect(tokenSimilarity(textTokens(panadol), textTokens(brufen))).toBeLessThan(0.3);
  });
});

describe("stepStability", () => {
  it("captures once the text has held steady", () => {
    const { captures } = feed([
      [panadol, 0],
      [panadol, 300],
      [panadol, 750],
      [panadol, 1000],
    ]);
    expect(captures).toEqual([750]);
  });

  it("does not capture sparse or changing text", () => {
    expect(
      feed([
        ["EXP", 0],
        ["EXP", 900],
      ]).captures,
    ).toEqual([]);
    expect(
      feed([
        [panadol, 0],
        [brufen, 400],
        [panadol, 800],
      ]).captures,
    ).toEqual([]);
  });

  it("waits for a different item and the cooldown before capturing again", () => {
    const first = feed([
      [panadol, 0],
      [panadol, 800],
    ]);
    expect(first.captures).toEqual([800]);
    const again = feed(
      [
        [panadol, 2000],
        [panadol, 3000],
        [brufen, 3100],
        [brufen, 3900],
      ],
      first.state,
    );
    expect(again.captures).toEqual([3900]);
  });

  it("treats a manual capture as the last item", () => {
    const state = markCaptured(INITIAL_STABILITY, panadol, 0);
    expect(
      feed(
        [
          [panadol, 2000],
          [panadol, 3000],
        ],
        state,
      ).captures,
    ).toEqual([]);
  });
});
