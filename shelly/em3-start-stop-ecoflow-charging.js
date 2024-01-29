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
    checkingTime: 10 * 1000, // check every 10 seconds
    shellySwitch: "shelly-plug-ecoflow-in", // "192.168.1.52" name or ip of your shelly switch
    phase: "b_act_power", // Phase! other values: a_act_power, c_act_power or total_act_power
    powerThresholdMin: -60, // start charging or increase charging power when power is less than
    powerThresholdMax: 20, // stop charging or decrease charging power when power is more than
    chargingStep: 50, // change charing power in steps of chargingStep watts
    maxCharging: 1500, // set maximum charging power for ecoflow
    lockingTime: 5, // after changing charge speed wait n times before changing again
};

let phone
let apikeycallmebot
let ecoflow

let ecoFlowCharging = false;


function getPowerAndAdaptCharging() {
    Shelly.call('Shelly.GetStatus', '',
        function(response, error_code, error_message) {
            let power  = response["em:0"][CONFIG.phase]
            Power.writeHistory(power)
            let avgPower = Power.median()

            let newChargingPower = 0
            if (MQTT.isConnected() && ecoFlowCharging && !Power.powerChangeLocked()) {
                if (avgPower < CONFIG.powerThresholdMin) {
                    newChargingPower = Power.chargingPower + CONFIG.chargingStep
                    setEcoflowChargingPower(newChargingPower)
                }
                if (avgPower > CONFIG.powerThresholdMax) {
                    newChargingPower = Power.chargingPower - CONFIG.chargingStep
                    setEcoflowChargingPower(newChargingPower)
                }
            }
            print("Power: " + power + " Avg: " + avgPower + " charging power: " + Power.chargingPower)

            if (!ecoFlowCharging && (avgPower < CONFIG.powerThresholdMin)) {
                print ("Start Charging!")
                switchEcoflow(true)
            } else if (ecoFlowCharging && (avgPower > CONFIG.powerThresholdMax) && Power.chargingPower === 0) {
                print ("Stop Charging!")
                switchEcoflow(false)
            }

        }
    );
}


function switchEcoflow(on) {
    print ("request: http://" + CONFIG.shellySwitch + "/rpc/Switch.Set?id=0&on=" + on)
    Shelly.call(
        "HTTP.GET",
        {url: "http://" + CONFIG.shellySwitch + "/rpc/Switch.Set?id=0&on=" + on},
        function(result, error_code, error_message) {
            if (error_code !== 0) {
                print('Error! ' + error_message);
                notify("Switching+ecoflow+" + (on ? "on":"off") + "+failed.")
            } else {
                let data = JSON.parse(result.body);
                print("Success performing switch from " + (JSON.stringify(data["was_on"]) ? "on":"off") + " to " + (on ? "on":"off"));
                notify((on ? "Start":"Stop") + "+charging+ecoflow.")
                ecoFlowCharging = on
                setEcoflowChargingPower(0)
            }
        });
}

function setEcoflowChargingPower(watts) {
    // round to CONFIG.chargingStep
    watts /= CONFIG.chargingStep
    watts = Math.round(watts) * CONFIG.chargingStep
    if (watts < 0) {
        watts = 0
    }
    if (watts > CONFIG.maxCharging) {
        watts = CONFIG.maxCharging
    }
    if (watts !== Power.chargingPower) {
        print("Setting ecoflow chargingPower to " + watts)
        let msg = {
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
        // print("topic: " + "/app/" + ecoflow.cid+ "/" + ecoflow.sn + "/thing/property/set" + "  message: " + JSON.stringify(msg))
        MQTT.publish("/app/" + ecoflow.cid + "/" + ecoflow.sn + "/thing/property/set", JSON.stringify(msg), 0, false);
        Power.chargingPower = watts
        Power.changePowerLock = CONFIG.lockingTime
    }
}

function notify(message) {
    if (phone && apikeycallmebot) {
        Shelly.call(
            "HTTP.GET",
            {url: "https://api.callmebot.com/whatsapp.php?phone=" + phone + "&apikey=" + apikeycallmebot + "&text=" + message},
            function(result, error_code, error_message) {
                if (error_code !== 0) {
                    print("Error! " + error_message);
                } else {
                    print("Success sending message: " + result.body);
                }
            });
    }
}

function initConfig() {
    Shelly.call('KVS.GetMany', '',
        function(response, error_code, error_message) {
            // print (response)
            phone  = response.items.phone.value
            apikeycallmebot = response.items.apikeycallmebot.value
            ecoflow = JSON.parse(response.items.ecoflow.value)

            setEcoflowChargingPower(0)
            switchEcoflow(true)

            Timer.set(CONFIG.checkingTime, true, getPowerAndAdaptCharging);
        }
    );

    if (MQTT.isConnected()) {
        print("MQTT connected");
    } else {
        print ("MQTT disconnected");
    }
}
initConfig()

let Power = {
    history: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
        return (sum - max - min) / (this.history.length - 2)
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
        this.changePowerLock--
    }
}
