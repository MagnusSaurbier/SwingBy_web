// T-11 DRAFT dev harness driver. Mounts the real `mountEditor` against the real `createStorage()`
// (T-10 VAULT) — no fakes here, this is what a real page load looks like. Exposes a small
// `window.__editorDev` control surface so a Playwright script can drive it deterministically for
// screenshots, the same technique T-04 AURORA's `dev.ts` used for its own harness.
import { BUILTIN_LEVELS } from "@swingby/core";
import { createStorage } from "../storage/index.js";
import { mountEditor, type EditorHandle } from "./editor.js";

const app = document.getElementById("app");
if (!app) throw new Error("dev harness: #app missing");

const storage = createStorage();
let handle: EditorHandle | null = null;

function mount(levelIndex: number | null): void {
  handle?.destroy();
  app!.replaceChildren();
  handle = mountEditor({
    storage,
    level: levelIndex === null ? undefined : BUILTIN_LEVELS[levelIndex],
    onExit: () => {
      // eslint-disable-next-line no-console
      console.log("[editor-dev] exit requested");
    },
    onSaved: (level) => {
      // eslint-disable-next-line no-console
      console.log("[editor-dev] saved", level.name);
    },
  });
  app!.append(handle.el);
}

mount(null);

(
  window as unknown as {
    __editorDev: { mount: (levelIndex: number | null) => void };
  }
).__editorDev = { mount };
