"use strict";

/**
 * Register the probe implementations on the global scope.
 * @param {typeof globalThis} globalScope
 */
(function initDetectors(globalScope) {
  const DOMESTIC_APIS = [
    {
      url: "https://myip.ipip.net/json",
      parse: (data) => ({
        ip: data.data?.ip,
        location: (data.data?.location || []).join(" "),
      }),
    },
    {
      url: "https://ip.taobao.com/service/getIpInfo.php?ip=myip",
      parse: (data) => {
        if (data.code !== 0 || !data.data) return null;
        const d = data.data;
        return {
          ip: d.ip,
          location: [d.country, d.region, d.city, d.isp]
            .filter(Boolean)
            .join(" "),
        };
      },
    },
    {
      url: "https://ip.useragentinfo.com/json",
      parse: (data) => ({
        ip: data.ip,
        location: [data.country, data.province, data.city, data.isp]
          .filter(Boolean)
          .join(" "),
      }),
    },
    {
      url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
      parse: (data) => ({ ip: data.ip, location: data.addr || "" }),
    },
  ];

  const FOREIGN_APIS = [
    {
      url: "https://ipinfo.io/json",
      parse: (data) => {
        if (!data.ip) return null;
        const parts = [data.country, data.region, data.city].filter(Boolean);
        if (data.org) parts.push(data.org);
        return {
          ip: data.ip,
          location: parts.join(" "),
        };
      },
    },
    {
      url: "https://api.ipify.org?format=json",
      parse: (data) => ({ ip: data.ip }),
    },
    {
      url: "https://api64.ipify.org?format=json",
      parse: (data) => ({ ip: data.ip }),
    },
    { url: "https://api.ip.sb/jsonip", parse: (data) => ({ ip: data.ip }) },
    { url: "https://httpbin.org/ip", parse: (data) => ({ ip: data.origin }) },
    { url: "https://checkip.amazonaws.com/", parseText: true },
    { url: "https://icanhazip.com/", parseText: true },
  ];

  const GOOGLE_PROBES = [
    "https://www.googleapis.com/generate_204",
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
  ];

  const CF_TRACES = [
    "https://1.1.1.1/cdn-cgi/trace",
    "https://cloudflare.com/cdn-cgi/trace",
  ];

  /** Each group accepts its first valid response and cancels slower requests. */
  function createDetectors({
    combineSignals,
    isCurrentRun,
    normalizeIP,
    lookupLocation,
    parseCloudflareTrace,
    safeFetch,
    state,
    timeouts,
  }) {
    const isActive = (run) => !run.signal.aborted && isCurrentRun(run.id);

    async function race(probes, run, timeoutMs) {
      const controller = new AbortController();
      const composite = combineSignals([run.signal, controller.signal]);
      try {
        return await Promise.any(
          probes.map((probe) => probe(composite.signal, timeoutMs)),
        );
      } finally {
        controller.abort();
        composite.release();
      }
    }

    async function probeIP(api, signal, timeoutMs) {
      const started = performance.now();
      const response = await safeFetch(api.url, { signal }, timeoutMs);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = (await response.text()).trim();
      const parsed = api.parseText ? { ip: text } : api.parse(JSON.parse(text));
      const ip = normalizeIP(parsed?.ip);
      if (!ip) throw new Error("Invalid IP response");
      return {
        status: "success",
        ip,
        location: parsed.location || "",
        latency: Math.round(performance.now() - started),
        source: new URL(api.url).hostname,
      };
    }

    function complete(run, key, result) {
      if (!isActive(run)) return;
      state.setResultForRun(run.id, key, result);
      // Geolocation is optional and never holds up an IP result or progress.
      if (result.ip && !result.location) {
        void lookupLocation(result.ip, run.signal)
          .then((location) => {
            if (isActive(run))
              state.setLocationForRun(
                run.id,
                key,
                location || "位置信息暂不可用",
              );
          })
          .catch(() => {
            if (isActive(run))
              state.setLocationForRun(run.id, key, "位置信息暂不可用");
          });
      }
    }

    async function checkIPGroup(run, key, apis, timeoutMs) {
      const result = await race(
        apis.map((api) => (signal) => probeIP(api, signal, timeoutMs)),
        run,
      );
      complete(run, key, result);
    }

    async function checkGoogle(run) {
      const result = await race(
        GOOGLE_PROBES.map((url) => async (signal) => {
          const started = performance.now();
          const response = await safeFetch(
            url,
            { mode: "no-cors", signal },
            timeouts.foreign,
          );
          const opaque = response.type === "opaque";
          if (!opaque && !response.ok) throw new Error("Google probe failed");
          return {
            status: opaque ? "warn" : "success",
            ip: null,
            message: opaque ? "已收到响应" : "连接正常",
            location: "",
            latency: Math.round(performance.now() - started),
            source: new URL(url).hostname,
            note: opaque
              ? "浏览器无法读取响应状态或出口 IP。"
              : "连接测试完成，服务未提供出口 IP。",
          };
        }),
        run,
      );
      complete(run, "google", result);
    }

    async function checkCloudflare(run) {
      const result = await race(
        CF_TRACES.map((url) => async (signal) => {
          const started = performance.now();
          const response = await safeFetch(url, { signal }, timeouts.foreign);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const trace = parseCloudflareTrace(await response.text());
          if (!trace || !normalizeIP(trace.ip))
            throw new Error("Invalid trace response");
          return {
            status: "success",
            ip: normalizeIP(trace.ip),
            location: "",
            countryCode: trace.countryCode,
            latency: Math.round(performance.now() - started),
            source: new URL(url).hostname,
          };
        }),
        run,
      );
      complete(run, "cf", result);
    }

    const checks = {
      domestic: (run) =>
        checkIPGroup(run, "domestic", DOMESTIC_APIS, timeouts.domestic),
      foreign: (run) =>
        checkIPGroup(run, "foreign", FOREIGN_APIS, timeouts.foreign),
      google: checkGoogle,
      cf: checkCloudflare,
    };

    return {
      checkAllDetectors(run, keys = Object.keys(checks)) {
        return Promise.allSettled(
          keys.map(async (key) => {
            try {
              await checks[key](run);
            } catch {
              if (isActive(run))
                state.setResultForRun(run.id, key, {
                  status: "error",
                  ip: null,
                  message: "暂时无法完成检测",
                  note: "可能是请求超时、服务异常或浏览器限制。",
                });
            }
          }),
        );
      },
    };
  }

  const detectorModule = { createDetectors };
  globalScope.IPCheckerDetectors = detectorModule;
  if (typeof module !== "undefined" && module.exports)
    module.exports = detectorModule;
})(typeof globalThis !== "undefined" ? globalThis : window);
