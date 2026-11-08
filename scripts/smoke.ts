/**
 * 核心逻辑冒烟测试：不碰浏览器，直接用 node 跑数据引擎。
 * 用法：先由 esbuild 打包成 .tmp/smoke.mjs，再 node 执行（见 scripts/run-smoke.mjs）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '../src/core/csv'
import { buildDataset, findHeaderRow, rebuildDataset } from '../src/core/profile'
import { classify, coerceNumber, formatCell } from '../src/core/value'
import { countFormulaOnly, readWorkbook } from '../src/core/xlsx-io'
import { handleRequest } from '../src/workers/table.worker'
import * as XLSX from 'xlsx'
import {
  opDropDuplicateRows,
  opDropEmptyRows,
  opFillMissing,
  opTrimWhitespace,
  resolveFillValue,
} from '../src/core/clean'
import { buildStepSequence, replay, type OpSpec } from '../src/core/pipeline'
import { computeDiff } from '../src/lib/diff'
import { buildCheckReport } from '../src/lib/checkReport'
import {
  DEFAULT_OUTLIER_SETTINGS,
  isOutlierValue,
  normalRange,
  resolveBinCount,
} from '../src/lib/analyze'
import { buildCompareSheets, buildReportSheets } from '../src/core/report'
import { sourceMetrics, type DataSource } from '../src/core/compare'
import {
  DEFAULT_FUZZY,
  findFuzzyGroups,
  levenshtein,
  normalizeText,
  similarity,
} from '../src/core/fuzzy'
import {
  findColumnByName,
  loadTemplates,
  materializeSteps,
  persistTemplates,
  templateStepLabel,
  toTemplateSteps,
} from '../src/core/template'
import { classifyField, classifyFields, recommendCharts } from '../src/core/recommend'
import { scatterSeries, timeSeries } from '../src/lib/series'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++
    console.log(`  \u2713 ${name}`)
  } else {
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    console.log(`  \u2717 ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, a === e ? '' : `期望 ${e}，实际 ${a}`)
}

console.log('\n[1] CSV 解析')
{
  const rows = parseCsv('\uFEFFa,b,c\r\n1,"x,y",3\n4,"带""引号""的值",6\n')
  eq('去掉 BOM + CRLF + 引号内逗号', rows, [
    ['a', 'b', 'c'],
    ['1', 'x,y', '3'],
    ['4', '带"引号"的值', '6'],
  ])
  const semi = parseCsv('x;y\n1;2\n')
  eq('自动识别分号分隔', semi, [
    ['x', 'y'],
    ['1', '2'],
  ])
  const multi = parseCsv('"第一行\n第二行",b\n')
  eq('引号内换行', multi, [['第一行\n第二行', 'b']])
}

console.log('\n[2] 值识别')
{
  eq('整数识别', classify('123'), 'number')
  eq('前导零按文本', classify('0012'), 'leadingZero')
  eq('千分位按文本', classify('1,234'), 'thousands')
  eq('日期识别', classify('2024-03-01'), 'date')
  eq('中文日期', classify('2024年3月1日'), 'date')
  eq('布尔识别', classify('是'), 'boolean')
  eq('千分位转数字', coerceNumber('1,234.5'), 1234.5)
  eq('普通空格转数字', coerceNumber(' 25.3 '), 25.3)
  eq('非数字返回 null', coerceNumber('abc'), null)
}

console.log('\n[3] 体检 + 异常值 + 重复行')
const csv = [
  '实验批次,温度(℃),浓度(mg/L),采样日期,备注',
  'B001,25.3,12.4,2024-03-01,正常',
  'B002,25.7,13.1,2024-03-01,',
  'B003, 26.1 ,12.6,2024-03-02,偏高',
  'B004,,12.9,2024-03-02,正常',
  'B005,25.9,12.7,2024-03-03, 含空格 ',
  'B001,25.3,12.4,2024-03-01,正常',
].join('\n')

const ds = buildDataset('测试数据.csv', '数据', parseCsv(csv), { source: '测试数据.csv' })
{
  eq('行数', ds.meta.rowCount, 6)
  eq('列数', ds.meta.colCount, 5)
  eq('批次列按文本（含字母）', ds.columns[0].type, 'text')
  eq('温度列识别为数值', ds.columns[1].type, 'number')
  eq('日期列识别为日期', ds.columns[3].type, 'date')
  eq('温度缺失 1 个', ds.columns[1].missing, 1)
  eq('检测到 1 行重复', ds.meta.duplicateRows, 1)

  const temp = ds.columns[1]
  check('温度列检出异常值 9999...（应为 0，本列无）', (temp.numeric?.outliers ?? 0) === 0, `实际 ${temp.numeric?.outliers}`)
  check('稳健中位数在 25 附近', Math.abs((temp.numeric?.median ?? 0) - 25.3) < 1, `实际 ${temp.numeric?.median}`)
  check('温度列有缺失问题', temp.issues.some((i) => i.code === 'MISSING'))
  const note = ds.columns[4]
  check('备注列检出空格问题', note.issues.some((i) => i.code === 'WHITESPACE'))
  check('质量分在 0-100', ds.meta.score >= 0 && ds.meta.score <= 100, `实际 ${ds.meta.score}`)
  check('温度 26.1 已被转成数字', ds.rows[2][1] === 26.1, `实际 ${formatCell(ds.rows[2][1])}`)
}

console.log('\n[4] 异常值判定（含极端值）')
{
  const body = ['x']
  for (let i = 0; i < 99; i++) body.push(String(10 + (i % 7) * 0.1))
  body.push('99999')
  const ds2 = buildDataset('极值.csv', '数据', parseCsv(body.join('\n')))
  const n = ds2.columns[0].numeric
  check('99999 被判定为异常值', (n?.outliers ?? 0) >= 1, `实际 ${n?.outliers}`)
  check('中位数不受极端值影响', Math.abs((n?.median ?? 0) - 10.3) < 1, `实际 ${n?.median}`)
  check('平均值被拉高（说明为何要用中位数）', (n?.mean ?? 0) > 1000, `实际 ${n?.mean}`)
}

console.log('\n[5] 长数字精度（身份证/订单号）')
{
  const ds3 = buildDataset('长数字.csv', '数据', parseCsv('编号,值\n1234567890123456789,1\n'))
  eq('19 位数字保持字符串', typeof ds3.rows[0][0], 'string')
  eq('原值未被截断', ds3.rows[0][0], '1234567890123456789')
}

console.log('\n[6] 清洗算子（写时复制，不改原始数据）')
{
  const trimmed = opTrimWhitespace(ds.rows, ds.columns)
  check('清理空格有改动', trimmed.affected > 0, `实际 ${trimmed.affected}`)
  eq('返回结果里空格已去掉', trimmed.rows[4][4], '含空格')
  eq('原始数据没有被改动', ds.rows[4][4], ' 含空格 ')
  check('未改动的行仍是同一个对象', trimmed.rows[1] === ds.rows[1])
  check('改动过的行是新对象', trimmed.rows[4] !== ds.rows[4])

  const median = ds.columns[1].numeric?.median ?? 0
  const filled = opFillMissing(trimmed.rows, 1, '温度(℃)', median)
  eq('填充缺失影响 1 个', filled.affected, 1)
  eq('填充值就是中位数', filled.rows[3][1], median)

  const dedup = opDropDuplicateRows(filled.rows, ds.columns)
  eq('去重删掉 1 行', dedup.affected, 1)
  eq('去重后行数', dedup.rows.length, 5)

  const rebuilt = rebuildDataset(ds, dedup.rows)
  eq('重建后行数', rebuilt.meta.rowCount, 5)
  eq('重建后列名不变', rebuilt.columns.map((c) => c.name), ['实验批次', '温度(℃)', '浓度(mg/L)', '采样日期', '备注'])
  check('重建后没有缺失', rebuilt.columns[1].missing === 0, `实际 ${rebuilt.columns[1].missing}`)
}

console.log('\n[7] 空行处理')
{
  const ds4 = buildDataset('空行.csv', '数据', parseCsv('a,b\n1,2\n,\n3,4\n'))
  eq('空行不进入数据', ds4.meta.rowCount, 2)
  const dropped = opDropEmptyRows(ds4.rows)
  eq('没有可删的空行', dropped.affected, 0)
}

console.log('\n[8] Excel 读取往返')
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['编号', '温度(℃)', '采样日期'],
    ['001', 25.3, new Date(2024, 2, 1)],
    [1234567890123456789, 26.1, null],
    ['1234567890123456789', null, new Date(2024, 2, 2)],
  ])
  XLSX.utils.book_append_sheet(wb, ws, '数据')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

  const sheets = readWorkbook(buf)
  eq('读到 1 个工作表', sheets.length, 1)
  eq('工作表名', sheets[0].name, '数据')

  const dsx = buildDataset('t.xlsx', '数据', sheets[0].rows, { source: 't.xlsx' })
  eq('表头正确', dsx.columns.map((c) => c.name), ['编号', '温度(℃)', '采样日期'])
  eq('数据行数', dsx.meta.rowCount, 3)
  check('日期列识别为日期', dsx.columns[2].type === 'date', `实际 ${dsx.columns[2].type}`)
  eq('数字单元格按原文保留位数（超安全整数转字符串）', typeof dsx.rows[1][0], 'string')
  eq('字符串单元格原样保留', dsx.rows[2][0], '1234567890123456789')

  // 只有公式、没有缓存值的工作表（openpyxl / 脚本生成的 xlsx 常见形态）。
  // SheetJS 写文件时会丢掉没有值的公式单元格，所以这里直接喂一个工作表对象做单元测试。
  const fakeWs = {
    '!ref': 'A1:B3',
    A1: { t: 's', v: '平均分' },
    B1: { t: 's', v: '结果' },
    A2: { t: 's', v: '语文' },
    B2: { t: 'z', f: 'ROUND(AVERAGE(I2:I301),2)', v: 0 },
    A3: { t: 's', v: '数学' },
    B3: { t: 'n', f: 'MAX(J2:J301)', v: 99 },
  } as unknown as XLSX.WorkSheet
  eq('只数「有公式但没有结果」的占位单元格', countFormulaOnly(fakeWs), 1)
  eq('普通工作表没有公式单元格', sheets[0].formulaOnly, 0)

  const dsFormula = buildDataset('t.xlsx', '统计汇总', [['统计项', '结果'], ['语文', null]], {
    formulaOnly: 1,
  })
  check(
    '提示条说明了公式没有计算结果',
    dsFormula.meta.notes.some((n) => n.includes('公式')),
    dsFormula.meta.notes.join(' | '),
  )
  eq('公式数量记进了 meta', dsFormula.meta.formulaOnly, 1)
}

console.log('\n[9] Worker 解析链路（真实 xlsx 文件，5002 行）')
{
  const g = globalThis as unknown as {
    self: unknown
    postMessage: (m: unknown) => void
  }
  const received: unknown[] = []
  g.self = g
  g.postMessage = (m: unknown) => received.push(m)

  const file = join(process.cwd(), 'samples', '实验数据示例.xlsx')
  const nodeBuf = readFileSync(file)
  const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)

  const started = Date.now()
  const res = handleRequest({
    id: 99,
    type: 'parse',
    fileId: 'probe',
    fileName: '实验数据示例.xlsx',
    buffer: ab as ArrayBuffer,
  })
  const cost = Date.now() - started

  check('解析成功', res.ok === true, res.ok ? '' : String((res as { error?: string }).error))
  if (res.ok) {
    eq('行数', res.dataset.meta.rowCount, 5002)
    eq('列数', res.dataset.meta.colCount, 6)
    eq('工作表列表', res.sheets.map((s) => s.name), ['原始记录', '批次汇总'])
    eq('温度列类型', res.dataset.columns[1].type, 'number')
    check('检出异常值', (res.dataset.columns[1].numeric?.outliers ?? 0) > 0, `实际 ${res.dataset.columns[1].numeric?.outliers}`)
    check('检出重复行', res.dataset.meta.duplicateRows >= 2, `实际 ${res.dataset.meta.duplicateRows}`)
    check('有进度回调', received.some((m) => (m as { type?: string }).type === 'progress'))
    check(`5002 行解析在 3 秒内（实际 ${cost}ms）`, cost < 3000)
  }

  // 切换到第二个工作表，验证缓存与切换逻辑
  const res2 = handleRequest({ id: 100, type: 'sheet', fileId: 'probe', fileName: '实验数据示例.xlsx', sheetIndex: 1 })
  check('切换工作表成功', res2.ok === true)
  if (res2.ok) eq('第二个表 6 行', res2.dataset.meta.rowCount, 6)
}

console.log('\n[10] 撤销 / 重做（从原始数据重放）')
{
  const csv10 = ['姓名,城市', '张三, 北京 ', '李四,上海', '张三, 北京 ', '王五,'].join('\n')
  const base = buildDataset('t.csv', '数据', parseCsv(csv10))
  eq('原始 4 行', base.meta.rowCount, 4)

  const step1: OpSpec = { kind: 'trim' }
  const step2: OpSpec = { kind: 'dropDuplicates' }

  const afterOne = replay(base.rows, base.columns, [step1])
  eq('1 步后仍是 4 行', afterOne.rows.length, 4)
  eq('空格已清理', afterOne.rows[0][1], '北京')
  eq('原始数据没被破坏', base.rows[0][1], ' 北京 ')
  eq('行来源映射为恒等', afterOne.origins, [0, 1, 2, 3])

  const afterTwo = replay(base.rows, base.columns, [step1, step2])
  eq('2 步后 3 行', afterTwo.rows.length, 3)
  eq('删行后来源映射正确', afterTwo.origins, [0, 1, 3])

  // 撤销一步 = 少重放一步
  eq('撤销后回到 4 行', replay(base.rows, base.columns, [step1]).rows.length, 4)
  // 重做 = 多重放一步
  eq('重做后又是 3 行', replay(base.rows, base.columns, [step1, step2]).rows.length, 3)

  // 填充值在生成步骤时就固定下来，所以重放结果完全一致
  const fillValue = resolveFillValue(base.columns[1], 'mode')
  eq('众数填充值取自当前统计', fillValue, '北京')
  const filled = replay(base.rows, base.columns, [
    { kind: 'fillMissing', colIndex: 1, colName: '城市', strategy: 'mode', value: fillValue },
  ])
  eq('空的城市被填上', filled.rows[3][1], '北京')
  eq('重放同样的步骤两次结果一致', replay(base.rows, base.columns, [step1, step2]).origins, afterTwo.origins)
}

console.log('\n[11] 多数据源对比')
{
  const mk = (name: string, ds: ReturnType<typeof buildDataset>): DataSource => ({
    id: name,
    fileId: name,
    name,
    sheet: ds.sheet,
    sheetIndex: 0,
    size: 0,
    baseline: ds,
    steps: [],
    cursor: 0,
  })
  const dsA = buildDataset('a.csv', '数据', parseCsv('x,y\n1,2\n3,\n'))
  const dsB = buildDataset('b.csv', '数据', parseCsv('x,y\n1,2\n3,4\n'))
  const sa = mk('a', dsA)
  const sb = mk('b', dsB)

  const ma = sourceMetrics(sa)
  const mb = sourceMetrics(sb)
  check('缺失率能横向区分', ma.missingRate > mb.missingRate, `${ma.missingRate} vs ${mb.missingRate}`)
  eq('行数取当前数据', ma.rows, 2)
  check('质量分有差异', ma.score < mb.score, `${ma.score} vs ${mb.score}`)
  check('迷你直方图有内容', ma.histogram.length > 0 && ma.histogram.some((v) => v > 0))

  const cleaned: DataSource = {
    ...sa,
    id: 'a-cleaned',
    steps: [
      {
        id: 's1',
        at: Date.now(),
        spec: { kind: 'fillMissing', colIndex: 1, colName: 'y', strategy: 'zero', value: 0 },
        title: '填充',
        detail: '',
        affected: 1,
      },
    ],
    cursor: 1,
  }
  const mc = sourceMetrics(cleaned)
  eq('填充后缺失率归零', mc.missingRate, 0)
  eq('清洗步数被记录', mc.steps, 1)
  check('原始数据源指标不受影响', sourceMetrics(sa).missingRate > 0)

  // 多数据源报告要带上每个源的清洗日志
  const cmp = buildCompareSheets([
    {
      label: 'a',
      dataset: dsA,
      metrics: ma,
      logs: [{ id: 's1', at: Date.now(), title: '填充缺失（填 0）', affected: 1, detail: '「y」填充了 1 个空单元格 → 0' }],
    },
    { label: 'b', dataset: dsB, metrics: mb, logs: [] },
  ])
  check('多源报告包含操作日志表', cmp.some((s) => s.name === '操作日志'), cmp.map((s) => s.name).join(' / '))
  const cmpLog = cmp.find((s) => s.name === '操作日志')!
  eq('日志表有表头 + 1 条记录', cmpLog.aoa.length, 2)
  eq('日志行第一列是数据源名', cmpLog.aoa[1][0], 'a')
  eq('日志行带操作标题', cmpLog.aoa[1][2], '填充缺失（填 0）')

  const cmpEmpty = buildCompareSheets([{ label: 'b', dataset: dsB, metrics: mb, logs: [] }])
  const emptyLog = cmpEmpty.find((s) => s.name === '操作日志')!
  eq('没做清洗时日志表也有一行说明', emptyLog.aoa.length, 2)
  eq('说明文案', emptyLog.aoa[1][2], '未做清洗')

  // 单表报告的「操作日志」：时间 / 操作 / 影响数量 / 说明
  const rep = buildReportSheets(dsA, [
    { id: 's1', at: Date.now(), title: '删除重复行', affected: 23, detail: '删除了 23 行完全重复的数据' },
  ])
  const repLog = rep.find((s) => s.name === '操作日志')!
  eq('单表报告含操作日志表', repLog.aoa.length, 2)
  eq('日志表头', repLog.aoa[0].join('|'), '时间|操作|影响数量|说明')
  eq('日志记录操作名', repLog.aoa[1][1], '删除重复行')
  eq('日志记录影响数量', repLog.aoa[1][2], 23)
  eq('日志记录明细', repLog.aoa[1][3], '删除了 23 行完全重复的数据')
}

console.log('\n[12] 清洗模板（按列名套用到别的表）')
{
  const src = buildDataset('a.csv', '数据', parseCsv('姓名,城市\n张三, 北京 \n李四,上海\n张三, 北京 \n'))
  const specs: OpSpec[] = [
    { kind: 'trim' },
    { kind: 'fillMissing', colIndex: 1, colName: '城市', strategy: 'text', value: '未填写' },
  ]
  const tplSteps = toTemplateSteps(specs, src.columns)
  eq('模板按列名记录而不是下标', tplSteps[1], {
    kind: 'fillMissing',
    colName: '城市',
    strategy: 'text',
    custom: '未填写',
  })
  eq('步骤可读标签', templateStepLabel(tplSteps[1]), '填充缺失（城市 · 填「未填写」）')

  const dst = buildDataset('b.csv', '数据', parseCsv('姓名,城市\n王五,\n赵六, 广州 \n'))
  const mat = materializeSteps(tplSteps, dst.columns)
  eq('套用后步骤数一致', mat.length, 2)
  const out = replay(dst.rows, dst.columns, mat)
  eq('空格被清理', out.rows[1][1], '广州')
  eq('空缺被填充', out.rows[0][1], '未填写')

  const other = buildDataset('c.csv', '数据', parseCsv('甲,乙\n1,2\n'))
  eq('列名对不上的步骤被跳过', materializeSteps(tplSteps, other.columns).length, 1)
  check('按列名能找回列', findColumnByName(src.columns, '城市')?.index === 1)

  // 没有 localStorage 的环境（node / 隐私模式）也不能崩
  check('无存储环境时读模板返回空数组', loadTemplates().length === 0)
  try {
    persistTemplates([{ id: 'x', name: 'x', createdAt: 0, steps: [] }])
    check('无存储环境时写模板不抛错', true)
  } catch {
    check('无存储环境时写模板不抛错', false, '抛出了异常')
  }
}

console.log('\n[13] 模糊去重')
{
  const opt = { ...DEFAULT_FUZZY, threshold: 0.5 }
  eq('全角转半角+去空格+小写', normalizeText('ＡＢＣ　１２３', opt), 'abc123')
  eq('去标点', normalizeText('张,三。', opt), '张三')
  eq('编辑距离 kitten→sitting', levenshtein('kitten', 'sitting'), 3)
  check('相似度：完全相同为 1', similarity('张三', '张三') === 1)
  check('相似度：差一个字为 0.5', Math.abs(similarity('张三', '张叁') - 0.5) < 1e-9, String(similarity('张三', '张叁')))

  const rows: CellValue[][] = [['张三'], ['张 三'], ['张叁'], ['李四'], ['']]
  const res = findFuzzyGroups(rows, 0, opt)
  check('找到疑似重复组', res.groups.length >= 1, `实际 ${res.groups.length}`)
  eq('待删行下标（保留每组第一条）', res.dropRows, [1, 2])
  eq('跳过了空值', res.scanned, 4)

  const strict = findFuzzyGroups(rows, 0, { ...DEFAULT_FUZZY, threshold: 0.99 })
  eq('阈值 0.99 时只合并归一化后完全相同的', strict.dropRows, [1])

  // 传入拼音转换后，「张三」和「zhangsan」也能归到一起
  const toPinyin = (s: string) => s.replace(/张三/g, 'zhangsan').replace(/张叁/g, 'zhangsan')
  const py = findFuzzyGroups(rows, 0, opt, toPinyin)
  check('拼音比较能扩大召回', py.dropRows.length >= 2, `实际 ${py.dropRows.length}`)

  // 落成清洗步骤后可以重放
  const base = buildDataset('f.csv', '数据', parseCsv('姓名\n张三\n张 三\n张叁\n李四\n'))
  const dropped = replay(base.rows, base.columns, [
    {
      kind: 'fuzzyDedupe',
      colIndex: 0,
      colName: '姓名',
      threshold: 0.5,
      dropRows: [1, 2],
    },
  ])
  eq('重放后剩 2 行', dropped.rows.length, 2)
  eq('保留的是第一条和无关的那条', dropped.origins, [0, 3])
}

console.log('\n[14] 行筛选与列操作')
{
  const csv = ['姓名,年龄,城市', '张三,23,北京', '李四,31,上海', '王五,,广州', '赵六,45,北京'].join('\n')
  const base = buildDataset('t.csv', '数据', parseCsv(csv))
  eq('初始 4 行 3 列', [base.meta.rowCount, base.columns.length], [4, 3])

  // 行筛选：大于
  const gt = replay(base.rows, base.columns, [
    { kind: 'filterRows', colIndex: 1, colName: '年龄', op: 'gt', value: '30' },
  ])
  eq('大于 30 保留 2 行', gt.rows.length, 2)
  eq('保留的行按原顺序', gt.origins, [1, 3])
  eq('空值行被过滤掉', gt.rows.map((r) => r[0]), ['李四', '赵六'])

  // 行筛选：小于 / 等于
  const lt = replay(base.rows, base.columns, [
    { kind: 'filterRows', colIndex: 1, colName: '年龄', op: 'lt', value: '30' },
  ])
  eq('小于 30 只留张三', lt.rows.map((r) => r[0]), ['张三'])

  const eqOp = replay(base.rows, base.columns, [
    { kind: 'filterRows', colIndex: 2, colName: '城市', op: 'eq', value: '北京' },
  ])
  eq('等于按文本匹配', eqOp.rows.map((r) => r[0]), ['张三', '赵六'])

  // 行筛选：包含 / 不包含（忽略大小写）
  const en = buildDataset('e.csv', '数据', parseCsv('名,备注\nA,Alpha\nB,beta\nC,alphabet'))
  const has = replay(en.rows, en.columns, [
    { kind: 'filterRows', colIndex: 1, colName: '备注', op: 'contains', value: 'ALPHA' },
  ])
  eq('包含忽略大小写', has.rows.map((r) => r[0]), ['A', 'C'])

  const notHas = replay(en.rows, en.columns, [
    { kind: 'filterRows', colIndex: 1, colName: '备注', op: 'notContains', value: 'alpha' },
  ])
  eq('不包含', notHas.rows.map((r) => r[0]), ['B'])

  // 删除列
  const drop = replay(base.rows, base.columns, [{ kind: 'dropColumn', colIndex: 1, colName: '年龄' }])
  eq('删列后表头少一个', drop.headers, ['姓名', '城市'])
  eq('删列后每行少一格', drop.rows[0], ['张三', '北京'])
  const dropDs = rebuildDataset(base, drop.rows, { headers: drop.headers })
  eq('重建数据集列数', dropDs.columns.length, 2)
  eq('重建后列名', dropDs.columns.map((c) => c.name), ['姓名', '城市'])

  // 调整列顺序
  const moved = replay(base.rows, base.columns, [
    { kind: 'moveColumn', from: 2, to: 0, colName: '城市' },
  ])
  eq('列顺序调整后表头', moved.headers, ['城市', '姓名', '年龄'])
  eq('列顺序调整后单元格跟着走', moved.rows[0], ['北京', '张三', 23])

  // 重命名
  const renamed = replay(base.rows, base.columns, [
    { kind: 'renameColumn', colIndex: 1, from: '年龄', to: '年龄(岁)' },
  ])
  eq('重命名只改表头', renamed.headers, ['姓名', '年龄(岁)', '城市'])
  eq('重命名不动数据', renamed.rows, base.rows)

  // 结构化操作之后，按当前列下标继续做值操作（下标要跟着走）
  const chained = replay(base.rows, base.columns, [
    { kind: 'dropColumn', colIndex: 0, colName: '姓名' },
    { kind: 'fillMissing', colIndex: 0, colName: '年龄', strategy: 'zero', value: 0 },
  ])
  eq('删列后再按新下标填充', chained.rows[2], [0, '广州'])

  // 筛选后再删列、再重命名，整条链可重放且能撤销到最后
  const full = replay(base.rows, base.columns, [
    { kind: 'filterRows', colIndex: 2, colName: '城市', op: 'eq', value: '北京' },
    { kind: 'dropColumn', colIndex: 1, colName: '年龄' },
    { kind: 'renameColumn', colIndex: 1, from: '城市', to: '所在城市' },
  ])
  eq('链式操作后表头', full.headers, ['姓名', '所在城市'])
  eq('链式操作后行数', full.rows.length, 2)
  const undone = replay(base.rows, base.columns, [])
  eq('撤销到 0 步回到原始数据', [undone.rows.length, undone.headers.length], [4, 3])

  // 结构变化后的逐格对比：按列名对齐，不该把没动的单元格算成改动
  const diff = computeDiff(base, drop.rows, drop.origins, drop.headers)
  eq('删列后没有单元格被误判为改动', diff.changedCells, 0)
  eq('对比列数跟随当前列', diff.changedByColumn.length, 2)
  eq('删掉的行数能算出来', computeDiff(base, gt.rows, gt.origins, gt.headers).removedRows, 2)
}

console.log('\n[14] 模板：重命名后引用新列名（回归）')
{
  const ds = buildDataset('t.csv', '数据', parseCsv('温度,浓度\n25,1\n30,2\n'))
  const specs = materializeSteps(
    [
      { kind: 'renameColumn', colName: '温度', to: '温度(℃)' },
      { kind: 'filterRows', colName: '温度(℃)', op: 'gt', value: '26' },
    ],
    ds.columns,
  )
  eq('重命名 + 引用新名字，两步都要生成', specs.length, 2)
  eq('第一步是重命名', specs[0]?.kind, 'renameColumn')
  eq('第二步是筛选', specs[1]?.kind, 'filterRows')
  eq('筛选的列下标正确', (specs[1] as { colIndex: number } | undefined)?.colIndex, 0)

  // 重命名 → 删掉该列 → 后续步骤按新布局算下标
  const specs2 = materializeSteps(
    [
      { kind: 'renameColumn', colName: '温度', to: 'T' },
      { kind: 'dropColumn', colName: 'T' },
      { kind: 'filterRows', colName: '浓度', op: 'gt', value: '1.5' },
    ],
    ds.columns,
  )
  eq('重命名 + 删列 + 引用剩余列，三步都要生成', specs2.length, 3)
  eq('删列后「浓度」下标变成 0', (specs2[2] as { colIndex: number } | undefined)?.colIndex, 0)

  // 列名真的不存在时仍然跳过，别把容错弄没了
  const specs3 = materializeSteps(
    [{ kind: 'filterRows', colName: '不存在的列', op: 'gt', value: '1' }],
    ds.columns,
  )
  eq('列名不存在时跳过', specs3.length, 0)
}

console.log('\n[15] 表头识别（多行标题的真实报表）')
{
  // 复刻真实文件结构：标题行 + 副标题行 + 空行 + 表头 + 数据 + 汇总行
  const csv = [
    '学生成绩明细,,,,,',
    '45 名学生 · 3 个班级 · 5 门科目,,,,,',
    ',,,,,',
    '学号,姓名,性别,班级,语文,总分',
    '20260101,杨浩然,男,高一(1)班,82,357',
    '20260102,魏志强,男,高一(1)班,85,432',
    '20260103,常思远,男,高一(1)班,80,427',
    '年级平均,,,高一,82.3,405.3',
  ].join('\n')
  const ds = buildDataset('成绩.xlsx', '数据', parseCsv(csv))
  eq('表头认在第 4 行（下标 3）', findHeaderRow(parseCsv(csv)), 3)
  eq('列数', ds.meta.colCount, 6)
  eq('列名', ds.columns.map((c) => c.name), ['学号', '姓名', '性别', '班级', '语文', '总分'])
  eq('行数（3 名学生 + 1 汇总行）', ds.meta.rowCount, 4)
  // 学号列里混进了「年级平均」，3 数字 : 1 文本 → 低于 90% 阈值，按文本处理
  eq('第一行数据没有被标题污染', ds.rows[0].slice(0, 2), ['20260101', '杨浩然'])
  check(
    '最后一行是汇总行时给出提示',
    ds.meta.notes.some((n) => n.includes('合计/统计行')),
    JSON.stringify(ds.meta.notes),
  )

  // 回归：常见形态不能被改坏
  eq('普通表格（表头在第 1 行）', buildDataset('a.csv', 's', parseCsv('a,b,c\n1,2,3\n')).meta.colCount, 3)
  eq(
    '单行标题 + 表头',
    buildDataset('b.csv', 's', parseCsv('销售报表,,,\na,b,c\n1,2,3\n')).columns.map((c) => c.name),
    ['a', 'b', 'c'],
  )
  eq(
    '单列表格（没有结构线索时退回第一个非空行）',
    buildDataset('c.csv', 's', parseCsv('值\n1\n2\n')).columns.map((c) => c.name),
    ['值'],
  )
}

console.log('\n[16] 手动删除行（可撤销）')
{
  const base = buildDataset('t.csv', '数据', parseCsv('a,b\n1,x\n2,y\n3,z\n4,w\n'))
  const dropped = replay(base.rows, base.columns, [{ kind: 'dropRows', indices: [1, 3] }])
  eq('删掉 2 行', dropped.rows.length, 2)
  eq('行来源映射正确', dropped.origins, [0, 2])
  eq('留下的是第 1、3 行', dropped.rows.map((r) => r[0]), [1, 3])
  eq('删行结果可撤销（0 步 = 原始）', replay(base.rows, base.columns, []).rows.length, 4)

  const chained = replay(base.rows, base.columns, [
    { kind: 'dropRows', indices: [0] },
    { kind: 'filterRows', colIndex: 0, colName: 'a', op: 'gt', value: '2' },
  ])
  eq('删行后再筛选', chained.rows.map((r) => r[0]), [3, 4])
  eq('删行不进模板（依赖具体行号）', toTemplateSteps([{ kind: 'dropRows', indices: [0] }], base.columns), [])
}

console.log('\n[17] 直方图分箱设置')
{
  const rows = ['v', ...Array.from({ length: 100 }, (_, i) => String(i + 1))].join('\n')
  const ds = buildDataset('t.csv', 's', parseCsv(rows))
  const col = ds.columns[0]
  eq('按组数：填 10 就是 10 组', resolveBinCount({ mode: 'count', n: 10 }, col, 100), 10)
  eq('按组数：超上限被夹到 200', resolveBinCount({ mode: 'count', n: 999 }, col, 100), 200)
  eq('按组数：小于 2 被夹到 2', resolveBinCount({ mode: 'count', n: 1 }, col, 100), 2)
  eq('自动：√100 = 10 组', resolveBinCount({ mode: 'auto' }, col, 100), 10)

  const range = normalRange(col)
  check('正常区间能算出来', !!range)
  if (range) {
    const expected = Math.round((range[1] - range[0]) / 10)
    eq('按组距：宽 10 → 组数由区间反推', resolveBinCount({ mode: 'width', w: 10 }, col, 100), expected)
  }
  // 组距非法时退回自动，不能除零或产生 NaN 组数
  check('组距为 0 时退回自动', resolveBinCount({ mode: 'width', w: 0 }, col, 100) === 10)
}

console.log('\n[18] 合计/统计行与列不报异常')
{
  // 合计行：241 在数据里是明显的极端值，但它不是脏数据
  const csv = ['姓名,分数', '张三,80', '李四,82', '王五,79', '合计,241'].join('\n')
  const ds = buildDataset('t.csv', '数据', parseCsv(csv))
  eq('识别出 1 行合计行', ds.meta.summaryRows, 1)
  eq('合计行是最后一行', ds.meta.summaryRowIndexes, [3])
  eq('合计值不进 min/max', [ds.columns[1].numeric!.min, ds.columns[1].numeric!.max], [79, 82])
  eq('合计行不产生异常值', ds.columns[1].numeric!.outliers, 0)
  check(
    '提示里说明了排除',
    ds.meta.notes.some((n) => n.includes('合计/统计行')),
    ds.meta.notes.join(' | '),
  )

  // 对照：不告诉判定函数「这是合计行」的话，241 本来会被判成异常
  const col = ds.columns[1]
  check('同一行的值当普通数据会被判异常', isOutlierValue(241, col, DEFAULT_OUTLIER_SETTINGS, false))
  check('标为合计行后不再判异常', !isOutlierValue(241, col, DEFAULT_OUTLIER_SETTINGS, true))

  // 合计列：总分是算出来的，不该被标红
  const sumCsv = ['姓名,语文,总分', '张三,80,160', '李四,82,170', '王五,79,155'].join('\n')
  const sumDs = buildDataset('s.csv', '数据', parseCsv(sumCsv))
  check('「总分」列被认成合计列', sumDs.columns[2].summary === true, String(sumDs.columns[2].summary))
  eq('合计列不做异常值判定', sumDs.columns[2].numeric!.outliers, 0)
  check(
    '合计列给出 info 提示',
    sumDs.columns[2].issues.some((i) => i.code === 'SUMMARY_ROW' && i.severity === 'info'),
    sumDs.columns[2].issues.map((i) => i.code).join(','),
  )
  check('普通列仍然照常判定', sumDs.columns[1].summary !== true)

  // 统计汇总表：整张都是算出来的数
  const sheetCsv = ['统计项,结果', '学生人数,300', '平均年龄,16.18', '总分最高,569'].join('\n')
  const sheetDs = buildDataset('x.csv', '统计汇总', parseCsv(sheetCsv))
  eq('整张表被判为统计汇总表', sheetDs.meta.summarySheet, true)
  eq('统计汇总表不产生异常值', sheetDs.columns[1].numeric!.outliers, 0)
  check(
    '提示里说明是统计汇总表',
    sheetDs.meta.notes.some((n) => n.includes('统计汇总表')),
    sheetDs.meta.notes.join(' | '),
  )

  // 普通数据不该受影响：没有合计行时照样能发现异常
  const plainDs = buildDataset('p.csv', '数据', parseCsv('温度\n20\n21\n19\n20\n999\n'))
  eq('普通表没有识别到合计行', plainDs.meta.summaryRows, 0)
  check(
    '普通表的 999 仍然是异常值',
    plainDs.columns[0].numeric!.outliers === 1,
    String(plainDs.columns[0].numeric!.outliers),
  )
}

console.log('\n[19] 校验报告文本')
{
  const csv = ['姓名,分数', '张三,80', '李四,', '王五,70', '张三,80'].join('\n')
  const base = buildDataset('t.csv', '数据', parseCsv(csv))
  const seq = buildStepSequence(base.rows, base.columns, [
    { kind: 'fillMissing', colIndex: 1, colName: '分数', strategy: 'zero', value: 0 },
    { kind: 'dropDuplicates' },
  ])
  const after = rebuildDataset(base, seq.rows, { headers: seq.headers })
  const text = buildCheckReport({
    dataset: after,
    baseline: base,
    steps: seq.steps,
    cursor: seq.steps.length,
    now: new Date(2026, 10, 5, 21, 30),
  })

  check('含标题', text.includes('LabClean 清洗校验报告'), text.slice(0, 40))
  check('含生成时间', text.includes('2026-11-05 21:30'), text)
  check('原始行数正确', text.includes('原始行数：4'), text)
  check('清洗后行数正确', text.includes('清洗后行数：3'), text)
  check('删除行数正确', text.includes('删除行数：1'), text)
  check('填充空值统计正确', text.includes('填充空值：1 处'), text)
  check('含异常值前后对照', /异常值：\d+ → \d+/.test(text), text)
  check('含步骤明细', text.includes('1. 填充缺失') && text.includes('2. 删除重复行'), text)

  // 撤销掉最后一步：报告里只剩已应用的，并注明有步骤被撤销
  const partial = buildCheckReport({ dataset: after, baseline: base, steps: seq.steps, cursor: 1 })
  check('撤销的步骤不计入', !partial.includes('2. 删除重复行'), partial)
  check('注明有步骤已撤销', partial.includes('已撤销'), partial)

  // 没做过清洗也要有明确说明
  const none = buildCheckReport({ dataset: base, baseline: base, steps: [], cursor: 0 })
  check('未清洗时说明按原始状态', none.includes('清洗步骤：无'), none)
}

console.log('\n[20] 智能推荐图表（字段类型判定 + 图表推荐 + 序列抽取）')
{
  // day=时间, temp=数值(含离群 999), hum=数值, cat=低基数文本(类别), sn=每行唯一文本(编号)
  const ds = buildDataset(
    'rec.csv',
    '数据',
    parseCsv('day,temp,hum,cat,sn\n2024-01-01,10,50,A,s1\n2024-01-02,20,55,A,s2\n2024-01-03,30,60,B,s3\n2024-01-04,40,65,B,s4\n2024-01-05,999,70,A,s5\n'),
  )
  eq('行数', ds.meta.rowCount, 5)

  // 字段类型判定
  const byName = (n: string) => ds.columns.find((c) => c.name === n)!
  eq('日期列判为时间序列', classifyField(byName('day'), 5), 'time')
  eq('数值列判为度量', classifyField(byName('temp'), 5), 'measure')
  eq('低基数文本判为类别', classifyField(byName('cat'), 5), 'category')
  eq('每行唯一的文本判为编号', classifyField(byName('sn'), 5), 'id')
  const infos = classifyFields(ds)
  eq('classifyFields 覆盖全部列', infos.length, ds.columns.length)
  eq('编号列不可画图', infos.find((f) => f.name === 'sn')!.chartable, false)
  eq('度量列可画图', infos.find((f) => f.name === 'temp')!.chartable, true)

  // 图表推荐
  const plans = recommendCharts(ds)
  const kinds = plans.map((p) => p.kind)
  check('推荐了直方图', kinds.includes('histogram'))
  check('对有离群点的数值列推荐了箱线图', kinds.includes('boxplot'))
  check('推荐了条形图', kinds.includes('bar'))
  check('有时间列+数值列时推荐了折线图', kinds.includes('line'))
  check('有两个数值列时推荐了散点图', kinds.includes('scatter'))
  const boxTargets = plans.filter((p) => p.kind === 'boxplot').map((p) => p.colName)
  eq('箱线图只针对检出离群点的列', boxTargets, ['temp'])
  const line = plans.find((p) => p.kind === 'line')!
  eq('折线图时间轴选日期列', line.colName, 'day')
  eq('折线图数值选首要度量列', line.secondName, 'temp')
  const scatter = plans.find((p) => p.kind === 'scatter')!
  eq('散点图 X 为第一度量', scatter.colName, 'temp')
  eq('散点图 Y 为第二度量', scatter.secondName, 'hum')
  check('每条推荐都带场景说明', plans.every((p) => p.scenario.length > 0 && p.reason.length > 0))

  // 时间序列抽取：按日期升序聚合均值
  const ts = timeSeries(ds.rows, byName('day').index, byName('temp').index)
  eq('时间点数量', ts.length, 5)
  eq('时间升序', ts.map((p) => p.label), ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'])
  eq('每个时间点单行即原值', ts.map((p) => p.value), [10, 20, 30, 40, 999])

  // 散点抽取：有效点对 + 相关系数 + 回归线
  const sc = scatterSeries(ds.rows, byName('temp').index, byName('hum').index)
  eq('有效点对数', sc.n, 5)
  eq('抽样点数不超过点对数', sc.points.length, 5)
  check('相关系数有限', Number.isFinite(sc.r), `r=${sc.r}`)
  check('temp 与 hum 正相关', sc.r > 0.5, `r=${sc.r}`)
  check('能拟合回归线', sc.line !== null && Number.isFinite(sc.line!.slope))

  // 边界：缺列 / 无数值不崩
  eq('没有数值列时不推荐散点', recommendCharts(buildDataset('t.csv', '数据', parseCsv('a,b\nx,y\np,q\n'))).filter((p) => p.kind === 'scatter').length, 0)
}

console.log('\n[21] 体检口径回归（baseline 写时复制 / 类型阈值 / 唯一值 / 众数 / 时间聚合）')
{
  // 少量脏值不该把整列判成文本
  const noisy: string[][] = [['温度']]
  for (let i = 0; i < 500; i++) noisy.push([String(10 + i)])
  noisy.push(['01'])
  eq('单个前导零不改变数值判定', buildDataset('n1.csv', '数据', noisy).columns[0].type, 'number')

  const noisy2: string[][] = [['读数']]
  for (let i = 0; i < 500; i++) noisy2.push([String(10 + i)])
  noisy2.push(['1,234'])
  eq('单个千分位不改变数值判定', buildDataset('n2.csv', '数据', noisy2).columns[0].type, 'number')

  const ids = buildDataset('n3.csv', '数据', [['编号'], ['001'], ['002'], ['003']])
  eq('编号列仍按文本保留', ids.columns[0].type, 'text')

  // 数值列的唯一值是真唯一值
  const dv = buildDataset('n4.csv', '数据', [['v'], ['1'], ['2'], ['2'], ['3'], ['3']])
  eq('数值列唯一值', dv.columns[0].distinct, 3)

  // 数值列的「出现最多的值」填充真的会填
  const mv = buildDataset('n5.csv', '数据', [
    ['v', 'note'],
    ['1', 'a'],
    ['2', 'b'],
    ['2', 'c'],
    ['', 'd'],
    ['3', 'e'],
  ])
  const mode = resolveFillValue(mv.columns[0], 'mode')
  eq('数值众数取到 2', mode, 2)
  eq('数值列众数填充生效', opFillMissing(mv.rows, 0, 'v', mode).affected, 1)

  // 清洗重算不能改写 baseline
  const baseRows: string[][] = [['id', 'v']]
  for (let i = 0; i < 17; i++) baseRows.push([String(i), String(100 + i)])
  baseRows.push(['17', 'N/A'], ['18', 'N/A'])
  const base = buildDataset('n6.csv', '数据', baseRows)
  eq('少量坏值仍判为文本', base.columns[1].type, 'text')
  const kept = replay(base.rows, base.columns, [{ kind: 'dropRows', indices: [18, 19] }])
  eq('删掉坏行后翻成数值', rebuildDataset(base, kept.rows).columns[1].type, 'number')
  eq('baseline 原值仍是字符串', base.rows[0][1], '100')

  // 同一天多个时刻按天聚合
  const t = buildDataset(
    'n7.csv',
    '数据',
    parseCsv('day,v\n2024-01-01 08:00,10\n2024-01-01 20:00,20\n2024-01-02 08:00,30\n'),
  )
  const ts = timeSeries(t.rows, 0, 1)
  eq('同一天只留一个时间点', ts.length, 2)
  eq('同一天取均值', ts[0].value, 15)

  // 数值型编号不推荐直方图
  const idRows: string[][] = [['学号', '成绩']]
  for (let i = 0; i < 60; i++) idRows.push([String(20260101 + i), String(60 + i)])
  const idDs = buildDataset('n8.csv', '数据', idRows)
  eq('学号列判为编号', classifyField(idDs.columns[0], idDs.meta.rowCount), 'id')
  check(
    '学号不推荐直方图',
    recommendCharts(idDs).every((p) => !(p.kind === 'histogram' && p.colName === '学号')),
  )
}

console.log(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'))
  throw new Error(`${failures.length} 项断言失败`)
}
console.log('全部通过 ✅\n')
