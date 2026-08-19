# QNAP NAS 部署：`better-sqlite3` native 模块 rebuild 失败的排查与修复

> Tracking 文档。记录 2026-08-17 在 TS-564（x86_64 QNAP，Linux 5.10.60-qnap）上部署 `ai-kb:latest` 时，`npm rebuild better-sqlite3` 连续报错的完整排查过程、试错的三个修法、以及最终落地的解决方案。配套 `docs/deploy-qnap.md` 第 5.3 节"修法 C"使用。

---

## 1. 现象

部署流程走到容器内 `npm rebuild better-sqlite3` 这一步，失败。报错日志的关键三行：

```
npm error prebuild-install warn install Request timed out
npm error gyp http GET https://unofficial-builds.nodejs.org/download/release/v20.20.2/node-v20.20.2-headers.tar.gz
npm error gyp ERR! stack FetchError: request to https://unofficial-builds.nodejs.org/... failed, reason: ETIMEDOUT
```

`npm run bootstrap` 紧随其后报 `ERR_DLOPEN_FAILED: Exec format error`（`.node` 文件 ELF 架构跟 NAS kernel 对不上）。

---

## 2. 根因链

三段报错看似不同，其实是一根链条上的三个症状：

1. **架构不匹配（`Exec format error`）**
   Windows 端 `docker build` 没传 `--platform linux/amd64`。Docker Desktop 在宿主架构非 amd64 时（例如 ARM Windows，或 buildx 未初始化的环境）会默认按宿主平台构建镜像，导致 `.node` 二进制跟 QNAP TS-564（x86_64）指令集不兼容。

2. **容器内 `npm rebuild` 拉不到 prebuilt binary（`prebuild-install warn install Request timed out`）**
   习惯性"在容器里重编一下"的兜底动作，但 better-sqlite3 的 `prebuild-install` 默认从 GitHub release 拉预编译 `.node`。国内 NAS 出口到 GitHub 不稳定，超时。

3. **fallback 到 node-gyp 又拉不到 headers（`unofficial-builds.nodejs.org ETIMEDOUT`）**
   prebuild 失败后 npm 走 `node-gyp rebuild --release`。node-gyp 拉 Node.js 源码头时使用 `process.release.sourceUrl` ——在 `node:20-alpine` 镜像里这个值是 `https://unofficial-builds.nodejs.org/download/...`（Alpine 用的交叉编译发行版托管在此），同样访问超时。

三段超时叠在一起，于是 `npm rebuild` 完全跑不动。

---

## 3. 试过的修法与结果

### 修法 A：开发机 `--platform linux/amd64` ——**未生效**

按 `deploy-qnap.md:79` 的建议在 Windows 构建时加 `--platform linux/amd64`，重新 `docker build` + `docker save` + `scp` 到 NAS，`docker load` 后 `npm run bootstrap` **仍然报 `Exec format error`**。

可能原因：
- 用户的 Windows 是 ARM 平台（`--platform` 通过 QEMU 仿真，但仿真下编出的 `.node` 在真实 x86_64 kernel 上仍偶现失败）。
- 或 buildx 未初始化，导致 `--platform` 被原生 `docker build` 静默忽略。

### 修法 B：在 NAS 上直接 build ——**未尝试**

`deploy-qnap.md:305` 推荐的"长期方案"，架构天然匹配。但用户本次部署已经传了 tar 上去，临时再走源码 scp / git clone 流程 cost 偏高，所以没走这条路。

### 修法 C：在容器内用国内镜像重 build ——**✅ 落地**

把"容器内 rebuild"这个思路里的所有外部依赖都改走国内镜像：

- npm 包 → `registry.npmmirror.com`
- Node.js headers（disturl）→ `npmmirror.com/mirrors/node`
- 跳过 `prebuild-install` 的 GitHub release 下载，直接 `--build-from-source` 走 node-gyp 编译

详见第 4 节。

---

## 4. 最终落地的命令（修法 C 完整版）

```bash
# 1. 写 .npmrc：npm 默认 registry + node-gyp 拉 headers 的 disturl 都改走国内镜像
docker exec -u root ai-kb sh -c '
cat > /app/.npmrc << "EOF"
registry=https://registry.npmmirror.com
disturl=https://npmmirror.com/mirrors/node
EOF
'

# 2. 装编译工具（已装可跳过）
docker exec -u root ai-kb apk add --no-cache python3 build-base

# 3. --build-from-source 跳过 prebuild-install（它去 GitHub release 拉 prebuilt，NAS 慢/不稳），
#    直接走 node-gyp 编译。node-gyp 拉 headers 时会读 .npmrc 里的 disturl。
docker exec -u root ai-kb npm rebuild better-sqlite3 --build-from-source

# 4. 初始化
docker exec -it ai-kb npm run bootstrap
```

跑完三段（apt 装好 → rebuild ~30 秒 → bootstrap）输出 `[bootstrap] ready — password hash present in settings table` 即视为成功。

---

## 5. 踩坑记录

### 5.1 `disturl` 不能用 `npm config set`

第一版直接跑：

```bash
docker exec -u root ai-kb npm config set disturl https://npmmirror.com/mirrors/node
```

报错：

```
npm error `disturl` is not a valid npm option
```

**原因**：npm 10+ 已经把 `disturl` 从合法 npm 配置列表里移除（它是 node-gyp 的配置，不是 npm 的）。`disturl` 只能通过以下两种方式设置：

- 写到 `.npmrc`（key 直接写 `disturl=...`，npm 不会校验，会原样传给 node-gyp）
- 传环境变量 `npm_config_disturl=https://...`

这就是为什么修法 C 走 `cat > .npmrc` 而不是 `npm config set`。

### 5.2 `--platform linux/amd64` 在某些 Docker Desktop 版本会被静默忽略

如果 `docker buildx` 没初始化过，原生 `docker build --platform linux/amd64` 在某些版本会被默默降级为宿主架构，根本不会报错。验证方式：

```bash
docker inspect ai-kb:latest --format '{{.Architecture}} {{.Os}}'
# 期望：amd64 linux
# 异常：arm64 linux  → 说明 --platform 没生效
```

要真正走 buildx 的多平台构建，需要：

```bash
docker buildx create --use --name ai-kb-builder
docker buildx build --platform linux/amd64 -f docker/Dockerfile -t ai-kb:latest --load .
```

### 5.3 镜像里 `node:20-alpine` 的 `process.release.sourceUrl` 是 `unofficial-builds.nodejs.org`

这是 node-gyp 拉 Node.js 源码头时实际请求的域名（不是常见的 `nodejs.org/dist`）。Alpine 镜像用的是交叉编译发行版，托管在这。如果 NAS 出口连不到这个域，就会在 fallback 那一步二次超时。

`npmmirror.com/mirrors/node` 同时镜像了 `nodejs.org/dist` 和 `unofficial-builds.nodejs.org`，配 `disturl=https://npmmirror.com/mirrors/node` 即可同时覆盖。

### 5.4 `prebuild-install` 拉 better-sqlite3 的预编译 binary 默认走 GitHub release

这条不会失败但会**很慢**。所以即便 NAS 通 GitHub，`prebuild-install` 也是个瓶颈。`--build-from-source` 跳过它直接走本地 node-gyp，反而更可控。

---

## 6. 决策记录

**为什么最终选修法 C 而不是 B**：

- 修法 B（NAS 上 build）虽然一次解决，但要求 NAS 端能克隆仓库或 scp 整份源码过去；用户当前部署流程已经定型为"Windows 构建 → tar → NAS load"，改造 cost 偏高。
- 修法 C 只是把"容器内 rebuild"这个兜底动作做得更鲁棒，复用了既有的部署链路。
- 修法 A 留作未来更彻底的方案 —— 把 `--platform linux/amd64` 配进 `docker build` 默认行为后，理论上不再需要修法 C。

**为什么把这条写进 `docs/` 而不是 `.scratch/`**：

按 `CLAUDE.md` 第 28 行，"`.scratch/` 是本地工作区，如果想保留要移到 `docs/`"。这条踩坑对所有 QNAP + 国内 NAS 部署都有复用价值（架构不匹配 + 网络受限这两个问题在同类环境很常见），属于项目知识而不是个人调试笔记。

---

## 7. 相关文档

- [`docs/deploy-qnap.md`](./deploy-qnap.md) —— 部署主流程 + 第 5.3 节"修法 C"使用了本文档的最终命令
- [`docs/deploy-synology.md`](./deploy-synology.md) —— 群晖部署流程（同源问题，群晖用户的 `--platform linux/amd64` 一般默认生效）
- `docker/Dockerfile` —— 镜像构建脚本（`deps` 阶段装 `python3 make g++` + `npm install`，native 模块在镜像里已经编好）