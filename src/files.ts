export type Format = 'vcd' | 'fst'
export type Mode = 'example' | 'files'

export type Example = {
  id: string
  title: string
  waveform: string[]
  script: string
}

export type WaveFile = {
  id: string
  name: string
  format: Format | null
  bytes: number
  pythonPath: string
  displayPath: string
  blobUrl: string
  data: ArrayBuffer
  source: 'example' | 'upload'
}

export const WAVEKIT_VERSION = '0.8.1'

export const WAVEKIT_INSTALL = `import os
import micropip

os.chdir('/home/pyodide')
await micropip.install(['wavekit==${WAVEKIT_VERSION}', 'typing_extensions'])

`

export function formatFromName(name: string): Format | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.vcd')) return 'vcd'
  if (lower.endsWith('.fst')) return 'fst'
  return null
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function uniquePythonPath(name: string, used: Iterable<string>): string {
  const taken = new Set(used)
  const base = `uploads/${name}`
  if (!taken.has(base)) return base
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  let n = 2
  while (taken.has(`uploads/${stem}_${n}${ext}`)) n += 1
  return `uploads/${stem}_${n}${ext}`
}

export function withInstall(code: string): string {
  return `${WAVEKIT_INSTALL}${code}`
}
