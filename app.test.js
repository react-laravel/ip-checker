"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const core = require("./core.js");
const { createDeferred } = require("./browser-utils.js");
const flush = () => new Promise(setImmediate);

function setup() {
  const events = {};
  const pending = [];
  let currentState;
  let displayedRunning;
  let dependencies;
  const elements = new Map();
  const ui = {
    el(id) {
      if (!elements.has(id))
        elements.set(id, {
          addEventListener(type, callback) {
            events[`${id}:${type}`] = callback;
          },
        });
      return elements.get(id);
    },
    AppState: class {
      constructor() {
        this.results = {};
        currentState = this;
      }
      reset(keys) {
        keys.forEach((key) => {
          this.results[key] = core.createPendingResult();
        });
      }
      setResult(key, result) {
        this.results[key] = result;
      }
      setLocation(key, location) {
        this.results[key].location = location;
      }
      stopLocationQueries() {}
      cancelPending() {
        Object.values(this.results).forEach((result) => {
          if (result.status === "loading") result.status = "cancelled";
        });
      }
    },
    setRunning(value) {
      displayedRunning = value;
    },
    updateTimestamp() {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./app.js"), "utf8"), {
    AbortController,
    IPCheckerCore: core,
    IPCheckerBrowserUtils: {
      createSafeFetch: () => {},
      createGeoLookup: () => {},
    },
    IPCheckerUI: { createUI: () => ui },
    IPCheckerDetectors: {
      createDetectors(options) {
        dependencies = options;
        return {
          checkAllDetectors(run, keys) {
            const deferred = createDeferred();
            pending.push({ run, keys, deferred });
            return deferred.promise;
          },
        };
      },
    },
    window: {
      addEventListener(type, callback) {
        events[type] = callback;
      },
    },
  });
  return {
    events,
    pending,
    get results() {
      return currentState.results;
    },
    get running() {
      return displayedRunning;
    },
    publish(index, key, ip) {
      dependencies.state.setResultForRun(pending[index].run.id, key, {
        status: "success",
        ip,
      });
    },
  };
}

test("stop retains completed IPs and late callbacks cannot overwrite a new run", async () => {
  const app = setup();
  app.publish(0, "domestic", "192.0.2.1");
  app.events["refresh-btn:click"]();
  assert.equal(app.pending[0].run.signal.aborted, true);
  assert.equal(app.results.domestic.ip, "192.0.2.1");
  assert.equal(app.results.foreign.status, "cancelled");
  assert.equal(app.running, false);
  app.events["refresh-btn:click"]();
  app.publish(1, "domestic", "192.0.2.2");
  app.publish(0, "domestic", "192.0.2.99");
  app.pending[0].deferred.resolve();
  await flush();
  assert.equal(app.results.domestic.ip, "192.0.2.2");
  assert.equal(app.running, true);
  app.pending[1].deferred.resolve();
  await flush();
  assert.equal(app.running, false);
});

test("restoring a cached page restarts its aborted detection", () => {
  const app = setup();
  app.events.pagehide();
  assert.equal(app.pending[0].run.signal.aborted, true);
  app.events.pageshow({ persisted: true });
  assert.equal(app.pending.length, 2);
  assert.equal(app.pending[1].run.signal.aborted, false);
  assert.equal(app.running, true);
  app.events.pageshow({ persisted: false });
  assert.equal(app.pending.length, 2);
});

test("single retry keeps completed results and only schedules the selected probe", async () => {
  const app = setup();
  app.publish(0, "foreign", "192.0.2.1");
  app.pending[0].deferred.resolve();
  await flush();
  app.events["result-grid:click"]({
    target: { closest: () => ({ dataset: { key: "domestic" } }) },
  });
  assert.deepEqual(Array.from(app.pending[1].keys), ["domestic"]);
  assert.equal(app.results.foreign.ip, "192.0.2.1");
  assert.equal(app.results.domestic.status, "loading");
});
