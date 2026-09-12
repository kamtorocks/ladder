// 规则文件同步 + 文件目录服务（原 sync-oss 的实现）
// 下载先写 .tmp 临时文件，非空后原子替换；单个失败不影响其他文件，旧文件保留。

const DATA_DIR = $os.getenv("SYNC_DATA_DIR") || $filepath.join($app.dataDir(), "sync");
const CRON = $os.getenv("SYNC_CRON") || "0 18 * * *"; // PocketBase cron 按 UTC 计算
const TIMEOUT = Number($os.getenv("DOWNLOAD_TIMEOUT")) || 120; // 秒
const KEEP_RUNS = 30;
const RUNNING_KEY = "sync.running";

// 把 URL / 配置里的相对路径规范化，越界或含 . / .. 段返回 null；根目录返回 ""
function safeRelPath(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw || "");
  } catch (_) {
    return null;
  }
  const parts = decoded.split("/").filter((p) => p !== "");
  for (const p of parts) {
    if (p === "." || p === ".." || p.indexOf("\\") !== -1) return null;
  }
  return parts.join("/");
}

function enabledResources() {
  return $app.findRecordsByFilter("sync_resources", "disabled = false", "+filename", 0, 0);
}

function download(url, filename) {
  const rel = safeRelPath(filename);
  if (!rel) throw new Error("非法路径: " + filename);
  const target = $filepath.join(DATA_DIR, rel);
  const tmp = target + ".tmp";
  $os.mkdirAll($filepath.dir(target), 0o755);

  const res = $http.send({ url: url, method: "GET", timeout: TIMEOUT });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error("HTTP " + res.statusCode);

  try {
    $os.writeFile(tmp, res.body, 0o644);
    const size = $os.stat(tmp).size();
    if (size === 0) throw new Error("下载内容为空");
    $os.rename(tmp, target);
    return size;
  } catch (err) {
    try { $os.remove(tmp); } catch (_) {}
    throw err;
  }
}

function isRunning() {
  return $app.store().get(RUNNING_KEY) === true;
}

// 执行一轮同步；正在运行时返回 null
function runSync(trigger) {
  const store = $app.store();
  if (isRunning()) {
    console.log("[sync] 上一轮同步尚未结束，跳过本次触发");
    return null;
  }
  store.set(RUNNING_KEY, true);

  const resources = enabledResources();
  const run = new Record($app.findCollectionByNameOrId("sync_runs"));
  run.set("trigger", trigger);
  run.set("started", new Date().toISOString());
  run.set("total", resources.length);
  run.set("ok", 0);
  run.set("failed", []);
  $app.save(run);

  let ok = 0;
  const failed = [];
  console.log("[sync] 开始同步 (" + trigger + ")...");
  try {
    for (const res of resources) {
      const filename = res.getString("filename");
      try {
        const size = download(res.getString("url"), filename);
        ok += 1;
        console.log("[sync] 更新成功: " + filename + " (" + size + " 字节)");
      } catch (err) {
        const message = String(err && err.message ? err.message : err);
        failed.push({ filename: filename, error: message });
        console.log("[sync] 同步失败: " + filename + " " + message);
      }
    }
  } finally {
    store.set(RUNNING_KEY, false);
    run.set("finished", new Date().toISOString());
    run.set("ok", ok);
    run.set("failed", failed);
    $app.save(run);
    pruneRuns();
  }
  console.log("[sync] 同步完成: 成功 " + ok + "，失败 " + failed.length);
  return runToJson(run);
}

function pruneRuns() {
  const stale = $app.findRecordsByFilter("sync_runs", "", "-started", 500, KEEP_RUNS);
  for (const rec of stale) {
    try { $app.delete(rec); } catch (_) {}
  }
}

function runToJson(run) {
  if (!run) return null;
  let failed = [];
  try {
    const raw = run.get("failed");
    const text = typeof raw === "string" ? raw : toString(raw);
    failed = text ? JSON.parse(text) : [];
  } catch (_) {}
  return {
    trigger: run.getString("trigger"),
    startedAt: run.getString("started") || null,
    finishedAt: run.getString("finished") || null,
    total: run.getInt("total"),
    ok: run.getInt("ok"),
    failed: failed,
  };
}

function lastRun() {
  const runs = $app.findRecordsByFilter("sync_runs", "", "-started", 1, 0);
  return runs.length ? runs[0] : null;
}

// /healthz 与首页用的同步状态（沿用 sync-oss 的字段）
function state() {
  const last = runToJson(lastRun());
  return {
    running: isRunning(),
    startedAt: last ? last.startedAt : null,
    finishedAt: last && !isRunning() ? last.finishedAt : null,
    ok: last ? last.ok : 0,
    failed: last ? last.failed : [],
  };
}

function listDir(abs) {
  const entries = [];
  for (const d of $os.readDir(abs)) {
    const name = d.name();
    if (name.startsWith(".") || name.endsWith(".tmp")) continue;
    const info = d.info();
    entries.push({
      name: name,
      isDir: d.isDir(),
      size: info.size(),
      mtime: info.modTime().utc().format("2006-01-02 15:04:05"),
    });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.isDir ? -1 : 1));
  return entries;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return (i === 0 ? value : value.toFixed(1)) + " " + units[i];
}

function renderListing(urlPath, entries) {
  const total = enabledResources().length;
  const s = state();
  const rows = entries.map((entry) => {
    const href = urlPath + encodeURIComponent(entry.name) + (entry.isDir ? "/" : "");
    const name = escapeHtml(entry.name) + (entry.isDir ? "/" : "");
    return "<tr>" +
      '<td><a href="' + href + '">' + (entry.isDir ? "📁" : "📄") + " " + name + "</a></td>" +
      '<td class="num">' + (entry.isDir ? "-" : formatSize(entry.size)) + "</td>" +
      '<td class="num">' + entry.mtime + "</td></tr>";
  }).join("\n");

  const parent = urlPath === "/" ? "" : '<tr><td colspan="3"><a href="../">⬆️ 上级目录</a></td></tr>';
  const status = s.running
    ? "同步中…"
    : s.finishedAt
      ? "最近同步 " + escapeHtml(s.finishedAt) + " · 成功 " + s.ok + "/" + total + (s.failed.length ? " · 失败 " + s.failed.length : "")
      : "尚未同步";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(urlPath)} - 文件服务</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0 auto; padding: 2rem 1rem;
         max-width: 900px; line-height: 1.6; }
  h1 { font-size: 1.1rem; word-break: break-all; }
  .meta { opacity: .7; font-size: .85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: .4rem .6rem; border-bottom: 1px solid rgba(128,128,128,.25); text-align: left; }
  .num { text-align: right; white-space: nowrap; opacity: .75; }
  a { text-decoration: none; }
  a:hover { text-decoration: underline; }
  @media (max-width: 600px) { td:last-child, th:last-child { display: none; } }
</style>
</head>
<body>
  <h1>目录 ${escapeHtml(urlPath)}</h1>
  <div class="meta">${status} · 定时任务 <code>${escapeHtml(CRON)}</code> (UTC)</div>
  <table>
    <thead><tr><th>名称</th><th class="num">大小</th><th class="num">修改时间</th></tr></thead>
    <tbody>
      ${parent}
      ${rows || '<tr><td colspan="3">（空目录）</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

module.exports = {
  DATA_DIR, CRON, safeRelPath, enabledResources, runSync, isRunning, state, listDir, renderListing,
};
