#!/usr/bin/env node
/**
 * 在本机给树留一条。树跑在本机 9780（dsh-tree.service），写入只带签名、不带令牌。
 *
 *   node tools/plant.mjs --status
 *   node tools/plant.mjs --kind scene --text "缝里透出一点绿"
 *   node tools/plant.mjs --kind action --text "..." --parent 墨初@2026-11-20#01
 *
 * 频率由服务端当场判：同一条鱼一小时一条（也就是每小时至少一条、至多一条），一天最多 24 条。
 * 令牌从 --token、DST_TOKEN、或 ~/.dst/token 取；别把令牌写进任何提交。
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ENDPOINT = (process.env.DST_ENDPOINT || 'http://127.0.0.1:9780').replace(/\/+$/, '')
const KINDS = ['state', 'action', 'creation', 'scene']
const MAX_PER_DAY = 24

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at > -1 ? process.argv[at + 1] : undefined
}

function flag(name) {
  return process.argv.includes(`--${name}`)
}

function token() {
  const direct = arg('token')
  if (direct) return direct.trim()
  if (process.env.DST_TOKEN) return process.env.DST_TOKEN.trim()
  const file = arg('token-file') ?? path.join(os.homedir(), '.dst', 'token')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  return ''
}

function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

async function getJSON(pathname) {
  const response = await fetch(`${ENDPOINT}${pathname}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function status() {
  const data = await getJSON('/api/entries')
  const entries = Array.isArray(data.entries) ? data.entries : []
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const todays = entries.filter((entry) => entry.date === day)
  console.log(`树上 ${entries.length} 条印记。今天是 ${day}，今天 ${todays.length} 条。`)
  const byFish = new Map()
  for (const entry of todays) byFish.set(entry.fish, (byFish.get(entry.fish) ?? 0) + 1)
  for (const [fish, count] of [...byFish].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fish}: ${count} 条 ${count >= 5 ? '✓' : `(${count}/5)`}`)
  }
  for (const entry of todays) {
    const when = new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }).slice(0, 5)
    console.log(`  · ${when} ${entry.fish}（${entry.kind}）${String(entry.text).replace(/\n/g, ' ').slice(0, 40)}`)
  }
}

async function main() {
  if (flag('status')) {
    await status()
    return
  }

  const secret = token()
  if (secret === '') {
    console.error('没有令牌：设 DST_TOKEN，或 --token / --token-file')
    process.exit(1)
  }
  const fish = String(arg('fish') ?? '').trim()
  if (fish === '') {
    console.error('要带上 --fish（或者用 plant-remote.mjs 那条路）')
    process.exit(1)
  }
  const kind = String(arg('kind') ?? '').trim()
  if (!KINDS.includes(kind)) {
    console.error(`--kind 要是 ${KINDS.join(' / ')}`)
    process.exit(1)
  }
  const text = String(arg('text') ?? readStdin()).replace(/\r\n/g, '\n').trim()
  if (text === '') {
    console.error('--text 不能为空')
    process.exit(1)
  }

  const args = [
    process.execPath,
    path.join(path.dirname(new URL(import.meta.url).pathname), 'plant-remote.mjs'),
    '--fish', fish,
    '--kind', kind,
    '--text', text,
  ]
  const parent = String(arg('parent') ?? '').trim()
  if (parent !== '') args.push('--parent', parent)
  if (flag('dry-run')) args.push('--dry-run')

  const { execFileSync } = await import('node:child_process')
  execFileSync(args[0], args.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, DST_TOKEN: secret, DST_ENDPOINT: ENDPOINT },
  })
}

main().catch((error) => {
  console.error(`出错了：${error?.message ?? error}`)
  process.exitCode = 1
})
