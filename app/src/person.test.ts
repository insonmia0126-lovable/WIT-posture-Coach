import { describe, expect, it } from "vitest";
import { newPersonId } from "./person";
import { sessionsForPerson, type StoredSession } from "./storage";

describe("person id", () => {
  it("assigns a WIT id", () => {
    const id = newPersonId();
    expect(id).toMatch(/^WIT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });
});

describe("sessionsForPerson", () => {
  const base = {
    startedAt: "2026-10-13T00:00:00.000Z",
    demo: false,
    sessionMs: 1000,
    validMs: 800,
    unavailableMs: 0,
    inRangeMs: 800,
    coachingCount: 0,
    recoveryCount: 0,
    meanRecoveryMs: null,
    kindCounts: { head: 0, shoulder: 0, torso: 0 },
    timeline: [],
  } satisfies Omit<StoredSession, "id">;

  it("keeps only that person's webcam rows", () => {
    const rows: StoredSession[] = [
      { ...base, id: "a", personId: "WIT-ABCD" },
      { ...base, id: "b", personId: "WIT-ZZZZ" },
      { ...base, id: "c", personId: "WIT-ABCD", demo: true },
    ];
    expect(sessionsForPerson(rows, "WIT-ABCD").map((s) => s.id)).toEqual(["a"]);
  });
});