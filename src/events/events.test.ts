import { describe, expect, test, vi } from "vitest";

import { events, mergeEvents } from "./events";

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
    const detach = mergeEvents<E>(srcOn, dest, ["ping"]);
    srcEmit("ping", 7);
    expect(dest).toHaveBeenCalledWith("ping", 7);
    detach();
    srcEmit("ping", 8);
    expect(dest).toHaveBeenCalledTimes(1);
  });
});
