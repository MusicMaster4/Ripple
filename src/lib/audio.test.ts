import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { DROP_COUNT, loadSound } from "./audio";

function storage(value: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => value });
}
afterEach(() => vi.unstubAllGlobals());

describe("sound preferences", () => {
  it("starts with music at zero, keeping water audible", () => {
    storage(null);
    expect(loadSound()).toEqual({ music: 0, effects: 0.45, muted: false });
  });
  it("respects a saved music choice and clamps volumes", () => {
    storage('{"music":0.6,"effects":5,"muted":true}');
    expect(loadSound()).toEqual({ music: 0.6, effects: 1, muted: true });
  });
  it.each(["null", "broken JSON", '{"music":"bad","effects":null}'])(
    "recovers from invalid preferences: %s",
    (value) => {
      storage(value);
      expect(loadSound().music).toBe(0);
      expect(loadSound().effects).toBe(0.45);
    },
  );
  it("plays without available storage", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw Error("disabled");
      },
    });
    expect(loadSound().music).toBe(0);
  });
});

describe("shipped water bank", () => {
  it("matches the playback count and manifest hashes with no missing samples", () => {
    const manifest = JSON.parse(
      readFileSync("docs/audio-manifest.json", "utf8"),
    );
    const files = readdirSync("public/audio/drops").filter((f) =>
      f.endsWith(".wav"),
    );
    const drops = manifest.assets.filter((a: { file: string }) =>
      a.file.startsWith("drops/"),
    );
    expect(files).toHaveLength(DROP_COUNT);
    expect(drops).toHaveLength(DROP_COUNT);
    expect(new Set(drops.map((a: { sha256: string }) => a.sha256)).size).toBe(
      DROP_COUNT,
    );
    for (const asset of manifest.assets) {
      const bytes = readFileSync(`public/audio/${asset.file}`);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
    expect(
      manifest.assets.filter((a: { file: string }) =>
        a.file.startsWith("sink-"),
      ),
    ).toHaveLength(2);
  });
});
