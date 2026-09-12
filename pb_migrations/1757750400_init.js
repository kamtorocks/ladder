/// <reference path="../pb_data/types.d.ts" />
//
// 初始化三张表（与原 Supabase 结构一一对应）：
//   proxies        -> Clash `proxies`（name + metadata json）
//   rule_providers -> Clash `rule-providers`（name + metadata json）
//   rules          -> Clash `rules`（keyword,value,policy 按 sort 升序）

const RULE_KEYWORDS = [
  "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX", "GEOSITE",
  "IP-CIDR", "IP-CIDR6", "IP-SUFFIX", "IP-ASN", "GEOIP",
  "SRC-GEOIP", "SRC-IP-ASN", "SRC-IP-CIDR", "SRC-IP-SUFFIX",
  "DST-PORT", "SRC-PORT", "IN-PORT", "IN-TYPE", "IN-USER", "IN-NAME",
  "PROCESS-PATH", "PROCESS-PATH-REGEX", "PROCESS-NAME", "PROCESS-NAME-REGEX",
  "UID", "NETWORK", "DSCP", "RULE-SET", "AND", "OR", "NOT", "SUB-RULE", "MATCH",
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
      name: "proxies",
      fields: [
        { name: "name", type: "text", required: true, min: 1, max: 100, presentable: true },
        { name: "metadata", type: "json", required: true, maxSize: 20000 },
        { name: "remark", type: "text", max: 500 },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_proxies_name` ON `proxies` (`name`)"],
    }));

    app.save(new Collection({
      type: "base",
      name: "rule_providers",
      fields: [
        { name: "name", type: "text", required: true, min: 1, max: 100, presentable: true },
        { name: "metadata", type: "json", required: true, maxSize: 20000 },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_rule_providers_name` ON `rule_providers` (`name`)"],
    }));

    app.save(new Collection({
      type: "base",
      name: "rules",
      fields: [
        { name: "keyword", type: "select", required: true, maxSelect: 1, values: RULE_KEYWORDS, presentable: true },
        { name: "value", type: "text", max: 500, presentable: true },
        { name: "policy", type: "text", required: true, max: 100, presentable: true },
        { name: "sort", type: "number", onlyInt: true },
        ...timestamps(),
      ],
      indexes: ["CREATE INDEX `idx_rules_sort` ON `rules` (`sort`, `created`)"],
    }));

    const settings = app.settings();
    settings.meta.appName = "ladder";
    settings.logs.maxDays = 3;
    app.save(settings);
  },
  (app) => {
    for (const name of ["rules", "rule_providers", "proxies"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {}
    }
  },
);
