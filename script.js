
const API_BASE_URL = "https://wearable-uv-pollution-monitoring.onrender.com";
const REFRESH_INTERVAL_MS = 2000;
const HISTORY_LIMIT = 12;

const $ = (id) => document.getElementById(id);

const historyData = [];
const charts = {};
let refreshTimer = null;
let requestInProgress = false;

// Convert valid numeric values without inventing missing readings.
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Read supported field names from the backend response.
function normalizeApiData(payload) {
  const data = payload?.data ?? payload;

  const motionValue =
    data?.motion ??
    data?.movement ??
    data?.motionDetected;

  let motion = null;

  if (typeof motionValue === "boolean") {
    motion = motionValue;
  } else if (motionValue === 1 || motionValue === "1") {
    motion = true;
  } else if (motionValue === 0 || motionValue === "0") {
    motion = false;
  } else if (typeof motionValue === "string") {
    const value = motionValue.toLowerCase().trim();

    if (["true", "detected", "motion"].includes(value)) {
      motion = true;
    } else if (["false", "none", "no motion", "not detected"].includes(value)) {
      motion = false;
    }
  }

  return {
    uvIndex: numberOrNull(data?.uvIndex),
    pollution: numberOrNull(data?.pollution),
    pm1: numberOrNull(data?.pm1),
    pm25: numberOrNull(data?.pm25 ?? data?.pm2_5),
    pm10: numberOrNull(data?.pm10),
    temperature: numberOrNull(data?.temperature),
    humidity: numberOrNull(data?.humidity),
    pressure: numberOrNull(
      data?.pressure ?? data?.atmosphericPressure
    ),
    altitude: numberOrNull(data?.altitude),
    motion,
    timestamp: data?.timestamp || new Date().toISOString()
  };
}

function setConnection(state, message) {
  const connection = $("connection");

  connection.className = `connection ${state}`;
  $("connection-text").textContent = message;
}

function showValue(id, value, decimals = 0) {
  const element = $(id);

  if (!element) return;

  if (value === null || value === undefined) {
    element.textContent = "—";
    return;
  }

  element.textContent =
    decimals > 0 ? Number(value).toFixed(decimals) : String(value);
}

function showStatus(id, message) {
  const element = $(id);

  if (element) {
    element.textContent = message;
  }
}

function uvRisk(uv) {
  if (uv === null) return "Unavailable";
  if (uv < 0) return "Invalid UV reading";
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";

  return "Extreme";
}

// Educational UV advice; does not replace medical advice.
function updateGuidance(uv) {
  const skinType = $("skin-type").value;

  let title = "Waiting for UV data";
  let advice =
    "A valid UV reading is not available. Check a trusted local UV forecast and use sun protection when appropriate.";

  if (uv !== null && uv >= 0) {
    title = `UV risk: ${uvRisk(uv)}`;

    if (uv <= 2) {
      advice =
        "UV risk is generally low. Sunglasses and sunscreen may still be useful during extended outdoor exposure.";
    } else if (uv <= 5) {
      advice =
        "Seek shade during strong sunlight. Wear protective clothing and sunglasses, and use broad-spectrum SPF 30+ sunscreen.";
    } else if (uv <= 7) {
      advice =
        "Protection is important. Reduce midday sun exposure, seek shade, wear protective clothing and use broad-spectrum SPF 30+ sunscreen.";
    } else {
      advice =
        "Minimise midday sun exposure. Stay in shade, cover exposed skin, wear sunglasses and use broad-spectrum SPF 30+ sunscreen.";
    }
  }

  $("guidance-title").textContent = title;
  $("guidance-text").textContent = advice;
  $("guidance-source").textContent =
    `Educational guidance · selected skin type ${skinType} · not a medical assessment`;
}

function renderReading(reading) {
  showValue("uv-value", reading.uvIndex);
  showValue("pollution-value", reading.pollution);
  showValue("pm1-value", reading.pm1);
  showValue("pm25-value", reading.pm25);
  showValue("pm10-value", reading.pm10);
  showValue("temperature-value", reading.temperature, 1);
  showValue("humidity-value", reading.humidity);
  showValue("pressure-value", reading.pressure, 1);
  showValue("altitude-value", reading.altitude);

  showStatus("uv-status", uvRisk(reading.uvIndex));

  showStatus(
    "pollution-status",
    reading.pollution === null ? "Not provided by API" : "API reading"
  );

  const fields = [
    ["pm1", reading.pm1],
    ["pm25", reading.pm25],
    ["pm10", reading.pm10],
    ["temperature", reading.temperature],
    ["humidity", reading.humidity],
    ["pressure", reading.pressure],
    ["altitude", reading.altitude]
  ];

  fields.forEach(([name, value]) => {
    showStatus(
      `${name}-status`,
      value === null ? "Not provided by API" : "API reading"
    );
  });

  showValue(
    "motion-value",
    reading.motion === null
      ? null
      : reading.motion
        ? "Motion detected"
        : "No motion"
  );

  showStatus(
    "motion-status",
    reading.motion === null ? "Not provided by API" : "API reading"
  );

  const timestamp = new Date(reading.timestamp);

  $("last-updated").textContent =
    `Last API update: ${
      Number.isNaN(timestamp.getTime())
        ? "time unavailable"
        : timestamp.toLocaleTimeString()
    }`;

  $("data-label").textContent =
    "API data only · missing fields shown as unavailable";

  updateGuidance(reading.uvIndex);

  historyData.push({
    ...reading,
    label: Number.isNaN(timestamp.getTime())
      ? new Date().toLocaleTimeString()
      : timestamp.toLocaleTimeString()
  });

  while (historyData.length > HISTORY_LIMIT) {
    historyData.shift();
  }

  updateCharts();
}

async function refreshReadings() {
  // Avoid overlapping requests if the server responds slowly.
  if (requestInProgress) return;

  requestInProgress = true;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/sensor-data`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload?.success === false) {
      throw new Error("Backend reported an unsuccessful request");
    }

    const reading = normalizeApiData(payload);

    setConnection("connected", "API connected");
    renderReading(reading);
  } catch (error) {
    setConnection("disconnected", "API unavailable");

    $("last-updated").textContent =
      "Cannot fetch API readings. Check the backend and API URL.";

    $("data-label").textContent = "Waiting for API data";

    // Keep previously received history, but do not add fake values.
    console.error("AirSense API request failed:", error);
  } finally {
    requestInProgress = false;
  }
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      intersect: false,
      mode: "index"
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          usePointStyle: true,
          boxWidth: 8
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 6 }
      },
      y: {
        beginAtZero: true,
        grid: { color: "#edf1f5" }
      }
    }
  };
}

function createChart(id, datasets, options = {}) {
  const canvas = $(id);

  if (!canvas || typeof Chart === "undefined") {
    console.error(`Cannot initialise chart: ${id}`);
    return null;
  }

  return new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: datasets.map(dataset => ({
        ...dataset,
        data: [],
        tension: 0.3,
        pointRadius: 2,
        spanGaps: false
      }))
    },
    options: {
      ...chartOptions(),
      ...options
    }
  });
}

function initCharts() {
  charts.uv = createChart("uv-chart", [
    {
      label: "UV index",
      borderColor: "#d89c2b",
      backgroundColor: "rgba(216,156,43,0.12)",
      fill: true
    }
  ]);

  charts.particles = createChart("particle-chart", [
    {
      label: "PM1",
      borderColor: "#247c78"
    },
    {
      label: "PM2.5",
      borderColor: "#d99a34"
    },
    {
      label: "PM10",
      borderColor: "#6b78b8"
    }
  ]);

  charts.climate = createChart("climate-chart", [
    {
      label: "Temperature °C",
      borderColor: "#d66b50"
    },
    {
      label: "Humidity %",
      borderColor: "#3689bd"
    }
  ]);

  charts.pressure = createChart("pressure-chart", [
    {
      label: "Pressure hPa",
      borderColor: "#247c78"
    },
    {
      label: "Altitude m",
      borderColor: "#8b6bb8"
    }
  ]);

  charts.motion = createChart("motion-chart", [
    {
      label: "Motion detected",
      borderColor: "#d66b50",
      backgroundColor: "rgba(214,107,80,0.12)",
      fill: true,
      stepped: true
    }
  ], {
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 6 }
      },
      y: {
        min: 0,
        max: 1,
        ticks: {
          stepSize: 1,
          callback: value => value === 1 ? "Motion" : "None"
        }
      }
    }
  });
}

function updateCharts() {
  const labels = historyData.map(item => item.label);

  const series = {
    uv: [
      historyData.map(item => item.uvIndex)
    ],
    particles: [
      historyData.map(item => item.pm1),
      historyData.map(item => item.pm25),
      historyData.map(item => item.pm10)
    ],
    climate: [
      historyData.map(item => item.temperature),
      historyData.map(item => item.humidity)
    ],
    pressure: [
      historyData.map(item => item.pressure),
      historyData.map(item => item.altitude)
    ],
    motion: [
      historyData.map(item =>
        item.motion === null ? null : item.motion ? 1 : 0
      )
    ]
  };

  Object.entries(series).forEach(([name, datasets]) => {
    const chart = charts[name];

    if (!chart) return;

    chart.data.labels = labels;

    chart.data.datasets.forEach((dataset, index) => {
      dataset.data = datasets[index];
    });

    chart.update("none");
  });
}

function startAutoRefresh() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }

  refreshReadings();

  refreshTimer = setInterval(
    refreshReadings,
    REFRESH_INTERVAL_MS
  );
}

document.addEventListener("DOMContentLoaded", () => {
  initCharts();

  $("skin-type").addEventListener("change", () => {
    const latest = historyData[historyData.length - 1];

    updateGuidance(latest ? latest.uvIndex : null);
  });

  startAutoRefresh();
});
