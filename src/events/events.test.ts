import { describe, expect, test, vi } from "vitest";

import { events, mergeEvents, type EventEmitter } from "./events";

type E = { ping: [n: number]; pong: [] };

describe("events", () => {
  test("on/emit delivers args; off stops delivery", () => {
    const [on, emit] = events<E>();
    const cb = vi.fn();
    on.on("ping", cb);
    emit("ping", 1);
    emit("ping", 2);
    expect(cb.mock.calls).toEqual([[1], [2]]);
    on.off("ping", cb);
    emit("ping", 3);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test("once fires at most once", () => {
    const [on, emit] = events<E>();
    const cb = vi.fn();
    on.once("pong", cb);
    emit("pong");
    emit("pong");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("once cleans up its callback entry so a later off resolves the right listener", () => {
    const [on, emit] = events<E>();
    // Same source => same fingerprint, distinct identities (simulates a callback
    // re-marshaled across the VM boundary, which `off` resolves by fingerprint).
    const make = (log: number[]) => (n: number) => log.push(n);

    const onceLog: number[] = [];
    on.once("ping", make(onceLog));
    emit("ping", 1); // fires once; its Map entry must be cleaned up here
    expect(onceLog).toEqual([1]);

    const onLog: number[] = [];
    on.on("ping", make(onLog)); // same fingerprint as the once-callback
    emit("ping", 2);
    expect(onLog).toEqual([2]);

    // A leaked once-entry (inserted first) would win the fingerprint fallback in
    // `off` and leave the real `on` listener attached. With cleanup, off detaches
    // the correct listener and the next emit does nothing.
    on.off("ping", make(onLog));
    emit("ping", 3);
    expect(onLog).toEqual([2]);
  });

  test("off refuses to guess when a colliding fingerprint is ambiguous", () => {
    const [on, emit] = events<E>();
    // Distinct callbacks with identical source share a fingerprint (as all
    // VM-marshaled callbacks do). Two are registered; a third — same source,
    // different identity — is passed to off, so identity misses both.
    const make = (log: number[]) => (n: number) => log.push(n);
    const aLog: number[] = [];
    const bLog: number[] = [];
    on.on("ping", make(aLog));
    on.on("ping", make(bLog));

    on.off("ping", make([])); // ambiguous fingerprint → remove nothing

    emit("ping", 5);
    // Neither listener was wrongly detached.
    expect(aLog).toEqual([5]);
    expect(bLog).toEqual([5]);
  });

  test("only the matching type is delivered", () => {
    const [on, emit] = events<E>();
    const ping = vi.fn();
    on.on("ping", ping);
    emit("pong");
    expect(ping).not.toHaveBeenCalled();
  });

  test("mergeEvents forwards selected types and the returned fn detaches", () => {
    const [srcOn, srcEmit] = events<E>();
    const [, destEmitSpyTarget] = events<E>();
    const dest = vi.fn(destEmitSpyTarget);
    const detach = mergeEvents<E>(
      srcOn,
      dest as unknown as EventEmitter<E>,
      ["ping"]
    );
    srcEmit("ping", 7);
    expect(dest).toHaveBeenCalledWith("ping", 7);
    detach();
    srcEmit("ping", 8);
    expect(dest).toHaveBeenCalledTimes(1);
  });
});
