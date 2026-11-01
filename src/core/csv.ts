const CANDIDATES = [',', ';', '\t', '|'] as const

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 在第一行（考虑引号）里数各候选分隔符出现次数，取最多的那个 */
export function detectDelimiter(text: string): string {
  const firstLineEnd = (() => {
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && (ch === '\n' || ch === '\r')) return i
    }
    return text.length
  })()

  const line = text.slice(0, firstLineEnd)
  let best = ','
  let bestCount = -1
  for (const d of CANDIDATES) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') inQuotes = !inQuotes
      else if (!inQuotes && ch === d) count++
    }
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

/**
 * RFC4180 风格的 CSV 解析器：
 * 支持双引号包裹、引号内换行、"" 转义、CRLF / LF。
 * 全部字段保持字符串，不做任何类型猜测 —— 这样身份证号/订单号这类长数字不会被 JS 精度吃掉。
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = stripBom(text)
  const delim = delimiter ?? detectDelimiter(src)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  let fieldStarted = false

  const pushField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < src.length) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"' && !fieldStarted && field === '') {
      inQuotes = true
      fieldStarted = true
      i++
      continue
    }

    if (ch === delim) {
      pushField()
      i++
      continue
    }

    if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      pushRow()
      i++
      continue
    }

    if (ch === '\n') {
      pushRow()
      i++
      continue
    }

    field += ch
    fieldStarted = true
    i++
  }

  // 收尾：最后一行没有换行符时也要保留
  if (field !== '' || row.length > 0) pushRow()

  // 丢掉完全空的尾部行
  while (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (last.length === 0 || (last.length === 1 && last[0].trim() === '')) rows.pop()
    else break
  }

  return rows
}
