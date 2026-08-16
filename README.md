# AI Knowledge Base

> 单用户 AI 个人知识库 · 跑在群晖 NAS · Web Station 反向代理

## 当前状态

**MVP 已全部完成（S1–S10）**，并额外实现了基于 FTS5 + sqlite-vec 混合检索的 RAG-lite 对话（`/chat`），以及让 agent 在对话里直接读 / 创建 / 编辑 / 删除笔记的工具调用（stage 1 + 2）。

- ✅ S1 工程骨架：Next.js 14 + Tailwind + shadcn/ui + ESLint
- ✅ S2 数据层：SQLite (better-sqlite3) + 迁移（v10：标签排序 + 收藏 + soft-delete）+ AES-256-GCM 加密
- ✅ S3 认证：bcrypt 密码 + JWT Cookie + middleware 路由保护
- ✅ S4 笔记基础：CRUD + TipTap 编辑器 + 标签 + FTS5 全文搜索
- ✅ S5 图片上传：multipart 上传 + TipTap Image 扩展 + 静态托管
- ✅ S6 导入导出：Markdown / TXT / zip 导入；单篇 zip / 全量备份 zip 导出
- ✅ S7 模型管理：模型 CRUD + 加密存储 + 连接测试
- ✅ S8 AI 摘要：SSE 流式摘要 + stale 标记
- ✅ S9 容器化：Dockerfile + docker-compose + standalone 构建
- ✅ S10 部署文档：群晖 `docs/deploy-synology.md` + 威联通 `docs/deploy-qnap.md`
- ✅ RAG-lite 对话：`/chat` 基于 FTS5 + sqlite-vec 混合检索（RRF 融合）；可选 web search 兜底
- ✅ Agent 工具调用（stage 1 + 2）：`read_note` / `create_note` / `edit_note` / `delete_note`，开关默认关闭（`settings/agent-tools-enabled`），全部操作审计（`agent_actions` 表），单回合限额（`settings/agent-tool-limit`），spec 与 ticket 见 `docs/agent-crud/`
- ✅ LAN agent Bearer token：Edge 中间件对 `/api/*` 放行 `Authorization: Bearer`，路由层 `getSession()` 用 `settings.agent_api_token_hash` 校验（`docs/agent-crud/tickets/11-agent-api-token.md` 的 HTTP 边界闭环）
- ✅ `POST /api/notes` / `PUT /api/notes/:id` 新增 `contentMarkdown` 字段，服务端用 `markdownToTiptap()` 归一化到 TipTap JSON（同步更新 `KB-MVP.md`、`CONTRACTS.md`、两份部署手册、共享的 `kb-agent-instructions.md`）

## 快速开始（开发）

```bash
# 1. 复制环境变量
cp .env.example .env
# 编辑 .env，至少填入 JWT_SECRET 和 ENCRYPTION_KEY：
#   openssl rand -hex 32   # 复制两遍
# 可选：填入 APP_PASSWORD，首次启动时会自动 hash 入库

# 2. 安装依赖（首次）
npm install

# 3. 开发服务器
npm run dev
# 访问 http://localhost:3000
```

## 项目结构

```
.
├── app/                    # Next.js App Router
│   ├── (auth)/             # 登录等公开页
│   ├── (app)/              # 登录后页面
│   │   ├── chat/           # RAG-lite 对话页
│   │   ├── notes/          # 笔记列表/详情/新建
│   │   ├── settings/       # 账户 / 模型 / 标签 / 通用设置
│   │   └── page.tsx        # 首页（笔记列表）
│   ├── api/                # API 路由
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                 # shadcn 组件
│   ├── chat/               # 对话窗口
│   ├── editor/             # TipTap 配置
│   ├── notes/              # 笔记列表/筛选
│   └── models/             # 模型管理 UI
├── lib/
│   ├── db/                 # SQLite client + migrate（S2）
│   ├── auth/               # 密码 hash + JWT + middleware helper（S3）
│   ├── ai/                 # OpenAI 兼容工厂 + 摘要（S8）
│   ├── storage/            # uploads + archive（S5-S6）
│   ├── crypto.ts           # API Key 加解密（S7）
│   └── utils.ts
├── docker/                 # Dockerfile + compose（S9）
├── docs/
│   ├── plan-mvp.md         # 指向 KB-MVP.md
│   ├── deploy-synology.md  # 群晖 Web Station 部署（S10）
│   ├── deploy-qnap.md      # 威联通部署（S10）
│   └── agent-crud/         # Agent 工具调用（stage 1+2）的 spec + tickets 历史归档
├── scripts/                # 一次性脚本
├── middleware.ts           # 路由保护（S3 实现）
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## 里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| S1 工程骨架 | ✅ | Next.js + Tailwind + shadcn + 目录 + .env.example |
| S2 数据层 | ✅ | SQLite + 迁移（v10 含 soft-delete 列）+ 加解密 |
| S3 认证 | ✅ | 登录 + middleware + 首次启动 hash |
| S4 笔记基础 | ✅ | 列表/详情/新建 + TipTap + 标签 + FTS |
| S5 图片上传 | ✅ | uploads API + TipTap Image |
| S6 导入导出 | ✅ | MD/TXT/zip |
| S7 模型管理 | ✅ | 模型 CRUD + 加密 |
| S8 AI 摘要 | ✅ | SSE 流式 |
| S9 容器化 | ✅ | Dockerfile + compose |
| S10 部署文档 | ✅ | 群晖 + 威联通手册 |
| RAG 对话 | ✅ | `/chat` 混合检索：FTS5 BM25 + sqlite-vec KNN (2048d)，RRF 融合 + 多信号重排（时效 × 标题命中）+ 单条多样性上限；可选 web search 兜底（设置 `settings/chat-web-search`） |
| 编辑器增强 | ✅ | 30 秒自动保存、对话一键存为笔记 |
| Agent 工具调用 stage 1 | ✅ | `read_note` / `create_note`，开关默认关闭，写操作全量审计（`agent_actions` 表） |
| Agent 工具调用 stage 2 | ✅ | `edit_note` / `delete_note`（soft-delete），保留 4 工具的共享单回合限额；spec 与 ticket 见 [`docs/agent-crud/`](./docs/agent-crud/) |

完整规划见 [`docs/plan-mvp.md`](./docs/plan-mvp.md) 与 [`KB-MVP.md`](./KB-MVP.md)。

## ⚠️ 启动与部署注意

- **密钥长度**：`JWT_SECRET` 与 `ENCRYPTION_KEY` 各必须是 **64 个 hex 字符**（即 32 字节）。  
  `lib/env.ts` 在模块加载时校验，缺失或长度不对会**直接抛错**启动失败。
- **首次启动密码**：`.env` 里 `APP_PASSWORD` 可填可不填；填了启动时会自动 bcrypt 入库（`settings.password_hash`），之后从 `.env` 删掉。建议在管理界面改密码前保留此变量。
- **API Key 加密格式**：存进 `model_configs.api_key_enc` 的是 AES-256-GCM 密文，布局为  
  `base64( IV(12B) ‖ TAG(16B) ‖ CipherText )`。密钥就是 `ENCRYPTION_KEY`，改了密钥所有已存 API Key 都需要重录。
- **群晖 WebStation 上的 SSE**：`/api/chat` 与 `/api/notes/*/summarize` 用 SSE 流式输出。WebStation 默认不开 WebSocket，SSE 事件可能被代理缓冲到响应结束才下发，浏览器看起来像"卡住"。若遇到此问题按 `docs/deploy-synology.md` 调整反代 buffering。
- **本地 agent 状态**：仓库根的 `.omo/` 与各子项目里的 `.playwright-mcp/` 是本地 agent 运行状态，**不要 commit**。根 `.gitignore` 已屏蔽。
- **手动改数据库**：唯一已知的"安全路径"是 `npx tsx scripts/smoke-db.ts`（迁移/加解密/认证变更后跑一次）。不要直接编辑 `data/kb.db`。
