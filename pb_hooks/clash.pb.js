/// <reference path="../pb_data/types.d.ts" />
//
// GET /clash  -> 输出 Clash 订阅配置（YAML）
// 可选：设置环境变量 CLASH_TOKEN 后，需携带 ?token=xxx 才能访问。

routerAdd("GET", "/clash", (e) => {
  const yaml = require(`${__hooks}/lib/yaml.js`);

  const token = $os.getenv("CLASH_TOKEN");
  if (token && e.request.url.query().get("token") !== token) {
    return e.string(403, "forbidden");
  }

  // JSON 字段在 JS hook 中拿到的是 Go 的 types.JSONRaw（goja 包装成字节数组），
  // 统一用 toString() 取回 JSON 文本再解析。
  function jsonField(rec, name) {
    const raw = rec.get(name);
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === "string" ? raw : toString(raw);
    return text === "" ? null : JSON.parse(text);
  }

  const proxyRecords = $app.findRecordsByFilter("proxies", "", "+name", 0, 0);
  const ruleRecords = $app.findRecordsByFilter("rules", "", "+sort,+created", 0, 0);
  const providerRecords = $app.findRecordsByFilter("rule_providers", "", "+name", 0, 0);

  const proxies = [];
  const proxyNames = [];
  for (const rec of proxyRecords) {
    const meta = jsonField(rec, "metadata") || {};
    const proxy = Object.assign({}, meta);
    if (!proxy.name) proxy.name = rec.getString("name");
    proxies.push(proxy);
    proxyNames.push(proxy.name);
  }

  const rules = [];
  for (const rec of ruleRecords) {
    const keyword = rec.getString("keyword");
    const value = rec.getString("value");
    const policy = rec.getString("policy");
    rules.push(value ? `${keyword},${value},${policy}` : `${keyword},${policy}`);
  }

  const ruleProviders = {};
  for (const rec of providerRecords) {
    ruleProviders[rec.getString("name")] = jsonField(rec, "metadata") || {};
  }

  const config = {
    proxies: proxies,
    "proxy-groups": [{ name: "Proxy", type: "select", proxies: proxyNames }],
    rules: rules,
    "rule-providers": ruleProviders,
  };

  const headers = e.response.header();
  headers.set("Content-Type", "application/x-yaml; charset=utf-8");
  headers.set("Content-Disposition", 'attachment; filename="clash.yaml"');
  headers.set("Profile-Update-Interval", "24");
  headers.set("Cache-Control", "no-cache");
  headers.set("Access-Control-Allow-Origin", "*");
  return e.string(200, yaml.stringify(config));
});
