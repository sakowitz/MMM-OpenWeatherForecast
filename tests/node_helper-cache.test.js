"use strict";

const assert = require("node:assert/strict");
const {beforeEach, describe, it} = require("node:test");
const path = require("node:path");

const helper = require(path.resolve(__dirname, "../node_helper.js"));

function weatherPayload(instanceId = "module_1_MMM-OpenWeatherForecast") {
  return {
    apiBaseURL: "https://example.test/weather?",
    apikey: "test-key",
    latitude: "38.5",
    longitude: "-121.5",
    units: "imperial",
    language: "en",
    instanceId,
    updateInterval: 30,
    haUrl: null,
    haSensor: null
  };
}

function response(data) {
  return {
    status: 200,
    statusText: "OK",
    async json () {
      return data;
    }
  };
}

describe("shared weather cache", () => {
  let notifications;

  beforeEach(() => {
    notifications = [];
    helper.start();
    helper.onSocketNotificationSent = (notification, payload) => {
      notifications.push({notification, payload});
    };
  });

  it("serves repeated client requests from one cached API response", async () => {
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount += 1;
      return response({current: {temp: 72}});
    };

    await helper.socketNotificationReceived("OPENWEATHER_FORECAST_GET", weatherPayload());
    await helper.socketNotificationReceived("OPENWEATHER_FORECAST_GET", weatherPayload());

    assert.equal(fetchCount, 1);
    assert.equal(notifications.length, 2);
    assert.equal(notifications[0].payload.cacheStatus, "fresh");
    assert.equal(notifications[1].payload.cacheStatus, "hit");
  });

  it("coalesces concurrent requests and broadcasts once per instance", async () => {
    let fetchCount = 0;
    let resolveFetch;
    global.fetch = () => {
      fetchCount += 1;
      return new Promise((resolve) => {
        resolveFetch = () => resolve(response({current: {temp: 68}}));
      });
    };

    const first = helper.socketNotificationReceived("OPENWEATHER_FORECAST_GET", weatherPayload("weather-a"));
    const second = helper.socketNotificationReceived("OPENWEATHER_FORECAST_GET", weatherPayload("weather-b"));
    resolveFetch();
    await Promise.all([first, second]);

    assert.equal(fetchCount, 1);
    assert.deepEqual(notifications.map(({payload}) => payload.instanceId).sort(), ["weather-a", "weather-b"]);
  });
});
