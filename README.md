# AI Knowledge Base

> 单用户 AI 个人知识库 · 跑在群晖 NAS · Web Station 反向代理

## 当前状态

**MVP 已全部完成（S1–S10）**，并额外实现了基于 FTS5 的 RAG-lite 对话（`/chat`）。

- ✅ S1 工程骨架：Next.js 14 + Tailwind + shadcn/ui + ESLint
- ✅ S2 数据层：SQLite (better-sqlite3) + 迁移（v2：标签排序 + 收藏）+ AES-256-GCM 加密
- ✅ S3 认证：bcrypt 密码 + JWT Cookie + middleware 路由保护
- ✅ S4 笔记基础：CRUD + TipTap 编辑器 + 标签 + FTS5 全文搜索
- ✅ S5 图片上传：multipart 上传 + TipTap Image 扩展 + 静态托管
- ✅ S6 导入导出：Markdown / TXT / zip 导入；单篇 zip / 全量备份 zip 导出
- ✅ S7 模型管理：模型 CRUD + 加密存储 + 连接测试
- ✅ S8 AI 摘要：SSE 流式摘要 + stale 标记
- ✅ S9 容器化：Dockerfile + docker-compose + standalone 构建
- ✅ S10 部署文档：群晖 `docs/deploy-synology.md` + 威联通 `docs/deploy-qnap.md`
- ✅ M4-lite 对话：`/chat` 基于 FTS5 + sqlite-vec 混合检索（RRF 融合）

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
│   └── deploy-synology.md  # 群晖部署手册（S10）
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
| S2 数据层 | ✅ | SQLite + 迁移 + 加解密 |
| S3 认证 | ✅ | 登录 + middleware + 首次启动 hash |
| S4 笔记基础 | ✅ | 列表/详情/新建 + TipTap + 标签 + FTS |
| S5 图片上传 | ✅ | uploads API + TipTap Image |
| S6 导入导出 | ✅ | MD/TXT/zip |
| S7 模型管理 | ✅ | 模型 CRUD + 加密 |
| S8 AI 摘要 | ✅ | SSE 流式 |
| S9 容器化 | ✅ | Dockerfile + compose |
| S10 部署文档 | ✅ | 群晖 + 威联通手册 |
| RAG 对话 | ✅ | `/chat` 基于 FTS5 + sqlite-vec 混合检索（RRF 融合），web search 模式 |
| 编辑器增强 | ✅ | 30 秒自动保存、对话一键存为笔记 |

完整规划见 [`docs/plan-mvp.md`](./docs/plan-mvp.md) 与 [`KB-MVP.md`](./KB-MVP.md)。
