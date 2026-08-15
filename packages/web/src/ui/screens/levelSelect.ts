// T-08 BRIDGE — Level Select screen. Task doc: "Grid of 33 built-in levels + custom levels.
// Completion state, personal bests when showTimes. Deep-linkable." Two tabs (Preset / Custom),
// mirroring UIBuilder.gd's build_level_select_screen (structure only — imperative widget
// construction there becomes a <div role="tablist"> + CSS grid here).

import { BUILTIN_LEVELS } from "@swingby/core";
import { fromMarkup, h } from "../dom.js";
import { backLink, screenHeader } from "../chrome.js";
import { buildPath } from "../router.js";
import { iconMarkup } from "../icons.js";
import { buildLevelList, formatMs, type LevelCardVM } from "../view-models.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

function levelCard(vm: LevelCardVM, showTimes: boolean): HTMLElement {
  const meta: string[] = [];
  if (vm.isCustom) meta.push(`by ${vm.author}`);
  if (showTimes && vm.best) {
    meta.push(`best ${formatMs(vm.best.timeMs)}`, `${formatMs(vm.best.boostMs)} boost`);
  }

  return h(
    "a",
    {
      href: buildPath("/play/:levelId", { levelId: vm.id }),
      class: "level-card",
      "aria-label": `${vm.name}${vm.completed ? ", completed" : ""}`,
    },
    [
      h("span", { class: "level-index" }, [vm.isCustom ? "•" : String(vm.index + 1).padStart(2, "0")]),
      h("span", { class: "level-info" }, [
        h("span", { class: "level-name" }, [vm.name]),
        meta.length > 0 ? h("span", { class: "level-meta" }, [meta.join(" · ")]) : null,
      ]),
      vm.completed ? h("span", { class: "level-status" }, [fromMarkup(iconMarkup("check")), "done"]) : null,
    ],
  );
}

export function renderLevelSelect(ctx: ScreenCtx): ScreenResult {
  const settings = ctx.storage.getSettings();
  const customs = ctx.storage.listCustomLevels();
  const { builtin, custom } = buildLevelList(BUILTIN_LEVELS, customs, ctx.storage);

  const builtinPanel = h(
    "div",
    { role: "tabpanel", id: "panel-preset", "aria-labelledby": "tab-preset" },
    [h("div", { class: "level-grid" }, builtin.map((vm) => levelCard(vm, settings.showTimes)))],
  );

  const customPanel = h(
    "div",
    { role: "tabpanel", id: "panel-custom", "aria-labelledby": "tab-custom", hidden: true },
    [
      custom.length > 0
        ? h("div", { class: "level-grid" }, custom.map((vm) => levelCard(vm, settings.showTimes)))
        : h("p", { class: "subtitle" }, ["No custom levels yet — build one in the Editor."]),
    ],
  );

  const tabPreset = h(
    "button",
    { class: "tab", role: "tab", id: "tab-preset", "aria-selected": "true", "aria-controls": "panel-preset", tabindex: "0" },
    [`Preset (${builtin.length})`],
  );
  const tabCustom = h(
    "button",
    { class: "tab", role: "tab", id: "tab-custom", "aria-selected": "false", "aria-controls": "panel-custom", tabindex: "-1" },
    [`Custom (${custom.length})`],
  );

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
  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Level source" }, [tabPreset, tabCustom]);

  // Arrow-key roving between tabs, standard tablist keyboard behaviour (only two tabs, so either
  // arrow direction just toggles which one is focused/selected).
  tabs.addEventListener("keydown", (ev) => {
    const key = (ev as KeyboardEvent).key;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      ev.preventDefault();
      selectTab(document.activeElement === tabPreset ? "custom" : "preset");
    }
  });

  const header = h("div", { class: "level-select-header" }, [screenHeader("Choose a stage", "Select a mission to fly."), tabs]);

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
