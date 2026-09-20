type FileInput = { path: string; bytes: ArrayBuffer }

type Pyodide = {
  FS: { mkdirTree: (path: string) => void; writeFile: (path: string, bytes: Uint8Array) => void }
  loadPackage: (packages: string[]) => Promise<void>
  runPythonAsync: (code: string) => Promise<unknown>
  setStdout: (options: { batched: (text: string) => void }) => void
  setStderr: (options: { batched: (text: string) => void }) => void
}

let pyodide: Pyodide

async function initialize() {
  const moduleUrl = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs'
  const { loadPyodide } = await import(/* @vite-ignore */ moduleUrl) as {
    loadPyodide: () => Promise<Pyodide>
  }
  pyodide = await loadPyodide()
  await pyodide.loadPackage(['micropip', 'numpy'])
  await pyodide.runPythonAsync("import micropip\nawait micropip.install(['wavekit==0.8.1', 'typing_extensions'])")
  self.postMessage({ type: 'ready' })
}

async function run(code: string, files: FileInput[]) {
  const output: string[] = []
  pyodide.setStdout({ batched: (text: string) => output.push(`${text}\n`) })
  pyodide.setStderr({ batched: (text: string) => output.push(`[stderr] ${text}\n`) })
  for (const file of files) {
    const path = `/home/pyodide/${file.path}`
    const parent = path.slice(0, path.lastIndexOf('/'))
    pyodide.FS.mkdirTree(parent)
    pyodide.FS.writeFile(path, new Uint8Array(file.bytes))
  }
  await pyodide.runPythonAsync("import os\nos.chdir('/home/pyodide')")
  await pyodide.runPythonAsync(code)
  self.postMessage({ type: 'result', output: output.join('') })
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'run') await run(data.code, data.files)
  } catch (error) {
    self.postMessage({ type: 'error', output: `${error instanceof Error ? error.stack : String(error)}` })
  }
}

initialize().catch(error => self.postMessage({ type: 'error', output: String(error) }))
