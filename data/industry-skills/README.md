# 行业二级 Skill（财报智析）

## 用途

- 生成智析 / 深度归因时，按标的 `company.industry` 加载对应 `{行业}.json`。
- 将 `systemAppend` 拼入 `report-verdict-llm` 的 system；`attributionModules`（由 `attributionSkeleton` 派生）决定深度归因的模块标题与 id；无 `attributionModules` 时回落固定五块（主营/净利/异常/历史/同业）。`moduleHints` / `retrievalKeywords` 仍指导检索与措辞。
- `{行业}.md` 给人审，不直接喂模型长文。

## 用户侧

- 仅使用 `userFacing.badge` 与 `userFacing.hover`（例如标题旁「半导体视角」）。
- **不要做可点问题芯片**——追问模板尚未产品化；禁区里「稼动率」等不得写进默认悬停承诺。

## 加载

- 单行业：读 `data/industry-skills/{industry}.json`
- 批量：`_all.json`（数组，40 条）
- 行业名必须与 `companies.json` 的 `industry` 字段完全一致

## 通用硬规则（所有行业）

1. 无披露写「未披露」
2. 禁止可转债/定增当季报
3. EPS 不因「千元」表头换算
4. 有原文才写模块；不承诺财报里经常没有的 KPI（如稼动率%）

## 审核

见 `INDEX.md`。改 JSON 后请同步预览目录或重新生成。
