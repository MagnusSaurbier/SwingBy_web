// T-02 TAPE — tiny Node ESM "resolve" customization hook, used ONLY to run bench.ts standalone
// via plain `node`. `packages/core/src/**` imports its siblings with a ".js" specifier pointing
// at a ".ts" file (e.g. `import { hydrate } from "./level.js"`) — the convention the whole package
// already uses for `tsc`'s "bundler" module resolution and for vitest (both resolve it fine). A
// bare `node --experimental-strip-types` invocation does NOT do that remapping on its own (checked
// empirically against this checkout's Node v22.22.2: a plain `.js`-specifier import of a sibling
// `.ts` file throws ERR_MODULE_NOT_FOUND — see notes/T-02-TAPE/log.md). This hook is the fix: on a
// module-not-found for a ".js" specifier, retry once with ".ts" before giving up.
//
// Zero npm dependencies — only Node's own `node:module` customization hooks API (stable since
// Node 20.6 as `module.register()`). Test-only tooling, not part of `packages/core/src`, so it
// does not touch the package's zero-dependency runtime contract.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.endsWith(".js")) {
      const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
      try {
        return await nextResolve(tsSpecifier, context);
      } catch {
        // Fall through — throw the ORIGINAL error, which names the ".js" specifier the source
        // actually wrote, not the ".ts" retry that also failed.
      }
    }
    throw err;
  }
}
