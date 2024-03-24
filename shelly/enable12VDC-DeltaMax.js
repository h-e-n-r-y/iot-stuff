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
    checkingTime: 3600 * 1000, // check every 1 hour
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
let battery

function enable12VDC() {
    if(!MQTT.isConnected()) {
        return
    }
    let msg = "{\"from\":\"iOS\",\"operateType\":\"TCP\",\"id\":\"680224601\",\"lang\":\"en-us\",\"params\":{\"id\":81,\"enabled\":1},\"version\":\"1.0\"}";
    //print("/app/" + ecoflow.cid + "/" + ecoflow.batteries[1].sn + "/thing/property/set | " + msg);
    MQTT.publish("/app/" + ecoflow.cid + "/" + battery.sn + "/thing/property/set", msg, 0, false);
}


function initConfig() {
    Shelly.call('KVS.GetMany', '',
        function(response, error_code, error_message) {
            phone  = response.items.phone.value
            apikeycallmebot = response.items.apikeycallmebot.value
            ecoflow = JSON.parse(response.items.ecoflow.value)
            ecoflow.batteries = JSON.parse(response.items.batteries.value)
            battery = ecoflow.batteries[1]
            Timer.set(CONFIG.checkingTime, true, enable12VDC);
            enable12VDC()
        }
    );

    if (MQTT.isConnected()) {
        print("MQTT connected");
    } else {
        print ("MQTT disconnected");
    }
}
initConfig()