import { describe, expect, it } from "vitest";
import {
  buildPath,
  matchRoute,
  normalizePath,
  type RouteDef,
} from "../router.js";

const ROUTES: readonly RouteDef[] = [
  { name: "menu", pattern: "/" },
  { name: "levels", pattern: "/levels" },
  { name: "workshop", pattern: "/workshop" },
  { name: "settings", pattern: "/settings" },
  { name: "credits", pattern: "/credits" },
  { name: "play", pattern: "/play/:levelId" },
  { name: "editor", pattern: "/editor" },
  { name: "shared", pattern: "/l/:shareId" },
];

describe("normalizePath", () => {
  it("collapses empty to root", () => {
    expect(normalizePath("")).toBe("/");
  });
  it("strips a trailing slash except on root", () => {
    expect(normalizePath("/levels/")).toBe("/levels");
    expect(normalizePath("/")).toBe("/");
  });
  it("strips query strings and hashes", () => {
    expect(normalizePath("/play/builtin-07?x=1")).toBe("/play/builtin-07");
    expect(normalizePath("/settings#foo")).toBe("/settings");
  });
});

describe("matchRoute", () => {
  it("matches the root path", () => {
    expect(matchRoute("/", ROUTES)).toEqual({ name: "menu", params: {} });
  });

  it("matches a literal path", () => {
    expect(matchRoute("/levels", ROUTES)).toEqual({
      name: "levels",
      params: {},
    });
  });

  it("matches a param path and extracts the param — the exact deep-link case from the task doc", () => {
    expect(matchRoute("/play/builtin-07", ROUTES)).toEqual({
      name: "play",
      params: { levelId: "builtin-07" },
    });
  });

  it("matches /editor and /l/:shareId", () => {
    expect(matchRoute("/editor", ROUTES)).toEqual({
      name: "editor",
      params: {},
    });
    expect(matchRoute("/l/abc123", ROUTES)).toEqual({
      name: "shared",
      params: { shareId: "abc123" },
    });
  });

  it("does not partial-match — extra segments miss", () => {
    expect(matchRoute("/play/builtin-07/extra", ROUTES)).toBeNull();
    expect(matchRoute("/play", ROUTES)).toBeNull();
  });

  it("returns null for an unknown path", () => {
    expect(matchRoute("/nonexistent", ROUTES)).toBeNull();
  });

  it("tolerates a trailing slash and query string", () => {
    expect(matchRoute("/levels/", ROUTES)).toEqual({
      name: "levels",
      params: {},
    });
    expect(matchRoute("/play/builtin-07?foo=bar", ROUTES)).toEqual({
      name: "play",
      params: { levelId: "builtin-07" },
    });
  });

  it("decodes a URL-encoded param", () => {
    expect(matchRoute("/l/my%20level", ROUTES)).toEqual({
      name: "shared",
      params: { shareId: "my level" },
    });
  });

  it("first match wins when patterns could overlap", () => {
    const routes: RouteDef[] = [
      { name: "first", pattern: "/x/:id" },
      { name: "second", pattern: "/x/:id" },
    ];
    expect(matchRoute("/x/1", routes)?.name).toBe("first");
  });
});

describe("buildPath", () => {
  it("builds a literal path unchanged", () => {
    expect(buildPath("/levels")).toBe("/levels");
    expect(buildPath("/")).toBe("/");
  });

  it("fills params and encodes them", () => {
    expect(buildPath("/play/:levelId", { levelId: "builtin-07" })).toBe(
      "/play/builtin-07",
    );
    expect(buildPath("/l/:shareId", { shareId: "my level" })).toBe(
      "/l/my%20level",
    );
  });

  it("throws on a missing param — a build-time bug, not user input", () => {
    expect(() => buildPath("/play/:levelId", {})).toThrow(
      /missing param "levelId"/,
    );
  });

  it("round-trips through matchRoute for every route in the table", () => {
    const sampleParams: Record<string, Record<string, string>> = {
      play: { levelId: "builtin-07" },
      shared: { shareId: "abc123" },
    };
    for (const route of ROUTES) {
      const params = sampleParams[route.name] ?? {};
      const path = buildPath(route.pattern, params);
      expect(matchRoute(path, ROUTES)).toEqual({ name: route.name, params });
    }
  });
});
