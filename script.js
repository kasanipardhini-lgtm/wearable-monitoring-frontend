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

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeApiData(payload) {
  const d = payload?.data ?? payload;

  return {
    temperature: numberOrNull(d?.temperature),
    humidity: numberOrNull(d?.humidity),
    uvIndex: numberOrNull(d?.uvIndex),
    pollution: numberOrNull(d?.pollution ?? d?.dust),
    pressure: numberOrNull(d?.pressure ?? d?.atmosphericPressure),
    altitude: numberOrNull(d?.altitude),
    acceleration: numberOrNull(d?.acceleration),
    alarm: d?.alarm === true,
    reason: d?.reason ?? "NORMAL",
    timestamp: d?.timestamp ?? null
  };
}

function setConnection(state, message) {
  const el = $("connection");
  if (el) el.className = `connection ${state}`;

  const label = $("connection-text");
  if (label) label.textContent = message;
}

function showValue(id, value, decimals = 0) {
  const el = $(id);
  if (!el) return;

  el.textContent =
    value === null || value === undefined
      ? "—"
      : decimals > 0
        ? Number(value).toFixed(decimals)
        : String(value);
}

function showStatus(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}

function uvRisk(uv) {
  if (uv === null) return "Unavailable";
  if (uv < 0) return "Invalid reading";
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}

function updateSkinCare(uv) {
  const type = $("skin-type")?.value ?? "III";
  let advice = "Waiting for a valid UV reading.";

  if (uv !== null && uv >= 0) {
    if (uv <= 2) {
      advice =
        "UV risk is generally low. For extended outdoor exposure, consider sunscreen, sunglasses and protective clothing.";
    } else if (uv <= 5) {
      advice =
        "Use sun protection. Apply broad-spectrum SPF 30+ sunscreen, wear sunglasses and protective clothing, and seek shade when sunlight is strong.";
    } else if (uv <= 7) {
      advice =
        "Protection is important. Reduce midday sun exposure, seek shade, and use broad-spectrum SPF 30+ sunscreen and protective clothing.";
    } else {
      advice =
        "UV risk is very high or extreme. Minimise midday sun exposure, seek shade, cover exposed skin and use broad-spectrum SPF 30+ sunscreen.";
    }
  }

  const typeAdvice = {
    I: "Very fair skin often burns easily.",
    II: "Fair skin commonly burns easily.",
    III: "Medium skin may sometimes burn.",
    IV: "Olive skin may burn less often, but UV damage is still possible.",
    V: "Brown skin may burn less often, but UV damage is still possible.",
    VI: "Deeply pigmented skin can still experience UV damage."
  };

  const title = $("skincare-title");
  const text = $("skincare-advice");

  if (title) {
    title.textContent =
      uv === null ? "Your UV Protection Advice" : `UV risk: ${uvRisk(uv)}`;
  }

  if (text) {
    text.textContent = `${advice} ${typeAdvice[type] ?? ""}`;
  }

  const guidanceTitle = $("guidance-title");
  const guidanceText = $("guidance-text");

  if (guidanceTitle) {
    guidanceTitle.textContent =
      uv === null ? "Waiting for UV data" : `UV risk: ${uvRisk(uv)}`;
  }

  if (guidanceText) guidanceText.textContent = advice;

  const source = $("guidance-source");
  if (source) {
    source.textContent =
      "General educational guidance. Skin type does not eliminate UV risk.";
  }
}

function renderReading(r) {
  showValue("uv-value", r.uvIndex, 1);
  showValue("pollution-value", r.pollution);
  showValue("temperature-value", r.temperature, 1);
  showValue("humidity-value", r.humidity, 1);
  showValue("pressure-value", r.pressure, 1);
  showValue("altitude-value", r.altitude, 1);
  showValue("acceleration-value", r.acceleration, 2);

  showStatus("uv-status", uvRisk(r.uvIndex));
  showStatus(
    "pollution-status",
    r.pollution === null ? "Unavailable" : "ESP32 sensor reading"
  );
  showStatus(
    "acceleration-status",
    r.acceleration === null ? "Unavailable" : "ESP32 sensor reading"
  );
  showStatus(
    "alarm-status",
    r.alarm ? `ALARM: ${r.reason}` : r.reason
  );

  const time = $("last-updated");
  if (time) {
    const date = r.timestamp ? new Date(r.timestamp) : null;
    time.textContent =
      date && !Number.isNaN(date.getTime())
        ? `Last update: ${date.toLocaleTimeString()}`
        : "Latest API reading received";
  }

  const label = $("data-label");
  if (label) label.textContent = "Sensor readings from ESP32 via Render";

  updateSkinCare(r.uvIndex);

  const date = r.timestamp ? new Date(r.timestamp) : new Date();

  historyData.push({
    ...r,
    label: Number.isNaN(date.getTime())
      ? new Date().toLocaleTimeString()
      : date.toLocaleTimeString()
  });

  while (historyData.length > HISTORY_LIMIT) historyData.shift();

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
      throw new Error("The API reported a failed request");
    }

    const reading = normalizeApiData(payload);
    setConnection("connected", "Backend connected");
    renderReading(reading);
  } catch (error) {
    setConnection("disconnected", "Backend unavailable");

    const time = $("last-updated");
    if (time) time.textContent = "Unable to fetch readings. Check the API connection.";

    console.error("Sensor API error:", error);
  } finally {
    requestInProgress = false;
  }
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
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: "index" },
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6 }
        },
        y: { beginAtZero: true }
      }
    }
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
  const series = {
    uv: "uvIndex",
    temperature: "temperature",
    humidity: "humidity",
    pressure: "pressure",
    altitude: "altitude",
    acceleration: "acceleration"
  };

  for (const [chartName, field] of Object.entries(series)) {
    const chart = charts[chartName];
    if (!chart) continue;

    chart.data.labels = historyData.map(item => item.label);
    chart.data.datasets[0].data =
      historyData.map(item => item[field]);

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

  const selector = $("skin-type");
  if (selector) {
    selector.addEventListener("change", () => {
      const latest = historyData[historyData.length - 1];
      updateSkinCare(latest ? latest.uvIndex : null);
    });
  }

  startAutoRefresh();
});
