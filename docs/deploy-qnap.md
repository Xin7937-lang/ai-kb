# 威联通 NAS 部署（内网版）

> 全程 4 步，手机浏览器打开 `http://NAS内网IP:3000` 即可使用。

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

## 第 2 步：构建镜像

在**开发机**（就是你现在的电脑）上：

```powershell
cd C:\opencode-space\knowledge-base

# 构建
docker build -f docker/Dockerfile -t ai-kb:latest .

# 导出为 tar
docker save -o ai-kb.tar ai-kb:latest

# 上传到 NAS（把 192.168.x.x 换成你的 NAS IP）
scp ai-kb.tar WANGXIN@192.168.50.198:/share/Container/
```

SSH 到 NAS 导入：

```bash
ssh WANGXIN@192.168.50.198
cd /share/Container
docker load -i ai-kb.tar
```

---

## 第 3 步：启动

继续在 NAS 的 SSH 里执行：

```bash
docker run -d \
  --name ai-kb \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /share/Container/ai-kb/data:/app/data \
  -v /share/Container/ai-kb/uploads:/app/uploads \
  -v /share/Container/ai-kb/backups:/app/backups \
  -v /share/Container/ai-kb/.env:/app/.env:ro \
  ai-kb:latest
```
如果报错：
 旧容器还在跑，先停掉再删：

  docker stop ai-kb
  docker rm ai-kb

  然后重跑 docker run -d ... 那条命令。

然后进去初始化数据库：

```bash
docker exec -it ai-kb npm run bootstrap
```


看到 `ready — password hash present` 即成功。

---

## 第 4 步：访问

浏览器打开 `http://你的NAS内网IP:3000`，输入 `.env` 里设的 `APP_PASSWORD`，登录即可。

搞定。后续配好内网穿透后再回来看是否需要加 HTTPS。
