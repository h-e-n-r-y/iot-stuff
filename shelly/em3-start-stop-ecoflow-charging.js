/*
  Script to be used with a Shelly PRO 3 EM.
  Control another Shelly Switch by monitoring Total Power.
  Can be used to charge a battery (i.e. EcoFlow) instead of giving power to the grid.
  Configuration:
    use KVS to store phone and apikeycallmebot if you wish to have whatsapp notifications.
    See also: https://www.callmebot.com/blog/free-api-whatsapp-messages/
*/
let CONFIG = {
    // every minute
    checkingTime: 10 * 1000, // check every 10 seconds
    shellySwitch: "shelly-plug-eco-flow", // name or ip of your shelly switch
    totalThreshold: -400, // start charging when total power is less than 400W
    chargingPower: 200, // power that is used by ecoflow for charging
    switchOn: 3,  // switch on when threshold was 3 times reached in the last 5 attempts
    switchOff: 5, // switch off when threshold was 5 times reached in the last 5 attempts
  };

  let phone
  let apikeycallmebot
  
  let ecoFlowCharging = false;
  let overThreshold = [false, false, false, false, false]
  let underThreshold = [false, false, false, false, false]
  
  
  function get_values() {
      Shelly.call('Shelly.GetStatus', '',
        function(response, error_code, error_message) {
          phaseA  = response["em:0"]["a_act_power"];
          phaseB  = response["em:0"]["b_act_power"];
          phaseC  = response["em:0"]["c_act_power"];
          total  = response["em:0"]["total_act_power"];
          print("Phase A: " + phaseA + "\tPhase B: " + phaseB + "\tPhase C: " + phaseC + "\tTotal: " + total);
          if (total < CONFIG.totalThreshold) {
            markOverThreshold()
          } else if (total > CONFIG.totalThreshold + CONFIG.chargingPower) {
            markUnderThreshold()
          } else {
            shift()
          }
          //print("over: " + overThreshold)
          //print("under: " + underThreshold)
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
    // print ("request: http://" + CONFIG.shellySwitch + "/rpc/Switch.Set?id=0&on=" + on)
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
          notify("Switching+ecoflow+" + (on ? "on":"off") + "+succeeded.")
          ecoFlowCharging = on
        }
      });    
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
          phone  = response.items.phone.value
          apikeycallmebot = response.items.apikeycallmebot.value
        }
    ); 
  } 
  initConfig()
  switchEcoflow(true)
  
  let timer = Timer.set(CONFIG.checkingTime, true, get_values);