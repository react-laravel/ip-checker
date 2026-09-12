"use strict";

(function initUI(globalScope) {
  function createUI({ core, toastDurationMs }) {
    const components = globalScope.IPCheckerUIComponents;
    const el = (id) => document.getElementById(id);
    const cards = new Map(
      Array.from(
        components.mountResultCards(el("result-grid"), core.KEYS),
        ([key, root]) => [
          key,
          components.createResultCard({
            root,
            isValidIP: core.isValidIP,
            getLatencyTier: core.getLatencyTier,
          }),
        ],
      ),
    );
    const summary = components.createSummary(el("summary"));
    const feedback = components.createFeedback({
      toastElement: el("toast"),
      toastDurationMs,
    });
    const copyLabels = new Map(
      components
        .getCardDefinitions(core.KEYS)
        .map((item) => [item.key, item.copyLabel]),
    );

    class AppState {
      constructor() {
        this.results = Object.fromEntries(
          core.KEYS.map((key) => [key, core.createPendingResult()]),
        );
      }
      reset(keys = core.KEYS) {
        for (const key of keys) {
          this.results[key] = core.createPendingResult();
          cards.get(key).render(this.results[key]);
        }
        summary.clearTimestamp();
        this.updateSummary();
      }
      updateSummary() {
        summary.render(core.summarizeResults(this.results));
        el("copy-all-btn").disabled = !core.KEYS.some((key) =>
          core.isValidIP(this.results[key].ip),
        );
      }
      setResult(key, result) {
        this.results[key] = { ...core.createPendingResult(), ...result };
        cards.get(key).render(this.results[key]);
        this.updateSummary();
      }
      setLocation(key, location) {
        this.results[key].location = location;
        cards.get(key).render(this.results[key]);
      }
      cancelPending() {
        for (const key of core.KEYS) {
          if (this.results[key].status === "loading") {
            this.setResult(key, {
              status: "cancelled",
              message: "检测已停止",
              note: "可单独重试此项。",
            });
          }
        }
        this.stopLocationQueries();
      }
      stopLocationQueries() {
        for (const key of core.KEYS) {
          if (this.results[key].ip && !this.results[key].location) {
            this.setLocation(
              key,
              this.results[key].countryCode || "位置查询已停止",
            );
          }
        }
      }
    }

    function setRunning(running) {
      const button = el("refresh-btn");
      button.classList.toggle("is-running", running);
      button.querySelector(".refresh-text").textContent = running
        ? "停止检测"
        : "重新检测";
      button.setAttribute("aria-label", running ? "停止检测" : "重新检测");
      cards.forEach((card) => card.setRetryDisabled(running));
    }

    function copyAllIps(state) {
      const entries = core.KEYS.flatMap((key) =>
        core.isValidIP(state.results[key].ip)
          ? [`${copyLabels.get(key)}: ${state.results[key].ip}`]
          : [],
      );
      if (!entries.length) return;
      void feedback.copyToClipboard(
        entries.join("\n"),
        `已复制 ${entries.length} 项 IP 结果`,
      );
    }

    return {
      AppState,
      el,
      setRunning,
      copyAllIps,
      copyToClipboard: feedback.copyToClipboard,
      updateTimestamp: summary.updateTimestamp,
    };
  }
  globalScope.IPCheckerUI = { createUI };
})(typeof globalThis !== "undefined" ? globalThis : window);
