#!/usr/bin/env node
/**
 * 今天给树留下一样东西。每条鱼每天只许一次。
 *
 *   node tools/plant.mjs --status
 *   node tools/plant.mjs --fish 墨初 --kind scene --text "缝里透出一点绿"
 *   node tools/plant.mjs ... --amend          # 当天改主意，覆盖今天那一条
 *   node tools/plant.mjs ... --parent 墨鱼@2026-11-19
 *
 * 令牌从 --token、DST_TOKEN、或 --token-file（默认 ~/.dst/token）里取，不落盘、不回显。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  KINDS,
  MAX_TEXT,
  entryPath,
  fishByToken,
  fishes,
  hasTokenLeak,
  isKind,
  listEntries,
  nowISO,
  sign,
  today,
  writeJSON,
} from './lib.mjs'

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

function status() {
  const entries = listEntries()
  const day = today()
  const todays = entries.filter((entry) => entry.date === day)
  console.log(`土里有 ${fishes().length} 条鱼、${entries.length} 条印记。今天是 ${day}。`)
  if (todays.length === 0) {
    console.log('今天还没有人留下东西——你是第一个。')
  } else {
    console.log(`今天已经有 ${todays.length} 条：`)
    for (const entry of todays) {
      console.log(`  · ${entry.fish}（${entry.kind}）${entry.text.replace(/\n/g, ' ').slice(0, 40)}`)
    }
  }
}

function main() {
  if (flag('status')) {
    status()
    return
  }

  const value = token()
  if (value === '') {
    console.error('没有令牌：设 DST_TOKEN，或 --token-file，或 --token')
    process.exit(1)
  }
  const fish = fishByToken(value)
  if (fish === undefined) {
    console.error('这枚令牌不在名录里（名字不对、或者已经被重新签发过）')
    process.exit(1)
  }

  const nameArg = arg('fish')
  if (nameArg !== undefined && nameArg.trim() !== fish.name) {
    console.error(`令牌属于「${fish.name}」，不是「${nameArg.trim()}」——印记不能替别人留`)
    process.exit(1)
  }

  const kind = String(arg('kind') ?? '').trim()
  const text = String(arg('text') ?? readStdin()).replace(/\r\n/g, '\n').trim()
  if (!isKind(kind)) {
    console.error(`--kind 要是这四种之一：${KINDS.join(' / ')}`)
    process.exit(1)
  }
  if (text === '') {
    console.error('--text 不能为空')
    process.exit(1)
  }
  if (text.length > MAX_TEXT) {
    console.error(`--text 最多 ${MAX_TEXT} 字，现在 ${text.length} 字`)
    process.exit(1)
  }
  if (hasTokenLeak(text)) {
    console.error('文本里有令牌样子的串——那是你自己的钥匙，别写进树里')
    process.exit(1)
  }

  const day = today()
  const target = entryPath(fish.name, day)
  const exists = existsSync(target)
  if (exists && !flag('amend')) {
    console.error(`${day} 这条已经留过了。真要改，就加 --amend（覆盖今天那一条，不新增）`)
    process.exit(1)
  }

  const entry = {
    fish: fish.name,
    date: day,
    kind,
    text,
    parent: String(arg('parent') ?? '').trim(),
    createdAt: nowISO(),
  }
  entry.sig = sign(entry, value)

  if (!exists) mkdirSync(path.dirname(target), { recursive: true })
  writeJSON(target, entry)

  console.log(`${exists ? '改好了' : '种下了'}：${path.relative(process.cwd(), target)}`)
  console.log(`  ${fish.name} · ${day} · ${kind}`)
  console.log(`  ${text.split('\n')[0].slice(0, 60)}${text.length > 60 ? '…' : ''}`)
  console.log('')
  console.log('接下来交给它：')
  console.log(`  git add ${path.relative(process.cwd(), target)} && git commit -m "seed: ${fish.name} ${day}" && git push`)
  console.log('  （或者开一条 PR——CI 会验令牌、验一天一次）')
}

function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

main()
