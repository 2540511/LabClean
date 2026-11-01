/**
 * 核心逻辑冒烟测试：不碰浏览器，直接用 node 跑数据引擎。
 * 用法：先由 esbuild 打包成 .tmp/smoke.mjs，再 node 执行（见 scripts/run-smoke.mjs）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from '../src/core/csv'
import { buildDataset, rebuildDataset } from '../src/core/profile'
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
import { replay, type OpSpec } from '../src/core/pipeline'
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

console.log(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'))
  throw new Error(`${failures.length} 项断言失败`)
}
console.log('全部通过 ✅\n')
