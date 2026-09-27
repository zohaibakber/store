import { describe, expect, it } from "vitest";

import { forecastDemand, inverseNormal } from "../src/insights";

const repeat = (length: number, value: (index: number) => number) =>
  Float64Array.from({ length }, (_, index) => value(index));

describe("forecastDemand", () => {
  it("reports no demand without sales", () => {
    const forecast = forecastDemand(repeat(60, () => 0));
    expect(forecast).toMatchObject({ pattern: "none", method: "none", dailyRate: 0 });
  });

  it("smooths regular sellers with SES near their true rate", () => {
    const forecast = forecastDemand(repeat(90, (index) => 4 + (index % 3) - 1));
    expect(forecast.pattern).toBe("smooth");
    expect(forecast.method).toBe("ses");
    expect(forecast.dailyRate).toBeGreaterThan(3.5);
    expect(forecast.dailyRate).toBeLessThan(4.5);
    expect(forecast.confidence).toBe("high");
    expect(forecast.trend).toBe("steady");
  });

  it("uses bias-corrected Croston for intermittent sellers", () => {
    const forecast = forecastDemand(repeat(90, (index) => (index % 5 === 0 ? 5 : 0)));
    expect(forecast.pattern).toBe("intermittent");
    expect(forecast.method).toBe("sba");
    expect(forecast.dailyRate).toBeGreaterThan(0.8);
    expect(forecast.dailyRate).toBeLessThan(1.1);
  });

  it("flags a statistically clear acceleration as rising", () => {
    const forecast = forecastDemand(repeat(60, (index) => (index >= 46 ? 12 : 3)));
    expect(forecast.trend).toBe("rising");
    expect(forecast.trendRatio).toBeGreaterThan(3);
    expect(forecast.dailyRate).toBeGreaterThan(6);
  });

  it("keeps a clear but small lift as steady", () => {
    const forecast = forecastDemand(repeat(60, (index) => (index >= 46 ? 60 : 50)));
    expect(forecast.trend).toBe("steady");
    expect(forecast.trendRatio).toBeCloseTo(1.2, 5);
  });

  it("does not call noise on tiny volumes a trend", () => {
    const forecast = forecastDemand(repeat(60, (index) => (index === 50 || index === 10 ? 1 : 0)));
    expect(forecast.trend).toBe("unknown");
    expect(forecast.pattern).toBe("sparse");
  });
});

describe("inverseNormal", () => {
  it("matches standard z-scores", () => {
    expect(inverseNormal(0.5)).toBeCloseTo(0, 6);
    expect(inverseNormal(0.95)).toBeCloseTo(1.6449, 3);
    expect(inverseNormal(0.975)).toBeCloseTo(1.96, 3);
    expect(inverseNormal(0.01)).toBeCloseTo(-2.3263, 3);
  });
});
