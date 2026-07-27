const API =  "https://yjtkj-xcx.ievcloud.com/online/realtime/data/30504B45530333301506174061230201?language=en_us";

let voltageChart = null;

// Grafik oluştur
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

                borderRadius: 4

            }]

        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {

                legend: {

                    labels: {

                        color: "white"

                    }

                }

            },

            scales: {

                x: {

                    ticks: {

                        color: "white"

                    },

                    grid: {

                        color: "#334155"

                    }

                },

                y: {

                    min: 3.25,

                    max: 3.40,

                    ticks: {

                        color: "white"

                    },

                    grid: {

                        color: "#334155"

                    }

                }

            }

        }

    });

}

// Grafik güncelle
function updateVoltageChart(cells) {

    if (!voltageChart) return;

    const labels = [];
    const values = [];
    const colors = [];

    const voltages = cells.map(v => v / 1000);

    const max = Math.max(...voltages);
    const min = Math.min(...voltages);

    voltages.forEach((v, i) => {

        labels.push(i + 1);

        values.push(v);

        if (v === max) {

            colors.push("#22c55e");

        } else if (v === min) {

            colors.push("#ef4444");

        } else {

            colors.push("#3b82f6");

        }

    });

    voltageChart.data.labels = labels;

    voltageChart.data.datasets[0].data = values;

    voltageChart.data.datasets[0].backgroundColor = colors;

    voltageChart.update();

}

async function load() {

    try {

        const r = await fetch(API);

        const d = await r.json();

        // Üst durum

        document.getElementById("connection").innerHTML =
            '<i class="fa-solid fa-circle"></i> ONLINE';

        document.getElementById("connection").className = "online";

        // Kartlar

        document.getElementById("deviceName").textContent = d.deviceName;

        document.getElementById("soc").textContent =
            d.sysStatus.soc + " %";

        document.getElementById("soh").textContent =
            d.sysStatus.soh + " %";

        document.getElementById("volt").textContent =
            d.v.totalV + " V";

        document.getElementById("current").textContent =
            d.v.totalC + " A";

        document.getElementById("temp").textContent =
            d.t.avg_t + " °C";

        document.getElementById("state").textContent =
            d.state;

        document.getElementById("cells").textContent =
            d.v.total;

        document.getElementById("time").textContent =
            d.deviceTime;

        // Alarm

        if (d.alarm.length === 0) {

            document.getElementById("alarm").innerHTML =
                "🟢 Alarm Yok";

        } else {

            document.getElementById("alarm").innerHTML =
                "🔴 " + d.alarm.join("<br>");

        }

        // Grafik

        updateVoltageChart(d.v.v);

    }

    catch (e) {

        console.error(e);

        document.getElementById("connection").innerHTML =
            '<i class="fa-solid fa-circle"></i> OFFLINE';

        document.getElementById("connection").className = "offline";

    }

}

// Başlat

createVoltageChart();

load();

setInterval(load, 5000);
