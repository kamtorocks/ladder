/// <reference path="../pb_data/types.d.ts" />
//
// 规则文件同步（原 sync-oss 服务）：
//   sync_resources -> 需要定时下载的文件清单（url + 相对路径），后台可编辑
//   sync_runs      -> 每次同步的结果记录（供 /healthz 与首页展示）

const CLASH_RULES = [
  "direct.txt", "proxy.txt", "reject.txt", "private.txt", "apple.txt", "icloud.txt",
  "google.txt", "gfw.txt", "tld-not-cn.txt", "telegramcidr.txt", "lancidr.txt",
  "cncidr.txt", "applications.txt",
];

const RESOURCES = [
  { url: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat", filename: "clash-rules/geoip.dat" },
  { url: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat", filename: "clash-rules/geosite.dat" },
  { url: "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb", filename: "clash-rules/geoip.metadb" },
  ...CLASH_RULES.map((name) => ({
    url: `https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/${name}`,
    filename: `clash-rules/${name}`,
  })),
];

function timestamps() {
  return [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
}

migrate(
  (app) => {
    app.save(new Collection({
      type: "base",
      name: "sync_resources",
      fields: [
        { name: "filename", type: "text", required: true, min: 1, max: 200, presentable: true,
          pattern: "^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$" },
        { name: "url", type: "url", required: true },
        { name: "disabled", type: "bool" },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_sync_resources_filename` ON `sync_resources` (`filename`)"],
    }));

    app.save(new Collection({
      type: "base",
      name: "sync_runs",
      fields: [
        { name: "trigger", type: "select", maxSelect: 1, values: ["cron", "startup", "manual"], presentable: true },
        { name: "started", type: "date", presentable: true },
        { name: "finished", type: "date" },
        { name: "total", type: "number", onlyInt: true },
        { name: "ok", type: "number", onlyInt: true },
        { name: "failed", type: "json", maxSize: 200000 },
        ...timestamps(),
      ],
      indexes: ["CREATE INDEX `idx_sync_runs_started` ON `sync_runs` (`started`)"],
    }));

    const col = app.findCollectionByNameOrId("sync_resources");
    for (const r of RESOURCES) {
      const rec = new Record(col);
      rec.set("filename", r.filename);
      rec.set("url", r.url);
      rec.set("disabled", false);
      app.save(rec);
    }
  },
  (app) => {
    for (const name of ["sync_runs", "sync_resources"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {}
    }
  },
);
