/// <reference path="../pb_data/types.d.ts" />
//
// 规则文件同步与文件服务（原 sync-oss）：
//   cron            定时下载 sync_resources 清单里的文件（SYNC_CRON，UTC，默认 18:00 = 北京时间 02:00）
//   GET  /healthz   同步状态 JSON
//   POST /api/sync  手动触发一次同步（需超级管理员）
//   GET  /...       文件下载 / 目录索引（根目录为 pb_data/sync）

// 注意：handler 在独立 VM 中执行，文件顶层的变量在 handler 里不可见，
// 所以配置都放在 lib/sync.js 里，handler 内通过 require 读取。
const sync = require(`${__hooks}/lib/sync.js`);
$os.mkdirAll(sync.DATA_DIR, 0o755); // 保证数据目录存在，首页在首次同步前也能打开

cronAdd("sync_rules", sync.CRON, () => {
  require(`${__hooks}/lib/sync.js`).runSync("cron");
});

// 启动后尽快同步一次：注册一个每分钟的任务，首次触发时先注销自己（hook 里没有异步/定时器）
if (($os.getenv("SYNC_ON_START") || "true") !== "false") {
  cronAdd("sync_on_start", "* * * * *", () => {
    cronRemove("sync_on_start");
    require(`${__hooks}/lib/sync.js`).runSync("startup");
  });
}

routerAdd("GET", "/healthz", (e) => {
  const sync = require(`${__hooks}/lib/sync.js`);
  return e.json(200, {
    status: "ok",
    total: sync.enabledResources().length,
    lastSync: sync.state(),
  });
});

routerAdd("POST", "/api/sync", (e) => {
  const sync = require(`${__hooks}/lib/sync.js`);
  const result = sync.runSync("manual");
  if (!result) return e.json(409, { message: "sync already running" });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("GET", "/{path...}", (e) => {
  const sync = require(`${__hooks}/lib/sync.js`);
  const rel = sync.safeRelPath(e.request.pathValue("path"));
  if (rel === null) return e.string(400, "非法路径");

  const abs = rel ? $filepath.join(sync.DATA_DIR, rel) : sync.DATA_DIR;
  let info;
  try {
    info = $os.stat(abs);
  } catch (_) {
    return e.string(404, "404 Not Found");
  }

  if (info.isDir()) {
    const urlPath = e.request.url.path;
    if (!urlPath.endsWith("/")) return e.redirect(301, urlPath + "/");
    return e.html(200, sync.renderListing(urlPath, sync.listDir(abs)));
  }

  const base = $filepath.base(rel);
  if (base.startsWith(".") || base.endsWith(".tmp")) return e.string(404, "404 Not Found");
  e.response.header().set("Cache-Control", "public, max-age=300");
  return e.fileFS($os.dirFS(sync.DATA_DIR), rel);
});
