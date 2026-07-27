const API_BASE = "https://yjtkj-xcx.ievcloud.com/online/realtime/data/";
const API_SUFFIX = "?language=en_us";
const OVERVIEW_REFRESH_MS = 10000;
const DETAIL_REFRESH_MS = 5000;
const HISTORY_STORAGE_KEY = "cilekLithiumMeasurementHistoryV1";
const ALARM_STORAGE_KEY = "cilekLithiumAlarmHistoryV1";
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_SAMPLE_MS = 60 * 1000;

const BATTERIES = [
    { id: "30504B45530333301506174061230201", name: "Karton Depo Forklift" },
    { id: "39354D451B013130100C173803140403", name: "Sevkiyat 8 Nolu Transpalet" },
    { id: "35374D45231739391C071843781D250E", name: "Sevkiyat 7 Nolu Transpalet" },
    { id: "35374D451C1739391C07183671311E0E", name: "Sevkiyat 9 Nolu Transpalet" },
    { id: "35374D45560F39391C071847A1113207", name: "Sevkiyat 6 Nolu Transpalet" }
];

const state = {
    selectedBatteryId: null,
    records: new Map(),
    overviewLoading: false,
    detailLoading: false,
    chart: null,
    overviewTimer: null,
    detailTimer: null,
    liveHistory: new Map(),
    liveCharts: {},
    historyCharts: {},
    historyRangeHours: 24,
    measurementHistory: {},
    alarmHistory: [],
    lastAlarmSignatures: new Map()
};

const $ = id => document.getElementById(id);
const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const format = (value, digits = 1) => number(value).toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
});
const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const clock = (date = new Date()) => date.toLocaleTimeString("tr-TR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
});

function apiUrl(id) {
    return `${API_BASE}${encodeURIComponent(id)}${API_SUFFIX}`;
}

function normalizeAlarms(value) {
    if (Array.isArray(value)) {
        return value.filter(item => item !== null && item !== undefined && String(item).trim());
    }
    return value === null || value === undefined || value === "" ? [] : [value];
}

function getTemperature(data) {
    const source = data?.t || {};
    const direct = [source.avg_t, source.avgT, source.average, source.temp, source.t]
        .map(Number)
        .find(Number.isFinite);

    if (Number.isFinite(direct)) return direct;

    const values = Object.values(source)
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(Number)
        .filter(Number.isFinite);

    return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
}

function normalizeOperationMode(apiState, current) {
    const raw = String(apiState ?? "").trim();
    const value = raw.toLowerCase();

    // "discharge" kelimesi "charge" içerdiği için önce deşarj kontrol edilir.
    if (
        value.includes("discharg") ||
        value.includes("deşarj") ||
        value.includes("dis charge")
    ) {
        return "Deşarj";
    }

    if (
        value.includes("charg") ||
        value.includes("şarj")
    ) {
        return "Şarj";
    }

    if (
        value.includes("idle") ||
        value.includes("standby") ||
        value.includes("rest") ||
        value.includes("bekle")
    ) {
        return "Beklemede";
    }

    // API açık bir durum vermiyorsa akımdan yalnızca yedek tahmin yapılır.
    const currentValue = number(current);

    if (currentValue > 0.1) return "Şarj";
    if (currentValue < -0.1) return "Deşarj";
    return "Beklemede";
}

function parseBattery(battery, data) {
    const system = data?.sysStatus || {};
    const voltage = data?.v || {};
    const cellsMv = Array.isArray(voltage.v) ? voltage.v.map(item => number(item)) : [];
    const cellsV = cellsMv.map(item => item / 1000);
    const totalVoltage = number(voltage.totalV);
    const current = number(voltage.totalC);
    const soc = number(system.soc);
    const soh = number(system.soh);
    const temperature = getTemperature(data);
    const alarms = normalizeAlarms(data?.alarm);
    const maxV = cellsV.length ? Math.max(...cellsV) : 0;
    const minV = cellsV.length ? Math.min(...cellsV) : 0;
    const maxIndex = cellsV.length ? cellsV.indexOf(maxV) + 1 : 0;
    const minIndex = cellsV.length ? cellsV.indexOf(minV) + 1 : 0;
    const averageCell = cellsV.length ? cellsV.reduce((a, b) => a + b, 0) / cellsV.length : 0;
    const deltaMv = cellsV.length ? Math.round((maxV - minV) * 1000) : 0;
    const powerKw = totalVoltage * current / 1000;
    const mode = normalizeOperationMode(data?.state, current);

    return {
        ...battery,
        online: true,
        raw: data,
        deviceName: data?.deviceName || battery.name,
        deviceTime: data?.deviceTime || clock(),
        soc, soh, totalVoltage, current, temperature, alarms,
        cellsV, cellCount: number(voltage.total, cellsV.length) || cellsV.length,
        maxV, minV, maxIndex, minIndex, averageCell, deltaMv, powerKw, mode,
        fetchedAt: new Date()
    };
}

function offlineRecord(battery, error) {
    return {
        ...battery, online: false, error: error?.message || "Bağlantı kurulamadı",
        soc: 0, soh: 0, totalVoltage: 0, current: 0, temperature: 0,
        alarms: [], cellsV: [], cellCount: 0, maxV: 0, minV: 0,
        maxIndex: 0, minIndex: 0, averageCell: 0, deltaMv: 0, powerKw: 0,
        mode: "Offline", fetchedAt: new Date()
    };
}

async function fetchBattery(battery) {
    const response = await fetch(apiUrl(battery.id), {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    if (!text.trim()) throw new Error("API boş cevap döndürdü");

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("API cevabı JSON değil");
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Geçersiz API cevabı");
    }

    return parseBattery(battery, data);
}

function statusClass(record) {
    if (!record?.online) return "offline";
    if (record.alarms.length) return "alarm";
    return "online";
}

function statusLabel(record) {
    if (!record?.online) return "OFFLINE";
    if (record.alarms.length) return "ALARM";
    return "ONLINE";
}


function readJsonStorage(key, fallback) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key));
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn("Yerel depolama yazılamadı:", error);
    }
}

function loadPersistentData() {
    state.measurementHistory = readJsonStorage(HISTORY_STORAGE_KEY, {});
    state.alarmHistory = readJsonStorage(ALARM_STORAGE_KEY, []);
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;

    Object.keys(state.measurementHistory).forEach(id => {
        const list = Array.isArray(state.measurementHistory[id]) ? state.measurementHistory[id] : [];
        state.measurementHistory[id] = list.filter(point => number(point.timestamp) >= cutoff);
    });
    state.alarmHistory = state.alarmHistory.filter(event => number(event.timestamp) >= cutoff);
}

function saveMeasurement(record) {
    if (!record?.online) return;

    const list = state.measurementHistory[record.id] || [];
    const last = list.at(-1);
    const now = record.fetchedAt.getTime();

    if (last && now - number(last.timestamp) < HISTORY_SAMPLE_MS) return;

    list.push({
        timestamp: now,
        soc: record.soc,
        voltage: record.totalVoltage,
        current: record.current,
        temperature: record.temperature,
        mode: record.mode,
        alarms: record.alarms.length
    });

    const cutoff = now - MAX_HISTORY_AGE_MS;
    state.measurementHistory[record.id] = list.filter(point => point.timestamp >= cutoff);
    writeJsonStorage(HISTORY_STORAGE_KEY, state.measurementHistory);
}

function trackAlarmEvents(record) {
    const signature = record.online
        ? record.alarms.map(String).sort().join("|")
        : "__OFFLINE__";

    const previous = state.lastAlarmSignatures.get(record.id);
    state.lastAlarmSignatures.set(record.id, signature);

    if (previous === undefined || previous === signature) return;
    if (!signature) return;

    const messages = record.online ? record.alarms : ["Akü bağlantısı kesildi"];
    messages.forEach(message => {
        state.alarmHistory.unshift({
            timestamp: Date.now(),
            batteryId: record.id,
            batteryName: record.name,
            message: String(message),
            kind: record.online ? "alarm" : "offline"
        });
    });

    state.alarmHistory = state.alarmHistory.slice(0, 500);
    writeJsonStorage(ALARM_STORAGE_KEY, state.alarmHistory);
}

function measurementPoints(id, hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return (state.measurementHistory[id] || []).filter(point => point.timestamp >= cutoff);
}

function observedStats(id) {
    const points = state.measurementHistory[id] || [];
    if (!points.length) return {
        count: 0, averageSoc: 0, maxTemperature: 0, operatingHours: 0, cycles: 0
    };

    const averageSoc = points.reduce((sum, p) => sum + number(p.soc), 0) / points.length;
    const maxTemperature = Math.max(...points.map(p => number(p.temperature)));
    let operatingMs = 0;
    let socThroughput = 0;

    for (let i = 1; i < points.length; i++) {
        const deltaTime = Math.min(
            number(points[i].timestamp) - number(points[i - 1].timestamp),
            HISTORY_SAMPLE_MS * 3
        );
        if (Math.abs(number(points[i - 1].current)) > .1) operatingMs += Math.max(0, deltaTime);
        socThroughput += Math.abs(number(points[i].soc) - number(points[i - 1].soc));
    }

    return {
        count: points.length,
        averageSoc,
        maxTemperature,
        operatingHours: operatingMs / 3600000,
        cycles: socThroughput / 200
    };
}

function formatDuration(hours) {
    if (hours < 1) return `${Math.round(hours * 60)} dk`;
    return `${format(hours, 1)} sa`;
}

function buildNavigation() {
    $("batteryNavItems").innerHTML = BATTERIES.map(battery => `
        <button class="navItem" type="button" data-battery-id="${battery.id}">
            <i class="fa-solid fa-car-battery"></i>
            <span>${escapeHtml(battery.name)}</span>
            <i id="nav-status-${battery.id}" class="navStatus"></i>
        </button>
    `).join("");
}

function batteryCard(record) {
    const loading = !record;
    const data = record || {
        name: "Yükleniyor", id: "", online: false, soc: 0, totalVoltage: 0,
        current: 0, temperature: 0, powerKw: 0, alarms: [], deltaMv: 0,
        mode: "Veri bekleniyor", fetchedAt: new Date()
    };
    const cardClass = loading ? "" : statusClass(data);
    const degree = Math.max(0, Math.min(100, data.soc)) * 3.6;

    return `
        <article class="batteryCard ${cardClass}" data-battery-id="${data.id}">
            <div class="cardTop">
                <div class="cardTitle">
                    <h2>${escapeHtml(data.name)}</h2>
                    <p>${escapeHtml(data.id)}</p>
                </div>
                <span class="statusBadge ${cardClass}">
                    <i class="fa-solid fa-circle"></i>
                    ${loading ? "YÜKLENİYOR" : statusLabel(data)}
                </span>
            </div>

            <div class="cardSocRow">
                <div class="circularSoc" style="--soc:${degree}deg">
                    <div><strong>${format(data.soc, 1)}%</strong><small>SOC</small></div>
                </div>
                <div class="cardMainStatus">
                    <span>ÇALIŞMA DURUMU</span>
                    <strong>${escapeHtml(data.mode)}</strong>
                    <small>${data.alarms.length ? `${data.alarms.length} aktif alarm` : "Alarm yok"}</small>
                </div>
            </div>

            <div class="cardStats">
                <div class="cardStat"><span>Voltaj</span><strong>${format(data.totalVoltage, 2)} V</strong></div>
                <div class="cardStat"><span>Akım</span><strong>${format(data.current, 2)} A</strong></div>
                <div class="cardStat"><span>Sıcaklık</span><strong>${format(data.temperature, 1)} °C</strong></div>
                <div class="cardStat"><span>Hücre Farkı</span><strong>${data.deltaMv} mV</strong></div>
            </div>

            <div class="cardFooter">
                <span>${loading ? "Veri bekleniyor" : `${format(data.powerKw, 2)} kW • ${clock(data.fetchedAt)}`}</span>
                <span class="openDetail">Detayı Aç <i class="fa-solid fa-arrow-right"></i></span>
            </div>
            ${loading ? '<div class="cardLoading"><i class="fa-solid fa-spinner fa-spin"></i></div>' : ""}
        </article>
    `;
}

function renderOverviewCards() {
    $("batteryCards").innerHTML = BATTERIES.map(battery =>
        batteryCard(state.records.get(battery.id))
    ).join("");
}

function updateFleetSummary() {
    const records = BATTERIES.map(b => state.records.get(b.id)).filter(Boolean);
    const online = records.filter(r => r.online).length;
    const alarm = records.filter(r => r.online && r.alarms.length).length;
    const totalPower = records.filter(r => r.online).reduce((sum, r) => sum + Math.abs(r.powerKw), 0);

    $("fleetTotal").textContent = BATTERIES.length;
    $("fleetOnline").textContent = online;
    $("fleetOffline").textContent = BATTERIES.length - online;
    $("fleetAlarm").textContent = alarm;
    $("fleetPower").textContent = `${format(totalPower, 2)} kW`;

    const global = $("globalConnection");
    global.className = `connectionPill ${online ? "online" : "offline"}`;
    global.querySelector("span").textContent = online
        ? `${online}/${BATTERIES.length} AKÜ ONLINE`
        : "TÜM AKÜLER OFFLINE";

    BATTERIES.forEach(battery => {
        const record = state.records.get(battery.id);
        const dot = $(`nav-status-${battery.id}`);
        if (dot) dot.className = `navStatus ${record ? statusClass(record) : ""}`;
    });
}

async function loadOverview() {
    if (state.overviewLoading) return;
    state.overviewLoading = true;
    $("refreshButton").querySelector("i").classList.add("fa-spin");

    try {
        const results = await Promise.allSettled(BATTERIES.map(fetchBattery));
        results.forEach((result, index) => {
            const battery = BATTERIES[index];
            state.records.set(
                battery.id,
                result.status === "fulfilled" ? result.value : offlineRecord(battery, result.reason)
            );
        });

        state.records.forEach(record => {
            saveMeasurement(record);
            trackAlarmEvents(record);
        });
        renderOverviewCards();
        updateFleetSummary();
        renderAlarmNavCount();
        const now = new Date();
        $("overviewUpdateTime").textContent = `Son güncelleme: ${now.toLocaleString("tr-TR")}`;
        $("sidebarUpdateTime").textContent = clock(now);
    } finally {
        state.overviewLoading = false;
        $("refreshButton").querySelector("i").classList.remove("fa-spin");
    }
}

function setActiveNavigation(route, batteryId = null) {
    document.querySelectorAll(".navItem").forEach(item => item.classList.remove("active"));
    const selected = route === "overview"
        ? document.querySelector('[data-route="overview"]')
        : route === "detail"
            ? document.querySelector(`[data-battery-id="${batteryId}"]`)
            : document.querySelector(`[data-route="${route}"]`);
    selected?.classList.add("active");
}

function closeSidebar() {
    $("sidebar").classList.remove("open");
    $("sidebarBackdrop").classList.remove("active");
}


function hideAllPages() {
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    clearInterval(state.detailTimer);
    state.detailTimer = null;
}

function showStandardPage(pageId, route, updateUrl = true) {
    state.selectedBatteryId = null;
    hideAllPages();
    $(pageId).classList.add("active");
    setActiveNavigation(route);
    if (updateUrl) history.replaceState({}, "", `${location.pathname}?page=${route}`);
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showAlarmCenter(updateUrl = true) {
    showStandardPage("alarmPage", "alarms", updateUrl);
    renderAlarmCenter();
}

function showHistoryPage(updateUrl = true) {
    showStandardPage("historyPage", "history", updateUrl);
    renderHistoryPage();
}

function showStatisticsPage(updateUrl = true) {
    showStandardPage("statisticsPage", "statistics", updateUrl);
    renderStatisticsPage();
}

function showOverview(updateUrl = true) {
    state.selectedBatteryId = null;
    hideAllPages();
    $("overviewPage").classList.add("active");
    setActiveNavigation("overview");
    if (updateUrl) history.replaceState({}, "", location.pathname);
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function showDetail(id, updateUrl = true) {
    const battery = BATTERIES.find(item => item.id === id);
    if (!battery) return;

    state.selectedBatteryId = id;
    hideAllPages();
    $("detailPage").classList.add("active");
    setActiveNavigation("detail", id);
    $("detailBatteryName").textContent = battery.name;
    $("detailDeviceId").textContent = battery.id;
    if (updateUrl) history.replaceState({}, "", `${location.pathname}?battery=${encodeURIComponent(id)}`);
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });

    const cached = state.records.get(id);
    if (cached) renderDetail(cached);

    await loadSelectedBattery();
    clearInterval(state.detailTimer);
    state.detailTimer = setInterval(loadSelectedBattery, DETAIL_REFRESH_MS);
}

function setDetailConnection(record) {
    const pill = $("detailConnection");
    pill.className = `connectionPill ${record.online ? "online" : "offline"}`;
    pill.querySelector("span").textContent = record.online ? "ONLINE" : "OFFLINE";
    $("detailCommunication").textContent = record.online ? "Aktif" : "Kesildi";
}

function renderState(record) {
    const badge = $("detailStateBadge");
    const isCharge = record.mode === "Şarj";
    const isDischarge = record.mode === "Deşarj";
    badge.className = `stateBadge ${isCharge ? "charging" : isDischarge ? "discharging" : "idle"}`;
    badge.innerHTML = `<i class="fa-solid ${isCharge ? "fa-arrow-down" : isDischarge ? "fa-arrow-up" : "fa-pause"}"></i><span>${record.mode}</span>`;
    $("detailMode").textContent = record.mode;
}

function renderHeatmap(record) {
    const holder = $("cellHeatmap");
    if (!record.cellsV.length) {
        holder.innerHTML = '<div class="emptyState">Hücre verisi bulunamadı.</div>';
        return;
    }

    holder.innerHTML = record.cellsV.map((voltage, index) => {
        const diff = Math.round((voltage - record.minV) * 1000);
        const cls = diff <= 10 ? "good" : diff <= 20 ? "warning" : "danger";
        return `<div class="cellTile ${cls}" title="Minimum hücreye fark: ${diff} mV">
            <span>Hücre ${index + 1}</span>
            <strong>${format(voltage, 3)} V</strong>
        </div>`;
    }).join("");
}


function getLiveHistory(batteryId) {
    if (!state.liveHistory.has(batteryId)) {
        state.liveHistory.set(batteryId, []);
    }
    return state.liveHistory.get(batteryId);
}

function appendLivePoint(record) {
    if (!record?.online) return;

    const history = getLiveHistory(record.id);
    const last = history.at(-1);

    // Aynı veri paketi iki kez çizilmesin.
    if (last && last.timestamp === record.fetchedAt.getTime()) return;

    history.push({
        timestamp: record.fetchedAt.getTime(),
        label: clock(record.fetchedAt),
        voltage: record.totalVoltage,
        current: record.current,
        soc: record.soc,
        temperature: record.temperature
    });

    // 5 saniyelik örnekleme ile yaklaşık son 10 dakika.
    if (history.length > 120) history.splice(0, history.length - 120);
}

function makeLiveChart(canvasId, label, suffix) {
    if (typeof Chart === "undefined") return null;
    const canvas = $(canvasId);
    if (!canvas) return null;

    return new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label,
                data: [],
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.28,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { intersect: false, mode: "index" },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `${format(context.raw, 2)} ${suffix}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#8da2b8", maxTicksLimit: 6 },
                    grid: { display: false }
                },
                y: {
                    ticks: {
                        color: "#8da2b8",
                        callback: value => `${Number(value).toLocaleString("tr-TR")} ${suffix}`
                    },
                    grid: { color: "rgba(141,162,184,.12)" }
                }
            }
        }
    });
}

function ensureLiveCharts() {
    if (state.liveCharts.voltage || typeof Chart === "undefined") return;

    state.liveCharts.voltage = makeLiveChart("liveVoltageChart", "Toplam Voltaj", "V");
    state.liveCharts.current = makeLiveChart("liveCurrentChart", "Akım", "A");
    state.liveCharts.soc = makeLiveChart("liveSocChart", "SOC", "%");
    state.liveCharts.temperature = makeLiveChart("liveTemperatureChart", "Sıcaklık", "°C");
}

function renderLiveCharts(record) {
    ensureLiveCharts();
    const history = getLiveHistory(record.id);
    const labels = history.map(point => point.label);

    const mappings = [
        ["voltage", "voltage"],
        ["current", "current"],
        ["soc", "soc"],
        ["temperature", "temperature"]
    ];

    mappings.forEach(([chartKey, dataKey]) => {
        const chart = state.liveCharts[chartKey];
        if (!chart) return;
        chart.data.labels = labels;
        chart.data.datasets[0].data = history.map(point => point[dataKey]);
        chart.update("none");
    });

    $("liveVoltageValue").textContent = `${format(record.totalVoltage, 2)} V`;
    $("liveCurrentValue").textContent = `${format(record.current, 2)} A`;
    $("liveSocValue").textContent = `${format(record.soc, 1)}%`;
    $("liveTemperatureValue").textContent = `${format(record.temperature, 1)} °C`;
}

function clearSelectedLiveHistory() {
    if (!state.selectedBatteryId) return;
    state.liveHistory.set(state.selectedBatteryId, []);
    const record = state.records.get(state.selectedBatteryId);
    if (record) renderLiveCharts(record);
}

function createChart() {
    if (state.chart || typeof Chart === "undefined") return;
    const canvas = $("cellVoltageChart");
    state.chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: [], datasets: [{
            label: "Hücre Voltajı",
            data: [],
            borderWidth: 1,
            borderRadius: 5
        }]},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${format(ctx.raw, 3)} V` } }
            },
            scales: {
                x: {
                    ticks: { color: "#8da2b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 24 },
                    grid: { display: false },
                    title: { display: true, text: "Hücre Numarası", color: "#8da2b8" }
                },
                y: {
                    ticks: { color: "#8da2b8", callback: value => `${Number(value).toFixed(3)} V` },
                    grid: { color: "rgba(141,162,184,.12)" }
                }
            }
        }
    });
}

function renderChart(record) {
    createChart();
    const fallback = $("chartFallback");

    if (!record.cellsV.length || !state.chart) {
        fallback.classList.remove("hidden");
        return;
    }

    fallback.classList.add("hidden");
    const max = record.maxV;
    const min = record.minV;
    const padding = Math.max(.015, (max - min) * 1.5);

    state.chart.data.labels = record.cellsV.map((_, index) => String(index + 1));
    state.chart.data.datasets[0].data = record.cellsV;
    state.chart.data.datasets[0].backgroundColor = record.cellsV.map(value =>
        value === max ? "#35e07b" : value === min ? "#ff5d73" : "#2687ff"
    );
    state.chart.data.datasets[0].borderColor = record.cellsV.map(value =>
        value === max ? "#8fffb9" : value === min ? "#ff9bac" : "#75aaff"
    );
    state.chart.options.scales.y.min = Math.floor((min - padding) * 1000) / 1000;
    state.chart.options.scales.y.max = Math.ceil((max + padding) * 1000) / 1000;
    state.chart.update("none");
}

function renderAlarm(record) {
    const box = $("detailAlarm");
    if (!record.alarms.length) {
        box.className = "alarmBox good";
        box.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Alarm Yok</span>';
        return;
    }

    box.className = "alarmBox danger";
    box.innerHTML = `<div><i class="fa-solid fa-triangle-exclamation"></i> <strong>${record.alarms.length} aktif alarm</strong></div>
        ${record.alarms.map(alarm => `<div>${escapeHtml(alarm)}</div>`).join("")}`;
}

function renderDetail(record) {
    $("detailBatteryName").textContent = record.name;
    $("detailDeviceId").textContent = record.id;
    setDetailConnection(record);
    renderState(record);

    const soc = Math.max(0, Math.min(100, record.soc));
    $("detailBatteryLevel").style.width = `${soc}%`;
    $("detailSocLarge").textContent = `${format(soc, 1)}%`;
    $("detailSoc").textContent = `${format(record.soc, 1)}%`;
    $("detailSoh").textContent = `${format(record.soh, 0)}%`;
    $("detailVoltage").textContent = `${format(record.totalVoltage, 2)} V`;
    $("detailCurrent").textContent = `${format(record.current, 2)} A`;
    $("detailPower").textContent = `${format(record.powerKw, 2)} kW`;
    $("detailTemperature").textContent = `${format(record.temperature, 1)} °C`;
    $("detailCellCount").textContent = record.cellCount;
    $("detailMaxCell").textContent = record.cellsV.length ? `Hücre ${record.maxIndex} • ${format(record.maxV, 3)} V` : "-";
    $("detailMinCell").textContent = record.cellsV.length ? `Hücre ${record.minIndex} • ${format(record.minV, 3)} V` : "-";
    $("detailDelta").textContent = record.cellsV.length ? `${record.deltaMv} mV` : "-";
    $("detailAverageCell").textContent = record.cellsV.length ? `${format(record.averageCell, 3)} V` : "-";
    $("detailThermal").textContent = !record.online ? "Bilinmiyor" : record.temperature >= 55 ? "Kritik" : record.temperature >= 45 ? "Yüksek" : "Normal";
    $("detailLastPacket").textContent = record.online ? clock(record.fetchedAt) : "-";

    renderLiveCharts(record);
    renderHeatmap(record);
    renderChart(record);
    renderAlarm(record);
}

async function loadSelectedBattery() {
    if (!state.selectedBatteryId || state.detailLoading) return;
    const battery = BATTERIES.find(item => item.id === state.selectedBatteryId);
    if (!battery) return;

    state.detailLoading = true;
    try {
        const record = await fetchBattery(battery);
        state.records.set(battery.id, record);
        appendLivePoint(record);
        saveMeasurement(record);
        trackAlarmEvents(record);
        renderDetail(record);
        renderAlarmNavCount();
    } catch (error) {
        const record = offlineRecord(battery, error);
        state.records.set(battery.id, record);
        renderDetail(record);
    } finally {
        updateFleetSummary();
        state.detailLoading = false;
    }
}


function renderAlarmNavCount() {
    const active = [...state.records.values()].reduce((sum, record) =>
        sum + (record.online ? record.alarms.length : 1), 0);
    $("alarmNavCount").textContent = active;
}

function emptyList(text) {
    return `<div class="emptyState">${escapeHtml(text)}</div>`;
}

function renderAlarmCenter() {
    const records = BATTERIES.map(b => state.records.get(b.id)).filter(Boolean);
    const activeItems = [];

    records.forEach(record => {
        if (!record.online) {
            activeItems.push({ record, message: "Akü bağlantısı kesildi", kind: "offline" });
        } else {
            record.alarms.forEach(message => activeItems.push({ record, message, kind: "alarm" }));
        }
    });

    $("alarmActiveTotal").textContent = records.reduce((sum, r) => sum + r.alarms.length, 0);
    $("alarmOfflineTotal").textContent = BATTERIES.length - records.filter(r => r.online).length;
    $("alarmEventTotal").textContent = state.alarmHistory.length;

    $("activeAlarmList").innerHTML = activeItems.length ? activeItems.map(item => `
        <div class="dataRow ${item.kind === "alarm" ? "danger" : "offline"}">
            <div><h3>${escapeHtml(item.record.name)}</h3><p>${escapeHtml(item.record.id)}</p></div>
            <div class="alarmMessage">${escapeHtml(item.message)}</div>
            <time>${clock(item.record.fetchedAt)}</time>
        </div>
    `).join("") : emptyList("Aktif alarm veya offline akü yok.");

    $("alarmHistoryList").innerHTML = state.alarmHistory.length ? state.alarmHistory.slice(0, 100).map(event => `
        <div class="dataRow ${event.kind === "alarm" ? "danger" : "offline"}">
            <div><h3>${escapeHtml(event.batteryName)}</h3><p>${escapeHtml(event.batteryId)}</p></div>
            <div class="alarmMessage">${escapeHtml(event.message)}</div>
            <time>${new Date(event.timestamp).toLocaleString("tr-TR")}</time>
        </div>
    `).join("") : emptyList("Henüz kaydedilmiş alarm olayı yok.");
}

function makeHistoryChart(canvasId, label, suffix) {
    if (typeof Chart === "undefined") return null;
    return new Chart($(canvasId).getContext("2d"), {
        type: "line",
        data: { labels: [], datasets: [{
            label, data: [], borderWidth: 2, pointRadius: 0, tension: .25, fill: false
        }]},
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { intersect: false, mode: "index" },
            plugins: { legend: { display: false }, tooltip: {
                callbacks: { label: ctx => `${format(ctx.raw, 2)} ${suffix}` }
            }},
            scales: {
                x: { ticks: { color: "#8da2b8", maxTicksLimit: 7 }, grid: { display: false } },
                y: { ticks: { color: "#8da2b8" }, grid: { color: "rgba(141,162,184,.12)" } }
            }
        }
    });
}

function ensureHistoryCharts() {
    if (state.historyCharts.voltage || typeof Chart === "undefined") return;
    state.historyCharts.voltage = makeHistoryChart("historyVoltageChart", "Voltaj", "V");
    state.historyCharts.current = makeHistoryChart("historyCurrentChart", "Akım", "A");
    state.historyCharts.soc = makeHistoryChart("historySocChart", "SOC", "%");
    state.historyCharts.temperature = makeHistoryChart("historyTemperatureChart", "Sıcaklık", "°C");
}

function renderHistoryPage() {
    const select = $("historyBatterySelect");
    if (!select.options.length) {
        select.innerHTML = BATTERIES.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
    }

    ensureHistoryCharts();
    const id = select.value || BATTERIES[0].id;
    const points = measurementPoints(id, state.historyRangeHours);
    $("historyPointCount").textContent = points.length;

    const labels = points.map(point => new Date(point.timestamp).toLocaleString("tr-TR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    }));

    [
        ["voltage", "voltage"],
        ["current", "current"],
        ["soc", "soc"],
        ["temperature", "temperature"]
    ].forEach(([chartKey, dataKey]) => {
        const chart = state.historyCharts[chartKey];
        if (!chart) return;
        chart.data.labels = labels;
        chart.data.datasets[0].data = points.map(point => number(point[dataKey]));
        chart.update("none");
    });
}

function renderStatisticsPage() {
    const allStats = BATTERIES.map(battery => ({ battery, stats: observedStats(battery.id) }));
    const populated = allStats.filter(item => item.stats.count);
    const totalRecords = allStats.reduce((sum, item) => sum + item.stats.count, 0);
    const totalOperating = allStats.reduce((sum, item) => sum + item.stats.operatingHours, 0);
    const totalCycles = allStats.reduce((sum, item) => sum + item.stats.cycles, 0);
    const fleetAverageSoc = populated.length
        ? populated.reduce((sum, item) => sum + item.stats.averageSoc, 0) / populated.length : 0;

    $("statisticsCards").innerHTML = `
        <article class="statisticsCard"><span>Toplam Kayıt</span><strong>${totalRecords}</strong></article>
        <article class="statisticsCard"><span>Filo Ortalama SOC</span><strong>${format(fleetAverageSoc, 1)}%</strong></article>
        <article class="statisticsCard"><span>Gözlenen Çalışma</span><strong>${formatDuration(totalOperating)}</strong></article>
        <article class="statisticsCard"><span>Gözlenen Çevrim</span><strong>${format(totalCycles, 2)}</strong></article>
    `;

    $("statisticsTableBody").innerHTML = allStats.map(({ battery, stats }) => `
        <tr>
            <td><strong>${escapeHtml(battery.name)}</strong></td>
            <td>${stats.count ? `${format(stats.averageSoc, 1)}%` : "-"}</td>
            <td>${stats.count ? `${format(stats.maxTemperature, 1)} °C` : "-"}</td>
            <td>${stats.count ? formatDuration(stats.operatingHours) : "-"}</td>
            <td>${stats.count ? format(stats.cycles, 2) : "-"}</td>
            <td>${stats.count}</td>
        </tr>
    `).join("");
}

function clearAlarmHistory() {
    state.alarmHistory = [];
    writeJsonStorage(ALARM_STORAGE_KEY, []);
    renderAlarmCenter();
}

function clearMeasurementHistory() {
    state.measurementHistory = {};
    writeJsonStorage(HISTORY_STORAGE_KEY, {});
    renderHistoryPage();
    renderStatisticsPage();
}

function bindEvents() {
    document.addEventListener("click", event => {
        const batteryTarget = event.target.closest("[data-battery-id]");
        if (batteryTarget) showDetail(batteryTarget.dataset.batteryId);

        const routeTarget = event.target.closest("[data-route]");
        if (routeTarget) {
            const route = routeTarget.dataset.route;
            if (route === "overview") showOverview();
            if (route === "alarms") showAlarmCenter();
            if (route === "history") showHistoryPage();
            if (route === "statistics") showStatisticsPage();
        }
    });

    $("backToOverview").addEventListener("click", () => showOverview());
    $("brandHome").addEventListener("click", () => showOverview());
    $("refreshButton").addEventListener("click", async () => {
        if (state.selectedBatteryId) {
            await loadSelectedBattery();
        } else {
            await loadOverview();
        }
    });
    $("menuToggle").addEventListener("click", () => {
        $("sidebar").classList.add("open");
        $("sidebarBackdrop").classList.add("active");
    });
    $("sidebarClose").addEventListener("click", closeSidebar);
    $("sidebarBackdrop").addEventListener("click", closeSidebar);
    $("clearLiveCharts").addEventListener("click", clearSelectedLiveHistory);
    $("clearAlarmHistory").addEventListener("click", clearAlarmHistory);
    $("clearMeasurementHistory").addEventListener("click", clearMeasurementHistory);
    $("historyBatterySelect").addEventListener("change", renderHistoryPage);
    document.querySelectorAll(".rangeButton").forEach(button => button.addEventListener("click", () => {
        document.querySelectorAll(".rangeButton").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        state.historyRangeHours = number(button.dataset.rangeHours, 24);
        renderHistoryPage();
    }));
}

function startClock() {
    const update = () => $("footerTime").textContent = new Date().toLocaleString("tr-TR");
    update();
    setInterval(update, 1000);
}

async function init() {
    loadPersistentData();
    buildNavigation();
    renderOverviewCards();
    bindEvents();
    startClock();

    const params = new URLSearchParams(location.search);
    const requestedId = params.get("battery");
    const requestedPage = params.get("page");

    if (requestedId && BATTERIES.some(item => item.id === requestedId)) {
        await showDetail(requestedId, false);
    } else if (requestedPage === "alarms") {
        showAlarmCenter(false);
    } else if (requestedPage === "history") {
        showHistoryPage(false);
    } else if (requestedPage === "statistics") {
        showStatisticsPage(false);
    } else {
        showOverview(false);
    }

    await loadOverview();
    clearInterval(state.overviewTimer);
    state.overviewTimer = setInterval(loadOverview, OVERVIEW_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", init);
