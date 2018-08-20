var http = require('http');
var API = require('./api');

module.exports = function(homebridge) {
  // console.log("homebridge API version: " + homebridge.version);

  const {platformAccessory: Accessory, hap: {Service, Characteristic, uuid: UUIDGen}} = homebridge;

  // Platform constructor
  // config may be null
  // api may be null if launched from old homebridge version
  class SalusIT500 {
    constructor(log, config, api) {
      log("SalusIT500 Init");
      const platform = this;
      this.log = log;
      this.accessories = [];

      this.config = config = (config || {});
      config.username = config.username || process.env.SALUS_USERNAME;
      config.password = config.password || process.env.SALUS_PASSWORD;

      for (const key of ['username','password']) {
        if (!config[key]) {
          throw new Error('Missing config key: '+key);
        }
      }

      // Save the API object as plugin needs to register new accessory via this object
      this.api = api;

      // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
      // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
      // Or start discover new accessories.
      this.api.on('didFinishLaunching', () => this.didFinishLaunching());

      this.loginPromise = (async () => {
        try {
          this.log("Logging in as " + config.username);
          const {sessionId, token} = await API.login({username: config.username, password: config.password});

          this.sessionId = sessionId;
          this.token = token;
          this.log("Login successful", {sessionId, token});
          return true
        } catch (error) {
          this.log('Login error: ' + error)
          return false
        }
      })();
    }

    async didFinishLaunching() {
      this.log('Did finish launching')
      if (!await this.loginPromise) return;

      this.api.unregisterPlatformAccessories("homebridge-salus-it500", "SalusIT500", this.accessories);
      this.accessories=[]

      // discover devices
      const devices = await API.getDevices({sessionId: this.sessionId})
      this.log('Found ' + devices.length + ' devices');

      for (const device of devices) {
        const uuid = UUIDGen.generate(device.serial);

        const registeredAccessory = this.accessories.find(a => a.UUID === uuid);
        if (registeredAccessory) {
          registeredAccessory.updateReachability(true);
        } else {
          const newAccessory = new Accessory(device.name, uuid);

          newAccessory.context.deviceId = device.id;
          newAccessory.context.serial = device.serial;
          newAccessory.context.name = device.name;

          await this.configureAccessory(newAccessory);
          this.api.registerPlatformAccessories("homebridge-salus-it500", "SalusIT500", [newAccessory]);
        }
      }
    }

    // Function invoked when homebridge tries to restore cached accessory.
    // Developer can configure accessory at here (like setup event handler).
    // Update current value.
    async configureAccessory(accessory) {
      this.log(accessory.displayName, "Configure Accessory");
      if (!await this.loginPromise) return;

      const platform = this;

      accessory.reachable = false;
      // console.log('Characteristic: ', Object.keys(Characteristic).filter(s=>s.includes('Mod')))

      accessory.on('identify', (paired, callback) => {
        platform.log(accessory.displayName, "Identify!!!");
        callback();
      });

      const batteryService = accessory.getService(Service.BatteryService) ||
                             accessory.addService(Service.BatteryService, "Thermostat");

     batteryService
       .setCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE)

      batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get StatusLowBattery`);

          API.getDeviceOnlineStatus({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({batteryLow}) =>
                callback(null, batteryLow
                  ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
                  : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL),
              err => callback(err)
            )
        });

      const infoService = accessory.getService(Service.AccessoryInformation) ||
                          accessory.addService(Service.AccessoryInformation, "Thermostat");
      infoService
        .setCharacteristic(Characteristic.Manufacturer, "Salus")
        .setCharacteristic(Characteristic.Model, "IT500")
        .setCharacteristic(Characteristic.Name, accessory.context.name)
        .setCharacteristic(Characteristic.SerialNumber, accessory.context.serial)
        .setCharacteristic(Characteristic.FirmwareRevision, 'N/A')

      const thermostatService = accessory.getService(Service.Thermostat) ||
                                accessory.addService(Service.Thermostat, "Thermostat");

      thermostatService
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get TemperatureDisplayUnits`);

          API.getDeviceValues({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({temperatureUnit}) =>
                callback(null, temperatureUnit === 'C'
                  ? Characteristic.TemperatureDisplayUnits.CELSIUS
                  : Characteristic.TemperatureDisplayUnits.FAHRENHEIT),
              err => callback(err)
            )
        })
        .on('set', (value, callback) => callback(new Error('Not implemented')));

      thermostatService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get CurrentTemperature`);

          API.getDeviceValues({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({currentRoomTemperature}) => callback(null, currentRoomTemperature),
              err => callback(err)
            )
        });

      thermostatService
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get TargetTemperature`);

          API.getDeviceValues({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({currentTargetTemperature}) => callback(null, currentTargetTemperature),
              err => callback(err)
            )
        })
        .on('set', (value, callback) => {
          platform.log(accessory.displayName, `Set TargetTemperature`, value);

          API.setDeviceValues({
            sessionId: this.sessionId,
            token: this.token,
            deviceId: accessory.context.deviceId,
            targetTemperature: value,
          })
            .then(
              () => callback(),
              err => callback(err)
            )
        });

      thermostatService
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get TargetHeatingCoolingState`);

          API.getDeviceValues({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({autoMode}) =>
                callback(null, autoMode
                  ? Characteristic.TargetHeatingCoolingState.AUTO
                  : Characteristic.TargetHeatingCoolingState.OFF),
              err => callback(err)
            )
        })
        .on('set', (value, callback) => {
          platform.log(accessory.displayName, `Set TargetHeatingCoolingState`, value);

          API.setDeviceValues({
            sessionId: this.sessionId,
            token:this.token,
            deviceId: accessory.context.deviceId,
            autoMode: value === Characteristic.TargetHeatingCoolingState.AUTO || value === Characteristic.TargetHeatingCoolingState.HEAT
          })
            .then(
              () => callback(),
              err => callback(err)
            )
        });

      thermostatService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', (callback) => {
          platform.log(accessory.displayName, `Get CurrentHeatingCoolingState`);

          API.getDeviceValues({sessionId: this.sessionId, token: this.token, deviceId: accessory.context.deviceId})
            .then(
              ({isHeating}) =>
                callback(null, isHeating
                  ? Characteristic.CurrentHeatingCoolingState.HEAT
                  : Characteristic.CurrentHeatingCoolingState.OFF),
              err => callback(err)
            )
        })
        .on('set', (value, callback) => callback(new Error('Not implemented')));

      this.accessories.push(accessory);
    }
  }

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform("homebridge-salus-it500", "SalusIT500", SalusIT500, true);
}
