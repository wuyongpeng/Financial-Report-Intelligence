# 单元测试说明

整理日期：2026-10-27。  
用途：答辩 PPT「验证效果 · 测试数据」；说明自动化测试**护住什么、不证明什么**。

---

## 1. 怎么跑

```bash
# 全量单元测试（node:test + tsx）
npm test

# 契约子集
npm run test:contracts

# 其它（非本文件重点）
npm run test:api-contract    # 可选：对运行中的 API 做契约检查
npm run test:backend         # 需本地 env
npm run test:integration     # 本地集成脚本
```

- 入口脚本：`package.json` → `"test": "node --import tsx --test tests/*.test.ts"`
- 无 Jest / Vitest 配置；使用 Node 内置 test runner。
- 用例文件：`tests/*.test.ts`（当前 **53** 个文件）。

---

## 2. 当前规模（已复跑）

| 项 | 值 |
|---|---|
| 复跑时间 | 2026-10-27（Asia/Shanghai） |
| 命令 | `npm test` |
| 结果 | **357 pass / 0 fail**（`# tests 357`） |
| 耗时 | 约 2.5s（本机） |

说明：`docs/project-review-2026-10-26.md` 曾记 **288/288**，为当时快照；**以本文复跑数为准**。答辩材料请写「单元测试 357/357 通过（2026-10-27）」，不要混用旧数。

同日评审还提到 `auth.test.ts` 相关类型检查问题；**单元测试通过 ≠ `tsc` 全绿**，二者分开表述。

---

## 3. 按领域分组（文件 → 一句话）

### 解析 / 指标（7）

| 文件 | 护栏 |
|---|---|
| `tests/parser.test.ts` | 核心四指标抽取、单位换算与置信度 |
| `tests/period-dedupe.test.ts` | 报告期去重 |
| `tests/attribution-title.test.ts` | 归因标题文案 |
| `tests/focus-highlights.test.ts` | 划词 / 焦点高亮 |
| `tests/page-local-highlight.test.ts` | 页内高亮定位 |
| `tests/outline.test.ts` | PDF 提纲结构 |
| `tests/pdf-download.test.ts` | PDF 下载路径 / 命名 |

### 检索 / 问答契约（10）

| 文件 | 护栏 |
|---|---|
| `tests/retrieval-application.test.ts` | 检索编排与上下文拼装 |
| `tests/answer-cite.test.ts` | 出处标记与页码链接解析 |
| `tests/question-scope.test.ts` | 问题范围 / 边界判定 |
| `tests/rag-intent.test.ts` | 检索意图粗分类 |
| `tests/chat-followups.test.ts` | 相关追问生成契约 |
| `tests/chat-stream-contract.test.ts` | 流式问答响应契约 |
| `tests/focus-prompt.test.ts` | 焦点追问提示拼装 |
| `tests/home-prompts.test.ts` | 首页推荐问题 |
| `tests/home-placeholders.test.ts` | 首页占位文案 |
| `tests/industry-skills.test.ts` | 行业 skill 提示选择 |

### 智析 / 归因 / 队列（10）

| 文件 | 护栏 |
|---|---|
| `tests/report-verdict.test.ts` | 智析 verdict 解析与证据绑定 |
| `tests/request-report-verdict.test.ts` | 请求触发智析 |
| `tests/verdict-queue.test.ts` / `verdict-job.test.ts` / `verdict-priority.test.ts` | 队列调度、单任务、优先级 |
| `tests/verdict-abort.test.ts` / `batch-verdict-queue.test.ts` / `verdict-bulk-queue.test.ts` | 中止与批量入队 |
| `tests/detail-model.test.ts` / `detail-auto.test.ts` | 详情页模型与自动行为 |

### 采集 / 入库（9）

| 文件 | 护栏 |
|---|---|
| `tests/ingest-control.test.ts` / `ingest-settings.test.ts` | 采集开关与设置 |
| `tests/ingest-lookback.test.ts` / `ingest-period.test.ts` | 回溯窗口与期次 |
| `tests/ingest-seed-companies.test.ts` | 种子公司 |
| `tests/crawl-display.test.ts` | 采集页展示态 |
| `tests/parse-queue.test.ts` / `batch-parse-queue.test.ts` / `parse-abort.test.ts` | 解析队列与中止 |

### 首页 / 详情 UI 逻辑（5）

| 文件 | 护栏 |
|---|---|
| `tests/home-search.test.ts` | 首页搜索与期次 hint |
| `tests/pane-collapse.test.ts` | 三栏收起 |
| `tests/company-classify.test.ts` | 公司行业分类 |
| `tests/reports-application.test.ts` | 报告应用层 |
| `tests/request-meta.test.ts` | 请求元信息 |

### 认证 / API / LLM（9）

| 文件 | 护栏 |
|---|---|
| `tests/auth.test.ts` | 演示 cookie / guest session |
| `tests/api-contract.test.ts` / `contracts.test.ts` | 公开错误形态、共享契约 |
| `tests/backend.test.ts` | 后端基础检查辅助 |
| `tests/client-uuid.test.ts` | 客户端 UUID |
| `tests/discard-password.test.ts` | 口令输入遮罩相关 |
| `tests/llm-gate.test.ts` / `llm-providers.test.ts` / `llm-error.test.ts` | 门禁、多提供方、错误映射 |

### 语音（3）

| 文件 | 护栏 |
|---|---|
| `tests/voice-nav-intent.test.ts` | 翻页 / 回首页等导航意图 |
| `tests/voice-farewell-intent.test.ts` | 告别退出 |
| `tests/voice-probe.test.ts` | 语音网关探测与 key 形态（不泄露完整密钥） |

---

## 4. 证明什么 / 不证明什么

| 证明 | 不证明 |
|---|---|
| 解析、队列、契约、意图分类等**纯逻辑**在变更后不易静默坏掉 | 任意真实财报上的「整体准确率」 |
| 出处链接格式、边界判定、流式契约等**可回归**行为 | 黄金题人工评分结果（见 `docs/golden-questions.md`） |
| 语音意图字符串解析稳定 | 麦克风 / 实时 ASR 现场体验 |
| CI/本地可快速红灯 | 外部数据源可用性、采集成功率、LLM 内容质量 |

---

## 5. 答辩一句话

「单元测试护的是管道与契约（当前 357 条全绿），**可信度**靠原文点回与边界策略；准确率数字以黄金题人工评分为准，未评完就不报。」

相关：`docs/golden-questions.md`、`docs/api-test-baseline.md`、`docs/test-plan-competition.md`。
