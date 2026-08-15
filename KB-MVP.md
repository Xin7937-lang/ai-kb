# AI 个人知识库 MVP - 落地方案

> 本文件为项目规划阶段产出物，记录 MVP 的全部决策与执行路线图。
> 后续开发与部署均以此为依据，如有调整需同步更新本文档。

---

## 1. 项目目标与范围

构建一个**单用户的 AI 个人知识库**，运行在群晖 NAS 上，通过 Web Station 反向代理对内网提供服务。

### 1.1 MVP 包含

- **M1 基础**：单密码登录、笔记 CRUD（图文）、标签、全文搜索
- **M2 导入导出**：Markdown / TXT / zip 导入；单篇 zip / 全量备份 zip 导出
- **M3 AI 摘要 + 模型管理**：多家国内模型可配置切换；笔记一键流式摘要
- **M4 与笔记对话（RAG-lite）**：FTS5 + sqlite-vec 混合检索，RRF 融合；可选 web search 兜底
- **M5 Agent 工具调用（stage 1 + 2）**：`read_note` / `create_note` / `edit_note` / `delete_note`；开关默认关闭；写操作全量审计；单回合限额；spec 与 ticket 历史见 `docs/agent-crud/`

### 1.2 MVP 明确不包含（后续迭代）

| 功能 | 计划阶段 | 备注 |
|---|---|---|
| PDF 导入 | 后续 | 当前需求少，预留接口位 |
| 公网部署（Vercel / 阿里云 VPS） | 后续 | 用户暂不熟悉流程 |
| 多用户 / 注册 | 不计划 | 定位为个人自用 |
| 网页链接抓取 | 后续 | |
| Word / Notion / Obsidian 导入 | 后续 | |
| OCR | 后续 | |

---

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 14 (App Router, `output: 'standalone'`) + TypeScript | 一份代码、Node 进程运行；standalone 减小镜像体积 |
| 样式 | Tailwind CSS + shadcn/ui | 快速搭建一致的 UI |
| 富文本编辑器 | TipTap + StarterKit + Image 扩展 | 支持图文，JSON 存储易导出 |
| 数据库 | SQLite (better-sqlite3) | 单文件、易备份；NAS 本地友好 |
| 全文搜索 | SQLite FTS5 | 内建、零外部依赖 |
| 认证 | bcryptjs + jose (JWT) | 单密码 + HttpOnly Cookie |
| AI SDK | Vercel AI SDK + `@ai-sdk/openai` | 流式输出；国内模型走 OpenAI 兼容协议 |
| 加密 | Node `crypto` AES-256-GCM | 模型 API Key 加密入库 |
| 打包 | `archiver` / `unzipper` | 导入导出 zip |
| 运行时 | Node.js 20 (alpine) 容器 | 与 NAS 环境解耦，better-sqlite3 原生模块在镜像内编译 |
| 反向代理 | 群晖 Web Station 虚拟主机 | 符合用户「跑在 Web Station」需求 |

### 2.1 不在 MVP 内的依赖（未来引入）

- `pdf-parse`（PDF 导入）
- Ollama / Xinference（本地 embedding）

---

## 3. 数据布局与备份

### 3.1 NAS 目录

```
/volume1/docker/ai-kb/
├── data/
│ ├── kb.db ← SQLite 主库
│ ├── kb.db-wal ← WAL
│ └── kb.db-shm ← shared memory
├── uploads/
│ └── 2026/06/<nanoid>.png ← 笔记图片，按年月分子目录
├── backups/ ← 全量导出 zip 临时存放
└── .env ← 环境变量（含明文初始密码）
```

### 3.2 容器内挂载

| 宿主路径 | 容器路径 |
|---|---|
| `/volume1/docker/ai-kb/data` | `/app/data` |
| `/volume1/docker/ai-kb/uploads` | `/app/uploads` |
| `/volume1/docker/ai-kb/backups` | `/app/backups` |
| `/volume1/docker/ai-kb/.env` | `/app/.env`（通过 `env_file` 加载） |

### 3.3 备份策略

- 群晖 **Hyper Backup** 直接备份整个 `/volume1/docker/ai-kb/` 目录
- 应用层「全量导出」生成包含 db 快照 + uploads 全部图片的 zip，作为冗余手段

---

## 4. 数据库 Schema

```sql
-- 全局设置：登录密码 hash、当前默认模型 id、加密盐等
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 笔记主表
CREATE TABLE notes (
  id TEXT PRIMARY KEY, -- nanoid
  title TEXT NOT NULL,
  content_json TEXT NOT NULL, -- TipTap JSON
  content_text TEXT NOT NULL, -- 纯文本，用于 FTS & 摘要输入
  summary TEXT,
  summary_state TEXT DEFAULT 'none', -- none | fresh | stale | generating
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- FTS5 全文搜索
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content_text,
  content='notes', content_rowid='rowid'
);

-- 标签
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  position INTEGER DEFAULT 999999  -- v2: 排序位；内置「收藏」固定为 0
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 图片资源
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  note_id TEXT, -- 可空，粘贴后未保存时
  rel_path TEXT NOT NULL, -- uploads/2026/06/xxx.png
  mime TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
);

-- 模型配置
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT NOT NULL, -- AES-256-GCM 加密
  model TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

---

## 5. API 设计

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 密码登录，下发 JWT Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/notes` | 列表，支持分页、关键字、标签筛选 |
| POST | `/api/notes` | 新建笔记 |
| GET | `/api/notes/:id` | 获取单篇 |
| PUT | `/api/notes/:id` | 更新（同时刷新 FTS、设置 summary_state=stale） |
| DELETE | `/api/notes/:id` | 删除（级联清理 note_tags / 关联 assets） |
| POST | `/api/notes/:id/summarize` | **SSE 流式**摘要 |
| PUT | `/api/notes/batch-tags` | 批量修改多篇笔记标签（添加/移除） |
| POST | `/api/uploads` | multipart 上传图片，返回 `{ url, assetId }` |
| GET | `/uploads/*` | 静态托管（Next.js 自定义 route） |
| POST | `/api/import` | 上传 md/txt/zip 解析入库 |
| GET | `/api/export` | `?scope=all` 或 `?scope=note&id=...`，流式 zip |
| GET | `/api/models` | 列表 |
| POST | `/api/models` | 新建 |
| PUT | `/api/models/:id` | 更新（含「设为默认」） |
| DELETE | `/api/models/:id` | 删除 |
| POST | `/api/models/:id/test` | 测试连接（调用一次 1 token 的极短请求） |
| GET | `/api/tags` | 列表 |
| PUT | `/api/tags` | 批量更新（合并/重命名） |
| POST | `/api/chat` | SSE 流式对话（RAG-lite：FTS5 检索相关笔记） |

所有 `/api/*`（除 `/api/auth/login`）和受保护页面通过 `middleware.ts` 校验 JWT。

---

## 6. 项目目录结构

```
cs_space/
├── app/
│ ├── (auth)/login/page.tsx
│ ├── (app)/
│ │ ├── layout.tsx ← 侧边栏 + 顶栏
│ │ ├── page.tsx ← 笔记列表首页
│ │ ├── chat/page.tsx ← RAG-lite 对话（额外实现）
│ │ ├── notes/new/page.tsx
│ │ ├── notes/[id]/page.tsx
│ │ └── settings/
│ │ ├── account/page.tsx
│ │ ├── general/page.tsx
│ │ ├── models/page.tsx
│ │ └── tags/page.tsx
│ └── api/
│ ├── auth/{login,logout}/route.ts
│ ├── notes/route.ts
│ ├── notes/[id]/route.ts
│ ├── notes/[id]/summarize/route.ts
│ ├── uploads/route.ts
│ ├── import/route.ts
│ ├── export/route.ts
│ ├── models/route.ts
│ ├── models/[id]/route.ts
│ ├── models/[id]/test/route.ts
│ ├── tags/route.ts
│ ├── chat/route.ts
│ └── settings/route.ts
├── components/
│ ├── editor/ ← TipTap 配置 + 图片扩展
│ ├── notes/ ← 列表项、筛选条
│ ├── models/ ← 模型表单、测试按钮
│ └── ui/ ← shadcn 生成物
├── lib/
│ ├── db/
│ │ ├── client.ts ← better-sqlite3 单例
│ │ └── migrate.ts ← 启动自动迁移
│ ├── auth/ ← 密码 hash、JWT、middleware helper
│ ├── ai/
│ │ ├── provider.ts ← OpenAI 兼容工厂
│ │ └── summarize.ts ← 摘要 prompt + 流
│ ├── storage/
│ │ ├── uploads.ts ← 写入 uploads/YYYY/MM
│ │ └── archive.ts ← 导入导出 zip
│ ├── crypto.ts ← API Key 加解密
│ └── utils.ts
├── middleware.ts ← 路由保护
├── docker/
│ ├── Dockerfile
│ └── docker-compose.yml
├── docs/
│ ├── plan-mvp.md ← 指向 KB-MVP.md
│ └── deploy-synology.md ← 群晖部署手册（S10 产出）
├── scripts/
│ └── init-password.ts ← 可选：手动生成 hash
├── .env.example
├── next.config.mjs ← output: 'standalone'
├── package.json
├── tsconfig.json
└── README.md
```

---

## 7. Docker 编排要点

### 7.1 Dockerfile（多阶段）

- 基础镜像：`node:20-alpine`
- 阶段：`deps` → `builder` → `runner`
- 构建期安装：`python3 make g++`（编译 better-sqlite3）
- 运行期：仅 `node` + standalone 产物
- 启动命令：`node server.js`
- 暴露端口：3000

### 7.2 docker-compose.yml（NAS 用）

```yaml
services:
  ai-kb:
    image: ai-kb:latest
    container_name: ai-kb
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000" # 仅监听本机，由 Web Station 反代
    volumes:
      - /volume1/docker/ai-kb/data:/app/data
      - /volume1/docker/ai-kb/uploads:/app/uploads
      - /volume1/docker/ai-kb/backups:/app/backups
    env_file:
      - /volume1/docker/ai-kb/.env
```

---

## 8. 群晖部署流程（手册大纲）

1. **准备目录**
   File Station 在 `/volume1/docker/` 下创建 `ai-kb/{data,uploads,backups}` 子目录。

2. **生成 `.env`**
   参考 `.env.example` 创建 `/volume1/docker/ai-kb/.env`，包含：
   - `APP_PASSWORD`（明文，首次启动自动 hash 到 settings 表后清零内存使用）
   - `JWT_SECRET`（`openssl rand -hex 32`）
   - `ENCRYPTION_KEY`（`openssl rand -hex 32`，用于加密模型 API Key）

3. **构建镜像**
   - 方式 A：开发机构建 → `docker save` → SCP 到 NAS → `docker load`
   - 方式 B：把源码上传到 NAS，Container Manager 「项目 → 从 docker-compose」直接 build

4. **启动容器**
   Container Manager 加载 compose → 启动 → `curl http://localhost:3000` 验证

5. **Web Station 反向代理**
   - 控制面板 → 登录门户 → 高级 → 反向代理（或 Web Station → 网页服务门户）
   - 来源：`https://kb.<your-nas>.local`（或指定子路径）
   - 目标：`http://localhost:3000`
   - **必须勾选 WebSocket 支持**（流式摘要、热重载需要）

6. **HTTPS**
   群晖控制面板 → 安全性 → 证书，使用自带 Let's Encrypt 或自签证书绑定该门户

7. **首次访问**
   浏览器访问反代域名 → 自动跳转登录页 → 用 `.env` 中 `APP_PASSWORD` 登录 → 登录成功后可在「设置 → 账户」修改密码

---

## 9. 关键决策汇总

| 决策点 | 选择 |
|---|---|
| 范围 | M1 + M2 + M3 + RAG（FTS5 + sqlite-vec 混合检索），不含 PDF / 公网 |
| 技术栈 | Next.js 全栈 |
| 数据库 | SQLite + sqlite-vec（2048d embedding，FTS5 + KNN + RRF） |
| Embedding | 已实现（OpenAI 兼容 embedding API，2048 维） |
| 笔记导入格式 | Markdown + TXT（含 zip 批量） |
| 图片存储 | 本地 `uploads/YYYY/MM/<nanoid>.<ext>` |
| 认证 | 单用户密码 |
| NAS 运行方式 | Web Station 反代 + Container Manager 跑 Node 容器 |
| NAS 平台 | 群晖 Synology DSM 7.x |
| 密码初始化 | `.env` 明文 → 启动自动 bcrypt 写库 |
| 摘要超长处理 | 截断到 8k token |
| API Key 加密 | AES-256-GCM，密钥来自 `ENCRYPTION_KEY` |
| 内网穿透 | MVP 不做（暂不公网访问） |

---

## 10. 迭代里程碑

| 阶段 | 产出 | 预计步数 |
|---|---|---|
| **S1** 工程骨架 | ✅ Next.js + Tailwind + shadcn + ESLint + 目录 + `.env.example` | 1 |
| **S2** 数据层 | ✅ SQLite client + 迁移（v10 含 soft-delete）+ 种子 + 加解密工具 | 1 |
| **S3** 认证 | ✅ 登录页 + middleware + 首次启动 hash 密码 | 1 |
| **S4** 笔记基础 | ✅ 列表 + 详情 + 新建 + TipTap + 标签 + FTS | 2-3 |
| **S5** 图片上传 | ✅ uploads API + TipTap 图片扩展 + 静态托管 | 1 |
| **S6** 导入导出 | ✅ MD/TXT/zip 导入、单篇 zip、全量 zip | 1-2 |
| **S7** 模型管理 | ✅ 模型 CRUD + 加密存储 + 测试连接 | 1 |
| **S8** AI 摘要 | ✅ 流式 SSE + UI + stale 标记 | 1 |
| **S9** 容器化 | ✅ Dockerfile + compose + standalone 配置 | 1 |
| **S10** 部署文档 | ✅ `docs/deploy-synology.md` + `docs/deploy-qnap.md` | 1 |
| **M4 RAG** 对话 | ✅ `/chat` 基于 FTS5 + sqlite-vec 混合检索（RRF 融合）+ web search 兜底 | — |
| **M5 Agent 工具调用 stage 1** | ✅ `read_note` / `create_note`（spec `docs/agent-crud/spec.md`） | — |
| **M5 Agent 工具调用 stage 2** | ✅ `edit_note` / `delete_note`（soft-delete）+ 工具卡片 + 共享单回合限额（spec `docs/agent-crud/spec.md`） | — |

---

## 11. 依赖清单（关键 npm 包）

| 类别 | 包 |
|---|---|
| 框架 | `next` `react` `react-dom` `typescript` |
| UI | `tailwindcss` `class-variance-authority` `lucide-react` shadcn 组件 |
| 编辑器 | `@tiptap/react` `@tiptap/starter-kit` `@tiptap/extension-image` `@tiptap/extension-placeholder` |
| 数据库 | `better-sqlite3` `nanoid` |
| 认证 | `bcryptjs` `jose` |
| AI | `ai` `@ai-sdk/openai`（兼容协议复用） |
| 工具 | `zod` `archiver` `unzipper` `marked`（MD → TipTap 转换） |

---

## 12. 预置模型清单（M3 内置选项）

| 名称 | baseUrl 示例 | 默认 model 字段 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| MiniMax | `https://api.minimax.chat/v1` | 用户自填 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| 阶跃 StepFun | `https://api.stepfun.com/v1` | `step-1-8k` |
| 自定义 | 任意 OpenAI 兼容地址 | 用户自填 |

> 注：用户在问题中提到的 `deepseek-v4-flash` / `minimax M3` / `GLM-4.7` / `stepfun` 等具体型号名，由用户在模型配置 UI 自行填入 `model` 字段，预置项只是脚手架。

---

## 13. 环境变量约定

```bash
# 应用
APP_PASSWORD= # 首次启动用，启动后建议清空
JWT_SECRET= # openssl rand -hex 32
ENCRYPTION_KEY= # openssl rand -hex 32（32 字节 hex）

# 路径（容器内绝对路径，开发时可改）
DB_PATH=/app/data/kb.db
UPLOADS_DIR=/app/uploads
BACKUPS_DIR=/app/backups

# 运行
NODE_ENV=production
PORT=3000
```

---

## 14. 后续阶段（非 MVP，仅备忘）

- **M6 公网部署**：Vercel + Turso 或阿里云 VPS；Cloudflare Tunnel / Tailscale / frp 三选一
- **M7 PDF / Word / 网页抓取导入**
- **M8 多用户 / 分享只读链接**