const state = {
  range: "7d",
  data: null,
  loading: false
};

const elements = {
  rangeTabs: document.querySelector("#rangeTabs"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  pageviewsMetric: document.querySelector("#pageviewsMetric"),
  visitorsMetric: document.querySelector("#visitorsMetric"),
  ipsMetric: document.querySelector("#ipsMetric"),
  todayMetric: document.querySelector("#todayMetric"),
  onlineMetric: document.querySelector("#onlineMetric"),
  updatedAt: document.querySelector("#updatedAt"),
  chart: document.querySelector("#trendChart"),
  regionList: document.querySelector("#regionList"),
  pageList: document.querySelector("#pageList"),
  deviceList: document.querySelector("#deviceList"),
  visitRows: document.querySelector("#visitRows"),
  toast: document.querySelector("#toastLine")
};

bindEvents();
loadAnalytics();

function bindEvents() {
  elements.rangeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button || button.dataset.range === state.range) {
      return;
    }

    state.range = button.dataset.range;
    updateRangeButtons();
    loadAnalytics();
  });

  elements.refreshButton.addEventListener("click", () => loadAnalytics());
  elements.logoutButton.addEventListener("click", logout);
  window.addEventListener("resize", () => {
    if (state.data) {
      drawTrendChart(state.data.timeSeries);
    }
  });
}

async function loadAnalytics() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  elements.refreshButton.disabled = true;

  try {
    const response = await fetch(`/api/admin/analytics?range=${encodeURIComponent(state.range)}`, {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (response.status === 401) {
      window.location.href = "/admin/login";
      return;
    }

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error && payload.error.message ? payload.error.message : "统计数据读取失败");
    }

    state.data = payload.data;
    renderDashboard(payload.data);
  } catch (error) {
    showToast(error.message || "统计数据读取失败");
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
  }
}

async function logout() {
  try {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } finally {
    window.location.href = "/admin/login";
  }
}

function renderDashboard(data) {
  elements.pageviewsMetric.textContent = formatNumber(data.totals.pageviews);
  elements.visitorsMetric.textContent = formatNumber(data.totals.visitors);
  elements.ipsMetric.textContent = formatNumber(data.totals.ips);
  elements.todayMetric.textContent = formatNumber(data.totals.todayVisitors);
  elements.onlineMetric.textContent = formatNumber(data.totals.onlineVisitors);
  elements.updatedAt.textContent = `更新于 ${formatDateTime(data.generatedAt)}`;

  renderRankList(elements.regionList, data.regions, "地区");
  renderRankList(elements.pageList, data.pages, "页面");
  renderChips(elements.deviceList, [...data.devices, ...data.browsers].slice(0, 8));
  renderRecent(data.recent);
  drawTrendChart(data.timeSeries);
}

function updateRangeButtons() {
  elements.rangeTabs.querySelectorAll("button[data-range]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.range === state.range);
  });
}

function renderRankList(container, items, fallbackLabel) {
  container.textContent = "";

  if (!items.length) {
    container.appendChild(emptyState(`暂无${fallbackLabel}数据`));
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "rank-item";

    const copy = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = item.label || fallbackLabel;
    const meta = document.createElement("small");
    meta.textContent = `${formatNumber(item.visitors)} 位访客 · ${formatNumber(item.ips)} 个 IP`;
    copy.append(label, meta);

    const value = document.createElement("div");
    value.className = "rank-value";
    value.textContent = formatNumber(item.pageviews);

    row.append(copy, value);
    container.appendChild(row);
  });
}

function renderChips(container, items) {
  container.textContent = "";

  if (!items.length) {
    container.appendChild(emptyState("暂无设备数据"));
    return;
  }

  items.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const meta = document.createElement("small");
    meta.textContent = `${formatNumber(item.pageviews)} 次访问 · ${formatNumber(item.visitors)} 位访客`;
    chip.append(title, meta);
    container.appendChild(chip);
  });
}

function renderRecent(items) {
  elements.visitRows.textContent = "";

  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-state";
    cell.textContent = "暂无访问记录";
    row.appendChild(cell);
    elements.visitRows.appendChild(row);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");
    row.append(
      tableCell(formatDateTime(item.time)),
      tableCell(item.visitor || "--"),
      tableCell(item.ip || "unknown"),
      stackedCell(item.region || "未知地区", item.isp || ""),
      tableCell(item.path || "/"),
      stackedCell(item.device || "未知设备", `${item.browser || ""} ${item.os || ""}`.trim()),
      stackedCell(item.referrer || "直接访问", item.referrer ? "" : "无来源页")
    );
    elements.visitRows.appendChild(row);
  });
}

function drawTrendChart(series) {
  const canvas = elements.chart;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(rect.height * ratio);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 24, right: 18, bottom: 44, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...series.map((item) => item.pageviews));

  ctx.strokeStyle = "rgba(246, 240, 223, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  if (!series.length) {
    ctx.fillStyle = "#a8ad98";
    ctx.font = "14px Microsoft YaHei UI, sans-serif";
    ctx.fillText("暂无趋势数据", padding.left, padding.top + 24);
    return;
  }

  const gap = Math.max(4, Math.min(18, chartWidth / Math.max(series.length, 1) * 0.16));
  const barWidth = Math.max(6, chartWidth / series.length - gap);

  series.forEach((item, index) => {
    const x = padding.left + index * (barWidth + gap);
    const barHeight = (item.pageviews / max) * chartHeight;
    const y = padding.top + chartHeight - barHeight;

    const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartHeight);
    gradient.addColorStop(0, "#dcff4f");
    gradient.addColorStop(0.58, "#36c7ba");
    gradient.addColorStop(1, "rgba(255, 112, 77, 0.5)");

    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, barWidth, Math.max(2, barHeight), 5);
    ctx.fill();

    if (index % Math.ceil(series.length / 8) === 0 || index === series.length - 1) {
      ctx.fillStyle = "#a8ad98";
      ctx.font = "11px Microsoft YaHei UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.label, x + barWidth / 2, height - 18);
    }
  });

  ctx.fillStyle = "#f6f0df";
  ctx.font = "12px Microsoft YaHei UI, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`峰值 ${formatNumber(max)} 次`, padding.left, 18);
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function tableCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "--";
  return cell;
}

function stackedCell(primary, secondary) {
  const cell = document.createElement("td");
  const top = document.createElement("span");
  top.textContent = primary || "--";
  cell.appendChild(top);

  if (secondary) {
    const bottom = document.createElement("small");
    bottom.textContent = secondary;
    cell.appendChild(bottom);
  }

  return cell;
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}
