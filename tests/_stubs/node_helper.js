"use strict";

module.exports = {
  create (descriptor) {
    const instance = {...descriptor};
    instance.sendSocketNotification = function (notification, payload) {
      if (typeof instance.onSocketNotificationSent === "function") {
        instance.onSocketNotificationSent(notification, payload);
      }
    };
    return instance;
  }
};
