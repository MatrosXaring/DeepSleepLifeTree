#!/usr/bin/env node
/**
 * 每天把服务器上的树镜像进 GitHub：真源在 /srv/dsh/workspace/tree-data/entries.jsonl，
 * 这里把它摊回 data/entries/<年>/<月>/<日期>-<鱼>-<序号>.json，再生成索引、推上去。
 *
 *   node tools/mirror.mjs            # 摊平 + 渲染 + 推送
 *   node tools/mirror.mjs --local    # 只摊平和渲染，不推
 *
 * 只增不减：GitHub 上的历史条目不会被删掉，除非服务器上那条本来就没有。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORE = process.env.DST_DATA
  ? path.join(process.env.DST_DATA, 'entries.jsonl')
  : '/srv/dsh/workspace/tree-data/entries.jsonl'
const ENTRIES = path.join(ROOT, 'data', 'entries')
const local = process.argv.includes('--local')

function pad(seq) {
  return String(seq).padStart(2, '0')
}

function readStore() {
  if (!existsSync(STORE)) return []
  const out = []
  for (const line of readFileSync(STORE, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // 坏行跳过
    }
  }
  return out.sort((a, b) => (a.date === b.date ? Number(a.seq) - Number(b.seq) : a.date.localeCompare(b.date)))
}

/** 镜像目录里多出来的（服务器上已经没有的）才删；有的一律覆盖成服务器版本。 */
function flatten(entries) {
  const wanted = new Set()
  for (const entry of entries) {
    const [year, month] = entry.date.split('-')
    const dir = path.join(ENTRIES, year, month)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${entry.date}-${entry.fish}-${pad(entry.seq)}.json`)
    wanted.add(file)
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
  }
  let removed = 0
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!name.endsWith('.json')) continue
      if (!wanted.has(full)) {
        rmSync(full, { force: true })
        removed += 1
      }
    }
  }
  walk(ENTRIES)
  return { written: wanted.size, removed }
}

function main() {
  const entries = readStore()
  const result = flatten(entries)
  console.log(`镜像：${entries.length} 条（写 ${result.written}，删 ${result.removed}）← ${STORE}`)

  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'render.mjs')], { stdio: 'inherit', cwd: ROOT })

  if (local) return
  execFileSync(
    process.execPath,
    ['/srv/dsh/workspace/dsh-app/scripts/push-tree-api.mjs'],
    {
      stdio: 'inherit',
      cwd: ROOT,
      env: {
        ...process.env,
        TREE_DIR: ROOT,
        TREE_MESSAGE: `mirror: ${entries.length} 条印记（服务器 → GitHub）`,
      },
    },
  )
}

main()
