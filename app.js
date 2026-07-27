const API =
"https://yjtkj-xcx.ievcloud.com/online/realtime/data/30504B45530333301506174061230201?language=en_us";

let voltageChart = null;

/* ===========================
   GRAFİK OLUŞTUR
=========================== */

function createVoltageChart() {

    const ctx = document.getElementById("voltageChart").getContext("2d");

    voltageChart = new Chart(ctx, {

        type: "bar",

        data: {

            labels: [],

            datasets: [{

                label: "Hücre Voltajı (V)",

                data: [],

                backgroundColor: [],

                borderRadius:6

            }]

        },

        options: {

            responsive:true,

            maintainAspectRatio:false,

            animation:false,

            plugins:{

                legend:{

                    labels:{
                        color:"white"
                    }

                }

            },

            scales:{

                x:{

                    ticks:{
                        color:"white"
                    },

                    grid:{
                        color:"#334155"
                    }

                },

                y:{

                    min:3.25,

                    max:3.40,

                    ticks:{
                        color:"white"
                    },

                    grid:{
                        color:"#334155"
                    }

                }

            }

        }

    });

}

/* ===========================
   GRAFİĞİ GÜNCELLE
=========================== */

function updateVoltageChart(cells){

    if(!voltageChart) return;

    const labels=[];
    const values=[];
    const colors=[];

    const voltages=cells.map(v=>v/1000);

    const max=Math.max(...voltages);
    const min=Math.min(...voltages);

    voltages.forEach((v,i)=>{

        labels.push(i+1);

        values.push(v);

        if(v===max){

            colors.push("#22c55e");

        }

        else if(v===min){

            colors.push("#ef4444");

        }

        else{

            colors.push("#3b82f6");

        }

    });

    voltageChart.data.labels=labels;
    voltageChart.data.datasets[0].data=values;
    voltageChart.data.datasets[0].backgroundColor=colors;

    voltageChart.update();

}

/* ===========================
   VERİYİ YÜKLE
=========================== */

async function load(){

    try{

        const response=await fetch(API);

        const d=await response.json();

        /* BAĞLANTI */

        document.getElementById("connection").innerHTML=
        '<i class="fa-solid fa-circle"></i> ONLINE';

        document.getElementById("connection").className="online";

        /* BATARYA */

        document.getElementById("deviceName").textContent=d.deviceName;

        document.getElementById("soc").textContent=
        d.sysStatus.soc+" %";

        document.getElementById("socText").textContent=
        d.sysStatus.soc+"%";

        document.getElementById("soh").textContent=
        d.sysStatus.soh+" %";

        document.getElementById("volt").textContent=
        d.v.totalV+" V";

        document.getElementById("current").textContent=
        d.v.totalC+" A";

        document.getElementById("temp").textContent=
        d.t.avg_t+" °C";

        document.getElementById("cells").textContent=
        d.v.total;

        document.getElementById("state").textContent=
        d.state;

        document.getElementById("time").textContent=
        d.deviceTime;

        /* BATARYA DOLULUK */

        document.getElementById("batteryLevel").style.width=
        d.sysStatus.soc+"%";

        /* DURUM */

        const badge=document.getElementById("stateBadge");

        badge.innerHTML=d.state;

        if(d.state.toLowerCase().includes("charg")){

            badge.className="stateBadge charging";

        }

        else{

            badge.className="stateBadge discharging";

        }

        /* ALARM */

        if(d.alarm.length===0){

            document.getElementById("alarm").innerHTML=
            "🟢 Alarm Yok";

        }

        else{

            document.getElementById("alarm").innerHTML=
            "🔴 "+d.alarm.join("<br>");

        }

        /* GRAFİK */

        updateVoltageChart(d.v.v);

    }

    catch(err){

        console.error(err);

        document.getElementById("connection").innerHTML=
        '<i class="fa-solid fa-circle"></i> OFFLINE';

        document.getElementById("connection").className="offline";

    }

}

/* ===========================
   BAŞLAT
=========================== */

createVoltageChart();

load();

setInterval(load,5000);
