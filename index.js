const API = require('./api');
const client = new API;

module.exports = function(homebridge) {
  // console.log("homebridge API version: " + homebridge.version);

  const {platformAccessory: PlatformAccessory, hap: {Service, Characteristic, Accessory, uuid: UUIDGen}} = homebridge;

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

      this.api = api;

      this.api.on('didFinishLaunching', () => this.didFinishLaunching());

      this.loginPromise = (async () => {
        try {
          this.log("Logging in as " + config.username);
          await client.login({username: config.username, password: config.password});
          this.log("Login successful");
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
      this.accessories = []

      // discover devices
      const devices = await client.getDevices()
      this.log('Found ' + devices.length + ' devices');

      for (const device of devices) {
        const uuid = UUIDGen.generate(device.serial);

        const registeredAccessory = this.accessories.find(a => a.UUID === uuid);
        if (registeredAccessory) {
          registeredAccessory.updateReachability(true);
        } else {
          const newAccessory = new PlatformAccessory(device.name, uuid, Accessory.Categories.THERMOSTAT);

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
                             accessory.addService(Service.BatteryService);

      batteryService
        .setCharacteristic(Characteristic.ChargingState, Characteristic.ChargingState.NOT_CHARGEABLE)

      batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', getCharacteristicFromDeviceStatus);

      const infoService = accessory.getService(Service.AccessoryInformation) ||
                          accessory.addService(Service.AccessoryInformation);
      infoService
        .setCharacteristic(Characteristic.Manufacturer, "Salus")
        .setCharacteristic(Characteristic.Model, "IT500")
        .setCharacteristic(Characteristic.Name, accessory.context.name)
        .setCharacteristic(Characteristic.SerialNumber, accessory.context.serial)
        .setCharacteristic(Characteristic.FirmwareRevision, 'N/A')

      const thermostatService = accessory.getService(Service.Thermostat) ||
                                accessory.addService(Service.Thermostat);

      thermostatService
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .setProps({
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
        })
        .on('get', getCharacteristicFromDeviceValue)

      thermostatService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', getCharacteristicFromDeviceValue);

      thermostatService
        .getCharacteristic(Characteristic.TargetTemperature)
        .setProps({
          minValue: 5,
          maxValue: 35,
        })
        .on('get', getCharacteristicFromDeviceValue)
        .on('set', (value, callback) => {
          platform.log(accessory.displayName, `Set TargetTemperature`, value);

          client.setDeviceValues({
            deviceId: accessory.context.deviceId,
            targetTemperature: value,
          })
            .then(updateDeviceValues)
            .then(
              () => callback(),
              err => {console.error(err); callback(err)}
            )
        });

      thermostatService
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .setProps({
          validValues: [
            Characteristic.TargetHeatingCoolingState.AUTO,
            Characteristic.TargetHeatingCoolingState.OFF,
          ],
        })
        .on('get', getCharacteristicFromDeviceValue)
        .on('set', (value, callback) => {
          platform.log(accessory.displayName, `Set TargetHeatingCoolingState`, value);

          client.setDeviceValues({
            deviceId: accessory.context.deviceId,
            autoMode: value === Characteristic.TargetHeatingCoolingState.AUTO
          })
            .then(updateDeviceValues)
            .then(
              () => callback(),
              err => {console.error(err); callback(err)}
            )
        });

      thermostatService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', getCharacteristicFromDeviceValue);

      function updateDeviceValues(values) {
        const {
          isHeating,
          autoMode,
          currentRoomTemperature,
          temperatureUnit,
          currentTargetTemperature,
        } = values;

        thermostatService
          .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
          .updateValue(
            isHeating
              ? Characteristic.CurrentHeatingCoolingState.HEAT
              : Characteristic.CurrentHeatingCoolingState.OFF
          );

        thermostatService
          .getCharacteristic(Characteristic.TargetHeatingCoolingState)
          .updateValue(
            autoMode
              ? Characteristic.TargetHeatingCoolingState.AUTO
              : Characteristic.TargetHeatingCoolingState.OFF
          );

        thermostatService
          .getCharacteristic(Characteristic.CurrentTemperature)
          .updateValue(currentRoomTemperature);

        thermostatService
          .getCharacteristic(Characteristic.TemperatureDisplayUnits)
          .updateValue(
            temperatureUnit === 'C'
              ? Characteristic.TemperatureDisplayUnits.CELSIUS
              : Characteristic.TemperatureDisplayUnits.FAHRENHEIT
          );

        thermostatService
          .getCharacteristic(Characteristic.TargetTemperature)
          .updateValue(currentTargetTemperature);
      }

      async function loadDeviceValues() {
        updateDeviceValues(
          await client.getDeviceValues({deviceId: accessory.context.deviceId})
        );
      }

      function getCharacteristicFromDeviceValue(callback) {
        loadDeviceValues()
          .then(
            () => callback(null, this.value),
            err => {console.error(err); callback(err)}
          );
      }

      function updateDeviceStatus(status) {
        const {
          batteryLow,
        } = status;

        batteryService
          .getCharacteristic(Characteristic.StatusLowBattery)
          .updateValue(
            batteryLow
              ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
              : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
          );
      }

      async function loadDeviceStatus() {
        updateDeviceStatus(
          await client.getDeviceOnlineStatus({deviceId: accessory.context.deviceId})
        );
      }

      function getCharacteristicFromDeviceStatus(callback) {
        loadDeviceStatus()
          .then(
            () => callback(null, this.value),
            err => {console.error(err); callback(err)}
          );
      }

      this.accessories.push(accessory);
    }
  }

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform("homebridge-salus-it500", "SalusIT500", SalusIT500, true);
}
