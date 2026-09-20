import type { Example } from './files.ts'

export type { Example }

let cached: Promise<Example[]> | null = null

export function loadExamples(): Promise<Example[]> {
  if (!cached) {
    cached = fetch('./examples/index.json').then(response => {
      if (!response.ok) throw new Error('Missing examples/index.json')
      return response.json() as Promise<Example[]>
    })
  }
  return cached
}
