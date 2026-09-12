#!/usr/bin/env node
// 一次性迁移：Supabase(PostgREST) -> PocketBase
//
// 用法：
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... \
//   PB_URL=http://127.0.0.1:8090 PB_EMAIL=admin@example.com PB_PASSWORD=... \
//   node scripts/migrate-from-supabase.mjs
//
// 幂等：proxies / rule_providers 按 name 匹配更新，rules 按 keyword+value+policy 匹配更新。

const env = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`missing env ${k}`);
    process.exit(1);
  }
  return v;
};

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SUPABASE_KEY = env("SUPABASE_SERVICE_KEY");
const PB_URL = env("PB_URL").replace(/\/$/, "");
const PB_EMAIL = env("PB_EMAIL");
const PB_PASSWORD = env("PB_PASSWORD");

async function supabase(table, order) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=${order}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

let pbToken = "";
async function pb(method, path, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(pbToken ? { Authorization: pbToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`pocketbase ${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function upsert(collection, filter, data) {
  const q = encodeURIComponent(filter);
  const found = await pb("GET", `/api/collections/${collection}/records?perPage=1&filter=${q}`);
  if (found.items.length > 0) {
    await pb("PATCH", `/api/collections/${collection}/records/${found.items[0].id}`, data);
    return "updated";
  }
  await pb("POST", `/api/collections/${collection}/records`, data);
  return "created";
}

const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function main() {
  const auth = await pb("POST", "/api/collections/_superusers/auth-with-password", {
    identity: PB_EMAIL,
    password: PB_PASSWORD,
  });
  pbToken = auth.token;

  const [proxies, providers, rules] = await Promise.all([
    supabase("proxies", "id"),
    supabase("rule_providers", "id"),
    supabase("rules", "sort,id"),
  ]);
  console.log(`fetched: proxies=${proxies.length} rule_providers=${providers.length} rules=${rules.length}`);

  for (const p of proxies) {
    const r = await upsert("proxies", `name = "${esc(p.id)}"`, {
      name: p.id,
      metadata: p.metadata,
      remark: p.remark ?? "",
    });
    console.log(`proxies ${p.id}: ${r}`);
  }

  for (const p of providers) {
    const r = await upsert("rule_providers", `name = "${esc(p.id)}"`, {
      name: p.id,
      metadata: p.metadata,
    });
    console.log(`rule_providers ${p.id}: ${r}`);
  }

  // 顺序写入，保证 created 时间与原 id 顺序一致（sort 相同时以 created 作为次序）
  for (const r of rules) {
    const res = await upsert(
      "rules",
      `keyword = "${esc(r.keyword)}" && value = "${esc(r.value)}" && policy = "${esc(r.policy)}"`,
      { keyword: r.keyword, value: r.value ?? "", policy: r.policy, sort: r.sort ?? 0 },
    );
    console.log(`rules #${r.id} ${r.keyword},${r.value},${r.policy} sort=${r.sort}: ${res}`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
