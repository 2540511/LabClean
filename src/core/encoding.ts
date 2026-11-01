export interface DecodedText {
  text: string
  encoding: string
}

/**
 * 中文数据最常见的翻车点就是编码。
 * 顺序：BOM 判定 -> UTF-8 严格解码 -> GB18030 兜底（覆盖 GBK/GB2312）。
 */
export function decodeText(buffer: ArrayBuffer): DecodedText {
  const bytes = new Uint8Array(buffer)

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'UTF-8' }
  } catch {
    // 不是合法 UTF-8，按国标解码（Excel 导出的 csv 在中文 Windows 上默认是 GBK）
  }

  try {
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'GB18030' }
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8（含无法识别字符）' }
  }
}
