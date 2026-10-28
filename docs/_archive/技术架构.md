# 技术架构说明

## 数据流

```text
SSE / SZSE / CNINFO 公告列表
  → 10 分钟 Worker 增量轮询、公告 ID 去重、数据源健康记录
  → 下载官方 PDF 至 VM 本地磁盘
  → PDF 逐页文本提取
  → 规则提取四项核心指标、保留字段名与页码
  → PostgreSQL（公告、指标、页文本、运行与复核记录）
  → Next.js Web（图表、提纲阅读、问答）
```

## 服务端分层

项目采用模块化单体，HTTP 入口仍位于 `app/api`。核心模块逐步按以下依赖方向重构：

```text
Route Handler（HTTP/鉴权/序列化）
  → Application Service（用例编排）
    → Repository Interface（领域数据端口）
      → PostgreSQL Adapter（SQL 与行映射）
```

Reports 是首个完整垂直样板：

- `app/api/reports/route.ts`：解析请求、组装依赖、返回响应；
- `modules/reports/application/list-reports.ts`：报告选择、同期补充、指标组合和 DTO 组装；
- `modules/reports/domain/report-repository.ts`：数据库无关的 Repository 接口与领域记录；
- `modules/reports/infrastructure/postgres-report-repository.ts`：数据库行到领域记录的映射；
- `modules/reports/infrastructure/postgres-reports-database.ts`：SQL 实现。

`contracts` 作为 HTTP 边界的共享请求/响应协议，不承载 SQL 或业务编排。Web 及未来 Mobile 可共享契约，但只通过 HTTP 调用后端。

## 解析与质量控制

- 规则优先：对营业收入、归母净利润、EPS、ROE 使用确定性字段定位与单位换算。
- 可追溯：每条指标保存 `source_label`、`source_page`、`confidence`、`verified`。
- 人工复核：管理员核对 PDF 后，指标标记为已复核，并写入复核事件。
- 异常不自动上线：无法完整抽取时保留“部分解析”状态，而非填充猜测数据。

## 问答与检索

问答入口仍由 `app/api/chat` 提供 SSE/JSON 协议，检索内部按以下流水线分层：

```text
QuestionPlanner
  → QueryPlan（指标、跨期、同行、页码、直答/拒答意图）
  → RetrievalRepository（结构化指标、相关报告、页文本数据端口）
  → PassageRetriever（当前为关键词规则排序）
  → Retrieval Orchestrator（证据、计算、上下文组装）
  → Answer Policy（结构化直答、证据不足、越界拒答）
  → LLM Answer Generator + Citation Validator
```

对应模块：

- `modules/retrieval/application/question-planner.ts`：问题规划与追问补全；
- `modules/retrieval/domain/retrieval-repository.ts`：检索数据端口；
- `modules/retrieval/infrastructure/postgres-retrieval-repository.ts`：PostgreSQL 查询适配器；
- `modules/retrieval/application/keyword-passage-retriever.ts`：现有关键词召回与摘录策略；
- `modules/retrieval/application/retrieve-context.ts`：结构化与原文检索编排；
- `modules/retrieval/application/answer-policy.ts`：直答、拒答和证据充分性策略。

`lib/rag.ts` 暂作为兼容与依赖组装入口，不再包含 SQL 或完整检索业务。当前仍是规则关键词检索，不宣称已经实现向量 RAG；后续可以在 `PassageRetriever` 接口后增加全文、向量和混合检索，而不改变 Chat API。

问答服务组合结构化指标、同业覆盖信息和与问题相关的 PDF 页文本。若配置 OpenAI 兼容 LLM，答案通过 SSE 输出；否则返回可核验的原文证据。问答不会访问未入库外部数据，也不提供投资建议。

## VM 部署

Docker Compose 包含 `app`、`worker`、`db`、`caddy` 四个服务。PDF 使用挂载的本地目录持久化，PostgreSQL 使用独立数据目录持久化；迁移至企业 PostgreSQL/S3 时只需替换数据库和存储适配层。
