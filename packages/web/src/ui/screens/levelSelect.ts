// T-08 BRIDGE — Level Select screen. Task doc: "Grid of 33 built-in levels + custom levels.
// Completion state, personal bests when showTimes. Deep-linkable." Two tabs (Preset / Custom),
// mirroring UIBuilder.gd's build_level_select_screen (structure only — imperative widget
// construction there becomes a <div role="tablist"> + CSS grid here).

import { BUILTIN_LEVELS, customLevelId } from "@swingby/core";
import { fromMarkup, h } from "../dom.js";
import { backLink, screenHeader } from "../chrome.js";
import { buildPath } from "../router.js";
import { iconMarkup } from "../icons.js";
import { formatWorldBest } from "../leaderboard/worldBest.js";
import { buildLevelList, formatMs, type LevelCardVM } from "../view-models.js";
import { confirmDialog } from "../dialog.js";
import { saveTextFile } from "../downloadFile.js";
import {
  buildDuplicateCheckState,
  buildLevelExport,
  classifyImportEntry,
  parseLevelExportFile,
  registerImportedLevel,
} from "../levelExport.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

/** Selection-mode wiring for one card, passed only for custom-panel cards while "Export" is
 *  active. Presence of this param, not a separate flag, is what switches a card from "navigate on
 *  click" to "toggle on click". */
interface CardSelection {
  selected: boolean;
  onToggle: () => void;
}

function levelCard(
  ctx: ScreenCtx,
  vm: LevelCardVM,
  showTimes: boolean,
  selection?: CardSelection,
): HTMLElement {
  const meta: string[] = [];
  if (vm.isCustom) meta.push(`by ${vm.author}`);
  if (showTimes && vm.best) {
    meta.push(
      `best ${formatMs(vm.best.timeMs)}`,
      `${formatMs(vm.best.boostMs)} boost`,
    );
  }

  // Built visible/hidden up front (not appended conditionally) so the async world-best fetch below
  // has a stable node to write into without a full card rerender — matches the "mutate in place,
  // never blow away focus" rule the rest of this screen already follows.
  const metaEl = h("span", { class: "level-meta", hidden: meta.length === 0 }, [
    meta.join(" · "),
  ]);

  const attrs: Record<string, string> = {
    href: buildPath("/play/:levelId", { levelId: vm.id }),
    class: "level-card",
    "aria-label": `${vm.name}${vm.completed ? ", completed" : ""}`,
  };
  if (selection) attrs["aria-pressed"] = String(selection.selected);

  const cardEl = h("a", attrs, [
    selection
      ? h("span", { class: "level-select-toggle", "aria-hidden": "true" }, [
          selection.selected ? fromMarkup(iconMarkup("check")) : null,
        ])
      : null,
    h("span", { class: "level-index" }, [
      vm.isCustom ? "•" : String(vm.index + 1).padStart(2, "0"),
    ]),
    h("span", { class: "level-info" }, [
      h("span", { class: "level-name" }, [vm.name]),
      metaEl,
    ]),
    vm.completed
      ? h("span", { class: "level-status" }, [
          fromMarkup(iconMarkup("check")),
          "done",
        ])
      : null,
  ]);

  if (selection) {
    // Select mode replaces navigation entirely: clicking (or Enter-activating) the card toggles
    // its checkbox instead of leaving the screen. preventDefault covers both, since a keyboard
    // "activate this link" also dispatches a click event.
    const onToggle = selection.onToggle;
    cardEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      onToggle();
    });
  }

  // T-13 PODIUM's world-best adornment (results/T-13-PODIUM.md wiring note #3): fetched on-demand
  // per card, not batched — a deliberate choice (see notes/T-08-BRIDGE/log.md design decision #5).
  // Custom levels are never submitted to the leaderboard (play.ts's submission gate), so skip the
  // request entirely rather than firing one that can only ever come back empty.
  if (!vm.isCustom) {
    void ctx.api.leaderboard(vm.id, "fastest").then((entries) => {
      const worldBest = formatWorldBest(entries);
      if (!worldBest) return;
      metaEl.textContent =
        meta.length > 0 ? `${meta.join(" · ")} · ${worldBest}` : worldBest;
      metaEl.hidden = false;
    });
  }

  return cardEl;
}

const EXPORT_FILENAME_PREFIX = "swingby-levels-";

function exportFilename(): string {
  return `${EXPORT_FILENAME_PREFIX}${new Date().toISOString().slice(0, 10)}.json`;
}

export function renderLevelSelect(ctx: ScreenCtx): ScreenResult {
  const settings = ctx.storage.getSettings();
  // Mutable — refreshed after a successful import so the custom tab reflects what's now stored.
  let customs = ctx.storage.listCustomLevels();

  const { builtin } = buildLevelList(BUILTIN_LEVELS, customs, ctx.storage);

  const builtinPanel = h(
    "div",
    { role: "tabpanel", id: "panel-preset", "aria-labelledby": "tab-preset" },
    [
      h(
        "div",
        { class: "level-grid" },
        builtin.map((vm) => levelCard(ctx, vm, settings.showTimes)),
      ),
    ],
  );

  // --- Custom panel: export ("select" mode + download) and import -----------------------------
  //
  // Export mode state lives here, outside any single render pass, and is applied by rebuilding
  // just `customPanel`'s children (`renderCustomPanel`) rather than the whole screen — a full
  // `ctx.rerender()` would lose it, since that calls this function again from scratch. Import DOES
  // go through a full local refresh (`customs` reassigned, then `renderCustomPanel()`), since it
  // can add levels the rest of this closure has no other way to learn about.
  let selectMode = false;
  let selectedIds = new Set<string>();

  function customCards(): LevelCardVM[] {
    return buildLevelList(BUILTIN_LEVELS, customs, ctx.storage).custom;
  }

  function customGrid(): HTMLElement {
    const cards = customCards();
    if (cards.length === 0) {
      return h("p", { class: "subtitle" }, [
        "No custom levels yet — build one in the Editor.",
      ]);
    }
    return h(
      "div",
      { class: "level-grid" },
      cards.map((vm) =>
        levelCard(
          ctx,
          vm,
          settings.showTimes,
          selectMode
            ? {
                selected: selectedIds.has(vm.id),
                onToggle: () => toggleSelected(vm.id),
              }
            : undefined,
        ),
      ),
    );
  }

  function toggleSelected(id: string): void {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    renderCustomPanel();
  }

  function customToolbar(): HTMLElement {
    if (!selectMode) {
      const exportBtn = h(
        "button",
        { type: "button", class: "btn btn-ghost" },
        ["Export"],
      );
      exportBtn.addEventListener("click", () => {
        selectMode = true;
        selectedIds = new Set();
        renderCustomPanel();
      });
      const importBtn = h(
        "button",
        { type: "button", class: "btn btn-ghost" },
        ["Import"],
      );
      importBtn.addEventListener("click", () => fileInput.click());
      return h("div", { class: "level-select-toolbar" }, [
        exportBtn,
        importBtn,
      ]);
    }

    const selectAllBtn = h(
      "button",
      { type: "button", class: "btn btn-ghost" },
      ["Select all"],
    );
    selectAllBtn.addEventListener("click", () => {
      selectedIds = new Set(customCards().map((vm) => vm.id));
      renderCustomPanel();
    });
    const deselectAllBtn = h(
      "button",
      { type: "button", class: "btn btn-ghost" },
      ["Deselect all"],
    );
    deselectAllBtn.addEventListener("click", () => {
      selectedIds = new Set();
      renderCustomPanel();
    });
    const cancelBtn = h("button", { type: "button", class: "btn btn-ghost" }, [
      "Cancel",
    ]);
    cancelBtn.addEventListener("click", () => {
      selectMode = false;
      selectedIds = new Set();
      renderCustomPanel();
    });
    const count = selectedIds.size;
    const downloadBtn = h(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        disabled: count === 0,
      },
      [`Download level files${count > 0 ? ` (${count})` : ""}`],
    );
    downloadBtn.addEventListener("click", () => void downloadSelected());

    return h("div", { class: "level-select-toolbar" }, [
      selectAllBtn,
      deselectAllBtn,
      h("span", { class: "level-select-toolbar-spacer" }, []),
      cancelBtn,
      downloadBtn,
    ]);
  }

  async function downloadSelected(): Promise<void> {
    const selected = customs.filter((lvl) =>
      selectedIds.has(customLevelId(lvl)),
    );
    if (selected.length === 0) return;
    const payload = buildLevelExport(selected, (lvl) =>
      ctx.storage.getCustomLevelCreatedAt(customLevelId(lvl)),
    );
    await saveTextFile(JSON.stringify(payload, null, 2), exportFilename());
    selectMode = false;
    selectedIds = new Set();
    renderCustomPanel();
  }

  async function acknowledge(title: string, body: string): Promise<void> {
    await confirmDialog(document.body, {
      title,
      body,
      confirmLabel: "OK",
      hideCancel: true,
    }).result;
  }

  /** True to import `entry` as a copy anyway, false to skip it. */
  async function resolveConflict(
    entryName: string,
    conflict: "duplicate-content" | "duplicate-name",
  ): Promise<boolean> {
    return confirmDialog(document.body, {
      title:
        conflict === "duplicate-content"
          ? "Duplicate level"
          : "Level name already used",
      body:
        conflict === "duplicate-content"
          ? `"${entryName}" is identical to a level you already have. Keep both?`
          : `A custom level named "${entryName}" already exists. Keep both?`,
      confirmLabel: "Keep both",
      cancelLabel: "Skip",
    }).result;
  }

  async function runImport(text: string): Promise<void> {
    const parsed = parseLevelExportFile(text);
    if (!parsed.ok) {
      await acknowledge("Import failed", parsed.reason);
      return;
    }

    const state = buildDuplicateCheckState(customs);
    const skipped: string[] = [...parsed.malformed];
    let imported = 0;

    for (const entry of parsed.entries) {
      const conflict = classifyImportEntry(entry.level, state);
      if (conflict !== "new") {
        const keepBoth = await resolveConflict(entry.level.name, conflict);
        if (!keepBoth) {
          skipped.push(`"${entry.level.name}": skipped (duplicate)`);
          continue;
        }
      }
      try {
        ctx.storage.saveCustomLevel(
          entry.level,
          entry.createdAt ? { createdAt: entry.createdAt } : undefined,
        );
        registerImportedLevel(entry.level, state);
        imported++;
      } catch (err) {
        skipped.push(
          `"${entry.level.name}": could not be saved (${err instanceof Error ? err.message : "storage error"})`,
        );
      }
    }

    customs = ctx.storage.listCustomLevels();
    selectMode = false;
    selectedIds = new Set();
    renderCustomPanel();

    if (skipped.length > 0) {
      await acknowledge(
        imported > 0 ? "Import finished with warnings" : "Import failed",
        `Imported ${imported} level${imported === 1 ? "" : "s"}. ${skipped.join(" · ")}`,
      );
    }
  }

  const fileInput = h("input", {
    type: "file",
    accept: ".json,application/json",
    hidden: true,
  }) as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    void file.text().then(runImport);
  });

  const customPanel = h(
    "div",
    {
      role: "tabpanel",
      id: "panel-custom",
      "aria-labelledby": "tab-custom",
      hidden: true,
    },
    [],
  );

  function renderCustomPanel(): void {
    customPanel.replaceChildren(customToolbar(), customGrid(), fileInput);
    tabCustom.textContent = `Custom (${customCards().length})`;
  }

  const tabPreset = h(
    "button",
    {
      class: "tab",
      role: "tab",
      id: "tab-preset",
      "aria-selected": "true",
      "aria-controls": "panel-preset",
      tabindex: "0",
    },
    [`Preset (${builtin.length})`],
  );
  const tabCustom = h(
    "button",
    {
      class: "tab",
      role: "tab",
      id: "tab-custom",
      "aria-selected": "false",
      "aria-controls": "panel-custom",
      tabindex: "-1",
    },
    [`Custom (${customCards().length})`],
  );
  // Now that both `tabCustom` and `customPanel` exist, populate the custom panel for real —
  // `customCards()`/`renderCustomPanel()` above only reference them, so this is the first point
  // both are safe to call.
  renderCustomPanel();

  // Roving tabindex (ARIA APG tablist pattern): only the SELECTED tab sits in the regular Tab
  // sequence; the other gets tabindex="-1" (still focusable programmatically via arrow keys, just
  // skipped by Tab). Without this, Tab from the tablist lands on the other tab button instead of
  // moving into the panel content below it — a real bug the keyboard-only pass caught (see
  // notes/T-08-BRIDGE/log.md).
  function selectTab(which: "preset" | "custom"): void {
    const presetActive = which === "preset";
    tabPreset.setAttribute("aria-selected", String(presetActive));
    tabPreset.setAttribute("tabindex", presetActive ? "0" : "-1");
    tabCustom.setAttribute("aria-selected", String(!presetActive));
    tabCustom.setAttribute("tabindex", presetActive ? "-1" : "0");
    builtinPanel.hidden = !presetActive;
    customPanel.hidden = presetActive;
    (presetActive ? tabPreset : tabCustom).focus();
  }
  tabPreset.addEventListener("click", () => selectTab("preset"));
  tabCustom.addEventListener("click", () => selectTab("custom"));
  const tabs = h(
    "div",
    { class: "tabs", role: "tablist", "aria-label": "Level source" },
    [tabPreset, tabCustom],
  );

  // Arrow-key roving between tabs, standard tablist keyboard behaviour (only two tabs, so either
  // arrow direction just toggles which one is focused/selected).
  tabs.addEventListener("keydown", (ev) => {
    const key = (ev as KeyboardEvent).key;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      ev.preventDefault();
      selectTab(document.activeElement === tabPreset ? "custom" : "preset");
    }
  });

  const header = h("div", { class: "level-select-header" }, [
    screenHeader("Choose a stage", "Select a mission to fly."),
    tabs,
  ]);

  const el = h("main", { class: "screen" }, [
    h("div", { class: "panel screen-shell level-select-shell" }, [
      header,
      builtinPanel,
      customPanel,
      h("div", { class: "screen-footer" }, [backLink("/")]),
    ]),
  ]);

  return { el };
}
