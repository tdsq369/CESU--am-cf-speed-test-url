# [am-cf-speed-test-url](https://github.com/ansoncloud8/am-cf-speed-test-url)
▶️ **新人[YouTube](https://youtube.com/@AM_CLUB)** 需要您的支持，请务必帮我**点赞**、**关注**、**打开小铃铛**，***十分感谢！！！*** ✅
</br>🎁 不要只是下载或Fork。请 **follow** 我的GitHub、给我所有项目一个 **Star** 星星（拜托了）！你的支持是我不断前进的动力！ 💖
</br>✅**解锁更多技术请访问[【个人博客】](https://am.809098.xyz)**

# 免责声明

### 用途
该项目被设计和开发仅供学习、研究和安全测试目的。它旨在为安全研究者、学术界人士和技术爱好者提供一个了解和实践网络通信技术的工具。

### 合法性
使用者在下载和使用该项目时，必须遵守当地法律和规定。使用者有责任确保他们的行为符合其所在地区的法律、规章以及其他适用的规定。

### 免责
1. 作为该项目的作者，我（以下简称“作者”）强调该项目应仅用于合法、道德和教育目的。
2. 作者不鼓励、不支持也不促进任何形式的非法使用该项目。如果发现该项目被用于非法或不道德的活动，作者将强烈谴责这种行为。
3. 作者对任何人或团体使用该项目进行的任何非法活动不承担责任。使用者使用该项目时产生的任何后果由使用者本人承担。
4. 作者不对使用该项目可能引起的任何直接或间接损害负责。
5. 通过使用该项目，使用者表示理解并同意本免责声明的所有条款。如果使用者不同意这些条款，应立即停止使用该项目。

作者保留随时更新本免责声明的权利，且不另行通知。最新的免责声明版本将会在该项目的 GitHub 页面上发布。

## 一、项目简介

本项目是一个使用Cloudflare的Worker搭建SpeedTest测速地址的工程，主要代码在`worker.js`文件中。通过本项目，你可以很容易地在Cloudflare上搭建起自己的测速服务。

## 二、功能介绍

例如您的项目域名为 `speedtest.am.workers.dev`

1. **默认测速大小为200MB**：当未在路径中指定测速大小时，项目会默认进行200MB的测速。

- 200M   默认测试下载地址: `https://speedtest.am.workers.dev`
 

2. **自定义测速大小**：通过在路径中指定数字和单位（可选的单位包括 K，M，G），可以设定想要进行测速的数据大小，如“/500M”表示进行500MB的测速。

- 1024K  测试下载地址: `https://speedtest.am.workers.dev/1024k`
- 200M   测试下载地址: `https://speedtest.am.workers.dev/200m`
- 1G     测试下载地址: `https://speedtest.am.workers.dev/1g`

3. **推荐使用workers部署方案并绑定自定义域，即可同时具备 http/https 两种测速途径。**

## 三、使用指南

1. 克隆或下载本项目到你的本地设备。

2. 在Cloudflare的Worker中创建一个新的项目，并将`worker.js`文件中的代码复制粘贴到你的项目中。

3. 部署你的Worker项目。

现在，你可以访问你的Worker的URL，进行网速测试了。

## 四、注意事项

- 代码中的路径需要做适当修改，以反映你自己的Cloudflare Worker的URL。
- 当路径不符合预设的格式时，程序将返回400错误。

希望这个星级的项目能对你有所帮助，如果你喜欢或用到了本项目，希望能给我一个星级鼓励一下。

 #
▶️ **新人[YouTube](https://youtube.com/@AM_CLUB)** 需要您的支持，请务必帮我**点赞**、**关注**、**打开小铃铛**，***十分感谢！！！*** ✅
</br>🎁 不要只是下载或Fork。请 **follow** 我的GitHub、给我所有项目一个 **Star** 星星（拜托了）！你的支持是我不断前进的动力！ 💖
  
 # 
<center><details><summary><strong> [点击展开] 赞赏支持 ~🧧</strong></summary>
*我非常感谢您的赞赏和支持，它们将极大地激励我继续创新，持续产生有价值的工作。*
  
- **USDT-TRC20:** `TWTxUyay6QJN3K4fs4kvJTT8Zfa2mWTwDD`
  
</details></center>



---

# 边缘自生成版改造（2026-11-10）

原版 `_worker.js` 只是把请求转发给 `https://speed.cloudflare.com/__down?bytes=...`，
本质仍是公共测速端点的一个壳，会跟全社区共用同一份限流配额：

- 大包请求（≥100MB）被 `speed.cloudflare.com` 返回 `429 Too Many Requests`
- 此时所有候选 IP 同时测不出速度，看起来像"整条线路挂了 / 节点全部 -1"

本次改造把数据源换成 **边缘现场生成**，不再发出任何上游请求：

| 项 | 原版 | 现版 |
|---|---|---|
| 数据来源 | `fetch(speed.cloudflare.com/__down)` | `ReadableStream` 现场生成随机字节 |
| 响应头 | 透传上游，无 `Content-Length` | 自带 `Content-Length`，可直接算吞吐 |
| 上限 | 受上游限额 | 1G（默认 200MB） |
| 探针 | 无 | `/1` 返回 1 字节，用于验证边缘 IP 能否服务本 Worker 路由 |
| 标记 | 无 | `x-cf-speed: edge-gen` |

同时保留原有路径语义：`/`（200MB）、`/1024k`、`/50m`、`/200m`、`/1g`、`/locations`，并支持 `HEAD`。

## 部署后自检

```bash
# 应看到 x-cf-speed: edge-gen，且不再出现 _cfuvid / cf-meta-* 头
curl -sI https://<你的域名>/1m | grep -iE 'content-length|x-cf-speed|x-cfuvid|cf-meta'

# 1 字节探针
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://<你的域名>/1

# 大包不再 429
curl -s -o /dev/null -w '%{http_code} %{size_download} %{speed_download}\n' --max-time 15 https://<你的域名>/200m
```

## 关于优选的一个实测结论

`162.159.0.0/15` 与 `108.162.192.0/18` 这两段：普通代理站点正常，但 **Worker 自定义域一律返回 403（error 1003）**。
用 `speed.cloudflare.com` 做测速源时这些 IP 往往速度最快，拿去接 Worker 节点却必然 `-1`。
用本域名的 `/1` 做一次 1 字节探针即可提前剔除这类 IP。


---

# v2：探针 + 测速源分离（2026-11-10）

## 为什么改

同一边缘 IP（`172.64.144.10`）实测：

| 数据来源 | 速度 |
|---|---|
| CF 原生 `speed.cloudflare.com` | 29.4 – 77 MB/s |
| 本 Worker 边缘生成（256KB 分片） | 3.0 – 5.0 MB/s |
| 本 Worker 边缘生成（4MB 分片） | 3.7 – 8.5 MB/s |
| 本 Worker `FixedLengthStream` | 3.5 – 7.6 MB/s |

**自己生成的字节要经过 isolate 的 JS，被 CPU 预算卡住**（Free 计划 10ms/请求），调分片、去掉 Content-Length 都没用；
**原样透传上游时 bytes 由 runtime 托管搬运**，才能跑满。所以 v2 的策略是：

> 默认透传上游，上游失败/限流时自动降级本地生成，并用响应头标明数据来源。

## 路由

| 路径 | 行为 | 用途 |
|---|---|---|
| `/probe`、`/1` | 本地生成 1 字节，**绝不打上游** | 优选探针：验证该边缘 IP 能否服务本 Worker 路由 |
| `/`、`/{n}{k\|m\|g}` | 默认透传 `speed.cloudflare.com/__down`；429/异常时降级本地生成 | 带宽实测 |
| `/health` | JSON：版本、默认模式、上游地址、上限、路由表 | 端点自描述，方便工具端自动识别 |
| `/locations` | 透传官方机房表 | 兼容原有工具 |

## 响应头

| 头 | 含义 |
|---|---|
| `x-cf-speed-src` | `upstream` / `gen` / `gen-fallback`，标明这批字节从哪来 |
| `x-cf-speed-upstream-status` | 降级时记录上游状态码（如 `429`） |
| `x-cf-speed` | `edge-gen-v2` |

## 参数

- `?mode=upstream|gen` 强制数据来源（对照测试）
- `?debug=1` 之后才认 `ck=<分片字节>` 与 `nc=1`（不带 Content-Length）

## 自检

```bash
curl -s https://<域名>/health | jq .
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://<域名>/probe
curl -sI https://<域名>/50m | grep -i x-cf-speed-src     # 期望 upstream
curl -s -o /dev/null -w '%{speed_download}\n' https://<域名>/50m
curl -s -o /dev/null -w '%{speed_download}\n' 'https://<域名>/50m?mode=gen'   # 对照：应明显更慢
```

## 重要提醒

- 透传模式**可能继承 `speed.cloudflare.com` 的 429 配额**。真要做稳定的长期测速源，请用 **R2 公共桶 + 自定义域**（走 CF 原生数据面，不经 isolate、不共享公共配额）。
- 本 Worker 的 `/probe` 在任何情况下都不打上游，所以**预算再紧也能用它做可用性判定**。
- `162.159.0.0/15`、`108.162.192.0/18` 里有部分 /24 对普通代理站点正常，但对 Worker 自定义域返回 403（**是部分 /24，不是整段**；实测 114 个坏段，且同 /15 内 `162.159.253.0/24` 可用）—— 优选时务必先用 `/probe` 逐个校验。
