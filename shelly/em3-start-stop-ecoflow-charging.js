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
    powerThreshold: -50, // start charging when power is less than 400W
    maxCharging: 1500, // set maximum charging power for ecoflow
    switchOn: 3,  // switch on when threshold was 3 times reached in the last 5 attempts
    switchOff: 5, // switch off when threshold was 5 times reached in the last 5 attempts
};

let phone
let apikeycallmebot
let ecoflow

let ecoFlowCharging = false;
let overThreshold = [false, false, false, false, false]
let underThreshold = [false, false, false, false, false]
let chargingPower = 0

function getPowerAndAdaptCharging() {
    Shelly.call('Shelly.GetStatus', '',
        function(response, error_code, error_message) {
            let power  = response["em:0"][CONFIG.phase];
            print("Power: " + power);
            if (power < CONFIG.powerThreshold) {
                markOverThreshold()
            } else if (power > CONFIG.powerThreshold) {
                markUnderThreshold()
            } else {
                shift()
            }

            if (MQTT.isConnected() && ecoFlowCharging && (power < 0 || power > CONFIG.powerThreshold)) {
                let newChargingPower = -(power - chargingPower)
                print ("new charging power: " + newChargingPower)
                setEcoflowChargingPower(newChargingPower)
            }

            if (!ecoFlowCharging && (countQueue(overThreshold) >= CONFIG.switchOn)) {
                print ("Start Charging!")
                switchEcoflow(true)
            } else if (ecoFlowCharging && (countQueue(underThreshold) >= CONFIG.switchOff)) {
                print ("Stop Charging!")
                switchEcoflow(false)
            }

        }
    );
}

function markOverThreshold() {
    shift()
    overThreshold[overThreshold.length - 1] = true
}
function markUnderThreshold() {
    shift()
    underThreshold[underThreshold.length - 1] = true
}

function shift() {
    for (let i=1; i<overThreshold.length; i++) {
        overThreshold[i-1] = overThreshold[i]
        underThreshold[i-1] = underThreshold[i]
    }
    overThreshold[overThreshold.length - 1] = false
    underThreshold[underThreshold.length - 1] = false
}

function countQueue(array) {
    let c = 0;
    for (let i=0; i < array.length; i++) {
        if (array[i]) {
            c++
        }
    }
    return c
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
            }
        });
}

function setEcoflowChargingPower(watts) {
    // round to full 100
    // watts /= 100
    // watts = Math.round(watts) * 100
    if (watts < 0) {
        watts = 0
    }
    if (watts > CONFIG.maxCharging) {
        watts = CONFIG.maxCharging
    }
    print("Setting ecoflow chargingPower to " + watts)
    let msg ={
        from:"iOS",
        operateType:"TCP",
        id:"694572336",
        lang:"en-us",
        params:{
            id:69,
            slowChgPower:watts
        },
        version:"1.0"
    }
    // print("topic: " + "/app/" + ecoflow.cid+ "/" + ecoflow.sn + "/thing/property/set" + "  message: " + JSON.stringify(msg))
    MQTT.publish("/app/" + ecoflow.cid + "/" + ecoflow.sn + "/thing/property/set", JSON.stringify(msg), 0, false);
    chargingPower = watts
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

            setEcoflowChargingPower(1)
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
