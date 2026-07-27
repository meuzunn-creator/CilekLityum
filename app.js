const API="https://yjtkj-xcx.ievcloud.com/online/realtime/data/30504B45530333301506174061230201?language=en_us";

async function load(){

try{

const r=await fetch(API);

const d=await r.json();

document.getElementById("connection").innerHTML="ONLINE";

document.getElementById("connection").className="online";

document.getElementById("deviceName").innerHTML=d.deviceName;

document.getElementById("soc").innerHTML=d.sysStatus.soc+" %";

document.getElementById("soh").innerHTML=d.sysStatus.soh+" %";

document.getElementById("volt").innerHTML=d.v.totalV+" V";

document.getElementById("current").innerHTML=d.v.totalC+" A";

document.getElementById("temp").innerHTML=d.t.avg_t+" °C";

document.getElementById("state").innerHTML=d.state;

document.getElementById("cells").innerHTML=d.v.total;

document.getElementById("time").innerHTML=d.deviceTime;

if(d.alarm.length===0){

document.getElementById("alarm").innerHTML="🟢 Alarm Yok";

}

else{

document.getElementById("alarm").innerHTML="🔴 "+d.alarm.join("<br>");

}

}

catch(e){

document.getElementById("connection").innerHTML="OFFLINE";

document.getElementById("connection").className="offline";

}

}

load();

setInterval(load,5000);