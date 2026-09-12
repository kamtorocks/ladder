// 极简 YAML 序列化（仅覆盖 Clash 配置需要的 对象/数组/标量），
// 输出风格与原 Supabase 版本（Deno std yaml.stringify）保持一致。

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function needsQuote(s) {
  if (s === "") return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#,\[\]{}&*!|>'"%@`\\]/.test(s)) return true;
  if (/^[-?]($|\s)/.test(s)) return true;
  if (/^(true|false|null|~|yes|no|on|off|y|n)$/i.test(s)) return true;
  if (/^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$/.test(s)) return true;
  if (/^[-+]?\.(inf|nan)$/i.test(s)) return true;
  if (/^0[xob][0-9a-fA-F_]+$/.test(s) || /^0[0-7]+$/.test(s)) return true;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return true;
  if (/^\d+:\d+/.test(s)) return true;
  return false;
}

function scalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  const s = String(v);
  if (/[\x00-\x1f\x7f  ]/.test(s)) return JSON.stringify(s);
  return needsQuote(s) ? "'" + s.replace(/'/g, "''") + "'" : s;
}

function dumpLines(value, indent, out) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (Array.isArray(item)) {
        if (item.length === 0) out.push(pad + "- []");
        else {
          out.push(pad + "-");
          dumpLines(item, indent + 2, out);
        }
      } else if (isObj(item)) {
        if (Object.keys(item).length === 0) {
          out.push(pad + "- {}");
          continue;
        }
        const sub = [];
        dumpLines(item, indent + 2, sub);
        sub[0] = pad + "- " + sub[0].slice(indent + 2);
        for (let j = 0; j < sub.length; j++) out.push(sub[j]);
      } else {
        out.push(pad + "- " + scalar(item));
      }
    }
    return;
  }
  if (isObj(value)) {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const v = value[key];
      if (v === undefined) continue;
      const k = scalar(key);
      if (Array.isArray(v)) {
        if (v.length === 0) out.push(pad + k + ": []");
        else {
          out.push(pad + k + ":");
          dumpLines(v, indent + 2, out);
        }
      } else if (isObj(v)) {
        if (Object.keys(v).length === 0) out.push(pad + k + ": {}");
        else {
          out.push(pad + k + ":");
          dumpLines(v, indent + 2, out);
        }
      } else {
        out.push(pad + k + ": " + scalar(v));
      }
    }
    return;
  }
  out.push(pad + scalar(value));
}

function stringify(value) {
  const out = [];
  dumpLines(value, 0, out);
  return out.join("\n") + "\n";
}

module.exports = { stringify };
