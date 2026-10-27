import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const replaySamplesPath = new URL("../../data/replay_samples.json", import.meta.url);
const featureNames = [
  "Time",
  ...Array.from({ length: 28 }, (_value, index) => `V${index + 1}`),
  "Amount",
];

/**
 * Loads and validates the replay dataset once when the server starts.
 */
export function loadReplaySamples(path = fileURLToPath(replaySamplesPath)) {
  const samples = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some(
      (sample) =>
        !sample ||
        ![0, 1].includes(sample.Class) ||
        featureNames.some((name) => typeof sample[name] !== "number"),
    )
  ) {
    throw new Error(`Replay samples are missing valid transaction rows: ${path}`);
  }
  return samples;
}

const replaySamples = loadReplaySamples();

/**
 * Picks a random replay row, optionally restricted to fraud or genuine samples.
 */
export function pickSample({ fraud } = {}, samples = replaySamples) {
  const candidates =
    fraud === undefined
      ? samples
      : samples.filter((sample) => sample.Class === (fraud ? 1 : 0));
  if (candidates.length === 0) {
    throw new Error(`No ${fraud ? "fraud" : "genuine"} replay samples are available.`);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}
