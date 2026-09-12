"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDetectors } = require("./detectors.js");
const { combineSignals, createDeferred } = require("./browser-utils.js");
const { normalizeIP, parseCloudflareTrace } = require("./core.js");
const json = (body) => ({ ok: true, text: async () => JSON.stringify(body) });
const trace = (ip) => ({ ok: true, text: async () => `ip=${ip}\nloc=US` });
const offline = async () => {
  throw new Error("offline");
};
function setup(overrides = {}) {
  const results = {};
  const updates = [];
  const controller = new AbortController();
  const run = { id: 1, signal: controller.signal, controller };
  const detectors = createDetectors({
    combineSignals,
    normalizeIP,
    parseCloudflareTrace,
    isCurrentRun: () => true,
    lookupLocation: async () => "US California",
    safeFetch: offline,
    state: {
      setResultForRun(_id, key, result) {
        results[key] = result;
        updates.push(key);
      },
      setLocationForRun(_id, key, location) {
        results[key].location = location;
      },
    },
    timeouts: { domestic: 100, foreign: 100 },
    ...overrides,
  });
  return { detectors, results, updates, run };
}

test("domestic uses the first valid endpoint, tolerating null parser results", async () => {
  const { detectors, results, run } = setup({
    safeFetch: async (url) => {
      if (url.includes("taobao")) return json({ code: 1 });
      if (url.includes("useragentinfo"))
        return json({ ip: "1.2.3.4", country: "中国" });
      throw new Error("offline");
    },
  });
  await detectors.checkAllDetectors(run, ["domestic"]);
  assert.equal(results.domestic.ip, "1.2.3.4");
  assert.equal(results.domestic.location, "中国");
});

test("foreign publishes the IP before a slow geolocation request", async () => {
  const deferred = createDeferred();
  const { detectors, results, run } = setup({
    safeFetch: async (url) =>
      url.includes("ipify") ? json({ ip: "203.0.113.7" }) : offline(),
    lookupLocation: () => deferred.promise,
  });
  await detectors.checkAllDetectors(run, ["foreign"]);
  assert.equal(results.foreign.ip, "203.0.113.7");
  assert.equal(results.foreign.location, "");
  deferred.resolve("US California");
  await Promise.resolve();
  assert.equal(results.foreign.location, "US California");
});

test("foreign preserves provided location without another request", async () => {
  let lookups = 0;
  const { detectors, results, run } = setup({
    safeFetch: async (url) =>
      url === "https://ipinfo.io/json"
        ? json({ ip: "203.0.113.7", country: "US" })
        : offline(),
    lookupLocation: async () => {
      lookups++;
    },
  });
  await detectors.checkAllDetectors(run, ["foreign"]);
  assert.equal(lookups, 0);
  assert.equal(results.foreign.location, "US");
});

test("opaque Google response is limited evidence, has no inferred IP, and no latency floor", async () => {
  const { detectors, results, run } = setup({
    safeFetch: async () => ({ type: "opaque", ok: false }),
  });
  await detectors.checkAllDetectors(run, ["google"]);
  assert.equal(results.google.status, "warn");
  assert.equal(results.google.ip, null);
  assert.match(results.google.note, /无法读取/);
});

test("Google completes on first response without waiting for a slow probe or foreign IP", async () => {
  let aborted = 0;
  const { detectors, results, run } = setup({
    safeFetch: async (url, { signal }) => {
      if (url.includes("googleapis")) return { type: "cors", ok: true };
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted++;
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    },
  });
  await detectors.checkAllDetectors(run, ["google"]);
  assert.equal(results.google.status, "success");
  assert.equal(aborted, 2);
});

test("Cloudflare races endpoints and rejects malformed trace IPs", async () => {
  const { detectors, results, run } = setup({
    safeFetch: async (url) =>
      url.includes("1.1.1.1") ? trace("invalid") : trace("2001:DB8::1"),
  });
  await detectors.checkAllDetectors(run, ["cf"]);
  assert.equal(results.cf.ip, "2001:db8::1");
  assert.equal(results.cf.source, "cloudflare.com");
});

test("failed probes do not claim blocking and selected retry does not touch other groups", async () => {
  const { detectors, results, run, updates } = setup();
  await detectors.checkAllDetectors(run, ["domestic"]);
  assert.deepEqual(updates, ["domestic"]);
  assert.equal(results.domestic.status, "error");
  assert.doesNotMatch(results.domestic.message, /封锁|拦截|阻断/);
});

test("aborted runs and stale geolocation cannot overwrite retained results", async () => {
  const deferred = createDeferred();
  const { detectors, results, run } = setup({
    safeFetch: async () => trace("1.1.1.1"),
    lookupLocation: () => deferred.promise,
  });
  await detectors.checkAllDetectors(run, ["cf"]);
  run.controller.abort();
  deferred.resolve("stale location");
  await Promise.resolve();
  assert.equal(results.cf.location, "");
  await detectors.checkAllDetectors(run, ["google"]);
  assert.equal(results.google, undefined);
});

test("location failure never turns a successful IP into a failed probe", async () => {
  const { detectors, results, run } = setup({
    safeFetch: async () => trace("1.1.1.1"),
    lookupLocation: offline,
  });
  await detectors.checkAllDetectors(run, ["cf"]);
  await Promise.resolve();
  assert.equal(results.cf.status, "success");
  assert.equal(results.cf.location, "位置信息暂不可用");
});
