const API =
    "https://yjtkj-xcx.ievcloud.com/online/realtime/data/30504B45530333301506174061230201?language=en_us";

const REFRESH_INTERVAL = 5000;

let voltageChart = null;
let isLoading = false;

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value;
    }
}

function toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, digits = 2) {
    return toNumber(value).toLocaleString("tr-TR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* =========================================================
   BAĞLANTI DURUMU
========================================================= */

function updateConnection(isOnline) {
    const connection = getElement("connection");

    if (!connection) {
        return;
    }

    if (isOnline) {
        connection.className = "online";
        connection.innerHTML = `
            <i class="fa-solid fa-circle"></i>
            <span>ONLINE</span>
        `;
    } else {
        connection.className = "offline";
        connection.innerHTML = `
            <i class="fa-solid fa-circle"></i>
            <span>OFFLINE</span>
        `;
    }
}

/* =========================================================
   VOLTAJ GRAFİĞİ
========================================================= */

function createVoltageChart() {
    const canvas = getElement("voltageChart");

    if (!canvas || typeof Chart === "undefined") {
        console.error("Chart.js veya voltageChart elementi bulunamadı.");
        return;
    }

    const context = canvas.getContext("2d");

    voltageChart = new Chart(context, {
        type: "bar",

        data: {
            labels: [],

            datasets: [
                {
                    label: "Hücre Voltajı",
                    data: [],
                    backgroundColor: [],
                    borderColor: [],
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 42
                }
            ]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: true,

                    labels: {
                        color: "#f8fafc",
                        boxWidth: 14,
                        boxHeight: 14
                    }
                },

                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) {
                                return "";
                            }

                            return `Hücre ${items[0].label}`;
                        },

                        label(context) {
                            return `${formatNumber(context.raw, 3)} V`;
                        }
                    }
                }
            },

            scales: {
                x: {
                    ticks: {
                        color: "#cbd5e1",
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0
                    },

                    grid: {
                        display: false
                    },

                    title: {
                        display: true,
                        text: "Hücre Numarası",
                        color: "#94a3b8"
                    }
                },

                y: {
                    suggestedMin: 3.20,
                    suggestedMax: 3.45,

                    ticks: {
                        color: "#cbd5e1",

                        callback(value) {
                            return `${Number(value).toFixed(3)} V`;
                        }
                    },

                    grid: {
                        color: "rgba(148, 163, 184, 0.15)"
                    },

                    title: {
                        display: true,
                        text: "Voltaj",
                        color: "#94a3b8"
                    }
                }
            }
        }
    });
}

function updateVoltageChart(cells) {
    if (!voltageChart || !Array.isArray(cells) || cells.length === 0) {
        return;
    }

    const voltages = cells.map(cell => toNumber(cell) / 1000);

    const maximumVoltage = Math.max(...voltages);
    const minimumVoltage = Math.min(...voltages);

    const labels = voltages.map((_, index) => String(index + 1));

    const backgroundColors = voltages.map(voltage => {
        if (voltage === maximumVoltage) {
            return "#22c55e";
        }

        if (voltage === minimumVoltage) {
            return "#ef4444";
        }

        return "#3b82f6";
    });

    const borderColors = voltages.map(voltage => {
        if (voltage === maximumVoltage) {
            return "#86efac";
        }

        if (voltage === minimumVoltage) {
            return "#fca5a5";
        }

        return "#93c5fd";
    });

    /*
     * Grafik eksenini gerçek değerlerin biraz altına ve üstüne getirir.
     * Böylece küçük hücre farkları daha rahat görülür.
     */
    const padding = Math.max(
        0.015,
        (maximumVoltage - minimumVoltage) * 1.5
    );

    voltageChart.options.scales.y.min =
        Math.floor((minimumVoltage - padding) * 1000) / 1000;

    voltageChart.options.scales.y.max =
        Math.ceil((maximumVoltage + padding) * 1000) / 1000;

    voltageChart.data.labels = labels;
    voltageChart.data.datasets[0].data = voltages;
    voltageChart.data.datasets[0].backgroundColor = backgroundColors;
    voltageChart.data.datasets[0].borderColor = borderColors;

    voltageChart.update("none");
}

/* =========================================================
   HEATMAP
========================================================= */

function updateHeatmap(cells) {
    const heatmap = getElement("heatmap");

    if (!heatmap) {
        return;
    }

    heatmap.innerHTML = "";

    if (!Array.isArray(cells) || cells.length === 0) {
        heatmap.innerHTML = `
            <div class="comingSoon">
                Hücre verisi bulunamadı.
            </div>
        `;

        return;
    }

    const voltages = cells.map(cell => toNumber(cell) / 1000);

    const maximumVoltage = Math.max(...voltages);
    const minimumVoltage = Math.min(...voltages);

    voltages.forEach((voltage, index) => {
        const differenceFromMinimumMv =
            Math.round((voltage - minimumVoltage) * 1000);

        const cellElement = document.createElement("div");

        cellElement.className = "cell";

        /*
         * Hücrenin minimum hücreye olan farkına göre renk atanır:
         *
         * 0–10 mV  : normal
         * 11–20 mV : uyarı
         * 20 mV+   : kritik
         */

        if (differenceFromMinimumMv <= 10) {
            cellElement.classList.add("good");
        } else if (differenceFromMinimumMv <= 20) {
            cellElement.classList.add("warning");
        } else {
            cellElement.classList.add("bad");
        }

        if (voltage === minimumVoltage) {
            cellElement.title =
                `Minimum hücre • ${formatNumber(voltage, 3)} V`;
        } else if (voltage === maximumVoltage) {
            cellElement.title =
                `Maksimum hücre • ${formatNumber(voltage, 3)} V`;
        } else {
            cellElement.title =
                `Minimum hücreye fark: ${differenceFromMinimumMv} mV`;
        }

        cellElement.innerHTML = `
            <div class="cellNumber">
                Hücre ${index + 1}
            </div>

            <div class="cellVoltage">
                ${formatNumber(voltage, 3)} V
            </div>
        `;

        heatmap.appendChild(cellElement);
    });
}

/* =========================================================
   BATARYA DOLULUK GÖSTERGESİ
========================================================= */

function updateBatteryLevel(socValue) {
    const batteryLevel = getElement("batteryLevel");
    const socText = getElement("socText");

    const soc = Math.min(100, Math.max(0, toNumber(socValue)));

    if (batteryLevel) {
        batteryLevel.style.width = `${soc}%`;

        if (soc <= 20) {
            batteryLevel.style.background =
                "linear-gradient(90deg, #dc2626, #ef4444)";
        } else if (soc <= 40) {
            batteryLevel.style.background =
                "linear-gradient(90deg, #d97706, #f59e0b)";
        } else {
            batteryLevel.style.background =
                "linear-gradient(90deg, #16a34a, #4ade80)";
        }
    }

    if (socText) {
        socText.textContent = `${formatNumber(soc, 0)}%`;

        if (soc <= 20) {
            socText.style.color = "#ef4444";
        } else if (soc <= 40) {
            socText.style.color = "#f59e0b";
        } else {
            socText.style.color = "#22c55e";
        }
    }
}

/* =========================================================
   ÇALIŞMA DURUMU
========================================================= */

function normalizeOperationState(state, current) {
    const rawState = String(state || "").trim();
    const lowercaseState = rawState.toLowerCase();
    const currentValue = toNumber(current);

    if (
        lowercaseState.includes("charg") ||
        lowercaseState.includes("şarj")
    ) {
        return {
            text: "Şarj Ediliyor",
            className: "charging",
            icon: "fa-bolt"
        };
    }

    if (
        lowercaseState.includes("discharg") ||
        lowercaseState.includes("deşarj")
    ) {
        return {
            text: "Deşarj Ediliyor",
            className: "discharging",
            icon: "fa-arrow-down"
        };
    }

    /*
     * API durumu açık şekilde bildirmezse akım değerinden tahmin edilir.
     * Bazı BMS sistemlerinde akım işareti ters olabilir. Gerekirse buradaki
     * iki sonucu yer değiştirebilirsin.
     */

    if (currentValue > 0.1) {
        return {
            text: rawState || "Şarj Ediliyor",
            className: "charging",
            icon: "fa-bolt"
        };
    }

    if (currentValue < -0.1) {
        return {
            text: rawState || "Deşarj Ediliyor",
            className: "discharging",
            icon: "fa-arrow-down"
        };
    }

    return {
        text: rawState || "Beklemede",
        className: "",
        icon: "fa-pause"
    };
}

function updateOperationState(state, current) {
    const stateBadge = getElement("stateBadge");
    const stateInformation = normalizeOperationState(state, current);

    if (stateBadge) {
        stateBadge.className = "stateBadge";

        if (stateInformation.className) {
            stateBadge.classList.add(stateInformation.className);
        }

        stateBadge.innerHTML = `
            <i class="fa-solid ${stateInformation.icon}"></i>
            <span id="state">${escapeHtml(stateInformation.text)}</span>
        `;
    }

    setText("operationState", stateInformation.text);
}

/* =========================================================
   KRİTİK BMS ÖZETİ
========================================================= */

function updateSummary(data, cells) {
    if (!Array.isArray(cells) || cells.length === 0) {
        setText("maxCell", "-");
        setText("minCell", "-");
        setText("deltaCell", "-");
        setText("power", "-");
        setText("operationState", "-");
        setText("systemEnabled", "-");

        return;
    }

    const voltagesMv = cells.map(cell => toNumber(cell));

    const maximumVoltageMv = Math.max(...voltagesMv);
    const minimumVoltageMv = Math.min(...voltagesMv);

    const calculatedMaximumIndex =
        voltagesMv.indexOf(maximumVoltageMv) + 1;

    const calculatedMinimumIndex =
        voltagesMv.indexOf(minimumVoltageMv) + 1;

    /*
     * API peak bilgisi sağlıyorsa onu kullanır.
     * Sağlamıyorsa hücre dizisinden hesaplanan değer kullanılır.
     */

    const peak = data?.peak || {};

    const maximumCellId =
        toNumber(peak.maxVoltId, calculatedMaximumIndex) ||
        calculatedMaximumIndex;

    const minimumCellId =
        toNumber(peak.minVoltId, calculatedMinimumIndex) ||
        calculatedMinimumIndex;

    let maximumVoltage = toNumber(peak.maxVolt, maximumVoltageMv);
    let minimumVoltage = toNumber(peak.minVolt, minimumVoltageMv);

    /*
     * Peak değeri volt cinsinden gelirse mV değerine dönüştürülür.
     */

    if (maximumVoltage > 0 && maximumVoltage < 10) {
        maximumVoltage *= 1000;
    }

    if (minimumVoltage > 0 && minimumVoltage < 10) {
        minimumVoltage *= 1000;
    }

    const deltaVoltageMv = Math.abs(
        maximumVoltage - minimumVoltage
    );

    const totalVoltage = toNumber(data?.v?.totalV);
    const totalCurrent = toNumber(data?.v?.totalC);

    const powerWatt = totalVoltage * totalCurrent;

    setText(
        "maxCell",
        `H${maximumCellId} • ${formatNumber(maximumVoltage / 1000, 3)} V`
    );

    setText(
        "minCell",
        `H${minimumCellId} • ${formatNumber(minimumVoltage / 1000, 3)} V`
    );

    setText(
        "deltaCell",
        `${formatNumber(deltaVoltageMv, 0)} mV`
    );

    setText(
        "power",
        `${formatNumber(Math.abs(powerWatt), 1)} W`
    );

    updateSystemEnabled(data?.sysEnabled);
}

function updateSystemEnabled(value) {
    const element = getElement("systemEnabled");

    if (!element) {
        return;
    }

    const normalizedValue = String(value).toLowerCase();

    const enabledValues = [
        "true",
        "1",
        "enabled",
        "enable",
        "on",
        "open"
    ];

    const disabledValues = [
        "false",
        "0",
        "disabled",
        "disable",
        "off",
        "closed"
    ];

    if (enabledValues.includes(normalizedValue)) {
        element.textContent = "Aktif";
        element.style.color = "#4ade80";

        return;
    }

    if (disabledValues.includes(normalizedValue)) {
        element.textContent = "Pasif";
        element.style.color = "#fb7185";

        return;
    }

    if (value === undefined || value === null || value === "") {
        element.textContent = "Bilinmiyor";
        element.style.color = "#fbbf24";

        return;
    }

    element.textContent = String(value);
    element.style.color = "#f8fafc";
}

/* =========================================================
   ALARM DURUMU
========================================================= */

function normalizeAlarms(alarmData) {
    if (Array.isArray(alarmData)) {
        return alarmData.filter(alarm => {
            return alarm !== null &&
                alarm !== undefined &&
                String(alarm).trim() !== "";
        });
    }

    if (
        alarmData === null ||
        alarmData === undefined ||
        alarmData === ""
    ) {
        return [];
    }

    return [alarmData];
}

function updateAlarm(alarmData) {
    const alarmElement = getElement("alarm");

    if (!alarmElement) {
        return;
    }

    const alarms = normalizeAlarms(alarmData);

    if (alarms.length === 0) {
        alarmElement.className = "alarmStatus";

        alarmElement.style.background = "#14361d";
        alarmElement.style.color = "#86efac";

        alarmElement.innerHTML = `
            <i class="fa-solid fa-circle-check"></i>
            <span>Alarm Yok</span>
        `;

        return;
    }

    const alarmList = alarms
        .map(alarm => `<div>${escapeHtml(alarm)}</div>`)
        .join("");

    alarmElement.className = "alarmStatus";

    alarmElement.style.background = "#3d1818";
    alarmElement.style.color = "#fca5a5";
    alarmElement.style.flexDirection = "column";
    alarmElement.style.alignItems = "flex-start";
    alarmElement.style.padding = "20px";

    alarmElement.innerHTML = `
        <div>
            <i class="fa-solid fa-triangle-exclamation"></i>
            <strong>${alarms.length} aktif alarm</strong>
        </div>

        <div>
            ${alarmList}
        </div>
    `;
}

/* =========================================================
   API VERİSİNİ SAYFAYA AKTAR
========================================================= */

function updateDashboard(data) {
    const systemStatus = data?.sysStatus || {};
    const voltageData = data?.v || {};
    const temperatureData = data?.t || {};

    const cells = Array.isArray(voltageData.v)
        ? voltageData.v
        : [];

    const soc = toNumber(systemStatus.soc);
    const soh = toNumber(systemStatus.soh);
    const totalVoltage = toNumber(voltageData.totalV);
    const totalCurrent = toNumber(voltageData.totalC);
    const averageTemperature = toNumber(temperatureData.avg_t);

    setText(
        "deviceName",
        data?.deviceName || "BMS cihazı"
    );

    setText(
        "soc",
        `${formatNumber(soc, 0)} %`
    );

    setText(
        "soh",
        `${formatNumber(soh, 0)} %`
    );

    setText(
        "volt",
        `${formatNumber(totalVoltage, 2)} V`
    );

    setText(
        "current",
        `${formatNumber(totalCurrent, 2)} A`
    );

    setText(
        "temp",
        `${formatNumber(averageTemperature, 1)} °C`
    );

    setText(
        "cells",
        voltageData.total || cells.length
    );

    setText(
        "time",
        data?.deviceTime || new Date().toLocaleString("tr-TR")
    );

    updateBatteryLevel(soc);
    updateOperationState(data?.state, totalCurrent);
    updateSummary(data, cells);
    updateAlarm(data?.alarm);
    updateVoltageChart(cells);
    updateHeatmap(cells);
}

/* =========================================================
   VERİYİ YÜKLE
========================================================= */

async function load() {
    if (isLoading) {
        return;
    }

    isLoading = true;

    try {
        const response = await fetch(API, {
            method: "GET",
            cache: "no-store",

            headers: {
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(
                `API isteği başarısız: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        if (!data || typeof data !== "object") {
            throw new Error("API geçerli bir JSON nesnesi döndürmedi.");
        }

        updateConnection(true);
        updateDashboard(data);
    } catch (error) {
        console.error("BMS verisi yüklenemedi:", error);

        updateConnection(false);

        const time = new Date().toLocaleString("tr-TR");

        setText("time", `Bağlantı hatası • ${time}`);
    } finally {
        isLoading = false;
    }
}

/* =========================================================
   BAŞLAT
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    createVoltageChart();
    load();

    window.setInterval(load, REFRESH_INTERVAL);
});
