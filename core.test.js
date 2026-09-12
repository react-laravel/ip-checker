"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeIP,
  isValidIP,
  summarizeResults,
  parseCloudflareTrace,
  getLatencyTier,
  createPendingResult,
} = require("./core.js");
const success = (ip) => ({ status: "success", ip });
const error = { status: "error" };
const google = { status: "warn", message: "已收到响应", ip: null };

test("accepts and normalizes valid IPv4 and equivalent IPv6 forms", () => {
  for (const ip of [
    "1.1.1.1",
    "2001:DB8:0:0:0:0:0:1",
    "[2606:4700:4700::1111]",
    "::ffff:192.0.2.1",
  ])
    assert.ok(isValidIP(ip), ip);
  assert.equal(normalizeIP("2001:DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(normalizeIP(" 1.2.3.4 "), "1.2.3.4");
});

test("rejects malformed addresses and URL fragments", () => {
  for (const ip of [
    "999.1.1.1",
    "01.2.3.4",
    "[::1",
    "::1]",
    "::1]/path",
    "1.2.3",
    "not an ip",
    {},
    null,
    "",
  ])
    assert.equal(isValidIP(ip), false, String(ip));
});

test("progress counts finished probes and excludes a Google response from exit IPs", () => {
  const result = summarizeResults({
    domestic: success("1.1.1.1"),
    foreign: createPendingResult(),
    google,
    cf: error,
  });
  assert.equal(result.finishedCount, 3);
  assert.equal(result.uniqueCount, 1);
  assert.equal(result.pending, true);
});

test("canonical equivalent IPv6 forms count as the same exit", () => {
  const result = summarizeResults({
    domestic: success("2001:DB8:0:0:0:0:0:1"),
    foreign: success("2001:db8::1"),
    google,
    cf: success("[2001:db8::1]"),
  });
  assert.equal(result.uniqueCount, 1);
  assert.equal(result.badgeText, "结果一致");
  assert.match(result.description, /无法判断是否直连/);
});

test("a dual-stack pair is not presented as proof of split routing", () => {
  const result = summarizeResults({
    domestic: success("1.1.1.1"),
    foreign: success("2001:db8::1"),
    google,
    cf: success("1.1.1.1"),
  });
  assert.equal(result.badgeText, "双栈结果");
});

test("different same-family IPs are described as differing exits", () => {
  const result = summarizeResults({
    domestic: success("1.1.1.1"),
    foreign: success("8.8.8.8"),
    google,
    cf: success("1.1.1.1"),
  });
  assert.equal(result.badgeText, "出口不同");
  assert.match(result.description, /可能/);
});

test("failure of any probe results in an incomplete summary", () => {
  for (const key of ["domestic", "foreign", "google", "cf"]) {
    const results = {
      domestic: success("1.1.1.1"),
      foreign: success("1.1.1.1"),
      google,
      cf: success("1.1.1.1"),
      [key]: error,
    };
    assert.equal(summarizeResults(results).badgeText, "部分失败");
  }
});

test("Google-only response does not invent an exit and stopped runs remain explicit", () => {
  const results = { domestic: error, foreign: error, cf: error, google };
  assert.equal(summarizeResults(results).uniqueCount, 0);
  assert.equal(summarizeResults(results).text, "暂未获取出口 IP");
  results.domestic = { status: "cancelled" };
  assert.equal(summarizeResults(results).text, "检测已停止");
});

test("trace parser rejects invalid IP data and supports CRLF", () => {
  assert.deepEqual(parseCloudflareTrace("ip=2001:DB8::1\r\nloc=US\r\n"), {
    ip: "2001:db8::1",
    countryCode: "US",
  });
  assert.equal(parseCloudflareTrace("ip=not-an-ip\nloc=US"), null);
  assert.equal(parseCloudflareTrace("loc=US"), null);
});

test("latency tier boundaries", () => {
  assert.equal(getLatencyTier(299), "good");
  assert.equal(getLatencyTier(300), "mid");
  assert.equal(getLatencyTier(799), "mid");
  assert.equal(getLatencyTier(800), "slow");
});
