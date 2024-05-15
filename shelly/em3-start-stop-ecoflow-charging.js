/*
  Script to be used with a Shelly PRO 3 EM.
  Control another Shelly Switch by monitoring Power (of a specific phase ot total).
  Can be used to charge a battery (i.e. EcoFlow) instead of giving power to the grid.
  The charging power of the ecoflow is dynamically adapted based on the actual power.
  To achieve this, the Shelly PRO 3 EM hast to be connected to ecoflow via MQTT.
  You need the right credentials/clientId for MQTT.
  I used https://raw.githubusercontent.com/mmiller7/ecoflow-withoutflow/main/cloud-mqtt/ecoflow_get_mqtt_login.sh
  for this purpose.
  Currently only Ecoflow Delta Max is supported. It can be easily adapted for Delta 2.

  Configuration:
    use KVS to store 'phone' and 'apikeycallmebot' if you wish to have WhatsApp notifications.
    See also: https://www.callmebot.com/blog/free-api-whatsapp-messages/

    To communicate to your ecoflow set 'ecoflow' in KVS with the JSON value like
    {
        "sn": "your ecoflow SN",
        "cid": "your ecoflow mqtt client id"
    }

*/
let CONFIG = {
    checkingTime: 5 * 1000, // check every 10 seconds
    shellySwitchIn: "shelly-plug-ecoflow-in", // "192.168.1.52" name or ip of your shelly switch
    shellySwitchOut: "shelly-plug-ecoflow-out", // "192.168.1.10", // name or ip of your shelly switch
    shellySwitchIn2: "192.168.1.62", // secondary battery
    in2ChargingPower: 2000, // fixed charging power in watts for 2nd battery, high number (>1500) means: do not use
    in2Name: "Anker",
    phase: "total_act_power", // Phase! other values: a_act_power, c_act_power or total_act_power
    powerThresholdMin: -50, // start charging or increase charging power when power is less than
    powerThresholdMax: 10, // stop charging or decrease charging power when power is more than
    chargingStep: 50, // change charging power in steps of chargingStep watts
    maxCharging: 1500, // set maximum charging power for ecoflow
    lockingTime: 4, // after changing charge speed wait n times before changing again
};

let phone
let apikeycallmebot
let ecoflow = {
    cid: "",
    batteries: [{
        sn: "sn",
        type: "DELTA Max"
    }],
    parallel_charging: true
}

let ecoFlowCharging = false;
let battery2Charging = false;
let in2ChargingPower = CONFIG.in2ChargingPower;
let ecoFlowDischarging = false;
let ecoFlowSOC = 0;
let alternatingCall = false;

function getPowerAndAdaptCharging() {
    try {
        if (alternatingCall) { // avoid "too many calls in progress"
            getEcoflowOutState()
        } else {
            getChargingPower2()
        }
        alternatingCall = !alternatingCall;

        Shelly.call('Shelly.GetStatus', '', getPowerAndAdaptChargingCallback);
    } catch (err) {
        print("ERROR: " + err);
        exit;
    }
}

function getPowerAndAdaptChargingCallback(response, error_code, error_message) {
    let power  = Math.floor(response["em:0"][CONFIG.phase])
    Power.writeHistory(power)
    let avgPower = Power.median()

    let newChargingPower = 0
    if (ecoFlowCharging && !Power.powerChangeLocked()) {
        /*
          if (avgPower < CONFIG.powerThresholdMin) {
              newChargingPower = Power.chargingPower + CONFIG.chargingStep
              setEcoflowChargingPower(newChargingPower)
          }
          if (avgPower > CONFIG.powerThresholdMax) {
              newChargingPower = Power.chargingPower - CONFIG.chargingStep
              setEcoflowChargingPower(newChargingPower)
          }
          */
        newChargingPower = Power.chargingPower - avgPower;
        setEcoflowChargingPower(newChargingPower);
    }
    if (ecoFlowCharging) {
        print("Power: " + power + " Avg: " + avgPower + " charging power: " + Power.chargingPower + " charging power #2: " + (battery2Charging ? in2ChargingPower : 0) + " lock: " + Power.changePowerLock + " soc: " + ecoFlowSOC)
    } else {
        print("Power: " + power + " Avg: " + avgPower + " soc: " + ecoFlowSOC + " not charging.")
    }

    if (!ecoFlowCharging && !Power.powerChangeLocked() && (avgPower < CONFIG.powerThresholdMin) && !ecoFlowDischarging) {
        print ("Start Charging!")
        switchEcoflow(true)
    } else if (ecoFlowCharging && !Power.powerChangeLocked() && (avgPower > CONFIG.powerThresholdMax) && Power.chargingPower === 0) {
        print ("Stop Charging!");
        switchEcoflow(false);
    }

}


function switchEcoflow(on) {
    switchBatteryIn(CONFIG.shellySwitchIn, "EcoFlow", on);
    if (!on) {
        setEcoflowChargingPower(0)
    }
}
function switchBattery2(on) {
    switchBatteryIn(CONFIG.shellySwitchIn2, CONFIG.in2Name, on);
}

let switchBatteryInProgress = [];
function switchBatteryIn(address, name, on) {
    if (switchBatteryInProgress[name]) {
        return;
    }
    let data = {};
    data.name = name;
    data.on = on;
    data.address = address;

    // print ("request: http://" + CONFIG.shellySwitchIn + "/rpc/Switch.Set?id=0&on=" + on)
    switchBatteryInProgress[name] = true;
    Shelly.call(
        "HTTP.GET",
        {url: "http://" + address + "/rpc/Switch.Set?id=0&on=" + on, timeout: 1},
        switchBatteryInCallback,
        data);
}
function switchBatteryInCallback(result, error_code, error_message, ud) {
    switchBatteryInProgress[ud.name] = false;
    if (error_code !== 0) {
        print('Error switching battery ' + ud.name + ': ' + error_message);
        notify("Switching+" + ud.name + "+" + (ud.on ? "on":"off") + "+failed.");
    } else {
        let data = JSON.parse(result.body);
        print("Success performing switch " + ud.name + "-In from " + (data.was_on ? "on":"off") + " to " + (ud.on ? "on":"off"));
        notify((ud.on ? "Start":"Stop") + "+charging+" + ud.name + ".");
        if (ud.address === CONFIG.shellySwitchIn) {
            ecoFlowCharging = ud.on;
        } else {
            battery2Charging = ud.on;
        }
    }
}

let getEcoflowOutStateInProgress = false;
function getEcoflowOutState() {
    if (getEcoflowOutStateInProgress) {
        return;
    }
    getEcoflowOutStateInProgress = true;
    //print ("request: http://" + CONFIG.shellySwitchOut + "/rpc/Switch.GetStatus?id=0");
    Shelly.call(
        "HTTP.GET",
        {url: "http://" + CONFIG.shellySwitchOut + "/rpc/Shelly.GetStatus?id=0", timeout: 1},
        getEcoflowOutStateCallback);
}

function getEcoflowOutStateCallback(result, error_code, error_message) {
    getEcoflowOutStateInProgress = false;
    //print("result: " + result + " " + error_code + " " + error_message)
    if (error_code !== 0) {
        print('Error getting EcoflowOutState! ' + error_message);
    } else {
        let data = JSON.parse(result.body);
        let s = data['switch:0'].apower > 10;
        // print("state: " + s + " data: " + JSON.stringify(data['switch:0'].apower));
        if (s !== ecoFlowDischarging) {
            print("Discharging " + (s ? "starts." : "stops."));
            ecoFlowDischarging = s;
        }
        // print("switch is " + ecoFlowDischarging)
    }
}

let getChargingPower2InProgress = false;
function getChargingPower2() {
    if (getChargingPower2InProgress) {
        return;
    }
    getChargingPower2InProgress = true;
    //print ("request: http://" + CONFIG.shellySwitchOut + "/rpc/Switch.GetStatus?id=0");
    Shelly.call(
        "HTTP.GET",
        {url: "http://" + CONFIG.shellySwitchIn2 + "/rpc/Shelly.GetStatus?id=0", timeout: 1},
        getChargingPower2Callback);
}

function getChargingPower2Callback(result, error_code, error_message) {
    getChargingPower2InProgress = false;
    // print("result: " + result.body + " " + error_code + " " + error_message)
    if (error_code !== 0) {
        print('Error getting ChargingPower2! ' + error_message);
    } else {
        let data = JSON.parse(result.body);
        let power = data['switch:0'].apower;
        if (power > 100) {
            in2ChargingPower = Math.floor(power);
        }
    }
}

function setEcoflowChargingPower(watts) {
    if(!MQTT.isConnected()) {
        print ("warning: MQTT is disconnected...")
        return
    }
    // round to CONFIG.chargingStep
    watts /= CONFIG.chargingStep
    watts = Math.floor(watts) * CONFIG.chargingStep
    if (watts < 0) {
        watts = 0
    }
    if (watts > CONFIG.maxCharging) {
        watts = CONFIG.maxCharging
    }
    if (watts !== Power.chargingPower) {
        if (!battery2Charging && (watts > in2ChargingPower + 100)) {
            // start charging battery2
            watts -= in2ChargingPower;
            switchBattery2(true);
        } else if (battery2Charging && (watts < 50)) {
            // stop charging battery2
            watts += in2ChargingPower;
            switchBattery2(false);
        }
        if (watts < 0) {
            watts = 0
        }
        print("Setting ecoflow charging power to " + watts)

        ecoflow.batteries.forEach(function(battery) {
            let msg
            if (battery.type === "DELTA Max") {
                msg = DeltaMax.changeChargingPowerMsg(battery.sn, watts)
            } else if (battery.type === "DELTA 2") {
                msg = Delta2.changeChargingPowerMsg(battery.sn, watts)
            } else {
                print ("Battery type not supported: " + battery.type)
                return
            }
            // print("topic: " + "/app/" + ecoflow.cid+ "/" + ecoflow.sn + "/thing/property/set" + "  message: " + JSON.stringify(msg))
            MQTT.publish("/app/" + ecoflow.cid + "/" + battery.sn + "/thing/property/set", JSON.stringify(msg), 0, false);
        })
        Power.chargingPower = watts
        Power.changePowerLock = CONFIG.lockingTime
    }
}

function notify(message) {
    if (phone && apikeycallmebot) {
        Shelly.call(
            "HTTP.GET",
            {url: "https://api.callmebot.com/whatsapp.php?phone=" + phone + "&apikey=" + apikeycallmebot + "&text=" + message, timeout: 10},
            function(result, error_code, error_message) {
                if (error_code !== 0) {
                    print("Error sending Whatsapp! " + error_message);
                } else {
                    // print("Success sending message: " + result.body);
                }
            });
    }
}

function initConfig() {
    Shelly.call('KVS.GetMany', '', initConfigCallback);

    if (MQTT.isConnected()) {
        print("MQTT connected");
    } else {
        print ("MQTT disconnected");
    }
}

function initConfigCallback(response, error_code, error_message) {
    // print (response)
    phone  = response.items.phone.value
    apikeycallmebot = response.items.apikeycallmebot.value
    ecoflow = JSON.parse(response.items.ecoflow.value)
    ecoflow.batteries = JSON.parse(response.items.batteries.value)

    print ("ecoflow configuration from KVS: " + JSON.stringify(ecoflow))
    setEcoflowChargingPower(0)
    switchEcoflow(true)
    switchBattery2(false)
    /*
                let topic = "/app/device/property/" + ecoflow.batteries[0].sn;
                print ("subscribe topic: " + topic)
                MQTT.subscribe(topic, mqttCallback);
    */
    Timer.set(CONFIG.checkingTime, true, getPowerAndAdaptCharging);
}
initConfig()

function mqttCallback(topic, message) {
    let msg = JSON.parse(message);
    let soc = msg.params['bmsMaster.soc'];
    if (soc > 0) {
        //print("SOC: " + soc);
        ecoFlowSOC = soc;
    }
    // print(message);
}

let Power = {
    history: [0, 0, 0, 0, 0, 0, 0], // specify length of history for median calculation
    chargingPower: -1,
    changePowerLock: CONFIG.lockingTime,

    powerChangeLocked: function() {
        return this.changePowerLock > 0
    },
    median: function () {
        let sum = 0;
        let min = 9999
        let max = 0
        for (let i = 0; i < this.history.length; i++) {
            sum += this.history[i]
            if (this.history[i] > max) {
                max = this.history[i]
            }
            if (this.history[i] < min) {
                min = this.history[i]
            }
        }
        return Math.floor((sum - max - min) / (this.history.length - 2))
    },
    writeHistory: function (power) {
        this.shift()
        this.history[this.history.length - 1] = power
    },
    shift: function () {
        for (let i = 1; i < this.history.length; i++) {
            this.history[i - 1] = this.history[i]
        }
        this.history[this.history.length - 1] = 0
        if (this.changePowerLock > 0) {
            this.changePowerLock--
        }
    }

}

let DeltaMax = {
    changeChargingPowerMsg: function (sn, watts) {
        return {
            from: "iOS",
            operateType: "TCP",
            id: "694572336",
            lang: "en-us",
            params: {
                id: 69,
                slowChgPower: watts
            },
            version: "1.0"
        }
    }
}

let Delta2 = {
    minChargingPower: 1,
    changeChargingPowerMsg: function (sn, watts) {
        return {
            params: {
                chgWatts: watts < this.minChargingPower ? this.minChargingPower : watts,
                chgPauseFlag: 0
            },
            from: "iOS",
            lang: "en-us",
            id: "630479220",
            moduleSn: sn,
            moduleType: 5,
            operateType: "acChgCfg",
            version: "1.0"
        }
    }
}