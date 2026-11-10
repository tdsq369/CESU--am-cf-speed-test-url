/**
 * CESU — am-cf-speed-test-url（边缘自生成版 / edge-generated rewrite）
 *
 * 与 speed.cloudflare.com 彻底解耦：测速数据在 Cloudflare 边缘现场生成，
 * 零回源、零共享配额，不会被公共测速端点的 429 限流波及。
 *
 * 路径：
 *   /             → 200MB（默认）
 *   /1            → 1 字节（优选探针：验证该边缘 IP 能否服务本 Worker 路由）
 *   /1024k /50m /80m /200m /1g
 *   /locations    → 透传 CF 官方机房列表（小请求，保留兼容）
 *
 * 特性：
 *   - 自带 Content-Length，客户端可直接按字节/时间算真实吞吐
 *   - 支持 HEAD
 *   - 缓冲区复用，CPU 开销接近 0
 *   - 响应带 x-cf-speed: edge-gen，便于确认是否已切到本地生成
 */

const UNIT = { k: 1000, m: 1000000, g: 1000000000 };
const DEFAULT_BYTES = 200000000;
const MAX_BYTES = 1073741824; // 1G
const CHUNK = 4194304; // 4MB：分片太小会被 RTT 限速（256KB≈3-5MB/s，4MB≈25MB/s+）

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // 机房列表：保留官方数据，失败也不影响测速
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
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // 解析尺寸：/1 = 1 字节，/1024k /50m /200m /1g
    let bytes = DEFAULT_BYTES;
    if (path) {
      const m = path.match(/^(\d+)([kmg])?$/i);
      if (!m) {
        return new Response("路径格式不正确，示例：/1 /1024k /50m /200m /1g", {
          status: 400,
        });
      }
      const n = parseInt(m[1], 10);
      bytes = m[2] ? n * (UNIT[m[2].toLowerCase()] || 1) : n;
    }
    if (!Number.isFinite(bytes) || bytes <= 0) bytes = DEFAULT_BYTES;
    if (bytes > MAX_BYTES) bytes = MAX_BYTES;

    // 诊断开关：?nc=1 不带 Content-Length；?ck=8388608 指定分片大小
    const q = url.searchParams;
    const noCL = q.get("nc") === "1";
    const chunk = Math.min(Math.max(parseInt(q.get("ck") || String(CHUNK), 10) || CHUNK, 65536), 8388608);

    const headers = {
      "content-type": "application/octet-stream",
      "cache-control": "no-store, no-transform",
      "access-control-allow-origin": "*",
      "timing-allow-origin": "*",
      "x-cf-speed": "edge-gen",
    };

    if (!noCL) headers["content-length"] = String(bytes);

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    // 边缘生成随机字节流（复用同一缓冲区，避免逐块分配）
    const buf = new Uint8Array(chunk);
    crypto.getRandomValues(buf.subarray(0, 65536));
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

    return new Response(body, { status: 200, headers });
  },
};
