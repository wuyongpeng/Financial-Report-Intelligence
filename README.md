# 财报智析台 V1：单 VM 部署

这是一个可单机交付的 V1：网页、10 分钟增量采集 Worker、PostgreSQL 和本地 PDF 归档都运行在同一台虚机上。数据库不暴露端口；PDF 保存在虚机的 `data/reports` 目录。

## 架构

```
交易所 / 巨潮公告 → worker（每 10 分钟） → PostgreSQL + VM 本地 PDF
                                                ↓
                                           Next.js Web → Caddy :80
```

- 公告发现：上交所、深交所为主源，巨潮为交叉兜底；按公告 ID 与逻辑 ID 去重，已入库公告跳过。
- 下载策略：低频小批量、明确 `User-Agent` 和来源页 `Referer`，每次最多下载 5 份、解析 3 份；不绕过验证码或访问控制。遇到失败会记录，下一轮再试。
- 解析：PDF 文本/表格解析后以规则提取营收、归母净利润、EPS、ROE，数值、字段名和页码存库。
- 存储：`db` 服务的数据在 `data/postgres`，PDF 在 `data/reports`。后续把这两个适配层换为公司 PostgreSQL/S3 即可，不影响页面和采集流程。

评委操作路径见 [使用说明](docs/user-guide.md)，实现、数据流与边界见 [技术架构说明](docs/technical-architecture.md)。

## 在 Ubuntu VM 启动

前提：安装 Docker Engine 和 Docker Compose Plugin，并在云安全组/防火墙放行 TCP 80、443。

```bash
git clone git@github.com:wuyongpeng/Financial-Report-Intelligence.git
cd Financial-Report-Intelligence
cp .env.example .env
```

编辑 `.env`，至少替换 `POSTGRES_PASSWORD`、`INTERNAL_INGEST_TOKEN`、`ADMIN_PASSWORD` 和 `ADMIN_SESSION_SECRET` 为长随机值；随后启动：

```bash
mkdir -p data/postgres data/reports
docker compose up -d --build
docker compose ps
docker compose logs -f worker
```

首次 Worker 启动会写入 50 家绿色通道公司和官方公告元数据，再进行本轮发现、下载与解析。用下面命令确认：

```bash
curl http://127.0.0.1/api/status
curl http://127.0.0.1/api/reports?limit=10
```

浏览器访问 `http://<VM公网IP>/`。列表整行进入详情页；只有 `PDF ↗` 打开 PDF 原文。Worker 会在启动时先跑一轮，之后每 10 分钟只增量处理未入库公告和失败/待解析项。

管理员在财报详情点击“管理员复核上线”，首次操作输入 `.env` 的 `ADMIN_PASSWORD`。系统会将四项指标标为已复核、记录复核事件并正式上线。升级到本版后，Worker 会按小批次为历史已解析 PDF 补建原文检索索引。

## 运行与排障

```bash
docker compose logs -f app worker
docker compose restart worker
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select status, count(*) from announcements group by status;"
```

如果某个公开源短暂限流或变更格式，Worker 会保留失败原因并继续处理其他源；不要通过提高频率或伪造浏览器特征来规避限制。生产时先将域名 A/AAAA 记录指向 VM，再在 `.env` 设置 `DOMAIN=你的域名`、`COOKIE_SECURE=true`，执行 `docker compose up -d`；Caddy 会自动申请并续期 HTTPS 证书。以 IP + HTTP 做内网验证时可设置 `COOKIE_SECURE=false`，但不应作为公网正式环境的配置。可选设置 `ALERT_WEBHOOK_URL` 接收任务或数据源失败告警。

## 后续平移边界

应用只有两处基础设施适配：`lib/db.ts`（PostgreSQL 连接）和 `lib/storage.ts`（本地文件系统）。迁移到公司 PostgreSQL 与 S3 时替换这些适配层、迁移数据目录即可；采集、解析、API 和页面不需要重写。
