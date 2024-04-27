let CONFIG = {
    checkingTime: 10 * 1000, // check every 10 seconds
    shellySwitchIn: "shelly-plug-ecoflow-in", // "192.168.1.52" name or ip of your shelly switch
    shellySwitchOut: "192.168.1.10", // "192.168.1.52" name or ip of your shelly switch
    phase: "b_act_power", // Phase! other values: a_act_power, c_act_power or total_act_power
    powerThresholdMin: -50, // start charging or increase charging power when power is less than
    powerThresholdMax: 10, // stop charging or decrease charging power when power is more than
    chargingStep: 25, // change charging power in steps of chargingStep watts
    maxCharging: 1500, // set maximum charging power for ecoflow
    lockingTime: 3, // after changing charge speed wait n times before changing again
};

let ecoflow = {
    cid: "",
    batteries: [{
        sn: "sn",
        type: "DELTA Max"
    }],
    parallel_charging: true
}

function initConfig() {
    Shelly.call('KVS.GetMany', '',
        function(response, error_code, error_message) {
            // print (response)
            phone  = response.items.phone.value
            apikeycallmebot = response.items.apikeycallmebot.value
            ecoflow = JSON.parse(response.items.ecoflow.value)
            ecoflow.batteries = JSON.parse(response.items.batteries.value)

            print ("ecoflow configuration from KVS: " + JSON.stringify(ecoflow))
            //setEcoflowChargingPower(0)
            //switchEcoflow(true)

            //Timer.set(CONFIG.checkingTime, true, getPowerAndAdaptCharging);
            let topic = "/app/device/property/" + ecoflow.batteries[0].sn;
            print ("subscribe topic: " + topic)

            MQTT.subscribe(topic, mqttCallback);
        }
    );

    if (MQTT.isConnected()) {
        print("MQTT connected");
    } else {
        print ("MQTT disconnected");
    }
}
initConfig()

function mqttCallback(topic, message) {
    let msg = JSON.parse(message)
    let soc = msg.params['bmsMaster.soc']
    if (soc > 0) {
        print ("SOC: " + soc)
    }
    // print(message);

}