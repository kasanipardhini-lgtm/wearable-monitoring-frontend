const API_BASE_URL =
  "https://wearable-uv-pollution-monitoring.onrender.com";

const REFRESH_INTERVAL_MS = 2000;
const HISTORY_LIMIT = 12;

const $ = (id) => document.getElementById(id);

const historyData = [];
const charts = {};

let refreshTimer = null;
let requestInProgress = false;

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeApiData(payload) {
  const data = payload?.data ?? payload;

  return {
    temperature: numberOrNull(data?.temperature),
    humidity: numberOrNull(data?.humidity),
    uvIndex: numberOrNull(data?.uvIndex),
    pollution: numberOrNull(data?.pollution ?? data?.dust),
    pressure: numberOrNull(data?.pressure ?? data?.atmosphericPressure),
    altitude: numberOrNull(data?.altitude),
    acceleration: numberOrNull(data?.acceleration),
    alarm: data?.alarm === true,
    reason: data?.reason ?? "Unknown",
    timestamp: data?.timestamp ?? new Date().toISOString()
  };
}

function setConnection(state, message) {
  const connection = $("connection");

  if (connection) {
    connection.className = `connection ${state}`;
    const text = $("connection-text");
    if (text) text.textContent = message;
  }
}

function showValue(id, value, decimals = 0, suffix = "") {
  const element = $(id);
  if (!element) return;

  if (value === null || value === undefined) {
    element.textContent = "—";
    return;
  }

  const formatted =
    decimals > 0 ? Number(value).toFixed(decimals) : String(value);

  element.textContent = `${formatted}${suffix}`;
}

function showStatus(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

function uvRisk(uv) {
  if (uv === null) return "Unavailable";
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}

function updateGuidance(uv) {
  const title = $("guidance-title");
  const text = $("guidance-text");
  const source = $("guidance-source");

  if (!title || !text) return;

  let advice =
    "UV data is unavailable. Check a trusted local UV forecast.";

  if (uv !== null) {
    if (uv <= 2) {
      advice = "UV risk is generally low. Use sun protection during extended outdoor exposure.";
    } else if (uv <= 5) {
      advice = "Seek shade when sunlight is strong. Wear protective clothing and sunscreen.";
    } else if (uv <= 7) {
      advice = "Protection is important. Reduce midday sun exposure and use sunscreen.";
    } else {
      advice = "UV risk is very high. Minimise midday sun exposure and use strong sun protection.";
    }
  }

  title.textContent = `UV risk: ${uvRisk(uv)}`;
  text.textContent = advice;

  if (source) {
    source.textContent = "Educational guidance based on the reported UV index.";
  }
}

function renderReading(reading) {
  showValue("temperature-value", reading.temperature, 1);
  showValue("humidity-value", reading.humidity);
  showValue("uv-value", reading.uvIndex, 1);
  showValue("pollution-value", reading.pollution);
  showValue("pressure-value", reading.pressure, 1);
  showValue("altitude-value", reading.altitude, 1);

  // Actual acceleration value reported by the ESP32.
  showValue("acceleration-value", reading.acceleration, 2);

  showStatus("uv-status", uvRisk(reading.uvIndex));
  showStatus(
    "pollution-status",
    reading.pollution === null ? "Unavailable" : "Live sensor reading"
  );
  showStatus(
    "acceleration-status",
    reading.acceleration === null ? "Unavailable" : "Live ESP32 reading"
  );
  showStatus(
    "alarm-status",
    reading.alarm ? "ALARM" : reading.reason
  );

  const updated = $("last-updated");
  if (updated) {
    const date = new Date(reading.timestamp);
    updated.textContent = `Last update: ${
      Number.isNaN(date.getTime())
        ? "time unavailable"
        : date.toLocaleTimeString()
    }`;
  }

  const label = $("data-label");
  if (label) label.textContent = "Live data from ESP32 via Render API";

  updateGuidance(reading.uvIndex);

  historyData.push({
    ...reading,
    label: new Date().toLocaleTimeString()
  });

  while (historyData.length > HISTORY_LIMIT) {
    historyData.shift();
  }

  updateCharts();
}

async function refreshReadings() {
  if (requestInProgress) return;
  requestInProgress = true;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/sensor-data`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload?.success === false) {
      throw new Error("API reported an unsuccessful request");
    }

    const reading = normalizeApiData(payload);

    setConnection("connected", "Backend connected");
    renderReading(reading);
  } catch (error) {
    setConnection("disconnected", "Backend unavailable");

    const updated = $("last-updated");
    if (updated) updated.textContent = "Unable to fetch sensor data. Check the API connection.";

    console.error("Sensor API error:", error);
  } finally {
    requestInProgress = false;
  }
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { position: "bottom" }
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
      y: { beginAtZero: true }
    }
  };
}

function createChart(id, label, color) {
  const canvas = $(id);

  if (!canvas || typeof Chart === "undefined") return null;

  return new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: color,
        tension: 0.3,
        pointRadius: 2,
        spanGaps: false
      }]
    },
    options: chartOptions()
  });
}

function initCharts() {
  charts.uv = createChart("uv-chart", "UV index", "#d89c2b");
  charts.temperature = createChart(
    "temperature-chart", "Temperature (°C)", "#d66b50"
  );
  charts.humidity = createChart(
    "humidity-chart", "Humidity (%)", "#3689bd"
  );
  charts.pressure = createChart(
    "pressure-chart", "Pressure (hPa)", "#247c78"
  );
  charts.altitude = createChart(
    "altitude-chart", "Altitude (m)", "#8b6bb8"
  );
  charts.acceleration = createChart(
    "acceleration-chart", "Acceleration (m/s²)", "#d66b50"
  );
}

function updateCharts() {
  const labels = historyData.map(item => item.label);

  const values = {
    uv: historyData.map(item => item.uvIndex),
    temperature: historyData.map(item => item.temperature),
    humidity: historyData.map(item => item.humidity),
    pressure: historyData.map(item => item.pressure),
    altitude: historyData.map(item => item.altitude),
    acceleration: historyData.map(item => item.acceleration)
  };

  for (const [name, chart] of Object.entries(charts)) {
    if (!chart) continue;

    chart.data.labels = labels;
    chart.data.datasets[0].data = values[name];
    chart.update("none");
  }
}

function startAutoRefresh() {
  if (refreshTimer !== null) clearInterval(refreshTimer);

  refreshReadings();
  refreshTimer = setInterval(refreshReadings, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", () => {
  initCharts();

  const skinType = $("skin-type");
  if (skinType) {
    skinType.addEventListener("change", () => {
      const latest = historyData[historyData.length - 1];
      updateGuidance(latest ? latest.uvIndex : null);
    });
  }

  startAutoRefresh();
});
