# 威联通 NAS 部署（内网版）

> 全程 4 步，方式 A / 方式 B 任选其一。手机浏览器打开 `http://NAS内网IP:3000`（若用 `-p 3001:3000` 则访问 `http://NAS_IP:3001`）即可使用。

## 前提

- QNAP QTS 5.x 或 QuTS hero
- **Container Station** 已安装（App Center → 搜索安装）
- NAS 和你的电脑/手机在同一个局域网

---

## 第 1 步：准备目录和 .env

在 NAS 的 File Station 里，进入 `/share/Container`（没有就新建），右键新建文件夹 `ai-kb`，再在里面建三个子文件夹 `data`、`uploads`、`backups`。

最终结构：

```
/share/Container/ai-kb/
├── data/
├── uploads/
└── backups/
```

> ⚠️ **再三确认你上传/创建的是生产 `.env`，不要直接 `scp .env.local` 上去**。开发机的 `.env.local` 顶部就标着 `# Local development env. Real values are placeholders.`，里面的 `APP_PASSWORD=3063210` 是占位符——bootstrap 会把它当真密码 bcrypt 进 DB，之后用任何"你以为设过"的密码都登录不上去。正确的做法：在开发机 PowerShell 跑两次 `openssl rand -hex 32`，把结果填到下方模板的 `JWT_SECRET` / `ENCRYPTION_KEY`；`APP_PASSWORD` 填你自己想用的强密码（≥12 字符）。

然后在 `ai-kb` 文件夹里新建 `.env` 文件（注意名字以点开头），写入：

```ini
# ===== 应用密码 =====
APP_PASSWORD=你的初始密码

# ===== 密钥（开发机执行 openssl rand -hex 32 生成）=====
JWT_SECRET=执行openssl生成的结果填这里
ENCRYPTION_KEY=执行openssl生成的结果填这里

# ===== 路径（不要改）=====
DB_PATH=/app/data/kb.db
UPLOADS_DIR=/app/uploads
BACKUPS_DIR=/app/backups

# ===== 运行（不要改）=====
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
```

两个密钥在开发机 PowerShell 里跑两次 `openssl rand -hex 32` 生成。

---

## 第 2 步：构建镜像（二选一）

### 方式 A：开发机构建后传输（推荐 Windows 用户）

在**开发机**上：

```powershell
cd C:\coding\knowledge-base

# 强制 x86_64，匹配 QNAP TS-564 等 Intel CPU
docker build --platform linux/amd64 -f docker/Dockerfile -t ai-kb:latest .

docker save -o ai-kb.tar ai-kb:latest
scp ai-kb.tar WANGXIN@192.168.50.198:/share/Container/
```

NAS 上导入：

```bash
ssh WANGXIN@192.168.50.198
cd /share/Container
docker load -i ai-kb.tar
```

> 文中 `/share/Container/ai-kb` 是示例路径，你可以换成自己的，比如 `/share/my-docker/ai-kb`，只要 `docker run` 里的 `-v` 挂载保持一致即可。

> 加 `--platform linux/amd64` 可以彻底避免 `better-sqlite3` 的 `Exec format error`，省掉每次进容器 `apk add + npm rebuild` 的步骤。

### 方式 B：在 NAS 上直接构建（不需要传 tar）

适合 NAS 性能足够、或者不想在 Windows 上装 Docker 的用户：

```bash
ssh WANGXIN@192.168.50.198
cd /share/Container
git clone <你的仓库地址> ai-kb-src
cd ai-kb-src
docker build -f docker/Dockerfile -t ai-kb:latest .
```

> 也可以把整个项目目录用 `scp -r` 或 File Station 上传到 NAS，不用 git。

---

## 第 3 步：启动并初始化

### 方式 A 后续：docker run

继续在 NAS 的 SSH 里执行：

```bash
# 升级前建议先备份数据库（好习惯）
cp /share/Container/ai-kb/data/kb.db \
   /share/Container/ai-kb/backups/kb-$(date +%Y%m%d-%H%M%S).db

# 停掉旧容器
docker stop ai-kb && docker rm ai-kb

# 确保 .env 权限正确（容器 uid 1001 可读，你也能在宿主上 cat 自检）
sudo chown 1001 /share/Container/ai-kb/.env
sudo chmod 644 /share/Container/ai-kb/.env
cat /share/Container/ai-kb/.env

# 起新容器
docker run -d \
  --name ai-kb \
  --restart unless-stopped \
  -p 3001:3000 \
  -e TZ=Asia/Shanghai \
  -v /share/Container/ai-kb/data:/app/data \
  -v /share/Container/ai-kb/uploads:/app/uploads \
  -v /share/Container/ai-kb/backups:/app/backups \
  -v /share/Container/ai-kb/.env:/app/.env:ro \
  ai-kb:latest

# 首次或 schema 升级时初始化
docker exec -it ai-kb npm run bootstrap
```

> 这里用 `3001:3000` 是示例（避免和 NAS 上其他 3000 端口服务冲突）。deploy 文档默认用 `3000:3000`，你自己选一个，反代/浏览器访问时保持一致即可。

### 方式 B 后续：docker compose

```bash
cd /share/Container/ai-kb-src

# 项目自带的 compose 默认是群晖路径，QNAP 上要改
sed -i 's|/volume1/docker/ai-kb|/share/Container/ai-kb|g' docker-compose.yml

docker compose up -d
docker exec -it ai-kb npm run bootstrap
```

### 判断成功

看到下面输出即成功：

```text
[bootstrap] applied migrations v1 (now at v10)
[auth] initial password hashed and stored. You can now remove APP_PASSWORD from .env.
[bootstrap] ready — password hash present in settings table
```

---

## 第 4 步：访问

浏览器打开 `http://你的NAS内网IP:3000`。如果你在 `docker run` 里用了 `-p 3001:3000`，就访问 `http://NAS_IP:3001`。

输入 `.env` 里设的 `APP_PASSWORD`，登录即可。

搞定。后续配好内网穿透后再回来看是否需要加 HTTPS。

### 4.1 LAN agent 访问（Bearer token）

如果同网段另一台机器（脚本、CI、另一个 Claude Code 实例）想直接调 `/api/*`，给它发一个长期 Bearer token，免 cookie：

1. 浏览器登录 → 左侧栏 **设置 → Agent → API Token** → **生成**。界面会一次性显示 64 位 hex，**立刻复制**到调用方机器。
2. 调用方：

   ```bash
   curl -sS --noproxy '*' \
     -H "Authorization: Bearer $TOKEN" \
     "http://192.168.50.198:3001/api/notes"
   ```

3. `POST /api/notes` 直接传 Markdown：

   ```bash
   curl -sS --noproxy '*' \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"title":"smoke","contentMarkdown":"# h\n\nbody","tags":["smoke"]}' \
     "http://192.168.50.198:3001/api/notes"
   ```

4. token 哈希存在 `/share/Container/ai-kb/data/kb.db` 的 `settings` 表里，**重建镜像不会重置**；要轮换在设置页点 **重新生成**，撤销点 **清除**。

---

## 第 5 步：常见踩坑（QNAP / Container Station 特有）

> 群晖 `deploy-synology.md` §11 的故障表也覆盖了部分通用问题，但 QNAP 上有几个 Container Station 特有的坑，遇到时按下面排查。

### 5.1 `.env` 被建成了目录

**症状**：`npm run bootstrap` 报

```
node: .env: invalid format
```

**原因**：在 Container Station 文件管理面板「右键 → 新建」时，UI 默认动作有时是「新建文件夹」而不是「新建文件」。Node 的 `--env-file-if-exists=.env` 拿到目录就报格式错。

**定位**：

```bash
wc -c /share/Container/ai-kb/.env
# 期望: 数字
# 异常: wc: .../.env: Is a directory
```

**修法**：

```bash
rmdir /share/Container/ai-kb/.env
cat > /share/Container/ai-kb/.env <<'EOF'
APP_PASSWORD=ChangeMe-Init-2026
JWT_SECRET=<开发机openssl rand -hex 32生成>
ENCRYPTION_KEY=<开发机openssl rand -hex 32生成>

DB_PATH=/app/data/kb.db
UPLOADS_DIR=/app/uploads
BACKUPS_DIR=/app/backups

NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
EOF
```

### 5.2 `.env` 文件 owner 与容器内 uid 不匹配

**症状**：

- `head -3 /share/Container/ai-kb/.env` → `Permission denied`
- `npm run bootstrap` 在 Node 层报 `.env not found. Continuing without it.`，接着 `lib/env.ts` 抛 `Missing required env var: JWT_SECRET`

**原因**：QNAP 上用 `cat >` 创建的文件默认 owner 是 QTS 的系统用户（uid 1000，`node`），权限 600。但容器跑的是 `ai-kb`（uid 1001）。差一个 uid 就读不到文件——`ls -la` 能看到元数据，`head` 读不到内容。

**定位**：

```bash
stat -c '%U %u %a' /share/Container/ai-kb/.env
# 期望: uid 1001，权限 600 或 644（uid 对就行，用户名容器外叫啥不重要）
# 异常: node 1000 600 或 wujing 1000 600（QNAP 上 uid 1000 的用户名可能是 node / wujing / 其他，都算异常）
```

**修法**：

```bash
sudo chown 1001 /share/Container/ai-kb/.env

# 推荐 600（最安全，只有 uid 1001 能读）
sudo chmod 600 /share/Container/ai-kb/.env

# 如果你需要 WANGXIN 在宿主上直接 cat/编辑 .env，用 644
# sudo chmod 644 /share/Container/ai-kb/.env

# 自检
stat -c '%U %u %a' /share/Container/ai-kb/.env
# 现在应该是: 任意名 1001 600/644（uid 对就行，用户名容器外叫啥不重要）
```

> 单用户内网场景下 `644` 也可以接受；多用户/公网暴露建议 `600`。

### 5.3 `better-sqlite3` 架构不匹配（`Exec format error`）

**症状**：`npm run bootstrap` 报

```
Error loading shared library /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node: Exec format error
    code: 'ERR_DLOPEN_FAILED'
```

**原因**：`better-sqlite3` 是 native 编译模块，编译时锁定 CPU 指令集。如果你在开发机（Windows 可能是 ARM）重新构建镜像并 `docker load` 到 NAS（QNAP TS-564 是 Intel x86_64），新旧镜像的 `.node` 二进制指令集对不上。

**定位**：

```bash
# 容器内核架构（QNAP 应该是 x86_64）
docker exec ai-kb uname -m
# 期望: x86_64

# 镜像声明的架构
docker inspect ai-kb:latest --format '{{.Architecture}} {{.Os}}'
# 期望: amd64 linux
# 异常: arm64 linux（说明构建环境是 ARM Windows/Mac）

# 镜像内二进制实际架构
docker exec ai-kb file /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
# 期望: ELF 64-bit LSB shared object, x86-64, ...
# 异常: ELF 64-bit LSB shared object, ARM aarch64, ...
```

**修法 A（推荐）**：开发机构建时强制 amd64

```powershell
docker build --platform linux/amd64 -f docker/Dockerfile -t ai-kb:latest .
docker save -o ai-kb.tar ai-kb:latest
```

**修法 B（推荐用于长期）**：直接在 NAS 上构建——架构天然匹配，无需折腾

```bash
ssh WANGXIN@NAS_IP
cd /share/Container
git clone <你的仓库地址> ai-kb-src      # 或 scp 上传源码
cd ai-kb-src
docker build -f docker/Dockerfile -t ai-kb:latest .
```

**修法 C（fallback）**：在容器内重 build native 模块

```bash
docker exec -u root ai-kb apk add --no-cache python3 build-base
docker exec -u root ai-kb npm rebuild better-sqlite3
```

> 修法 C 每次升级镜像都要重做。修法 A/B 一次解决。

### 5.4 `data/` / `uploads/` / `backups/` 目录 owner 不对

**症状**：`npm run bootstrap` 报

```
SqliteError: attempt to write a readonly database
    code: 'SQLITE_READONLY'
```

**原因**：在 File Station 上右键建的子目录 owner 是 WANGXIN（你的 SSH 登录用户），权限 755——只有 owner 能写。容器进程是 uid 1001，写不进 `/app/data/`，SQLite 就拒绝写库。

**修法**：

```bash
sudo chown -R 1001:1001 /share/Container/ai-kb/data \
                          /share/Container/ai-kb/uploads \
                          /share/Container/ai-kb/backups

# 自检：1001 应该能写
docker exec -u 1001 ai-kb touch /app/data/.write-test && \
docker exec -u 1001 ai-kb rm /app/data/.write-test && \
echo "data dir writable"
```

> 三个目录一起 chown——`uploads/` 和 `backups/` 后面写图片/备份时也是同一个问题，提前改省事。

---

## 附录：成功路径的一气呵成脚本（方式 A：开发机构建 + save/load）

跳过所有踩坑的最终序列，复制粘贴即可。假设：
- 开发机 Windows，项目路径 `C:\coding\knowledge-base`
- NAS 路径 `/share/Container/ai-kb`
- NAS 上 SSH 登录用户 `WANGXIN`，IP `192.168.50.198`

### 1. 开发机：构建并导出

```powershell
cd C:\coding\knowledge-base

# 强制 amd64，匹配 QNAP x86_64
docker build --platform linux/amd64 -f docker/Dockerfile -t ai-kb:latest .

docker save -o ai-kb.tar ai-kb:latest
scp ai-kb.tar WANGXIN@192.168.50.198:/share/Container/
```

### 2. NAS：导入镜像并启动

```bash
ssh WANGXIN@192.168.50.198

# 0. 准备目录
sudo mkdir -p /share/Container/ai-kb/{data,uploads,backups}
sudo chown -R 1001:1001 /share/Container/ai-kb/data \
                          /share/Container/ai-kb/uploads \
                          /share/Container/ai-kb/backups

# 1. 创建 .env（密钥用 openssl 在开发机 PowerShell 生成）
sudo tee /share/Container/ai-kb/.env > /dev/null <<'EOF'
APP_PASSWORD=ChangeMe-Init-2026
JWT_SECRET=<粘贴openssl结果1>
ENCRYPTION_KEY=<粘贴openssl结果2>

DB_PATH=/app/data/kb.db
UPLOADS_DIR=/app/uploads
BACKUPS_DIR=/app/backups

NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
EOF
sudo chown 1001 /share/Container/ai-kb/.env
sudo chmod 644 /share/Container/ai-kb/.env

# 2. 加载镜像
cd /share/Container
docker load -i ai-kb.tar

# 3. 停旧起新（首次没有旧容器会报错，忽略）
docker stop ai-kb 2>/dev/null && docker rm ai-kb 2>/dev/null

docker run -d \
  --name ai-kb \
  --restart unless-stopped \
  -p 3001:3000 \
  -e TZ=Asia/Shanghai \
  -v /share/Container/ai-kb/data:/app/data \
  -v /share/Container/ai-kb/uploads:/app/uploads \
  -v /share/Container/ai-kb/backups:/app/backups \
  -v /share/Container/ai-kb/.env:/app/.env:ro \
  ai-kb:latest

# 4. Bootstrap（首次或 schema 升级）
docker exec -it ai-kb npm run bootstrap

# 5. 自检
docker exec -u 1001 ai-kb touch /app/data/.write-test && \
  docker exec -u 1001 ai-kb rm /app/data/.write-test && \
  echo "OK"
```

### 3. 后续升级

只有镜像变了，数据不动：

```bash
# 开发机
cd C:\coding\knowledge-base
docker build --platform linux/amd64 -f docker/Dockerfile -t ai-kb:latest .
docker save -o ai-kb.tar ai-kb:latest
scp ai-kb.tar WANGXIN@192.168.50.198:/share/Container/

# NAS
ssh WANGXIN@192.168.50.198
cp /share/Container/ai-kb/data/kb.db \
   /share/Container/ai-kb/backups/kb-$(date +%Y%m%d-%H%M%S).db
docker stop ai-kb && docker rm ai-kb
docker load -i /share/Container/ai-kb.tar
docker run -d \
  --name ai-kb \
  --restart unless-stopped \
  -p 3001:3000 \
  -e TZ=Asia/Shanghai \
  -v /share/Container/ai-kb/data:/app/data \
  -v /share/Container/ai-kb/uploads:/app/uploads \
  -v /share/Container/ai-kb/backups:/app/backups \
  -v /share/Container/ai-kb/.env:/app/.env:ro \
  ai-kb:latest

# schema 有更新才跑 bootstrap，否则不需要
docker exec -it ai-kb npm run bootstrap
```

### 4. 预期输出

```text
[bootstrap] applied migrations v1 (now at v10)
[auth] initial password hashed and stored. You can now remove APP_PASSWORD from .env.
[bootstrap] ready — password hash present in settings table
```

成功后浏览器访问 `http://NAS_IP:3001`（如果你用 `-p 3000:3000` 就访问 `http://NAS_IP:3000`），用 `.env` 里的 `APP_PASSWORD` 登录。
