# 群晖部署手册

> 目标读者：会用 DSM 桌面（File Station、Container Manager、控制面板），但没部署过 Node.js 应用的人。
> 全程复制粘贴即可，不需要懂 Next.js 或 Docker 原理。

---

## 0. 前提

开始之前，请确认你的 NAS 满足以下条件：

- 群晖 **DSM 7.x**（7.1 或更新）。
- **Container Manager** 套件已安装。早期版本叫 Docker，两个是同一个东西。
- **Web Station** 套件已安装（反代需要它）。
- `/volume1` 至少 **1 GB** 可用空间。建议 SSD 卷。
- 浏览器能正常访问 DSM 桌面。

可选：

- 一个公网域名 + DNS 解析记录，用来签发 Let's Encrypt 证书（内网用可以跳过）。
- SSH 客户端（Windows 自带的 PowerShell 即可），方便拷贝文件。
- 一个 AI 模型的 API Key（DeepSeek / 智谱 / 阶跃 / 自定义都行）。这一步后面再配也行。

---

## 1. 准备目录

NAS 上要有一个固定目录存放数据、配置、上传的图片。

**用 File Station 操作：**

1. 打开 **File Station**。
2. 进入 `/volume1/docker/`。如果 `docker` 文件夹不存在，右键空白处 → 新建文件夹。
3. 在 `docker` 下新建文件夹 `ai-kb`。
4. 进入 `ai-kb`，再依次新建三个子目录：`data`、`uploads`、`backups`。

最终结构：

```
/volume1/docker/ai-kb/
├── data/
├── uploads/
└── backups/
```

**SSH 等价命令**（开了 SSH 的可以直接用）：

```bash
ssh admin@your-nas.local
sudo mkdir -p /volume1/docker/ai-kb/{data,uploads,backups}
ls -la /volume1/docker/ai-kb/
```

**预期看到：** `data  uploads  backups` 三个空目录。

---

## 2. 生成 `.env`

应用的密钥和初始密码都存在一个 `.env` 文件里。位置在 `/volume1/docker/ai-kb/.env`。

### 2.1 创建并编辑

先在开发机或 NAS 上用文本编辑器创建这个文件（File Station 选中 `ai-kb` 文件夹 → 右键 → 新建文件 → 命名为 `.env`，注意前面有点）。

如果你在本机有项目源码（路径在 `C:\opencode-space\knowledge-base\`），最快的办法是先在源码里准备好再上传：

```bash
cd C:\opencode-space\knowledge-base
cp .env.example .env
notepad .env
```

### 2.2 填入两个 64 字符密钥

在 PowerShell 或 SSH 里执行两次：

```bash
openssl rand -hex 32
```

把每次的输出（共 64 个十六进制字符）填到 `.env` 对应字段：

- `JWT_SECRET`：JWT Cookie 签名密钥。
- `ENCRYPTION_KEY`：模型 API Key 加密密钥。

**这两个密钥绝不能丢，丢了所有已存的模型 API Key 全部作废，必须重新录入。**

### 2.3 设置初始密码

在 `.env` 里写：

```bash
APP_PASSWORD=你的初始密码明文
```

首次启动时，应用会自动把这个明文密码用 bcrypt 哈希写入数据库的 `settings` 表。之后你可以从 `.env` 里把这行删掉或注释掉（应用启动后只用数据库里的 hash 值）。

### 2.4 完整示例

`.env` 长这样（占位值，请用你自己的）：

```bash
# ===== 应用 =====
APP_PASSWORD=MySecret-Init-Pass-2026
JWT_SECRET=3f8a1c0b9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90
ENCRYPTION_KEY=9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a3928170615f4e3d2c1b0a

# ===== 路径（容器内绝对路径）=====
DB_PATH=/app/data/kb.db
UPLOADS_DIR=/app/uploads
BACKUPS_DIR=/app/backups

# ===== 运行 =====
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
```

### 2.5 警告

- `.env` 文件**绝不能 commit 到 git**。项目根目录的 `.gitignore` 已经忽略了它，但请勿手动 `git add -f`。
- 复制好之后，**用 SSH 或 File Station 把这个 `.env` 传到 NAS 的 `/volume1/docker/ai-kb/.env`**。

**预期看到：** File Station 里能看见 `/volume1/docker/ai-kb/.env` 这个文件，且大小不是 0 字节。

---

## 3. 构建镜像（两种方式）

镜像里装着 Next.js 编译好的产物。两种方式选一个。

### 方式 A：开发机构建后传输（推荐给熟悉命令行的人）

在**开发机**（Windows、Mac、Linux 都行）执行：

```bash
# 1. 构建镜像
cd C:\opencode-space\knowledge-base
docker build -f docker/Dockerfile -t ai-kb:latest .

# 2. 导出为 tar 文件
docker save -o ai-kb.tar ai-kb:latest

# 3. 上传到 NAS
scp ai-kb.tar WANGXIN@192.168.50.198:/volume1/docker/
```

然后 SSH 到 NAS：

```bash
ssh admin@your-nas.local
cd /volume1/docker
docker load -i ai-kb.tar
docker images | grep ai-kb
```

**预期看到：** `ai-kb   latest   <镜像ID>   <时间>   <大小>`。

### 方式 B：Container Manager 从源码构建（推荐给不想离开 DSM UI 的人）

1. 把整个项目目录上传到 NAS。比如用 File Station 拖拽到 `/volume1/docker/ai-kb-src/`，或者在 NAS 上 `git clone`：

   ```bash
   ssh admin@your-nas.local
   cd /volume1/docker
   sudo git clone <你的仓库地址> ai-kb-src
   ```

2. 确保 NAS 已经有 `/volume1/docker/ai-kb/{data,uploads,backups,.env}`（前面 §1、§2 已经建好）。

3. 把源码目录里的 `docker-compose.yml` 路径同步：默认 compose 在源码根目录（即 `/volume1/docker/ai-kb-src/docker-compose.yml`）。检查挂载路径与 §1、§2 的目录一致。

4. 打开 **Container Manager** → 左侧栏 **项目** → 右上 **创建**。
5. 项目名称填 `ai-kb`，路径选 `/volume1/docker/ai-kb-src`，来源选 `docker-compose.yml`，勾选「构建项目」后点 **下一步**。
6. Web UI 展示 compose 解析出的服务列表，确认无误后点 **完成**。
7. Container Manager 自动 `docker compose build` 并启动。

**预期看到：** 项目列表里出现 `ai-kb`，状态显示「运行中」。

---

## 4. 启动容器

启动前**先跑一次 bootstrap**——这一步会建表 + 把 `.env` 里的 `APP_PASSWORD` 写进数据库的 `settings` 表。**没有这一步，登录会报 500**（表不存在）。

```bash
# SSH 到 NAS 后，进入项目目录（如果走方式 A：源码在 ~/ai-kb 这种位置）
cd /volume1/docker/ai-kb      # 改成你实际放源码的路径
npm install --omit=dev        # 第一次需要；安装 tsx 等跑脚本用的工具
npm run bootstrap
```

**预期看到**：

```text
[bootstrap] applied migrations v1 (now at v1)
[auth] initial password hashed and stored. You can now remove APP_PASSWORD from .env.
[bootstrap] ready — password hash present in settings table
```

如果 `APP_PASSWORD` 在 `.env` 里是空的，第三行会变成 `no password configured. Set APP_PASSWORD ...`。在那种情况下后续要在应用里设置密码（M3+ UI 待做，临时只能重新跑一遍 bootstrap）。

> **为什么不是「容器启动时自动跑」？** Next.js 14.2.7 的 `instrumentationHook: true` 在某些环境下会触发一个 webpack bug（"stream did not contain valid UTF-8"），所以 MVP 阶段我们把 hook 禁用了，改成显式 bootstrap。如果你以后升级到 Next.js 15 或 bug 修复了，可以把 `next.config.mjs` 里的注释删掉并启用 hook，省掉手动这一步。

启动后**做三件事**确认正常：

1. **看容器状态**：Container Manager → 容器 → 找 `ai-kb` → 状态应该是绿色的「运行中」。
2. **看日志**：点容器名 → 日志。看到 `Ready in ...ms` 即可（不会有 `[db]` 之类日志了，那些是 bootstrap 阶段输出的）。
3. **HTTP 自检**：SSH 到 NAS 后执行：

   ```bash
   curl -I http://localhost:3000
   ```

   **预期看到：** `HTTP/1.1 307 Temporary Redirect` 或 `HTTP/1.1 302 Found`，Location 头指向 `/login`。这表示应用跑起来了，根路径被中间件重定向到登录页。

如果 curl 直接返回 `Connection refused`，回到 Container Manager 看容器是否在 Running、端口映射是否正确（应当是 `127.0.0.1:3000:3000`）。

---

## 5. Web Station 反向代理

容器现在监听 `127.0.0.1:3000`，只能 NAS 本机访问。要让浏览器通过域名访问，需要 Web Station 做反代。

### 5.1 新版 Web Station（DSM 7.2+，网页服务门户）

1. 打开 **Web Station** → 左侧 **网页服务门户**。
2. 点 **创建** → 服务门户类型选 **基于名称**（子域名）或 **基于端口** 都行。
3. 服务门户名称：填你喜欢的，例如 `AI 知识库`。
4. 文档根目录：随便指一个空目录（比如 `/volume1/web/ai-kb`），本应用不直接用。
5. **添加 HTTP 反向代理规则**：
   - 来源协议：HTTPS（端口 443）如果你打算上证书；或 HTTP（端口 80）测试用。
   - 来源主机名：填你要用的访问域名，比如 `kb.your-nas.local`（内网）或 `kb.example.com`（公网）。
   - 来源端口：443 或 80。
   - 目的地协议：HTTP。
   - 目的地主机名：`localhost`。
   - 目的地端口：`3000`。
6. **关键：勾选 "WebSocket"**。流式摘要用 SSE 协议传输，Next.js 在某些情况下也会用到 WebSocket。不勾会导致 AI 摘要卡住。
7. 保存。

### 5.2 旧版（登录门户 + 反向代理）

如果你的 DSM 还是旧版界面：

1. **控制面板** → **登录门户** → **高级**。
2. 底部「反向代理服务器」点 **创建**：
   - 来源：`https://kb.your-nas.local:443`（或你想用的子路径，比如 `https://nas.local/kb`）。
   - 目的地：`http://localhost:3000`。
3. **必须勾选 WebSocket 支持**。
4. 保存。

### 5.3 验证

浏览器访问你配的域名（内网用 IP 走 mDNS，比如 `http://kb.your-nas.local`，需 NAS 开启了 `.local` 多播域名）。如果内网不能解析，可以直接用 NAS 内网 IP，比如 `http://192.168.1.100`。

**预期看到：** 页面跳转到 `/login` 的登录界面。如果还是 502 或超时，看 §11 故障排查。

---

## 6. HTTPS

没有 HTTPS 的话，登录密码和 API Key 都是明文在网络里传。强烈建议上线前就配好。

### 方案 A：DSM 自带 Let's Encrypt（推荐用于内网 + 公网都能访问）

1. **控制面板** → **外部访问** 或 **安全性** → **证书**。
2. 点 **添加** → **从 Let's Encrypt 获取**。
3. 填你的域名（比如 `kb.example.com`）和邮箱。Let's Encrypt 会验证 DNS 解析记录。
4. 证书签发后，回到 **Web Station** → 你的服务门户 → 编辑 → 绑定刚才那张证书。

适用于有公网域名 + 80/443 端口可达的情况。

### 方案 B：Cloudflare 代理 + Origin Certificate（适合已有 CDN 的人）

1. 域名 NS 到 Cloudflare。
2. Cloudflare 后台 → **SSL/TLS** → **Origin Server** → **Create Certificate**。
3. 把生成的 `cert.pem` 和 `key.pem` 上传到 NAS。
4. **控制面板** → **证书** → **添加** → **导入已有证书**，导入那两个文件。
5. Web Station 服务门户绑定该证书。
6. Cloudflare 里把 DNS 记录的代理开关打开（小黄云变橙云），SSL 模式选 **Full (Strict)**。

这种方式下浏览器到 Cloudflare 是 HTTPS，Cloudflare 到 NAS 也是 HTTPS，但 NAS 本身不需要暴露 80/443 给公网（只暴露 Cloudflare IP 段）。

### 方案 C：自签证书（仅内网测试用）

1. **控制面板** → **证书** → **添加** → **创建自签名证书**。
2. 填一个内网主机名，比如 `kb.your-nas.local`。
3. Web Station 绑定。
4. 浏览器第一次访问会提示「您的连接不是私密连接」，需要手动点「高级」→ 「继续前往」。

**仅用于内网测试**。生产环境别用。

**预期看到：** 浏览器地址栏出现小锁，访问不报「不安全」。

---

## 7. 首次访问

1. 浏览器打开你配的域名。
2. 自动跳转到 `/login`。
3. 输入 `.env` 里 `APP_PASSWORD` 的明文值（首次登录）。
4. 登录成功 → 跳到笔记列表首页，看到「还没有笔记，新建第一篇」之类的空状态。

**首次登录后的安全操作：**

- 登录后立即在应用里测试一遍：新建一篇笔记、输几个字、保存。确认能保存。
- **修改密码**：登录后点击左侧栏 → **设置** → **账户**，在「修改密码」表单中填写当前密码和新密码后保存。修改成功后下次登录使用新密码即可。
  - 若忘记了当前密码，仍可通过 SSH 到 NAS 编辑 `/volume1/docker/ai-kb/.env` 的 `APP_PASSWORD`，然后在项目目录下重新运行 `npm run bootstrap` 来重置密码。

---

## 8. 配置 AI 模型

不配模型的话，「生成摘要」会失败。配一下：

1. 左侧栏 → **设置** → **模型**。
2. 点 **新建模型**。
3. 选一个 Preset（脚手架），系统会自动填好 `baseUrl` 和默认 `model` 名：

   | Preset | baseUrl | model 字段（默认） |
   |---|---|---|
   | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
   | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
   | 阶跃 StepFun | `https://api.stepfun.com/v1` | `step-1-8k` |
   | 自定义 | 自己填 | 自己填 |

4. 填入你在该模型厂商后台申请的 **API Key**。
5. 名称随便起，比如「我的 DeepSeek」。
6. 点 **测试连接**。成功会显示「OK」或类似提示；失败会显示厂商返回的错误（401 大概率是 Key 错，404 大概率是 baseUrl 错）。
7. 勾选「设为默认」并保存。

**验证流式摘要：**

- 进任意一篇笔记（新建一篇也行）。
- 顶部点 **生成摘要**。
- 摘要应该一个字一个字地「流」出来，而不是等几秒一次性蹦出来。

**预期看到：** 摘要区域下方出现一段流式渲染的中文总结（用 DeepSeek 的话大约几秒内出完整段）。

---

## 9. 数据备份

### 9.1 应用层备份（在网页里操作）

- 进首页（笔记列表）→ 顶部 **导出全部** 按钮。
- 浏览器会下载一个 zip，文件名形如 `kb-backup-2026-06-03.zip`，里面包含：
  - `kb-<时间戳>.db`：SQLite 数据库快照（笔记、标签、模型配置、设置）。
  - `uploads/<年月>/...`：所有上传过的图片。

把 zip 存到 NAS 之外的地方（外接硬盘、网盘、电脑本地）。这是**应用可理解的备份格式**，换机器时直接恢复。

### 9.2 系统层备份（DSM Hyper Backup）

1. 打开 **Hyper Backup**。
2. 新建任务 → 备份源选 `/volume1/docker/ai-kb/`。
3. 目的地：外接 USB 硬盘 / 另一台 Synology / 远程 rsync / 等等。
4. 计划：每天凌晨 3 点跑一次。
5. 启用「智能回收」或「版本轮换」防止硬盘塞满。

这种方式备份的是**整个目录的原样**（包括 `.env`、运行时的 db 文件、上传图片、临时备份）。做整盘还原时最方便。

### 9.3 恢复

- **应用层 zip 备份**：把 zip 解压，把 `kb-<时间戳>.db` 重命名为 `kb.db`，覆盖到 `/volume1/docker/ai-kb/data/kb.db`。把解压出的 `uploads/` 整目录覆盖到 `/volume1/docker/ai-kb/uploads/`。然后 Container Manager 重启 `ai-kb` 容器。**[计划 M3+]** 提供图形化恢复入口。
- **Hyper Backup 整盘还原**：直接恢复 `/volume1/docker/ai-kb/` 到原路径，重启容器即可。

### 9.4 推荐

两种都做。Hyper Backup 兜底整盘灾难，导出 zip 方便跨设备迁移。

---

## 10. 升级

每次发新版本（`docs/CHANGELOG` 会有说明），按下面任一方式升级。

### 方式 A：在 NAS 上 git pull + 重新构建

```bash
ssh admin@your-nas.local
cd /volume1/docker/ai-kb-src
sudo git pull
cd /volume1/docker/ai-kb-src
docker compose build --pull
docker compose up -d
```

### 方式 B：本地构建新镜像再 load

```bash
# 开发机
cd C:\opencode-space\knowledge-base
git pull
docker build -f docker/Dockerfile -t ai-kb:latest .
docker save -o ai-kb.tar ai-kb:latest
scp ai-kb.tar admin@your-nas.local:/volume1/docker/

# NAS
ssh admin@your-nas.local
cd /volume1/docker
docker load -i ai-kb.tar
docker compose -f /volume1/docker/ai-kb-src/docker-compose.yml up -d
```

**升级后验证：** 浏览器刷新 → 首页正常显示 → 笔记列表里原有笔记都还在。

**数据不会被升级动作影响**。数据库结构变更由应用启动时自动迁移。

---

## 11. 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| 容器启动后立刻退出（exited 状态） | `.env` 缺 `JWT_SECRET` 或 `ENCRYPTION_KEY`，或长度不是 64 hex | 重新执行 `openssl rand -hex 32`，检查 .env 无空格无换行错位 |
| `/api/uploads` 返回 500 | `data/` 或 `uploads/` 目录权限不对，容器内用户（uid 1001）写不进去 | SSH 执行 `sudo chown -R 1001:1001 /volume1/docker/ai-kb/data /volume1/docker/ai-kb/uploads` |
| 笔记保存后再也搜不到 | FTS5 索引没刷新（极少出现） | Container Manager 重启 `ai-kb`，启动时会跑一次 `INSERT INTO notes_fts(notes_fts)` 重建 |
| 「生成摘要」卡住没反应 | Web Station 反代没勾 WebSocket | 回到 §5，编辑反代规则，**勾上 WebSocket** |
| 反代访问返回 502 | 容器没跑起来 | Container Manager → 容器 → 看 `ai-kb` 状态，重启它 |
| 浏览器一直转圈，最后报「无法连接」 | 域名解析不对，或 Web Station 没启用 | 直接用 NAS IP 试一下（比如 `http://192.168.1.100`），如果 IP 能访问就是域名问题 |
| 登录后看到旧数据 | 浏览器缓存 | 硬刷新：Ctrl+Shift+R（Mac: Cmd+Shift+R） |
| 测模型时显示 401 | API Key 错 | 重新去厂商后台复制，注意没有前后空格 |
| 测模型时显示 404 | baseUrl 错 | 检查自定义模型那栏的 URL，常见错误：少了 `/v1`、多了路径尾巴 |
| 迁移到新 NAS | 没有用导出 zip，单纯拷贝 `data/` | 用 §9.1 的「导出全部」做迁移载体最稳 |

---

## 12. 安全提醒

- **强密码**：`APP_PASSWORD` 至少 12 字符，建议含大小写数字符号。
- **定期换 API Key**：每 3-6 个月到模型厂商后台轮换一次。换了之后在「设置 → 模型」里点编辑，替换 Key 即可。
- **启用 DSM 自动更新**：控制面板 → 更新与还原 → 自动更新，重要补丁别错过。
- **不要直接暴露 NAS 到公网**：把 5000/5001 端口直接映射到公网是危险操作。如果必须从外部访问：
  - 用 **Cloudflare Tunnel**（推荐，零端口暴露）。
  - 或 VPN（Tailscale / WireGuard）连回家再访问。
  - **[计划 M5]** 后续会出公网部署专题。
- **限制反代来源 IP**（可选）：Web Station 高级设置里可以加 IP 白名单，仅允许家庭 / 办公网段访问。
- **.env 权限**：`chmod 600 /volume1/docker/ai-kb/.env` 防止其他用户读取。
- **关掉没用的 DSM 应用**：MailPlus、Photo Station 之类的你不用就别开，扩大攻击面没好处。

---

完成以上 12 步，你的 AI 知识库就跑起来了。日常使用就是：写笔记、配模型、生成摘要。备份按 §9 设好就基本可以忘掉它了。
