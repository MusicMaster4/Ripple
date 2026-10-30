import { bench, describe } from "vitest";
import { WaterArena, WaterWave, WATER_STEP } from "./water";

const arena = new WaterArena(
  1000,
  640,
  [
    { x: 440, y: 150, width: 24, height: 340 },
    {
      x: 650,
      y: 160,
      width: 130,
      height: 130,
      shape: "circle",
    },
  ],
  27.1875,
);

function waves(count: number) {
  return Array.from(
    { length: count },
    (_, i) =>
      new WaterWave(arena, {
        x: 80 + ((i * 83) % 320),
        y: 80 + ((i * 137) % 480),
      }),
  );
}

describe("water engine", () => {
  bench(
    "32 waves propagated for 8 seconds",
    () => {
      const fields = waves(32);
      for (let age = WATER_STEP; age <= 8000; age += WATER_STEP)
        for (const wave of fields) wave.setAge(age);
    },
    { iterations: 3, warmupIterations: 0 },
  );

  bench(
    "32 reflected fronts extracted",
    () => {
      const fields = waves(32);
      for (const [i, wave] of fields.entries()) wave.front(3000 + i * 150);
    },
    { iterations: 3, warmupIterations: 0 },
  );
});

// Excludes propagation/initialization: this is the actual per-display-frame cost.
const renderFields = waves(32);
for (const wave of renderFields) wave.setAge(8050);
let renderFrame = 0;
describe("continuous crest rendering", () => {
  bench(
    "32 interpolated fronts in one display frame",
    () => {
      const age = 8000 + (++renderFrame % 120) * (49 / 120);
      for (const wave of renderFields) wave.front(age);
    },
    { time: 1000, warmupTime: 200 },
  );
});

// Includes solver work and rebuilding the candidate band at physical steps.
// Synchronized drops expose the costly frames that an interpolation-only test misses.
const frameFields = waves(32);
for (const wave of frameFields) wave.setAge(8000);
let frameAge = 8000;
describe("complete numerical animation frame", () => {
  bench(
    "32 synchronized waves advanced and contoured at 144 Hz",
    () => {
      frameAge += 1000 / 144;
      for (const [i, wave] of frameFields.entries()) {
        wave.setAge(frameAge);
        wave.front(frameAge);
        wave.prefetch(
          frameAge,
          (((i + 1) * 0.618033988749895) % 1) * WATER_STEP,
        );
      }
    },
    { iterations: 144, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
