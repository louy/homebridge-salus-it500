const rp = require('request-promise-native');

async function getSessionToken({sessionId}) {
  const response = await rp({
    url: 'https://salus-it500.com/public/devices.php',
    headers: {
      'Cookie': 'PHPSESSID='+sessionId,
    },
  });
  const [,token] = response.match(/id="token"[^>]*value="([^"]*)"/m)
  return token;
}

async function login({username, password}) {
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
  const token = await getSessionToken({sessionId});

  return {sessionId, token};
}
exports.login = login;

async function getDevices({sessionId}) {
  const response = await rp({
    url: 'https://salus-it500.com/public/devices.php',
    headers: {
      'Cookie': 'PHPSESSID='+sessionId,
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
exports.getDevices = getDevices;

async function getDeviceOnlineStatus({sessionId, deviceId, token}) {
  // console.log("getDeviceOnlineStatus", {sessionId, token, deviceId})

  const response = await rp.get({
    url: 'https://salus-it500.com/public/ajax_device_online_status.php?devId='+deviceId+'&token='+token,
    headers: {
      'Cookie': 'PHPSESSID='+sessionId,
    },
  });
  const flags = response.replace(/"/g, '').split(' ')
  // console.log({flags})

  return {
    online: flags.includes('online'),
    batteryLow: flags.includes('lowBat'),
  }
}
exports.getDeviceOnlineStatus = getDeviceOnlineStatus;

async function getDeviceValues({sessionId, token, deviceId}) {
  // console.log("getDeviceValues", {sessionId, token, deviceId})
  const json = await rp({
    url: 'https://salus-it500.com/public/ajax_device_values.php?devId='+deviceId+'&token='+token,
    headers: {
      'Cookie': 'PHPSESSID='+sessionId,
    },
    json: true,
  });
  // console.log(json)

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
}
exports.getDeviceValues = getDeviceValues;

async function setDeviceValues({sessionId, token, deviceId, autoMode, energySaving, targetTemperature}) {
  const body = `
    token=${encodeURIComponent(token)}
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
      'Cookie': 'PHPSESSID='+sessionId,
    },
  });

  return getDeviceValues({sessionId, token, deviceId})
}
exports.setDeviceValues = setDeviceValues;
