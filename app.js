"use strict";

const core = globalThis.IPCheckerCore;
const browserUtils = globalThis.IPCheckerBrowserUtils;
const uiModule = globalThis.IPCheckerUI;
const detectorModule = globalThis.IPCheckerDetectors;
if (!core || !browserUtils || !uiModule || !detectorModule) {
  throw new Error("IP Checker dependencies are missing");
}

const ui = uiModule.createUI({ core, toastDurationMs: 2200 });
const state = new ui.AppState();
const safeFetch = browserUtils.createSafeFetch(8000);
const lookupLocation = browserUtils.createGeoLookup({
  safeFetch,
  timeoutMs: 5000,
});
let currentRun = null;
let nextRunId = 0;
let running = false;

const isCurrentRun = (runId) => currentRun?.id === runId;
const detectors = detectorModule.createDetectors({
  combineSignals: browserUtils.combineSignals,
  isCurrentRun,
  normalizeIP: core.normalizeIP,
  lookupLocation,
  parseCloudflareTrace: core.parseCloudflareTrace,
  safeFetch,
  state: {
    setResultForRun(runId, key, result) {
      if (isCurrentRun(runId) && !currentRun.signal.aborted)
        state.setResult(key, result);
    },
    setLocationForRun(runId, key, location) {
      if (isCurrentRun(runId) && !currentRun.signal.aborted)
        state.setLocation(key, location);
    },
  },
  timeouts: { domestic: 6000, foreign: 7000 },
});

async function checkAll(keys = core.KEYS) {
  if (running) return;
  currentRun?.controller.abort();
  state.stopLocationQueries();
  const controller = new AbortController();
  const run = { id: ++nextRunId, controller, signal: controller.signal };
  currentRun = run;
  running = true;
  state.reset(keys);
  ui.setRunning(true);
  await detectors.checkAllDetectors(run, keys);
  if (!isCurrentRun(run.id) || run.signal.aborted) return;
  running = false;
  ui.setRunning(false);
  ui.updateTimestamp();
}

function stopChecking() {
  currentRun?.controller.abort();
  running = false;
  state.cancelPending();
  ui.setRunning(false);
  ui.updateTimestamp("停止于");
}

ui.el("refresh-btn").addEventListener("click", () => {
  if (running) stopChecking();
  else void checkAll();
});
ui.el("copy-all-btn").addEventListener("click", () => ui.copyAllIps(state));
ui.el("result-grid").addEventListener("click", (event) => {
  const retryButton = event.target.closest(".retry-btn");
  if (retryButton && !running) {
    void checkAll([retryButton.dataset.key]);
    return;
  }
  const copyButton = event.target.closest(".copy-btn");
  if (!copyButton) return;
  const result = state.results[copyButton.dataset.key];
  if (core.isValidIP(result?.ip)) void ui.copyToClipboard(result.ip);
});
window.addEventListener("pagehide", () => currentRun?.controller.abort());
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  // A restored page must not retain a cancelled run as its active task.
  running = false;
  void checkAll();
});
void checkAll();
