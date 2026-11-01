export function pct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function num(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  const abs = Math.abs(x)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return x.toExponential(2)
  return String(Number(x.toPrecision(digits + 2)))
}

export function int(n: number): string {
  return n.toLocaleString('zh-CN')
}

export function compact(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)} 万`
  return int(n)
}

/** 坐标轴用的短数字：既要短，又要还能读出量级 */
export function shortNum(x: number): string {
  if (!Number.isFinite(x)) return ''
  const a = Math.abs(x)
  if (a === 0) return '0'
  if (a >= 1e8) return `${(x / 1e8).toFixed(1)}亿`
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(x / 1e3).toFixed(0)}k`
  if (a >= 1000) return x.toFixed(0)
  if (a >= 100) return x.toFixed(a >= 995 ? 0 : 1)
  if (a >= 1) return x.toFixed(2).replace(/\.?0+$/, '')
  return x.toPrecision(2)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function nowStamp(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
