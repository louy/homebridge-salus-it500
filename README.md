# Homebridge Salus IT500
Homebridge platform that allows you to view and control your Salus IT500 thermostats.

## Installation
Just add the following to your homebridge `config.json`

```json
{
  "platforms": [
    {"platform": "SalusIT500", "username": "[[ADD YOUR EMAIL]]", "password": "[[ADD YOUR PASSWORD]]"}
  ]
}
```

## Features
- See current temperature from the thermostat
- See whether the heating is currently on
- Turn auto mode on/off and set target temperature
- Supports having multiple devices

Unfortunately there's currently no way to control energy saving mode nor frost settings due to HAP protocol limitations
