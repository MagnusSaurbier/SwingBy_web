// T-11 DRAFT dev harness driver. Mounts the real `mountEditor` against the real `createStorage()`
// (T-10 VAULT) — no fakes here, this is what a real page load looks like. Exposes a small
// `window.__editorDev` control surface so a Playwright script can drive it deterministically for
// screenshots, the same technique T-04 AURORA's `dev.ts` used for its own harness.
//
// `api` defaults to a REAL `createApi(window.location.origin)` (T-13 PODIUM) — against this plain
// `vite` dev server (no `/api/**` routes at all), a real Share click genuinely 404s, which is
// itself a useful real-world "never blocks, shows an error" proof, not just a fake one. `mount()`
// also accepts an optional `api` override so a Playwright script can inject a fully controllable
// fake `Api` (deterministic success / hang / malformed-response cases) for the follow-up's
// regression verification — see notes/T-11-DRAFT/log.md's "Follow-ups" entry.
import { BUILTIN_LEVELS } from "@swingby/core";
import { createStorage } from "../storage/index.js";
import { createApi, type Api } from "../net/index.js";
import {
  mountEditor,
  type EditorHandle,
  type EditorMountOptions,
} from "./editor.js";

const app = document.getElementById("app");
if (!app) throw new Error("dev harness: #app missing");

const storage = createStorage();
let handle: EditorHandle | null = null;

function mount(levelIndex: number | null, apiOverride?: Api): void {
  handle?.destroy();
  app!.replaceChildren();
  const api: Api = apiOverride ?? createApi(window.location.origin);
  const opts: EditorMountOptions = {
    storage,
    level: levelIndex === null ? undefined : BUILTIN_LEVELS[levelIndex],
    api,
    onExit: () => {
      // eslint-disable-next-line no-console
      console.log("[editor-dev] exit requested");
    },
    onSaved: (level) => {
      // eslint-disable-next-line no-console
      console.log("[editor-dev] saved", level.name);
    },
  };
  handle = mountEditor(opts);
  app!.append(handle.el);
}

mount(null);

(
  window as unknown as {
    __editorDev: {
      mount: (levelIndex: number | null, apiOverride?: Api) => void;
    };
  }
).__editorDev = { mount };
