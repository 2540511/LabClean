# LabClean AI 诊断意见 · 开发说明（给编码 AI / 队友）

> **这份文档是给「写代码的人/模型」看的**，不是给运行时大模型看的。
>
> - [AI-提示词.md](./AI-提示词.md) → 决定**大模型说什么**（诊断意见 JSON）
> - 本文档 → 决定**我们怎么写代码接住它**
>
> **本功能不做自动清洗。** AI 只出意见，操作由用户自己在界面上点。

---

## 0. 复制这段给编码 AI

````text
你是一名资深 TypeScript / React 工程师，要在 LabClean 项目里新增「AI 数据诊断」功能。

LabClean 是基于 Tauri + Vite + React 18 + TypeScript(strict) 的离线 Excel 数据清洗工具，
已有 169 项冒烟测试全部通过，不允许破坏。项目根目录：xiangmu/

【这个功能做什么】
用户点「AI 诊断」，把表格画像（表头 + 统计摘要，不含任何数据行）发给大模型，
拿回一份诊断意见：有哪些质量问题、怎么处理、以及一段能直接写进实验报告的文字。

【这个功能不做什么 —— 非常重要】
- 不生成或执行任何清洗操作
- 不修改数据、不新增步骤、不碰 undo
- 不引入 OpSpec / applySpec / runSequence 相关逻辑

理由：AI 只出意见，风险和实现量都降一个数量级。用户看到建议自己去点。

【必须遵守的技术细节】
- 系统提示词放在 src/core/ai/system-prompt.txt，
  用 import systemPrompt from './system-prompt.txt?raw' 引入，不要硬编码进 TS
- 拼装上下文、解析返回必须是纯函数，能被 smoke 测试覆盖
- 不引入新依赖，fetch 就够
- API Key 只存 localStorage，绝不写进代码或提交 git
- 默认不启用 AI；首次使用要说清「只发送表结构，不发送数据行」

【一个 commit 即可完成】
core+ui 一起：feat(ai): AI 数据诊断意见（只读，不动数据）

完成后必须：npm run check 无错、npm run smoke 全绿、npm run build 通过。
````

---

## 1. 动手前先读这些文件

| 文件 | 要看什么 |
|---|---|
| `src/core/types.ts` | `Column`、`Dataset`、`NumericStats` 的字段名（拼上下文要用） |
| `src/components/SettingsDialog.tsx` | 弹窗的写法和样式类名，**照这个写** |
| `src/App.tsx` | 顶栏按钮长什么样、`dataset` / `selected` 从哪来 |
| `src/styles.css` | 现有 `modal-*` / `pop-*` / `seg-*` 类，尽量复用 |
| `docs/AI-提示词.md` | 模型会返回什么结构，解析器要按它对 |

---

## 2. 数据流（就四步）

```
Dataset ──► buildTableContext() ──► 表画像 JSON ──► 大模型
                                                    │
                                         诊断意见 JSON
                                                    │
                                    parseAdvice() ──▼──► <AdviceDialog/>
```

没有执行、没有回写、没有撤销联动。

---

## 3. 新建文件

### 3.1 `src/core/ai/types.ts`

```ts
export interface AiColumnContext {
  index: number
  name: string
  type: 'number' | 'text' | 'date' | 'boolean'
  missing: number
  missingRate: number
  distinct: number
  sample: string[]
  top: { value: string; count: number }[]
  issues: { code: string; count: number }[]
  numeric: {
    n: number; min: number; max: number
    median: number; mean: number; std: number
    q1: number; q3: number; mad: number; outliers: number
  } | null
}

export interface AiTableContext {
  meta: {
    fileName: string
    sheetName: string
    rows: number
    cols: number
    missingCells: number
    duplicateRows: number
    formulaOnly: number
    summaryRows: number
  }
  columns: AiColumnContext[]
  notes: string[]
}

/** 一条诊断意见 */
export interface AdviceFinding {
  column: string | null
  level: 'high' | 'medium' | 'low'
  issue: string
  impact: string
  suggestion: string
  howto: string
}

/** 一整份诊断结果 */
export interface Advice {
  overall: string
  findings: AdviceFinding[]
  report: string
  questions: string[]
}

export interface AdviceResult {
  ok: boolean
  advice: Advice | null
  error: string | null
  /** 原始返回，出错时给用户复制排查 */
  raw: string
}
```

### 3.2 `src/core/ai/sanitize.ts`

```ts
import type { Dataset } from '../types'
import type { AiTableContext } from './types'

export function harden(mask: boolean, v: string): string
export function buildTableContext(dataset: Dataset): AiTableContext
/** 给用户看「将要发送什么」 */
export function describePayload(ctx: AiTableContext): string
```

**硬性要求（评审第一条就看这里）：**

- **函数内绝对不能出现 `dataset.rows`** —— 只读 `dataset.columns` 和 `dataset.meta`
- `sample` 最多 5 个，每个截断到 30 字符
- 列名命中 `/(姓名|名字|手机|电话|身份证|邮箱|地址)/` 时，样例掩码成 `张*`、`138****5678`
- 数值字段保留 2 位小数，别把浮点尾巴发出去

### 3.3 `src/core/ai/system-prompt.txt`

把 [AI-提示词.md](./AI-提示词.md) 第二节那个大代码块**里面的内容**原样存进去（不含 ```` 围栏）。

### 3.4 `src/core/ai/prompt.ts`

```ts
import raw from './system-prompt.txt?raw'
export const SYSTEM_PROMPT = raw
```

### 3.5 `src/core/ai/client.ts`

```ts
export interface AiConfig {
  baseUrl: string   // https://api.deepseek.com/v1
  apiKey: string
  model: string     // deepseek-chat
}

export const DEFAULT_AI_CONFIG: AiConfig
export function loadAiConfig(): AiConfig          // 读 localStorage，缺失时返回默认
export function saveAiConfig(cfg: AiConfig): void
export function isAiConfigured(cfg: AiConfig): boolean

/** 调 OpenAI 兼容接口，返回原始文本 */
export async function requestAdvice(
  cfg: AiConfig,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string>
```

实现要点：

- `POST {baseUrl}/chat/completions`，body 带 `temperature: 0.3`、`response_format: { type: 'json_object' }`
- 超时 **30 秒**（`AbortSignal.timeout`，注意和外部 signal 合并）
- 非 2xx：把响应体里的错误信息原样带出来，不要只报「请求失败」
- **CORS 预案**：Tauri 生产环境跨域可能被拦。如果 `fetch` 报 CORS，改成在 Rust 侧实现一个 `ai_request` command（reqwest），前端用 `invoke`。函数签名不变，只换实现。

### 3.6 `src/core/ai/advice.ts`（纯函数，必须单测）

```ts
import type { AdviceResult } from './types'

/** 解析并规整模型返回。永不抛异常。 */
export function parseAdvice(raw: string): AdviceResult
```

规整规则：

| 情况 | 处理 |
|---|---|
| 前后有 ```json 围栏 | 剥掉再解析 |
| 前后有多余文字 | 截取第一个 `{` 到最后一个 `}` |
| `JSON.parse` 失败 | `ok=false`，`raw` 原样带回 |
| `overall` / `report` 缺失或非字符串 | 补成 `''`，不算失败 |
| `findings` 不是数组 | 变成 `[]` |
| `level` 不是三档之一 | 归一成 `'medium'` |
| `findings` 超过 8 条 | 截断到 8 条 |
| 单条 finding 缺字段 | 该字段补空串，保留这一条 |
| `questions` 不是字符串数组 | 过滤掉非字符串项 |

**注意：这里不做 colIndex 越界、op 白名单之类的校验 —— 因为没有可执行的操作。**
只保证结构可用、渲染不崩。

### 3.7 `src/components/AdviceDialog.tsx`

照 `SettingsDialog.tsx` 的结构写（`modal-backdrop` / `modal` / `modal-head` / `modal-body`）。

布局：

```
┌───────────────────────────────────────────────┐
│ AI 数据诊断                               ×   │
├───────────────────────────────────────────────┤
│ [⚙ 设置]  ← 折叠区：baseUrl / model / API Key  │
│                                               │
│          [分析这张表]  （主按钮）                │
│         发送中：正在请求 AI…（可取消）            │
│                                               │
│ ▸ 将发送：14 个字段的表结构，不含数据行           │
│                                               │
│ ── 诊断结果 ────────────────────────────────── │
│  总述：……                                      │
│  ┌ 🔴 第46行是汇总行 …………………………………     │
│  │  影响：……   建议：……                        │
│  │  操作入口：右栏「行筛选」→ …                 │
│  └────────────────────────────────────────   │
│  ┌ 🟡 语文缺失 1 个（2.2%）…………………………     │
│  └────────────────────────────────────────   │
│                                               │
│  报告文字：[复制]  ← 一键复制进实验报告           │
│              一段可直接粘贴的段落                 │
│                                               │
│  需你确认：……                                  │
└───────────────────────────────────────────────┘
```

要点：

- 设置区默认折叠，没配置 Key 时自动展开并提示
- 结果区按 level 着色：high 红 / medium 黄 / low 灰
- `report` 放一个「复制」按钮（`navigator.clipboard.writeText`）
- 有 `column` 的意见，点一下就把左侧字段列表切到那一列（调 `onSelectColumn(index)`），**这只是定位，不改任何数据**
- 出错时显示错误 + 一个「复制原始返回」按钮

---

## 4. 要改的现有文件

### 4.1 `src/App.tsx`

| 位置 | 改法 |
|---|---|
| 顶栏 | 「显示设置」旁边加 `<button className="btn" onClick={() => setAdviceOpen(true)}>AI 诊断</button>` |
| state | `const [adviceOpen, setAdviceOpen] = useState(false)` |
| 渲染 | 挂 `<AdviceDialog dataset={dataset} onClose={...} onSelectColumn={setSelected} />` |

**不碰** `runOp` / `runSequence` / `steps` —— 这个功能完全不参与清洗。

### 4.2 `src/styles.css`

只新增，不改旧的：`.advice-card`、`.advice-high`、`.advice-medium`、`.advice-low`、`.advice-report`、`.ai-settings`。

### 4.3 `scripts/smoke.ts`

新增 `[18] AI 诊断`（全部离线，不发网络）：

```ts
// 上下文不含数据行
check('上下文无 rows 字段', !('rows' in buildTableContext(ds)))
// 样例截断
check('样例最多 5 个', buildTableContext(ds).columns.every(c => c.sample.length <= 5))
// 敏感列掩码
check('姓名列已掩码', buildTableContext(ds).columns.find(c => c.name === '姓名')!.sample.every(s => s.includes('*')))
// 围栏能剥
check('带 markdown 围栏也能解析', parseAdvice('```json\n{"overall":"x","findings":[],"report":"y"}\n```').ok)
// 脏数据不崩
check('findings 非数组时降级', parseAdvice('{"findings":"oops"}').advice!.findings.length === 0)
// 非法 level 归一
eq('level 归一', parseAdvice('{"findings":[{"level":"urgent"}]}').advice!.findings[0].level, 'medium')
// 超过 8 条截断
eq('findings 上限 8', parseAdvice(JSON.stringify({ findings: Array(20).fill({ level: 'low' }) })).advice!.findings.length, 8)
```

---

## 5. 降级与安全（评审重点）

| 场景 | 必须的行为 |
|---|---|
| 没配 Key | 自动展开设置区并提示，不报错、不发请求 |
| 断网 / 超时 | 明确提示「网络不可用或超时」，可复制错误详情 |
| 返回非 JSON | 显示「格式不对」+ 原始返回可复制 |
| 结构化字段缺失 | 降级渲染，能显示的照常显示，不崩 |
| 用户取消 | `abort()`，状态回 idle |
| 未选数据源 | 按钮禁用 |

**隐私：**

- `buildTableContext` 物理上读不到数据行（只依赖 `columns` / `meta`）
- 弹窗里给「将发送什么」的折叠预览
- 首次点击弹一次说明：「只发送表结构与统计摘要，不发送任何数据行」

---

## 6. 验收清单

| # | 检查 |
|---|---|
| 1 | `npm run check` 0 错误 |
| 2 | `npm run smoke` 全绿（原 169 项 + 新增 AI 断言） |
| 3 | `npm run build` 通过 |
| 4 | 没配 Key 时点按钮不崩、自动展开设置 |
| 5 | 断网时提示清楚，不白屏 |
| 6 | 模型返回脏数据（非 JSON、字段缺失、level 乱写）都不崩 |
| 7 | `grep dataset.rows src/core/ai/sanitize.ts` **无结果** |
| 8 | 执行本功能前后，表格数据、步骤列表完全不变 |
| 9 | 「复制报告文字」能用 |
| 10 | 点带列名的意见，左侧切到对应列 |

第 8 条最关键：**这个功能是只读的**，用它之后 `steps` 长度必须还是原来的值。

---

## 7. 可选增强（做完基础版再考虑）

1. **把诊断意见写进导出报告** —— `report.ts` 已经能生成多个 sheet，加一个「AI 诊断」sheet 成本很低
2. **意见存本地历史** —— 同一张表再诊断时直接显示上次结果，省 API 费用
3. **点意见定位列** —— 已在 4.1 里写了接口，实现很简单
4. **离线兜底文案** —— 断网时用规则生成的模板话术（缺失率高→提示填充），保证功能不消失

---

## 8. 明确不要做的事

- ❌ 不要生成或执行任何操作（这是本功能的设计前提）
- ❌ 不要在 prompt 里传数据行
- ❌ 不要引入 openai-sdk 之类依赖
- ❌ 不要把 Key 提交进 git
- ❌ 不要做流式输出、多轮对话
- ❌ 不要为了"更智能"偷偷加上自动执行

---

## 9. 做完之后

把弹窗截图、新增 smoke 输出、一次真实模型返回（脱敏后）发出来。

如果发现提示词里的字段和解析器对不上，**以解析器为准去改提示词**，别为了迁就文档改代码。
