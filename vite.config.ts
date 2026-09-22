import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

const WAVEKIT_REPO = 'cxzzzz/wavekit'
const SURFER_TAG = 'v0.7.0'
const TRUNK_VERSION = 'v0.21.14'
const FORCE_VENDOR = process.env.FORCE_VENDOR === '1'

function toTitleCase(id: string): string {
  return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

async function fetchLatestWavekitTag(): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${WAVEKIT_REPO}/tags`)
  if (!response.ok) throw new Error(`Failed to list wavekit tags: ${response.status}`)
  const tags = await response.json() as { name: string }[]
  const latest = tags[0]?.name
  if (!latest) throw new Error('wavekit has no tags')
  return latest
}

async function downloadAndExtract(url: string, destDir: string, stripComponents: number) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  mkdirSync(destDir, { recursive: true })
  const archivePath = join(destDir, 'archive.tar.gz')
  writeFileSync(archivePath, buffer)
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir, `--strip-components=${stripComponents}`])
  rmSync(archivePath)
}

function buildExamples(exampleRoot: string, destRoot: string) {
  const entries = readdirSync(exampleRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
  const examples = entries.map(entry => {
    const id = entry.name
    const dir = join(exampleRoot, id)
    execFileSync('make', ['sim'], { cwd: dir, stdio: 'inherit' })
    const files = readdirSync(dir)
    const scripts = files.filter(name => name.endsWith('.py'))
    const waveforms = files.filter(name => name.endsWith('.vcd') || name.endsWith('.fst'))
    if (scripts.length !== 1) {
      throw new Error(`Example "${id}" must have exactly one .py script, found ${scripts.length}`)
    }
    if (waveforms.length === 0) {
      throw new Error(`Example "${id}" must have at least one .vcd/.fst waveform`)
    }
    const dest = join(destRoot, id)
    mkdirSync(dest, { recursive: true })
    for (const file of [...scripts, ...waveforms]) {
      cpSync(join(dir, file), join(dest, file))
    }
    return { id, title: toTitleCase(id), waveform: waveforms, script: scripts[0] }
  })
  writeFileSync(join(destRoot, 'index.json'), JSON.stringify(examples, null, 2))
}

async function vendorWavekitExamples() {
  const ref = process.env.WAVEKIT_REF || await fetchLatestWavekitTag()
  const tmp = mkdtempSync(join(tmpdir(), 'wavekit-examples-'))
  try {
    await downloadAndExtract(`https://github.com/${WAVEKIT_REPO}/archive/${encodeURIComponent(ref)}.tar.gz`, tmp, 1)
    buildExamples(join(tmp, 'example'), join(root, 'public/examples'))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function buildSurfer() {
  const tmp = mkdtempSync(join(tmpdir(), 'surfer-build-'))
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', SURFER_TAG, 'https://gitlab.com/surfer-project/surfer.git', tmp], { stdio: 'inherit' })
    execFileSync('git', ['submodule', 'update', '--init'], { cwd: tmp, stdio: 'inherit' })
    execFileSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { stdio: 'inherit' })

    const trunkDir = mkdtempSync(join(tmpdir(), 'trunk-'))
    execFileSync('bash', ['-c', `curl -sL https://github.com/trunk-rs/trunk/releases/download/${TRUNK_VERSION}/trunk-x86_64-unknown-linux-gnu.tar.gz | tar -xzf- -C "${trunkDir}"`], { stdio: 'inherit' })
    const trunkBin = join(trunkDir, 'trunk')
    execFileSync('chmod', ['+x', trunkBin])

    execFileSync(trunkBin, ['build', '--config=surfer/Trunk.toml', 'index.html', '--release', '--public-url', '/dist', '--features', 'accesskit'], {
      cwd: tmp,
      stdio: 'inherit',
      env: { ...process.env, RUSTFLAGS: '--cfg=web_sys_unstable_apis' },
    })

    const distDir = join(tmp, 'surfer/dist')
    let indexHtml = readFileSync(join(distDir, 'index.html'), 'utf-8')
    indexHtml = indexHtml.replaceAll('/dist/', './')
    writeFileSync(join(distDir, 'index.html'), indexHtml)

    const surferDest = join(root, 'public/surfer')
    mkdirSync(surferDest, { recursive: true })
    cpSync(distDir, surferDest, { recursive: true })
    cpSync(join(root, 'src/vendor/surfer-config.toml'), join(surferDest, 'config.toml'))

    rmSync(trunkDir, { recursive: true, force: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function vendorAssets(): Plugin {
  return {
    name: 'vendor-assets',
    async buildStart() {
      if (!FORCE_VENDOR && existsSync(join(root, 'public/examples/index.json'))) {
        this.warn('public/examples already exists, skipping wavekit examples fetch (set FORCE_VENDOR=1 to refresh)')
      } else {
        await vendorWavekitExamples()
      }
      if (!FORCE_VENDOR && existsSync(join(root, 'public/surfer/surfer_bg.wasm'))) {
        this.warn('public/surfer already exists, skipping Surfer build (set FORCE_VENDOR=1 to refresh)')
      } else {
        buildSurfer()
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), vendorAssets()],
  base: './',
  server: {
    headers: {
      'Cache-Control': 'no-store',
    },
  },
})
