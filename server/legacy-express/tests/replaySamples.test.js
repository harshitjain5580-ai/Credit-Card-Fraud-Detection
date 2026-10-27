import { loadReplaySamples, pickSample } from "../src/services/replaySamples.js";

describe("replay samples", () => {
  const samples = [
    { Time: 1, Amount: 2, Class: 0 },
    { Time: 3, Amount: 4, Class: 1 },
  ];

  it("loads all startup replay rows with the required features and labels", () => {
    const loaded = loadReplaySamples();

    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.every((row) => Object.keys(row).length === 31)).toBe(true);
  });

  it("selects fraud-only, genuine-only, or any sample", () => {
    expect(pickSample({ fraud: true }, samples).Class).toBe(1);
    expect(pickSample({ fraud: false }, samples).Class).toBe(0);
    expect(samples).toContain(pickSample({}, samples));
  });
});
