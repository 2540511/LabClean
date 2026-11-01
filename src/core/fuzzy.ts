import type { CellValue } from './types'
import { isBlank, rawText } from './value'

export interface FuzzyOptions {
  /** 相似度阈值 0..1，1 表示完全相等 */
  threshold: number
  /** 是否转成拼音再比较（张三 vs zhangsan） */
  usePinyin: boolean
  ignoreSpaces: boolean
  ignoreCase: boolean
  ignorePunctuation: boolean
}

export const DEFAULT_FUZZY: FuzzyOptions = {
  threshold: 0.85,
  usePinyin: false,
  ignoreSpaces: true,
  ignoreCase: true,
  ignorePunctuation: true,
}

export interface FuzzyGroup {
  /** 该组所有行的下标，第一个是保留的那条 */
  rows: number[]
  /** 对应的原始值，便于人工确认 */
  values: string[]
  key: string
}

export interface FuzzyResult {
  groups: FuzzyGroup[]
  scanned: number
  truncated: boolean
  /** 需要删除的行下标（每组保留第一条） */
  dropRows: number[]
}

/** 展示用的组数上限：太多也没人看得过来 */
export const MAX_DISPLAY_GROUPS = 100
const MAX_SCAN_ROWS = 20_000

const FULLWIDTH_RE = /[\uff01-\uff5e]/g
const PUNCT_RE = /[\s\p{P}\p{S}]/gu

/** 全角转半角 + 可选的去空格/去标点/转小写 */
export function normalizeText(input: string, opt: FuzzyOptions): string {
  let s = input.replace(FULLWIDTH_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  if (opt.ignoreCase) s = s.toLowerCase()
  if (opt.ignoreSpaces) s = s.replace(/\s+/g, '')
  if (opt.ignorePunctuation) s = s.replace(PUNCT_RE, '')
  return s
}

/** 编辑距离（两行滚动数组实现，短文本足够快） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev: number[] = new Array(n + 1)
  let cur: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j] + 1
      const ins = cur[j - 1] + 1
      const sub = prev[j - 1] + cost
      cur[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[n]
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

export type PinyinFn = (s: string) => string

/**
 * 找疑似重复：按「归一化后的值」分组，逐个和已有的代表值比较相似度。
 * 先按长度分桶，长度差超过允许编辑距离的直接不比，省掉大部分无效计算。
 */
export function findFuzzyGroups(
  rows: CellValue[][],
  colIndex: number,
  opt: FuzzyOptions,
  toPinyin?: PinyinFn,
): FuzzyResult {
  const reps: { key: string; rows: number[]; values: string[] }[] = []
  const byLen = new Map<number, number[]>()
  let scanned = 0

  for (let r = 0; r < rows.length; r++) {
    if (scanned >= MAX_SCAN_ROWS) break
    const v = rows[r][colIndex]
    if (isBlank(v)) continue
    const raw = rawText(v)
    let key = normalizeText(raw, opt)
    if (toPinyin) key = toPinyin(key)
    if (!key) continue
    scanned++

    const len = key.length
    const maxDist = Math.floor((1 - opt.threshold) * len + 1e-9)
    let matched = false

    for (let l = Math.max(1, len - maxDist); l <= len + maxDist && !matched; l++) {
      const bucket = byLen.get(l)
      if (!bucket) continue
      for (const idx of bucket) {
        const rep = reps[idx]
        if (similarity(key, rep.key) >= opt.threshold) {
          rep.rows.push(r)
          rep.values.push(raw)
          matched = true
          break
        }
      }
    }

    if (!matched) {
      reps.push({ key, rows: [r], values: [raw] })
      const bucket = byLen.get(len)
      if (bucket) bucket.push(reps.length - 1)
      else byLen.set(len, [reps.length - 1])
    }
  }

  const dupGroups = reps
    .filter((x) => x.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length)

  const dropRows: number[] = []
  for (const g of dupGroups) {
    for (let i = 1; i < g.rows.length; i++) dropRows.push(g.rows[i])
  }
  dropRows.sort((a, b) => a - b)

  return {
    groups: dupGroups.slice(0, MAX_DISPLAY_GROUPS),
    scanned,
    truncated: rows.length > MAX_SCAN_ROWS && scanned >= MAX_SCAN_ROWS,
    dropRows,
  }
}
