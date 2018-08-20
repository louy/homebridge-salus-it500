const rp = require('request-promise-native');

class API {
  constructor() {
    this.sessionId = null;
    this.token = null;
    this.lastRefresh = null;

    this._getSessionToken = async () => {
      const response = await rp({
        url: 'https://salus-it500.com/public/devices.php',
        headers: {
          'Cookie': 'PHPSESSID='+this.sessionId,
        },
      });
      const [,token] = response.match(/id="token"[^>]*value="([^"]*)"/m)
      return token;
    }

    this.login = async ({username, password}) => {
      this._credentials = {username, password};

      const response = await rp.post({
        url: 'https://salus-it500.com/public/login.php?lang=en',
        followRedirect: false,
        body: 'IDemail='+encodeURIComponent(username)+'&password='+encodeURIComponent(password)+'&login=Login',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        resolveWithFullResponse: true,
        simple: false,
      });

      if (response.statusCode !== 302 || !response.headers.location.startsWith('devices.php')) {
        throw new Error('Invalid credentials')
      }

      const match = response.headers['set-cookie'][0].match(/PHPSESSID=([^;]+);/);
      if (!match || !match[1]) throw new Error('Unexpected response');

      const [,sessionId] = match;
      this.sessionId = sessionId;

      const token = await this._getSessionToken({sessionId});
      this.token = token;

      return true;
    }

    // Keep track of pending requests to avoid multiple simultanous network calls
    this._pendingSessionCheck = null;
    this._checkSession = async () => {
      if (this._pendingSessionCheck) return this._pendingSessionCheck;

      const promise = (async () => {
        const response = await rp({
          url: 'https://salus-it500.com/public/devices.php',
          headers: {
            'Cookie': 'PHPSESSID='+this.sessionId,
          },
          followRedirect: false,
          resolveWithFullResponse: true,
          simple: false,
        });

        // session expired
        if (response.statusCode === 302 && response.headers.location.includes('login.php')) {
          await this.login(this._credentials)
        }
      })()

      this._pendingSessionCheck = promise;
      try {await promise}
      finally {this._pendingSessionCheck = null}
    }

    this.getDevices = async () => {
      await this._checkSession();

      const response = await rp({
        url: 'https://salus-it500.com/public/devices.php',
        headers: {
          'Cookie': 'PHPSESSID='+this.sessionId,
        },
      });

      const RE = /control\.php\?devId=([^"]+)">(STA\d+) ([^<]+)</mg;
      let match;
      const devices = [];
      while (match = RE.exec(response)) {
        const [,id, serial, name] = match;
        devices.push({id, serial, name});
      }

      return devices;
    }

    this.getDeviceOnlineStatus = async ({deviceId}) => {
      await this._checkSession();

      const response = await rp.get({
        url: 'https://salus-it500.com/public/ajax_device_online_status.php?devId='+deviceId+'&token='+this.token,
        headers: {
          'Cookie': 'PHPSESSID='+this.sessionId,
        },
      });
      const flags = response.replace(/"/g, '').split(' ')

      return {
        online: flags.includes('online'),
        batteryLow: flags.includes('lowBat'),
      }
    }

    // Keep a list of pending requests to avoid multiple simultanous network calls
    this._loadingDeviceValues = {};
    this.cachedDeviceValues = {};

    this.getDeviceValues = async ({deviceId}) => {
      if (this._loadingDeviceValues[deviceId]) {
        return this._loadingDeviceValues[deviceId];
      }

      const promise = (async () => {
        await this._checkSession();

        const json = await rp({
          url: 'https://salus-it500.com/public/ajax_device_values.php?devId='+deviceId+'&token='+this.token,
          headers: {
            'Cookie': 'PHPSESSID='+this.sessionId,
          },
          json: true,
        });

        if (json.tempUnit != 0) {
          console.warn('Unexpected temp unit: ' + JSON.stringify(json.tempUnit));
        }

        const values = {
          currentRoomTemperature: parseFloat(json.CH1currentRoomTemp),
          currentTargetTemperature: parseFloat(json.CH1currentSetPoint),
          autoMode: json.CH1autoOff == 0,
          energySaving: json.esStatus == 1,
          isHeating: json.CH1heatOnOffStatus == 1,
          temperatureUnit: json.tempUnit == 0 ? 'C' : 'F',
        };
        // console.log(values);

        return values;
      })()

      this._loadingDeviceValues[deviceId] = promise;

      try {
        return (this.cachedDeviceValues[deviceId] = await promise);
      } finally {
        this._loadingDeviceValues[deviceId] = null;
      }
    }

    this.setDeviceValues = async ({deviceId, autoMode, energySaving, targetTemperature}) => {
      await this._checkSession();

      const body = `
        token=${encodeURIComponent(this.token)}
        devId=${encodeURIComponent(deviceId)}
        tempUnit=0
        ${targetTemperature != null ? `
          auto=0
          auto_setZ1=1
          current_tempZ1_set=1
          current_tempZ1=${encodeURIComponent(targetTemperature)}
        ` : (
          autoMode ? `
            auto=0
            auto_setZ1=1
          ` : `
            auto=1
            auto_setZ1=1
          `
        )}
      `.split('\n').map(s=>s.trim()).filter(Boolean).join('&')
      // console.log(body);
      const response = await rp.post({
        url: 'https://salus-it500.com/includes/set.php',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': 'PHPSESSID='+this.sessionId,
        },
      });

      return this.getDeviceValues({deviceId})
    }
  }
}

module.exports = API;
