"use strict";

(function initUIComponents(globalScope) {
  const CARD_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "domestic",
      icon: "CN",
      iconClass: "domestic",
      title: "国内出口",
      description: "访问国内检测服务时的出口 IP",
      copyLabel: "国内",
      group: "domestic",
    }),
    Object.freeze({
      key: "foreign",
      icon: "INTL",
      iconClass: "foreign",
      title: "国际出口",
      description: "访问国际检测服务时的出口 IP",
      copyLabel: "国际",
      group: "overseas",
    }),
    Object.freeze({
      key: "google",
      icon: "G",
      iconClass: "google",
      title: "Google",
      description: "连接测试 · 不提供出口 IP",
      copyLabel: "Google",
      group: "overseas",
    }),
    Object.freeze({
      key: "cf",
      icon: "CF",
      iconClass: "cloudflare",
      title: "Cloudflare",
      description: "访问 Cloudflare 检测服务时的出口 IP",
      copyLabel: "Cloudflare",
      group: "overseas",
    }),
  ]);

  function getCardDefinitions(keys) {
    return keys.map((key) => {
      const definition = CARD_DEFINITIONS.find((item) => item.key === key);
      if (!definition) throw new Error(`Missing card definition: ${key}`);
      return definition;
    });
  }

  function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createCopyIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M9 9h11v11H9z M5 15H3V3h12v2");
    svg.append(path);
    return svg;
  }

  function createResultCardElement(definition) {
    const root = createElement(
      "article",
      `card ${definition.key === "domestic" ? "domestic-card" : "result-item"}`,
    );
    root.dataset.key = definition.key;
    root.setAttribute("aria-labelledby", `${definition.key}-title`);
    const header = createElement("div", "card-header");
    const icon = createElement(
      "div",
      `card-icon ${definition.iconClass}`,
      definition.icon,
    );
    icon.setAttribute("aria-hidden", "true");
    const heading = createElement("div", "card-heading");
    const title = createElement(
      definition.key === "domestic" ? "h2" : "h3",
      "card-title",
      definition.title,
    );
    title.id = `${definition.key}-title`;
    heading.append(
      title,
      createElement("p", "card-desc", definition.description),
    );
    header.append(
      icon,
      heading,
      createElement("span", "card-status", "检测中"),
    );

    const body = createElement("div", "card-body");
    const ipRow = createElement("div", "ip-row");
    const ip = createElement("div", "ip-display");
    ip.id = `${definition.key}-ip`;
    const family = createElement("span", "ip-family");
    const copy = createElement("button", "copy-btn");
    copy.type = "button";
    copy.dataset.key = definition.key;
    copy.setAttribute("aria-label", `复制${definition.title} IP`);
    copy.title = `复制${definition.title} IP`;
    copy.append(createCopyIcon());
    copy.hidden = true;
    ipRow.append(ip, family, copy);
    const location = createElement("div", "ip-location");
    location.id = `${definition.key}-location`;
    body.append(ipRow, location);
    const note = createElement("p", "result-note");
    const meta = createElement("div", "card-meta");
    const retry = createElement("button", "retry-btn", "重试");
    retry.type = "button";
    retry.dataset.key = definition.key;
    retry.setAttribute("aria-label", `重试${definition.title}`);
    retry.hidden = true;
    const footer = createElement("div", "card-footer");
    footer.append(meta, retry);
    root.append(header, body, note, footer);
    return root;
  }

  function createOverseasGroupElement(definitions) {
    const root = createElement("section", "overseas-group");
    root.setAttribute("aria-labelledby", "overseas-card-title");
    const heading = createElement("div", "group-heading");
    const title = createElement("h2", "group-title", "海外服务");
    title.id = "overseas-card-title";
    heading.append(
      title,
      createElement("span", "group-description", "对照不同服务的连接结果"),
    );
    const list = createElement("div", "result-list");
    const cards = new Map();
    for (const definition of definitions) {
      const card = createResultCardElement(definition);
      cards.set(definition.key, card);
      list.append(card);
    }
    root.append(heading, list);
    return { root, cards };
  }

  function mountResultCards(container, keys) {
    const cards = new Map();
    const definitions = getCardDefinitions(keys);
    const fragment = document.createDocumentFragment();
    definitions
      .filter((item) => item.group !== "overseas")
      .forEach((item) => {
        const card = createResultCardElement(item);
        cards.set(item.key, card);
        fragment.append(card);
      });
    const overseas = definitions.filter((item) => item.group === "overseas");
    if (overseas.length) {
      const group = createOverseasGroupElement(overseas);
      group.cards.forEach((card, key) => cards.set(key, card));
      fragment.append(group.root);
    }
    container.replaceChildren(fragment);
    return cards;
  }

  function createResultCard({ root, isValidIP, getLatencyTier }) {
    const find = (selector) => root.querySelector(selector);
    const ip = find(".ip-display");
    const location = find(".ip-location");
    const status = find(".card-status");
    const copy = find(".copy-btn");
    const family = find(".ip-family");
    const note = find(".result-note");
    const meta = find(".card-meta");
    const retry = find(".retry-btn");
    function render(result) {
      const retryHadFocus = document.activeElement === retry;
      const valid = isValidIP(result.ip);
      const loading = result.status === "loading";
      root.dataset.status = result.status;
      root.setAttribute("aria-busy", String(loading));
      status.textContent = {
        loading: "检测中",
        success: "已完成",
        warn: "有限验证",
        error: "未完成",
        cancelled: "已停止",
      }[result.status];
      ip.textContent = valid ? result.ip : result.message || "正在检测…";
      ip.classList.toggle("is-message", !valid);
      ip.classList.toggle("is-ipv6", valid && result.ip.includes(":"));
      if (valid && result.ip.includes(":")) {
        const groups = result.ip.split(":");
        ip.replaceChildren();
        groups.forEach((group, index) => {
          ip.append(document.createTextNode(group));
          if (index < groups.length - 1)
            ip.append(":", document.createElement("wbr"));
        });
      }
      family.textContent = valid
        ? result.ip.includes(":")
          ? "IPv6"
          : "IPv4"
        : "";
      family.hidden = !valid;
      copy.hidden = !valid;
      location.textContent = valid
        ? result.location ||
          (result.countryCode
            ? `${result.countryCode} · 正在查询位置…`
            : "正在查询位置…")
        : "";
      location.hidden = !valid;
      note.textContent = result.note || "";
      note.hidden = !result.note;
      retry.hidden = !["error", "cancelled"].includes(result.status);
      if (retryHadFocus && retry.hidden)
        document.getElementById("refresh-btn")?.focus({ preventScroll: true });
      meta.replaceChildren();
      if (Number.isFinite(result.latency)) {
        const latency = createElement(
          "span",
          `latency ${getLatencyTier(result.latency)}`,
          `${result.latency} ms`,
        );
        latency.title = "检测请求耗时，包含连接和响应时间，并非 Ping 延迟";
        meta.append(latency);
      }
      if (result.source) {
        const source = createElement("span", "api-source", result.source);
        source.title = `检测来源：${result.source}`;
        meta.append(source);
      }
      if (loading)
        meta.append(createElement("span", "pending-label", "等待检测服务响应"));
    }
    return {
      render,
      setRetryDisabled: (disabled) => {
        retry.disabled = disabled;
      },
    };
  }

  function createSummary(root) {
    const status = root.querySelector("#summary-status");
    const description = root.querySelector("#summary-description");
    const time = root.querySelector("#summary-time");
    const progress = root.querySelector("#detection-progress");
    const caption = root.querySelector("#progress-caption");
    return {
      render(result) {
        status.replaceChildren(
          document.createTextNode(result.text),
          createElement("span", `badge ${result.badgeClass}`, result.badgeText),
        );
        description.textContent = result.description;
        progress.value = result.finishedCount;
        progress.max = result.total;
        caption.textContent = result.pending
          ? `已完成 ${result.finishedCount} / ${result.total} 项`
          : result.cancelledCount
            ? "检测已停止"
            : `已完成 ${result.total} 项检测`;
        root.dataset.pending = String(result.pending);
      },
      clearTimestamp() {
        time.textContent = "";
      },
      updateTimestamp(prefix = "更新于") {
        time.textContent = `${prefix} ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      },
    };
  }

  function createFeedback({ toastElement, toastDurationMs }) {
    let toastTimer;
    function showToast(message) {
      toastElement.textContent = message;
      toastElement.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(
        () => toastElement.classList.remove("show"),
        toastDurationMs,
      );
    }
    function fallbackCopy(text) {
      const active = document.activeElement;
      const selection = window.getSelection();
      const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) =>
            selection.getRangeAt(index).cloneRange(),
          )
        : [];
      const textarea = createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.append(textarea);
      try {
        textarea.select();
        return document.execCommand("copy");
      } finally {
        textarea.remove();
        active?.focus({ preventScroll: true });
        if (selection) {
          selection.removeAllRanges();
          ranges.forEach((range) => selection.addRange(range));
        }
      }
    }
    async function copyToClipboard(text, message = "IP 地址已复制") {
      try {
        let copied = false;
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          try {
            await navigator.clipboard.writeText(text);
            copied = true;
          } catch {
            /* Some browsers deny permission; try the selection fallback. */
          }
        }
        if (!copied && !fallbackCopy(text)) throw new Error("Copy failed");
        showToast(message);
        return true;
      } catch {
        showToast("复制失败，请选中 IP 手动复制");
        return false;
      }
    }
    return { copyToClipboard, showToast };
  }

  const components = {
    CARD_DEFINITIONS,
    getCardDefinitions,
    createResultCardElement,
    createOverseasGroupElement,
    mountResultCards,
    createResultCard,
    createSummary,
    createFeedback,
  };
  globalScope.IPCheckerUIComponents = components;
  if (typeof module !== "undefined" && module.exports)
    module.exports = components;
})(typeof globalThis !== "undefined" ? globalThis : window);
