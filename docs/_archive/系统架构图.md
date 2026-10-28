# 财报智析台 · 系统架构说明

> 面向 A 股上市公司财报的智能阅读与分析平台。核心主张：**问财报，有出处** —— 每一个数字、每一条结论都可回溯到官方 PDF 的具体页码。

---

## 一、总体架构图

```mermaid
graph TB
    subgraph SRC["① 数据源层 · 官方公开披露"]
        SSE["上交所<br/>query.sse.com.cn"]
        SZSE["深交所<br/>szse.cn/api"]
        BSE["北交所<br/>bse.cn"]
        CNINFO["巨潮资讯<br/>交叉兜底"]
    end

    subgraph WORKER["② 采集层 · Worker 独立进程"]
        DISC["公告发现<br/>fetchAllSources"]
        DEDUP["双重去重<br/>逻辑ID + source_id"]
        DL["温和下载<br/>UA/Referer·限速·重试"]
        PARSE["PDF 解析<br/>unpdf + poppler 兜底"]
        EXTRACT["规则提取<br/>四项核心指标 + 页码"]
        VERDICT["财报速览生成<br/>后台异步"]
    end

    subgraph STORE["③ 存储层"]
        PG[("PostgreSQL 16<br/>8 张表 · 不暴露端口")]
        FS[("本地 PDF 归档<br/>/data/reports")]
        RT[("运行时状态<br/>/app/.data")]
    end

    subgraph API["④ 服务层 · Next.js Route Handlers"]
        R_READ["阅读类<br/>/reports · /outline · /pdf"]
        R_ANA["分析类<br/>/analysis · /verdict · /status"]
        R_CHAT["问答类<br/>/chat SSE · /conversations"]
        R_OPS["运维类<br/>/crawl/* · /admin/*"]
    end

    subgraph RAG["⑤ 智能层 · 检索增强"]
        INTENT["意图识别<br/>跨期 / 同业 / 页码"]
        RETR["证据检索<br/>结构化指标 + 页级正文"]
        PROMPT["提示装配<br/>证据编号 E1..En"]
        GATE["LLM 闸门<br/>单并发 · 多供应商 failover"]
        VALID["引用校验<br/>失败即降级"]
    end

    subgraph UI["⑥ 展现层 · React 19"]
        HOME["首页<br/>搜索 · 覆盖看板"]
        DETAIL["三栏详情页<br/>原文 | 指标 | 问答"]
        PDFV["PDF 证据视图<br/>连续滚动 + 高亮"]
        CRAWL["采集监控页<br/>实时队列"]
    end

    SSE --> DISC
    SZSE --> DISC
    BSE --> DISC
    CNINFO --> DISC

    DISC --> DEDUP --> DL --> PARSE --> EXTRACT
    EXTRACT --> VERDICT

    DL -.PDF 落盘.-> FS
    EXTRACT -.指标+页文本.-> PG
    VERDICT -.速览 JSON.-> PG
    DL <-.进度/闸门.-> RT

    PG --> R_READ
    PG --> R_ANA
    PG --> R_CHAT
    PG --> R_OPS
    FS --> R_READ
    RT <--> R_OPS

    R_CHAT --> INTENT --> RETR --> PROMPT --> GATE --> VALID
    VALID -.引用非法则回退确定性答案.-> R_CHAT

    R_READ --> HOME
    R_READ --> DETAIL
    R_ANA --> DETAIL
    R_CHAT --> DETAIL
    R_READ --> PDFV
    R_OPS --> CRAWL

    style SRC fill:#e8f4fd,stroke:#4a90d9
    style WORKER fill:#fff4e6,stroke:#e8a33d
    style STORE fill:#e9f7ef,stroke:#48a868
    style API fill:#f4ecfa,stroke:#9b59b6
    style RAG fill:#fdeaea,stroke:#d9534f
    style UI fill:#eef1f5,stroke:#5d6d7e
```

---

## 二、采集与解析流水线（状态机）

公告从发现到可阅读的完整生命周期。**异常不自动上线**：无法完整抽取时保留"部分解析"状态，而非填充猜测数据。

```mermaid
stateDiagram-v2
    [*] --> discovered: 公告发现·去重入库
    discovered --> downloading: 领取下载任务
    downloading --> downloaded: PDF 校验通过
    downloading --> download_failed: 网络/拦截失败
    download_failed --> downloading: 下一轮重试
    downloading --> discovered: 超时 5min 退回

    downloaded --> parsing: 领取解析任务
    parsing --> review: 四项核心指标完整
    parsing --> parse_partial: 指标不完整·仅标注
    parsing --> parse_parked: 扫描件无法抽取正文
    parsing --> downloaded: 超时 5min 退回

    review --> online: 管理员人工复核通过
    online --> review: 复核驳回

    discovered --> auto_skipped: 早于采集窗口
    discovered --> auto_skipped: 非完整财报
    discovered --> auto_skipped: 同期次重复

    note right of review
        指标已入库，用户可读
        速览在后台异步生成
    end note
    note right of online
        financial_metrics.verified = true
        进入正式上线状态
    end note
```

**关键设计点**

| 环节 | 做法 | 目的 |
|---|---|---|
| 公告发现 | 交易所为主源，巨潮交叉兜底；三源顺序拉取 | 单源变更或限流不中断整体采集 |
| 去重 | `逻辑ID = sha256(代码\|日期\|归一化标题)` + `(source, source_id)` 唯一键 | 同一公告多源发布只入库一次 |
| 下载合规 | 明确 UA、来源页 Referer、可配置间隔、小批量、失败下轮再试 | 温和抓取，不绕过验证码或访问控制 |
| 解析 | `unpdf` 优先，大文件/字体异常时降级 `poppler-utils` | 中文 PDF 字体不暴露 Unicode 时仍可提取 |
| 指标提取 | 确定性规则定位字段名 + 单位换算，保留 `source_page` / `source_label` | 可追溯，非模型猜测 |
| 自愈 | `recoverStaleRuns()` 回收超时任务与中断轮次 | Worker 重启不丢任务 |

---

## 三、智能问答链路（RAG）

问答**不访问未入库的外部数据**，不提供投资建议。模型只负责在给定证据范围内解释，数值与计算由服务端结构化数据完成。

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant API as /api/chat (SSE)
    participant CV as 会话层
    participant RAG as 检索层
    participant LLM as 模型网关
    participant DB as PostgreSQL

    U->>API: 提问（含 reportId / requestId）
    API->>CV: beginTurn 行锁 + 租约
    CV->>DB: 幂等校验 · 加载历史
    alt 同一 requestId 已完成
        CV-->>API: 直接重放历史答案
    else 新回答
        CV-->>API: 返回受限历史上下文
    end

    API->>RAG: 装载证据上下文
    RAG->>DB: 本期指标 + 跨期同比 + 同业对比
    RAG->>DB: 页级正文检索（含关键词加权）
    RAG-->>API: 结构化事实 + 原文摘录（编号 E1..En）

    API-->>U: SSE: status=retrieving（先出证据）

    alt 纯数值类问题
        API-->>U: 结构化直答·零模型成本
    else 需要解释归纳
        API->>LLM: 单并发闸门排队
        LLM->>LLM: 多供应商 failover · 429 退避
        LLM-->>API: 流式 token
        API-->>U: SSE: 增量内容
        API->>API: 引用编号合法性校验
        alt 引用非法或缺失
            API-->>U: 回退到确定性证据答案
        end
    end

    API->>DB: finishTurn 落库 · 释放租约
    API-->>U: SSE: [DONE]
```

**可信度保障机制**

- **证据先行**：检索结果在模型输出之前就推送给前端，用户始终能看到依据。
- **引用强制校验**：答案中的 `【E1】` 编号必须属于本轮证据集，否则整段回退到确定性答案。
- **口径约束**：同比仅当报告期后缀相同（2026Q1 对 2025Q1）；年报与季报可作参考但不得称为同比。
- **越界拒答**：涉及买卖建议、股价预测，或询问未入库年份时，明确回答"暂无法回答"并说明可核验范围。
- **成本控制**：数值类问题走结构化直答路径，完全不调用模型。

---

## 四、数据模型

```mermaid
erDiagram
    companies ||--o{ announcements : "股票代码"
    announcements ||--o{ financial_metrics : "指标提取"
    announcements ||--o{ report_chunks : "页级正文"
    announcements ||--o| report_verdicts : "财报速览"
    announcements ||--o{ review_events : "复核审计"
    announcements ||--o{ metric_feedback : "读者反馈"

    companies {
        text code PK "六位代码"
        text name "简称"
        text exchange "SSE/SZSE"
        text industry "行业分类"
        int rank "监控优先级"
        bool enabled "是否启用采集"
    }
    announcements {
        text id PK "逻辑ID·内容哈希"
        text source "SSE/SZSE/BSE/CNINFO"
        text source_id "源公告ID"
        text title "公告标题"
        text report_type "FY/H1/Q1/Q3"
        text status "生命周期状态"
        text pdf_key "归档路径"
        text pdf_sha256 "完整性校验"
        text parse_error "失败原因留痕"
    }
    financial_metrics {
        int id PK
        text metric "revenue/net_profit/eps/roe"
        real value "数值"
        text unit "单位"
        int source_page "原文页码"
        text source_label "原文字段名"
        real confidence "置信度"
        bool verified "人工复核标记"
    }
    report_chunks {
        int page "页码"
        text content "该页正文"
    }
    report_verdicts {
        jsonb payload "速览结论+关键变化"
        text status "pending/ready/failed"
        text model "生成模型"
    }
    ingest_runs {
        text id PK
        text status "running/success/failed"
        int discovered_count
        int downloaded_count
    }
    source_health {
        text source PK
        int consecutive_failures
        text last_error
    }
```

**8 张表分三类职责**：业务主数据（`companies` / `announcements` / `financial_metrics` / `report_chunks`）、AI 产出（`report_verdicts` / `chat_conversations` / `chat_messages`）、运行与审计（`ingest_runs` / `source_health` / `review_events` / `metric_feedback`）。

---

## 五、部署架构

单虚机 Docker Compose 交付，四个服务。数据库不对外暴露端口，仅容器网络内可达。

```mermaid
graph LR
    subgraph VM["单台 Ubuntu 虚拟机"]
        subgraph NET["Docker 内部网络"]
            CADDY["caddy<br/>:80 / :443<br/>自动 HTTPS"]
            APP["app<br/>Next.js :3000"]
            WRK["worker<br/>定时采集进程"]
            DB[("db<br/>PostgreSQL 16<br/>无端口暴露")]
        end
        subgraph VOL["宿主持久化目录"]
            V1[("postgres<br/>数据库文件")]
            V2[("reports<br/>PDF 归档")]
            V3[("runtime<br/>采集进度·闸门·锁")]
        end
    end
    USER["用户浏览器"] -->|HTTPS| CADDY
    CADDY -->|reverse_proxy<br/>flush_interval -1| APP
    APP --> DB
    WRK --> DB
    DB --- V1
    APP --- V2
    WRK --- V2
    APP --- V3
    WRK --- V3
    WRK -->|温和限速| EXT["交易所 / 巨潮<br/>公开接口"]
    APP -->|OpenAI 兼容| LLM["大模型服务"]

    style VM fill:#f8f9fa,stroke:#495057
    style NET fill:#e8f4fd,stroke:#4a90d9
    style VOL fill:#e9f7ef,stroke:#48a868
```

| 服务 | 职责 | 关键配置 |
|---|---|---|
| `caddy` | 反向代理 + 自动申请续期证书 | `flush_interval -1` 保障 SSE 流式不被缓冲 |
| `app` | 页面渲染 + API + RAG 编排 | `output: standalone` 精简运行时 |
| `worker` | 定时发现、下载、解析、速览 | 独立进程，与 Web 请求互不阻塞 |
| `db` | 全部结构化数据 | 仅容器网络可达，独立数据卷 |

**平移边界**：应用只有两处基础设施适配 —— `lib/db.ts`（数据库连接）与 `lib/storage.ts`（文件存储）。迁移到企业 PostgreSQL 与对象存储时只需替换这两层并迁移数据目录，采集、解析、API 与页面无需改动。

---

## 六、技术栈

| 层次 | 选型 |
|---|---|
| 前端 | React 19 · Next.js 16 (App Router) · Tailwind CSS 4 · react-markdown |
| 服务端 | Next.js Route Handlers · SSE 流式输出 |
| 数据库 | PostgreSQL 16 · postgres.js 驱动（参数化查询） |
| PDF 处理 | unpdf（主）· poppler-utils（中文字体兜底） |
| 模型接入 | OpenAI 兼容协议 · 多供应商 failover · 全局单并发闸门 |
| 采集 | 原生 fetch · 分页收集 · 可配置限速与退避 |
| 部署 | Docker Compose · Caddy 自动 HTTPS · 单虚机交付 |
| 质量 | Node 原生测试运行器（116 项单元测试）· ESLint · TypeScript 严格模式 |

---

## 七、架构设计要点小结

1. **可追溯优先于智能化** —— 指标的原始字段名、页码、置信度与人工复核标记全部入库，答案引用编号强制校验，校验失败即降级为确定性证据展示。
2. **采集与服务解耦** —— Worker 独立进程承担全部耗时任务，Web 请求路径不做爬取与解析，页面响应不受采集波动影响。
3. **状态透明不粉饰** —— 已上线、待复核、部分解析、已搁置逐一如实展示；失败原因留痕于 `parse_error`，不以模拟数据填补缺口。
4. **成本自觉** —— 数值类问题走零模型成本的结构化直答；速览按报告缓存复用；LLM 调用受全局闸门约束并具备多供应商容错。
5. **合规采集** —— 明确身份标识、低频小批量、失败退避重试，不绕过任何访问控制机制。
6. **可平移** —— 基础设施耦合面收敛在两个适配模块，具备向企业级数据库与对象存储演进的能力。
