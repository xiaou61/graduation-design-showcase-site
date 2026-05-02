const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const net = require("net");
const path = require("path");

const express = require("express");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const VISITS_FILE = path.join(DATA_DIR, "visits.jsonl");
const IP_CACHE_FILE = path.join(DATA_DIR, "ip-cache.json");

loadEnvFile();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG = {
  adminUsername: process.env.ADMIN_USERNAME || "yuanfang",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionTtlMs: 1000 * 60 * 60 * 8,
  visitorTtlMs: 1000 * 60 * 60 * 24 * 365,
  regionCacheTtlMs: 1000 * 60 * 60 * 24 * 14
};

const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/script.js", "script.js"],
  ["/readme_simple.md", "readme_simple.md"],
  ["/admin.css", "admin.css"],
  ["/admin.js", "admin.js"],
  ["/login.js", "login.js"]
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const app = express();
const adminSessions = new Map();
let ipCache = null;

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "12kb", type: ["application/json", "application/*+json"] }));
app.use(express.urlencoded({ extended: false, limit: "12kb" }));
app.use(express.text({ limit: "12kb", type: ["text/plain", "application/octet-stream"] }));

for (const [route, fileName] of PUBLIC_FILES.entries()) {
  app.get(route, (req, res) => sendPublicFile(res, fileName));
}

app.get("/admin/login", (req, res) => {
  if (getAdminSession(req)) {
    return res.redirect(303, "/admin");
  }

  return sendPublicFile(res, "admin-login.html");
});

app.get(["/admin", "/admin.html"], requireAdminPage, (req, res) => {
  return sendPublicFile(res, "admin.html");
});

app.post("/api/track", createRateLimiter({ max: 90, windowMs: 60_000 }), async (req, res) => {
  try {
    const payload = parseBodyObject(req.body);
    const ip = getClientIp(req);
    const visitorId = getOrCreateVisitorId(req, res);
    const userAgent = cleanString(req.headers["user-agent"], 600);
    const region = await resolveIpRegion(ip);

    const record = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      visitorId,
      ip,
      region,
      path: cleanPath(payload.path),
      title: cleanString(payload.title, 160),
      referrer: cleanString(payload.referrer, 500),
      language: cleanString(payload.language, 64),
      timezone: cleanString(payload.timezone, 80),
      screen: {
        width: cleanNumber(payload.screenWidth),
        height: cleanNumber(payload.screenHeight),
        viewportWidth: cleanNumber(payload.viewportWidth),
        viewportHeight: cleanNumber(payload.viewportHeight)
      },
      device: detectDevice(userAgent),
      browser: detectBrowser(userAgent),
      os: detectOs(userAgent),
      userAgent
    };

    await appendVisit(record);
    return res.status(201).json({ data: { ok: true } });
  } catch (error) {
    console.error("track_failed", error);
    return jsonError(res, 500, "track_failed", "访问记录保存失败");
  }
});

app.post("/api/admin/login", createRateLimiter({ max: 8, windowMs: 15 * 60_000 }), (req, res) => {
  const body = parseBodyObject(req.body);
  const username = cleanString(body.username, 80);
  const password = typeof body.password === "string" ? body.password : "";

  if (!CONFIG.adminPassword) {
    return jsonError(res, 503, "admin_not_configured", "后台密码还没有配置");
  }

  const valid =
    safeEqual(username, CONFIG.adminUsername) &&
    safeEqual(password, CONFIG.adminPassword);

  if (!valid) {
    return jsonError(res, 401, "invalid_credentials", "账号或密码错误");
  }

  const sessionId = createAdminSession();
  res.cookie("admin_session", sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure: requestIsSecure(req),
    path: "/",
    maxAge: CONFIG.sessionTtlMs
  });

  return res.json({ data: { ok: true } });
});

app.post("/api/admin/logout", requireAdminApi, (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.admin_session) {
    adminSessions.delete(cookies.admin_session);
  }

  res.clearCookie("admin_session", {
    httpOnly: true,
    sameSite: "strict",
    secure: requestIsSecure(req),
    path: "/"
  });

  return res.json({ data: { ok: true } });
});

app.get("/api/admin/analytics", requireAdminApi, async (req, res) => {
  try {
    const range = validateRange(req.query.range);
    const visits = await readVisits();
    return res.json({ data: summarizeVisits(visits, range) });
  } catch (error) {
    if (error.statusCode) {
      return jsonError(res, error.statusCode, error.code, error.message);
    }

    console.error("analytics_failed", error);
    return jsonError(res, 500, "analytics_failed", "统计数据读取失败");
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error && (error.type === "entity.parse.failed" || error.status === 400)) {
    return jsonError(res, 400, "invalid_json", "请求内容格式不正确");
  }

  console.error("server_error", error);
  return jsonError(res, 500, "internal_error", "服务器处理失败");
});

app.use((req, res) => {
  return jsonError(res, 404, "not_found", "资源不存在");
});

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function securityHeaders(req, res, next) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (requestIsSecure(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
}

function sendPublicFile(res, fileName) {
  const absolutePath = path.join(ROOT_DIR, fileName);
  const type = CONTENT_TYPES[path.extname(fileName)] || "application/octet-stream";

  return res.sendFile(absolutePath, {
    headers: {
      "Content-Type": type,
      "Cache-Control": fileName.endsWith(".html") ? "no-store" : "public, max-age=300"
    }
  });
}

function jsonError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    error: {
      code,
      message
    }
  });
}

function parseBodyObject(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    return body;
  }

  return {};
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanPath(value) {
  const pathValue = cleanString(value, 500);
  if (!pathValue || !pathValue.startsWith("/")) {
    return "/";
  }

  return pathValue;
}

function cleanNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.round(number);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestIsSecure(req) {
  return Boolean(req.secure || req.headers["x-forwarded-proto"] === "https");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function getOrCreateVisitorId(req, res) {
  const cookies = parseCookies(req);
  const current = cookies.visitor_id;
  if (/^[a-zA-Z0-9_-]{32,80}$/.test(current || "")) {
    return current;
  }

  const nextId = crypto.randomBytes(24).toString("base64url");
  res.cookie("visitor_id", nextId, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(req),
    path: "/",
    maxAge: CONFIG.visitorTtlMs
  });

  return nextId;
}

function createAdminSession() {
  cleanupSessions();
  const sessionId = crypto.randomBytes(32).toString("base64url");
  adminSessions.set(sessionId, {
    createdAt: Date.now(),
    expiresAt: Date.now() + CONFIG.sessionTtlMs
  });

  return sessionId;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) {
      adminSessions.delete(sessionId);
    }
  }
}

function getAdminSession(req) {
  cleanupSessions();
  const cookies = parseCookies(req);
  const sessionId = cookies.admin_session;
  if (!sessionId) {
    return null;
  }

  const session = adminSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return null;
  }

  return session;
}

function requireAdminPage(req, res, next) {
  if (!getAdminSession(req)) {
    return res.redirect(303, "/admin/login");
  }

  return next();
}

function requireAdminApi(req, res, next) {
  if (!getAdminSession(req)) {
    return jsonError(res, 401, "unauthorized", "请先登录后台");
  }

  return next();
}

function createRateLimiter({ max, windowMs }) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = getClientIp(req);
    const now = Date.now();
    const bucket = (buckets.get(key) || []).filter((time) => now - time < windowMs);

    if (bucket.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return jsonError(res, 429, "rate_limit_exceeded", "请求太频繁，请稍后再试");
    }

    bucket.push(now);
    buckets.set(key, bucket);

    if (buckets.size > 2000) {
      for (const [bucketKey, times] of buckets.entries()) {
        if (!times.some((time) => now - time < windowMs)) {
          buckets.delete(bucketKey);
        }
      }
    }

    return next();
  };
}

function getClientIp(req) {
  const candidates = [];
  const headers = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-client-ip",
    "x-forwarded-for"
  ];

  for (const headerName of headers) {
    const value = req.headers[headerName];
    if (!value) {
      continue;
    }

    candidates.push(...String(value).split(","));
  }

  const forwarded = req.headers.forwarded;
  if (forwarded) {
    const matches = String(forwarded).match(/for="?([^;,"]+)/gi) || [];
    candidates.push(...matches.map((item) => item.replace(/^for="?/i, "")));
  }

  candidates.push(req.socket.remoteAddress || "");

  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "unknown";
}

function normalizeIp(value) {
  let ip = String(value || "").trim().replace(/^"|"$/g, "");
  if (!ip) {
    return "";
  }

  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }

  return net.isIP(ip) ? ip : "";
}

function isPrivateIp(ip) {
  if (ip === "unknown") {
    return true;
  }

  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }

  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function resolveIpRegion(ip) {
  if (isPrivateIp(ip)) {
    return {
      country: "本地",
      region: "内网",
      city: "",
      isp: "",
      label: "本地 / 内网"
    };
  }

  const cache = await loadIpCache();
  const cached = cache[ip];
  if (cached && Date.now() - cached.cachedAt < CONFIG.regionCacheTtlMs) {
    return cached.data;
  }

  let data = {
    country: "",
    region: "",
    city: "",
    isp: "",
    label: "未知地区"
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,regionName,city,isp,query`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const json = await response.json();
      if (json && json.status === "success") {
        data = {
          country: cleanString(json.country, 80),
          region: cleanString(json.regionName, 120),
          city: cleanString(json.city, 120),
          isp: cleanString(json.isp, 160),
          label: compactRegionLabel(json.country, json.regionName, json.city)
        };
      }
    }
  } catch {
    data = {
      country: "",
      region: "",
      city: "",
      isp: "",
      label: "未知地区"
    };
  }

  cache[ip] = {
    cachedAt: Date.now(),
    data
  };
  await saveIpCache(cache);

  return data;
}

function compactRegionLabel(country, region, city) {
  const parts = [country, region, city]
    .map((item) => cleanString(item, 120))
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(" / ") : "未知地区";
}

async function loadIpCache() {
  if (ipCache) {
    return ipCache;
  }

  try {
    const raw = await fsp.readFile(IP_CACHE_FILE, "utf8");
    ipCache = JSON.parse(raw);
  } catch {
    ipCache = {};
  }

  return ipCache;
}

async function saveIpCache(cache) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(IP_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

async function appendVisit(record) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.appendFile(VISITS_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

async function readVisits() {
  try {
    const raw = await fsp.readFile(VISITS_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function validateRange(rangeValue) {
  const range = typeof rangeValue === "string" ? rangeValue : "7d";
  const allowed = new Set(["today", "7d", "30d", "90d", "all"]);
  if (!allowed.has(range)) {
    const error = new Error("统计时间范围不正确");
    error.statusCode = 400;
    error.code = "invalid_range";
    throw error;
  }

  return range;
}

function summarizeVisits(visits, range) {
  const now = new Date();
  const start = getRangeStart(range, now);
  const filtered = visits
    .filter((visit) => {
      const time = new Date(visit.timestamp);
      return Number.isFinite(time.getTime()) && (!start || time >= start);
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const todayStart = startOfDay(now);
  const onlineStart = new Date(now.getTime() - 5 * 60_000);
  const todayVisits = visits.filter((visit) => new Date(visit.timestamp) >= todayStart);
  const onlineVisits = visits.filter((visit) => new Date(visit.timestamp) >= onlineStart);
  const uniqueVisitors = uniqueCount(filtered, (visit) => visit.visitorId);
  const uniqueIps = uniqueCount(filtered, (visit) => visit.ip);

  return {
    range,
    generatedAt: now.toISOString(),
    totals: {
      pageviews: filtered.length,
      visitors: uniqueVisitors,
      ips: uniqueIps,
      todayPageviews: todayVisits.length,
      todayVisitors: uniqueCount(todayVisits, (visit) => visit.visitorId),
      onlineVisitors: uniqueCount(onlineVisits, (visit) => visit.visitorId)
    },
    timeSeries: buildTimeSeries(filtered, range, start, now),
    regions: topGroups(filtered, (visit) => (visit.region && visit.region.label) || "未知地区", 10),
    pages: topGroups(filtered, (visit) => visit.path || "/", 10),
    devices: topGroups(filtered, (visit) => visit.device || "未知设备", 6),
    browsers: topGroups(filtered, (visit) => visit.browser || "未知浏览器", 6),
    recent: filtered
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 100)
      .map((visit) => ({
        id: visit.id,
        time: visit.timestamp,
        visitor: visit.visitorId ? `${visit.visitorId.slice(0, 8)}...` : "",
        ip: visit.ip || "unknown",
        region: (visit.region && visit.region.label) || "未知地区",
        isp: (visit.region && visit.region.isp) || "",
        path: visit.path || "/",
        referrer: visit.referrer || "",
        device: visit.device || "未知设备",
        browser: visit.browser || "未知浏览器",
        os: visit.os || "未知系统"
      }))
  };
}

function getRangeStart(range, now) {
  if (range === "all") {
    return null;
  }

  if (range === "today") {
    return startOfDay(now);
  }

  const days = Number.parseInt(range, 10);
  const start = startOfDay(now);
  start.setDate(start.getDate() - days + 1);
  return start;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildTimeSeries(visits, range, start, now) {
  const mode = range === "today" ? "hour" : "day";
  const buckets = new Map();

  if (range !== "all" && start) {
    const cursor = new Date(start);
    while (cursor <= now) {
      const key = bucketKey(cursor, mode);
      buckets.set(key, emptyBucket(key, mode));
      if (mode === "hour") {
        cursor.setHours(cursor.getHours() + 1);
      } else {
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  for (const visit of visits) {
    const time = new Date(visit.timestamp);
    const key = bucketKey(time, mode);
    if (!buckets.has(key)) {
      buckets.set(key, emptyBucket(key, mode));
    }

    const bucket = buckets.get(key);
    bucket.pageviews += 1;
    if (visit.visitorId) {
      bucket.visitorSet.add(visit.visitorId);
    }
    if (visit.ip) {
      bucket.ipSet.add(visit.ip);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      pageviews: bucket.pageviews,
      visitors: bucket.visitorSet.size,
      ips: bucket.ipSet.size
    }));
}

function emptyBucket(key, mode) {
  return {
    key,
    label: mode === "hour" ? key.slice(11, 16) : key.slice(5),
    pageviews: 0,
    visitorSet: new Set(),
    ipSet: new Set()
  };
}

function bucketKey(date, mode) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  if (mode === "hour") {
    return `${year}-${month}-${day} ${pad2(date.getHours())}:00`;
  }

  return `${year}-${month}-${day}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function uniqueCount(records, getter) {
  const values = new Set();
  for (const record of records) {
    const value = getter(record);
    if (value) {
      values.add(value);
    }
  }

  return values.size;
}

function topGroups(records, getter, limit) {
  const groups = new Map();

  for (const record of records) {
    const key = getter(record) || "未知";
    if (!groups.has(key)) {
      groups.set(key, {
        label: key,
        pageviews: 0,
        visitorSet: new Set(),
        ipSet: new Set()
      });
    }

    const group = groups.get(key);
    group.pageviews += 1;
    if (record.visitorId) {
      group.visitorSet.add(record.visitorId);
    }
    if (record.ip) {
      group.ipSet.add(record.ip);
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit)
    .map((group) => ({
      label: group.label,
      pageviews: group.pageviews,
      visitors: group.visitorSet.size,
      ips: group.ipSet.size
    }));
}

function detectDevice(userAgent) {
  const source = userAgent.toLowerCase();
  if (/bot|spider|crawler|slurp/.test(source)) {
    return "Bot";
  }
  if (/ipad|tablet/.test(source)) {
    return "Tablet";
  }
  if (/mobile|android|iphone|ipod/.test(source)) {
    return "Mobile";
  }
  if (!source) {
    return "Unknown";
  }

  return "Desktop";
}

function detectBrowser(userAgent) {
  if (/Edg\//.test(userAgent)) {
    return "Edge";
  }
  if (/Chrome\//.test(userAgent) && !/Chromium\//.test(userAgent)) {
    return "Chrome";
  }
  if (/Firefox\//.test(userAgent)) {
    return "Firefox";
  }
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) {
    return "Safari";
  }

  return userAgent ? "Other" : "Unknown";
}

function detectOs(userAgent) {
  if (/Windows NT/i.test(userAgent)) {
    return "Windows";
  }
  if (/Android/i.test(userAgent)) {
    return "Android";
  }
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) {
    return "iOS";
  }
  if (/Mac OS X/i.test(userAgent)) {
    return "macOS";
  }
  if (/Linux/i.test(userAgent)) {
    return "Linux";
  }

  return userAgent ? "Other" : "Unknown";
}

app.listen(PORT, () => {
  const authState = CONFIG.adminPassword ? "ready" : "missing ADMIN_PASSWORD";
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin auth: ${authState}`);
});
