"use strict";

(function initCore(globalScope) {
  const KEYS = ["domestic", "foreign", "google", "cf"];

  /** Normalize equivalent IP literals before validation and comparison. */
  function normalizeIP(input) {
    if (typeof input !== "string") return null;
    const value = input.trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      const parts = value.split(".");
      if (
        parts.every(
          (part) =>
            Number(part) <= 255 && (part === "0" || !part.startsWith("0")),
        )
      ) {
        return parts.join(".");
      }
      return null;
    }
    const unwrapped =
      value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
    if (!unwrapped.includes(":") || !/^[\da-f:.]+$/i.test(unwrapped))
      return null;
    try {
      return new URL(`http://[${unwrapped}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }

  function isValidIP(value) {
    return normalizeIP(value) !== null;
  }

  function createPendingResult() {
    return {
      status: "loading",
      ip: null,
      location: "",
      latency: null,
      source: null,
    };
  }

  /** Summaries describe observations; IP equality cannot prove a direct route. */
  function summarizeResults(results, keys = KEYS) {
    const records = keys.map((key) => results[key] || createPendingResult());
    const finishedCount = records.filter(
      (result) => result.status !== "loading",
    ).length;
    const failedCount = records.filter(
      (result) => result.status === "error",
    ).length;
    const cancelledCount = records.filter(
      (result) => result.status === "cancelled",
    ).length;
    const ips = records.map((result) => normalizeIP(result.ip)).filter(Boolean);
    const uniqueIps = [...new Set(ips)];
    const uniqueCount = uniqueIps.length;
    const pending = finishedCount < keys.length;
    const base = {
      finishedCount,
      failedCount,
      cancelledCount,
      uniqueCount,
      total: keys.length,
      pending,
    };

    if (pending)
      return {
        ...base,
        text: "正在检测网络出口",
        badgeText: `${finishedCount} / ${keys.length}`,
        badgeClass: "badge-info",
        description: uniqueCount
          ? `已获取 ${uniqueCount} 个出口 IP，其余检测仍在进行。`
          : "正在连接检测服务，结果将逐项显示。",
      };
    if (!uniqueCount)
      return {
        ...base,
        text: cancelledCount ? "检测已停止" : "暂未获取出口 IP",
        badgeText: cancelledCount ? "已停止" : "结果不完整",
        badgeClass: "badge-warn",
        description: cancelledCount
          ? "已保留完成的结果，可重试单项或重新检测。"
          : "检测服务、网络或浏览器限制可能影响结果，可稍后重试。",
      };
    const families = new Set(uniqueIps.map((ip) => (ip.includes(":") ? 6 : 4)));
    const sameFamilyDiffers = [4, 6].some(
      (family) =>
        uniqueIps.filter((ip) => (ip.includes(":") ? 6 : 4) === family).length >
        1,
    );
    let badgeText =
      ips.length < 2
        ? "样本不足"
        : sameFamilyDiffers
          ? "出口不同"
          : families.size > 1
            ? "双栈结果"
            : "结果一致";
    let description = sameFamilyDiffers
      ? "不同检测服务返回了不同出口，可能与分流或代理规则有关。"
      : families.size > 1
        ? "同时获取到 IPv4 和 IPv6 地址，地址不同不代表已分流。"
        : ips.length < 2
          ? "当前只有一个 IP 检测结果，暂不足以比较出口。"
          : "已获取的出口 IP 相同；仅凭此结果无法判断是否直连。";
    if (failedCount || cancelledCount) {
      badgeText = cancelledCount ? "已停止" : "部分失败";
      description = cancelledCount
        ? "已保留完成的结果，可重试未完成项。"
        : `${failedCount} 项检测失败，可能受服务或浏览器限制影响，不代表网络被封锁。`;
    }
    return {
      ...base,
      text: `检测到 ${uniqueCount} 个出口 IP`,
      badgeText,
      badgeClass: failedCount || cancelledCount ? "badge-warn" : "badge-same",
      description,
    };
  }

  function getLatencyTier(latency) {
    if (latency < 300) return "good";
    if (latency < 800) return "mid";
    return "slow";
  }

  function parseCloudflareTrace(text) {
    const ip = normalizeIP(text.match(/^ip=(.+)$/m)?.[1]);
    if (!ip) return null;
    return { ip, countryCode: text.match(/^loc=(.+)$/m)?.[1]?.trim() || null };
  }

  const core = {
    KEYS,
    createPendingResult,
    getLatencyTier,
    isValidIP,
    normalizeIP,
    parseCloudflareTrace,
    summarizeResults,
  };
  globalScope.IPCheckerCore = core;
  if (typeof module !== "undefined" && module.exports) module.exports = core;
})(typeof globalThis !== "undefined" ? globalThis : window);
