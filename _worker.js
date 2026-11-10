/**
 * CESU — am-cf-speed-test-url / v2
 *
 * 定位：Cloudflare 优选用的「探针 + 测速源」。两类请求分开处理：
 *   - /1、/probe            → 本地生成 1 字节（极便宜，用来验证该边缘 IP 能否服务本 Worker 路由）
 *   - /{n}{k|m|g}、/        → 默认上游直通（pass-through，快），上游 429/失败时自动降级为本地生成
 *
 * 为什么这样做（2026-11-10 实测，同一边缘 IP 172.64.144.10）：
 *   CF 原生 speed.cloudflare.com : 29.4 – 77 MB/s
 *   本 Worker 边缘生成(256KB)     : 3.0 – 5.0 MB/s
 *   本 Worker 边缘生成(4MB)       : 3.7 – 8.5 MB/s
 *   本 Worker FixedLengthStream   : 3.5 – 7.6 MB/s
 *   → 自己生成字节要过 isolate 的 JS，被 CPU 预算卡住；原样透传则由 runtime 托管搬运，能跑满。
 *   所以：默认透传，失败才降级生成，并用 x-cf-speed-src 标明数据来源。
 *
 * 参数：
 *   ?mode=upstream|gen   强制数据来源（对照测试用）
 *   ?debug=1             允许 ck=<分片字节> / nc=1(不带 Content-Length)
 *
 * 响应头：
 *   x-cf-speed-src: upstream | gen | gen-fallback
 *   x-cf-speed: edge-gen-v2
 */

const UNIT = { k: 1000, m: 1000000, g: 1000000000 };
const DEFAULT_BYTES = 200000000;
const MAX_BYTES = 1073741824; // 1G
const GEN_CHUNK = 4194304; // 4MB

function parseSize(path) {
  if (!path) return DEFAULT_BYTES;
  const m = path.match(/^(\d+)([kmg])?$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const bytes = m[2] ? n * (UNIT[m[2].toLowerCase()] || 1) : n;
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.min(bytes, MAX_BYTES);
}

function baseHeaders(bytes, src, withLength) {
  const h = {
    "content-type": "application/octet-stream",
    "cache-control": "no-store, no-transform",
    "access-control-allow-origin": "*",
    "timing-allow-origin": "*",
    "x-cf-speed-src": src,
    "x-cf-speed": "edge-gen-v2",
  };
  if (withLength) h["content-length"] = String(bytes);
  return h;
}

function generate(bytes, chunk, withLength) {
  const buf = new Uint8Array(chunk);
  crypto.getRandomValues(buf.subarray(0, Math.min(chunk, 65536)));
  let sent = 0;
  const body = new ReadableStream(
    {
      pull(controller) {
        if (sent >= bytes) {
          controller.close();
          return;
        }
        const n = Math.min(chunk, bytes - sent);
        controller.enqueue(n === chunk ? buf : buf.slice(0, n));
        sent += n;
      },
    },
    { highWaterMark: 3 }
  );
  return new Response(body, { status: 200, headers: baseHeaders(bytes, "gen", withLength) });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");
    const q = url.searchParams;

    if (path === "health") {
      return new Response(
        JSON.stringify({
          app: "cesu-speedtest",
          version: 2,
          mode_default: "upstream",
          upstream: "https://speed.cloudflare.com/__down",
          fallback: "edge-gen",
          max_bytes: MAX_BYTES,
          gen_chunk: GEN_CHUNK,
          routes: ["/", "/probe", "/1", "/{n}{k|m|g}", "/health", "/locations"],
          note: "生成字节受 Worker CPU 预算限制（约 3-8MB/s）；透传可跑满，但可能遇到上游 429",
        }),
        { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
      );
    }

    if (path === "locations") {
      try {
        const r = await fetch("https://speed.cloudflare.com/locations", {
          cf: { cacheTtl: 86400, cacheEverything: true },
        });
        return new Response(r.body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=86400",
          },
        });
      } catch (e) {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
    }

    // 探针：固定 1 字节，绝不打上游
    if (path === "probe") {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: baseHeaders(1, "gen", true) });
      }
      return generate(1, 65536, true);
    }

    const bytes = parseSize(path);
    if (!bytes) {
      return new Response("路径格式不正确，示例：/probe /1 /1024k /50m /200m /1g", { status: 400 });
    }

    const debug = q.get("debug") === "1";
    const chunk = debug
      ? Math.min(Math.max(parseInt(q.get("ck") || String(GEN_CHUNK), 10) || GEN_CHUNK, 65536), 8388608)
      : GEN_CHUNK;
    const withLength = !(debug && q.get("nc") === "1");
    const mode = q.get("mode") || (bytes <= 1048576 ? "gen" : "upstream");

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: baseHeaders(bytes, mode === "gen" ? "gen" : "upstream", withLength),
      });
    }

    if (mode === "upstream") {
      try {
        const up = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}`, {
          headers: { accept: "*/*" },
        });
        if (up.status === 200) {
          const h = new Headers(up.headers);
          h.set("cache-control", "no-store, no-transform");
          h.set("access-control-allow-origin", "*");
          h.set("timing-allow-origin", "*");
          h.set("x-cf-speed-src", "upstream");
          h.set("x-cf-speed", "edge-gen-v2");
          return new Response(up.body, { status: 200, headers: h });
        }
        // 429/403/其他 → 降级本地生成，并标注来源
        if (up.body) {
          try {
            await up.body.cancel();
          } catch (e) {}
        }
        const r = generate(bytes, chunk, withLength);
        const fh = new Headers(r.headers);
        fh.set("x-cf-speed-src", "gen-fallback");
        fh.set("x-cf-speed-upstream-status", String(up.status));
        return new Response(r.body, { status: 200, headers: fh });
      } catch (e) {
        const r = generate(bytes, chunk, withLength);
        const fh = new Headers(r.headers);
        fh.set("x-cf-speed-src", "gen-fallback");
        fh.set("x-cf-speed-upstream-status", "error");
        return new Response(r.body, { status: 200, headers: fh });
      }
    }

    return generate(bytes, chunk, withLength);
  },
};
