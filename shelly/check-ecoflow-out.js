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

let ecoFlowDischarging = false;

function  getEcoflowOutState() {
    print ("request: http://" + CONFIG.shellySwitchOut + "/rpc/Switch.GetStatus?id=0");
    Shelly.call(
        "HTTP.GET",
        {url: "http://" + CONFIG.shellySwitchOut + "/rpc/Shelly.GetStatus?id=0"},
        function(result, error_code, error_message, ud) {
            //print("result: " + result + " " + error_code + " " + error_message + " " + ud)
            if (error_code !== 0) {
                print('Error! ' + error_message);
            } else {
                let data = JSON.parse(result.body);
                let s = data['switch:0'].output;
                //print("state: " + s + " data: " + JSON.stringify(data['switch:0']));
                if (s != ecoFlowDischarging) {
                    print("Discharging " + (s ? "starts." : "stops."));
                    ecoFlowDischarging = s;
                }
                // print("switch is " + ecoFlowDischarging)
            }
        });
    print("state: " + ecoFlowDischarging);
}
Timer.set(CONFIG.checkingTime, true, getEcoflowOutState);
