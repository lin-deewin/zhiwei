// getRandomValues also works on LAN HTTP pages, where randomUUID is unavailable.
export function newRequestKey(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前浏览器无法生成保存标识，请更新浏览器后重试。')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
