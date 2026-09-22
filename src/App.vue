<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logoSrc from './assets/logo.svg'
import CodeEditor from './CodeEditor.vue'
import { loadExamples, type Example } from './examples'
import {
  formatFromName,
  formatSize,
  uniquePythonPath,
  WAVEKIT_VERSION,
  type Mode,
  type WaveFile,
} from './files'

const SURFER_SRC = import.meta.env.DEV ? './surfer/index.html#dev' : './surfer/index.html'

const mode = ref<Mode>('example')
const filesOpen = ref(true)
const rootStyle = getComputedStyle(document.documentElement)
const SIDEBAR_DEFAULT = Number.parseInt(rootStyle.getPropertyValue('--sidebar-default'), 10)
const SIDEBAR_MIN = Number.parseInt(rootStyle.getPropertyValue('--sidebar-min'), 10)
const SIDEBAR_MAX = Number.parseInt(rootStyle.getPropertyValue('--sidebar-max'), 10)
const RETRY_TIMEOUT_MS = Number.parseInt(rootStyle.getPropertyValue('--retry-timeout-ms'), 10)
const RETRY_INTERVAL_MS = Number.parseInt(rootStyle.getPropertyValue('--retry-interval-ms'), 10)
const RETRY_ATTEMPTS = Math.round(RETRY_TIMEOUT_MS / RETRY_INTERVAL_MS)
const sidebarWidth = ref(SIDEBAR_DEFAULT)
const menuOpen = ref(false)
const examples = ref<Example[]>([])
const exampleId = ref<string | null>(null)
const files = ref<WaveFile[]>([])
const selectedId = ref<string | null>(null)
const surferRef = ref<HTMLIFrameElement | null>(null)
const workspaceRef = ref<HTMLElement | null>(null)
const surferRatio = ref(0.4)
const codeRatio = ref(0.7)
const code = ref('')
const output = ref('')
const running = ref(false)
const pythonReady = ref(false)
const surferCollapsed = ref(false)
const pythonCollapsed = ref(false)
const initialCode = ref('')

let lastBlobUrl = ''
let loadSeq = 0
let worker: Worker | null = null
let idSeq = 0

function uniqueId() {
  idSeq += 1
  return `${Date.now()}-${idSeq}`
}

const currentExample = computed(() => examples.value.find(item => item.id === exampleId.value) ?? null)
const visibleFiles = computed(() => files.value.filter(file => (mode.value === 'example') === (file.source === 'example')))
const selected = computed(() => files.value.find(file => file.id === selectedId.value) ?? null)
const surferStyle = computed(() => ({ flex: pythonCollapsed.value ? '1 1 auto' : `0 0 ${surferRatio.value * 100}%` }))
const surferEmpty = computed(() => selectedId.value === null)

function loadSurfer(blobUrl: string, attempt = 0) {
  lastBlobUrl = blobUrl
  const win = surferRef.value?.contentWindow
  if (win && 'inject_message' in win) {
    win.postMessage({ command: 'LoadUrl', url: blobUrl }, location.origin)
    return
  }
  if (attempt < RETRY_ATTEMPTS) setTimeout(() => { if (lastBlobUrl === blobUrl) loadSurfer(blobUrl, attempt + 1) }, RETRY_INTERVAL_MS)
}

function onSurferLoad() {
  if (lastBlobUrl) loadSurfer(lastBlobUrl)
  simplifySurferUi()
}

function injectSurfer(message: unknown) {
  surferRef.value?.contentWindow?.postMessage(
    { command: 'InjectMessage', message: JSON.stringify(message) },
    location.origin,
  )
}

function simplifySurferUi(attempt = 0) {
  const win = surferRef.value?.contentWindow
  if (!win || !('inject_message' in win)) {
    if (attempt < RETRY_ATTEMPTS) setTimeout(() => simplifySurferUi(attempt + 1), RETRY_INTERVAL_MS)
    return
  }
  // ponytail: config.toml support in the WASM build is unverified; send
  // equivalent runtime Message variants as a fallback. Group ids are the
  // lowercase strings matching TOOLBAR_GROUP_SPECS (same as config.toml keys).
  injectSurfer({ SetMenuVisible: false })
  injectSurfer({ SetStatusbarVisible: false })
  injectSurfer({ SetToolbarGroupEnabled: ['files', false] })
  injectSurfer({ SetToolbarGroupEnabled: ['cxxrtl', false] })
}

function revoke(file: WaveFile) {
  URL.revokeObjectURL(file.blobUrl)
}

async function fetchExample(example: Example) {
  const base = `./examples/${example.id}`
  const [waves, script] = await Promise.all([
    Promise.all(example.waveform.map(name =>
      fetch(`${base}/${name}`).then(response => {
        if (!response.ok) throw new Error(`Missing ${name}`)
        return response.arrayBuffer()
      }),
    )),
    fetch(`${base}/${example.script}`).then(response => {
      if (!response.ok) throw new Error(`Missing ${example.script}`)
      return response.text()
    }),
  ])
  return { waves, script }
}

async function loadExample(example: Example, prefill: boolean) {
  const seq = ++loadSeq
  menuOpen.value = false
  mode.value = 'example'
  exampleId.value = example.id
  const { waves, script } = await fetchExample(example)
  if (seq !== loadSeq) return
  const next: WaveFile[] = example.waveform.map((name, index) => {
    const wave = waves[index]
    const format = formatFromName(name)
    if (!format) throw new Error('Example waveform must be VCD or FST')
    return {
      id: `example:${example.id}:${name}`,
      name,
      format,
      bytes: wave.byteLength,
      pythonPath: name,
      displayPath: `example/${example.id}/${name}`,
      blobUrl: URL.createObjectURL(new Blob([wave.slice(0)])),
      data: wave,
      source: 'example',
    }
  })
  const previous = files.value.filter(file => file.source === 'example')
  files.value = [...files.value.filter(file => file.source !== 'example'), ...next]
  selectedId.value = next[0]?.id ?? null
  previous.forEach(revoke)
  if (next[0]) loadSurfer(next[0].blobUrl)
  if (prefill) {
    initialCode.value = script
    code.value = script
  }
  if (seq !== loadSeq) return
}

function selectFile(file: WaveFile) {
  selectedId.value = file.id
  loadSurfer(file.blobUrl)
}

async function removeFile(file: WaveFile) {
  files.value = files.value.filter(item => item.id !== file.id)
  revoke(file)
  if (selectedId.value === file.id) {
    const next = visibleFiles.value.find(item => item.format)
    selectedId.value = next?.id ?? null
    if (next) loadSurfer(next.blobUrl)
  }
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = [...(input.files ?? [])]
  input.value = ''
  for (const file of chosen) {
    const format = formatFromName(file.name)
    const name = file.name.split(/[/\\]/).pop() ?? file.name
    const pythonPath = uniquePythonPath(name, files.value.map(item => item.pythonPath))
    const wave = await file.arrayBuffer()
    const blobUrl = URL.createObjectURL(new Blob([wave.slice(0)]))
    const next: WaveFile = {
      id: uniqueId(),
      name,
      format,
      bytes: wave.byteLength,
      pythonPath,
      displayPath: pythonPath,
      blobUrl,
      data: wave,
      source: 'upload',
    }
    files.value = [...files.value, next]
    if (format) {
      selectedId.value = next.id
      loadSurfer(blobUrl)
    }
  }
}

function switchMode(next: Mode) {
  menuOpen.value = next === 'example' ? !menuOpen.value : false
  mode.value = next
  if (next === 'files') filesOpen.value = true
  const shown = files.value.filter(file => (next === 'example') === (file.source === 'example'))
  const keep = shown.find(file => file.id === selectedId.value) ?? shown[0]
  if (keep) {
    selectFile(keep)
  } else {
    selectedId.value = null
    lastBlobUrl = ''
  }
}

function download(file: WaveFile) {
  const link = document.createElement('a')
  link.href = file.blobUrl
  link.download = file.name
  link.click()
}

function fail(error: unknown) {
  output.value = String(error)
}

function runCode() {
  if (!worker || !pythonReady.value || running.value) return
  running.value = true
  output.value = ''
  worker.postMessage({
    type: 'run',
    code: code.value,
    files: visibleFiles.value.map(file => ({
      path: file.pythonPath.split('/').pop(),
      bytes: file.data.slice(0),
    })),
  })
}

function clearOutput() {
  output.value = ''
}

function resetCode() {
  code.value = mode.value === 'example' ? initialCode.value : ''
}

function clearCode() {
  code.value = ''
}

function toggleSurfer() {
  surferCollapsed.value = !surferCollapsed.value
  if (surferCollapsed.value) pythonCollapsed.value = false
}

function togglePython() {
  pythonCollapsed.value = !pythonCollapsed.value
  if (pythonCollapsed.value) surferCollapsed.value = false
}

function startSidebarResize(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  document.body.classList.add('resizing-columns')
  const onMove = (move: PointerEvent) => {
    sidebarWidth.value = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, move.clientX))
  }
  const onUp = () => {
    document.body.classList.remove('resizing-columns')
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

function startCodeSplit(event: PointerEvent) {
  const pane = (event.currentTarget as HTMLElement).parentElement
  if (!pane) return
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const onMove = (move: PointerEvent) => {
    const rect = pane.getBoundingClientRect()
    codeRatio.value = Math.max(0.3, Math.min(0.7, (move.clientX - rect.left) / rect.width))
  }
  const onUp = () => {
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

function startSplit(event: PointerEvent) {
  const workspace = workspaceRef.value
  if (!workspace) return
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  workspace.classList.add('resizing')
  const onMove = (move: PointerEvent) => {
    const rect = workspace.getBoundingClientRect()
    const usable = rect.height - handle.offsetHeight
    surferRatio.value = Math.min(0.85, Math.max(0.2, (move.clientY - rect.top) / usable))
  }
  const onUp = () => {
    workspace.classList.remove('resizing')
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

function onWindowClick() {
  menuOpen.value = false
}

onMounted(async () => {
  window.addEventListener('click', onWindowClick)
  worker = new Worker(new URL('./pyodide-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      pythonReady.value = true
    } else if (data.type === 'result' || data.type === 'error') {
      output.value = data.output || '(no output)'
      running.value = false
    }
  }
  try {
    examples.value = await loadExamples()
    const defaultExample = examples.value[0]
    if (defaultExample) await loadExample(defaultExample, true)
  } catch (error) {
    fail(error)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  files.value.forEach(revoke)
  worker?.terminate()
})
</script>

<template>
  <div class="app">
    <header class="top">
      <a class="brand" href="https://cxzzzz.github.io/wavekit/" target="_blank" rel="noreferrer">
        <img :src="logoSrc" alt="" />
        <span class="brand-mark">wavekit<span class="version-badge">v{{ WAVEKIT_VERSION }}</span></span>
      </a>
      <span class="top-divider" />
      <span class="top-section">Playground</span>
      <div class="source-actions">
        <div class="seg">
          <button class="example-selector" type="button" :class="{ active: mode === 'example' }" :aria-expanded="menuOpen" @click.stop="switchMode('example')">
            <span class="source-label">Example</span>
            <span class="source-value">{{ currentExample?.title ?? '—' }}</span>
            <span class="chevron" aria-hidden="true" />
          </button>
          <button class="source-button" type="button" :class="{ active: mode === 'files' }" @click.stop="switchMode('files')">Your files</button>
        </div>
        <div v-if="menuOpen" class="menu" @click.stop>
          <button
            v-for="item in examples"
            :key="item.id"
            type="button"
            :aria-current="item.id === exampleId"
            @click="loadExample(item, true).catch(fail)"
          >
            {{ item.title }}
          </button>
        </div>
      </div>
      <div class="spacer" />
      <nav class="nav">
        <a href="https://cxzzzz.github.io/wavekit/" target="_blank" rel="noreferrer">Docs</a>
        <a href="https://github.com/cxzzzz/wavekit" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </header>

    <div class="body">
      <aside class="sidebar" :class="{ open: filesOpen }" :style="{ width: filesOpen ? `${sidebarWidth}px` : '0px' }">
        <div class="sidebar-inner">
          <div class="sidebar-heading">
            <h2>Files</h2>
          </div>
          <label v-if="mode === 'files'" class="upload-btn">
            <span>+</span> Add file
            <input hidden type="file" multiple @change="onUpload" />
          </label>
          <div class="file-list">
            <div
              v-for="file in visibleFiles"
              :key="file.id"
              class="file"
              :class="{ selected: file.id === selectedId }"
            >
              <div class="file-main">
                <strong>{{ file.name }}</strong>
                <div class="file-actions">
                  <button v-if="file.format" type="button" :aria-label="`View ${file.name}`" :title="`View ${file.name}`" @click.stop="selectFile(file)">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" /><circle cx="8" cy="8" r="1.6" /></svg>
                  </button>
                  <button type="button" :aria-label="`Download ${file.name}`" :title="`Download ${file.name}`" @click.stop="download(file)">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" /></svg>
                  </button>
                  <button class="danger" type="button" :aria-label="`Delete ${file.name}`" :title="`Delete ${file.name}`" @click.stop="removeFile(file)">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h10m-7 0V3h4v2m-6 0 .6 8h6.8l.6-8" /></svg>
                  </button>
                </div>
              </div>
              <div class="path">{{ formatSize(file.bytes) }}</div>
            </div>
            <p v-if="!visibleFiles.length" class="hint">No files yet.</p>
          </div>
        </div>
      </aside>
      <div class="sidebar-split-wrap">
        <div class="sidebar-split" role="separator" aria-orientation="vertical" @pointerdown="startSidebarResize" />
        <button class="sidebar-toggle" type="button" :aria-expanded="filesOpen" :aria-label="filesOpen ? 'Collapse files panel' : 'Expand files panel'" @click="filesOpen = !filesOpen"><span class="chevron side" :class="{ reverse: !filesOpen }" /></button>
      </div>

      <main ref="workspaceRef" class="workspace">
        <button class="pane-bar" type="button" :aria-expanded="!surferCollapsed" @click="toggleSurfer">
          <span><span class="pane-dot teal" />Waveform</span>
          <span v-if="selected" class="pane-meta">{{ selected.name }}</span>
          <span class="chevron vertical" :class="{ collapsed: surferCollapsed }" aria-hidden="true" />
        </button>
        <div class="surfer-wrap" :style="surferStyle" :class="{ hidden: surferCollapsed }">
          <iframe
            ref="surferRef"
            class="surfer"
            title="Surfer"
            :src="SURFER_SRC"
            @load="onSurferLoad"
          />
          <div v-if="surferEmpty" class="surfer-empty">
            <p>No waveform selected.</p>
          </div>
        </div>
        <div v-show="!surferCollapsed && !pythonCollapsed" class="split" role="separator" aria-orientation="horizontal" @pointerdown="startSplit" />
        <button class="analysis-bar" type="button" :aria-expanded="!pythonCollapsed" @click="togglePython">
          <span><span class="pane-dot violet" />Analysis</span>
          <span class="chevron vertical" :class="{ collapsed: pythonCollapsed }" aria-hidden="true" />
        </button>
        <section class="python-pane" :class="{ hidden: pythonCollapsed }">
          <div class="code-panel" :style="{ flex: `0 0 ${codeRatio * 100}%` }">
            <div class="panel-toolbar">
              <span class="panel-label">Code</span>
              <div class="editor-actions">
                <button type="button" class="clear-button" title="Restore the initial code" @click="resetCode">Reset</button>
                <button type="button" class="clear-button" title="Clear the editor" @click="clearCode">Clear</button>
                <button class="run-button" type="button" :disabled="!pythonReady || running" @click="runCode">{{ running ? 'Running…' : 'Run' }}</button>
              </div>
            </div>
            <CodeEditor v-model="code" @run="runCode" />
          </div>
          <div class="code-split" role="separator" aria-orientation="vertical" @pointerdown="startCodeSplit" />
          <div class="result-panel">
            <div class="panel-toolbar"><span class="panel-label">Result</span><button type="button" class="clear-button" @click="clearOutput">Clear</button></div>
            <pre v-if="output" class="result-output">{{ output }}</pre>
            <p v-else class="result-empty">Run Python to see output.</p>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
