/**
 ********************************
 *
 *Node Helper for MMM-OpenWeatherForecast.
 *
 *This helper is responsible for the data pull from OpenWeather's
 *One Call API. At a minimum the API key, Latitude and Longitude
 *parameters must be provided.  If any of these are missing, the
 *request to OpenWeather will not be executed, and instead an error
 *will be output the the MagicMirror log.
 *
 *Additional, this module supplies two optional parameters:
 *
 *  units - one of "standard", "metric" or "imperial"
 *  lang - Any of the languages OpenWeather supports, as listed here: https://openweathermap.org/api/one-call-api#multi
 *
 *The OpenWeather OneCall API request looks like this:
 *
 *  https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&exclude=minutely&appid={API key}&units={units}&lang={lang}
 *
 ********************************
 */

const Log = require("logger");
const NodeHelper = require("node_helper");
const moment = require("moment");

module.exports = NodeHelper.create({

  start () {
    Log.log(`Starting node_helper for: ${this.name}`);
    this.weatherCache = new Map();
    this.inFlightWeather = new Map();
  },

  evalHaTemplateString(template, config) {
    return template.replace(/{{(.*?)}}/g, (_, key) => config[key.trim()] ?? "");
  },

  async socketNotificationReceived (notification, payload) {
    if (notification === "OPENWEATHER_FORECAST_GET") {
      await this.handleWeatherRequest(payload);
    } else if (notification === "CONFIG") {
      this.config = payload;
    }
  },

  async handleWeatherRequest(payload) {
    if (!this.isValidRequest(payload)) return;

    const key = this.weatherCacheKey(payload);
    const cached = this.weatherCache.get(key);
    const ttl = this.weatherCacheTtl(payload);

    if (cached && Date.now() - cached.fetchedAt < ttl) {
      this.sendWeatherData(cached.data, payload.instanceId, "hit");
      return;
    }

    const pending = this.inFlightWeather.get(key);
    if (pending) {
      pending.instanceIds.add(payload.instanceId);
      await pending.promise;
      return;
    }

    const request = {
      instanceIds: new Set([payload.instanceId]),
      promise: null
    };
    request.promise = this.fetchAndBroadcastWeather(key, payload, request, cached);
    this.inFlightWeather.set(key, request);
    await request.promise;
  },

  isValidRequest(payload) {
    if (payload.apikey === null || payload.apikey === "") {
      Log.error(`[MMM-OpenWeatherForecast] ${moment().format("D-MMM-YY HH:mm")} ** ERROR ** No API key configured. Get an API key at https://openweathermap.org/`);
      return false;
    }
    if (payload.latitude === null || payload.latitude === "" || payload.longitude === null || payload.longitude === "") {
      Log.error(`[MMM-OpenWeatherForecast] ${moment().format("D-MMM-YY HH:mm")} ** ERROR ** Latitude and/or longitude not provided.`);
      return false;
    }
    return true;
  },

  weatherCacheKey(payload) {
    return JSON.stringify({
      apiBaseURL: payload.apiBaseURL,
      latitude: payload.latitude,
      longitude: payload.longitude,
      units: payload.units,
      language: payload.language,
      haUrl: payload.haUrl || null,
      haSensor: payload.haSensor || null
    });
  },

  weatherCacheTtl(payload) {
    const configuredMinutes = Number(payload.updateInterval ?? this.config?.updateInterval);
    const minutes = Number.isFinite(configuredMinutes) ? configuredMinutes : 10;
    return Math.max(1, minutes) * 60 * 1000;
  },

  async fetchAndBroadcastWeather(key, payload, request, cached) {
    try {
      const data = await this.fetchWeather(payload);
      this.weatherCache.set(key, {data, fetchedAt: Date.now()});
      for (const instanceId of request.instanceIds) {
        this.sendWeatherData(data, instanceId, "fresh");
      }
      Log.info(`[MMM-OpenWeatherForecast] Shared cache refreshed for ${request.instanceIds.size} client instance(s).`);
    } catch (error) {
      Log.error(`[MMM-OpenWeatherForecast] ${moment().format("D-MMM-YY HH:mm")} ** ERROR ** ${error}\n${error.stack}`);
      if (cached) {
        for (const instanceId of request.instanceIds) {
          this.sendWeatherData(cached.data, instanceId, "stale");
        }
      }
    } finally {
      this.inFlightWeather.delete(key);
    }
  },

  async fetchWeather(payload) {
    const url = `${payload.apiBaseURL
    }lat=${payload.latitude
    }&lon=${payload.longitude
    }&exclude=minutely` +
    `&appid=${payload.apikey
    }&units=${payload.units
    }&lang=${payload.language}`;
    Log.debug("[MMM-OpenWeatherForecast] Refreshing shared OpenWeather cache.");

    const response = await fetch(url);
    if (response.status !== 200) {
      throw new Error(`API response error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    await this.applyHomeAssistantTemperature(data, payload);
    return data;
  },

  async applyHomeAssistantTemperature(data, payload) {
    if (payload.haUrl == null) return;

    try {
      const haFetchUrl = this.evalHaTemplateString(payload.haUrlTemplate, payload);
      const haResponse = await fetch(haFetchUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${payload.haToken}`,
          "Content-Type": "application/json"
        }
      });
      if (!haResponse.ok) {
        Log.warn(`[MMM-OpenWeatherForecast] Home Assistant API error: ${haResponse.status}`);
        return;
      }

      const haData = await haResponse.json();
      const haTemp = Number.parseFloat(haData?.state);
      if (Number.isFinite(haTemp) && data.current) data.current.temp = haTemp;
    } catch (error) {
      Log.error(`[MMM-OpenWeatherForecast] Error connecting to HA: ${error}`);
    }
  },

  sendWeatherData(data, instanceId, cacheStatus) {
    this.sendSocketNotification("OPENWEATHER_FORECAST_DATA", {
      ...data,
      instanceId,
      cacheStatus
    });
  }
});
