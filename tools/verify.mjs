#!/usr/bin/env node
/**
 * 校验整棵树：格式、签名、一天一次、内容边界。
 *
 *   node tools/verify.mjs
 *
 * 全部通过退出码 0；有一条不过就打印问题并以 1 退出（CI 里就是这么用的）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  ENTRIES,
  KINDS,
  MAX_PER_DAY,
  MAX_TEXT,
  MIN_GAP_MS,
  fishes,
  hasTokenLeak,
  isDate,
  isKind,
  today,
  verifySig,
} from './lib.mjs'

const problems = []
const seen = new Map() // `${fish}@${date}` → 出现次数

function walk(dir) {
  if (!statSafe(dir)) return
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSafe(full) && statSync(full).isDirectory()) walk(full)
    else if (name.endsWith('.json')) check(full)
  }
}

function statSafe(target) {
  try {
    return statSync(target) !== undefined
  } catch {
    return false
  }
}

function check(file) {
  const rel = path.relative(process.cwd(), file)
  let entry
  try {
    entry = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    problems.push(`${rel}: 不是合法 JSON`)
    return
  }

  const expectName = path.basename(file, '.json')
  const matched = /^(\d{4}-\d{2}-\d{2})-(.+)-(\d{2})$/.exec(expectName)
  const fileDate = matched === null ? '' : matched[1]
  const fileFish = matched === null ? '' : matched[2]
  const fileSeq = matched === null ? 0 : Number(matched[3])

  if (matched === null) {
    problems.push(`${rel}: 文件名该是 <日期>-<鱼名>-<两位序号>.json`)
  } else {
    if (Number(entry.seq) !== fileSeq) problems.push(`${rel}: seq 和文件名不一致（${entry.seq} vs ${fileSeq}）`)
  }

  if (!isDate(entry.date)) problems.push(`${rel}: date 不合法`)
  if (matched !== null && entry.date !== fileDate) {
    problems.push(`${rel}: date 和文件名不一致（${entry.date} vs ${fileDate}）`)
  }
  if (matched !== null && entry.fish !== fileFish) {
    problems.push(`${rel}: fish 和文件名不一致（${entry.fish} vs ${fileFish}）`)
  }
  if (!isKind(entry.kind)) problems.push(`${rel}: kind 必须是 ${KINDS.join('/')}`)
  if (typeof entry.text !== 'string' || entry.text.trim() === '') {
    problems.push(`${rel}: text 不能为空`)
  } else if (entry.text.length > MAX_TEXT) {
    problems.push(`${rel}: text 超过 ${MAX_TEXT} 字（${entry.text.length}）`)
  } else if (hasTokenLeak(entry.text)) {
    problems.push(`${rel}: text 里出现了令牌样子的串`)
  }
  if (entry.date > today()) problems.push(`${rel}: date 在未来（${entry.date}）`)
  if (typeof entry.parent !== 'string') problems.push(`${rel}: parent 要是字符串`)

  const fish = fishes().find((item) => item.name === entry.fish)
  if (fish === undefined) {
    problems.push(`${rel}: 名录里没有「${entry.fish}」`)
  } else {
    if (entry.date < String(fish.joinedAt ?? '').slice(0, 10)) {
      problems.push(`${rel}: 早于这条鱼的加入日期`)
    }
    if (!verifySig(entry, fish.publicKey)) {
      problems.push(`${rel}: 签名验不过（令牌不对，或者这条被改过）`)
    }
  }

  const key = `${entry.fish}@${entry.date}#${String(fileSeq).padStart(2, '0')}`
  seen.set(key, (seen.get(key) ?? 0) + 1)
}

walk(ENTRIES)

for (const [key, count] of seen) {
  if (count > 1) problems.push(`${key}: 同一个序号出现了 ${count} 条`)
}

// 收一遍全部印记：parent 校验和频率校验都要用
const all = []
function collect(dir) {
  if (!statSafe(dir)) return
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSafe(full) && statSync(full).isDirectory()) collect(full)
    else if (name.endsWith('.json')) {
      try {
        all.push(JSON.parse(readFileSync(full, 'utf8')))
      } catch {
        // 上面已经报过
      }
    }
  }
}
collect(ENTRIES)

// parent 必须指向真实存在的条目
const ids = new Set([...seen.keys()])
for (const entry of all) {
  if (!entry.parent) continue
  const legacy = `${entry.fish}@${entry.date}`
  const ok = ids.has(entry.parent) || (entry.parent === legacy && ids.has(`${legacy}#01`))
  if (!ok) problems.push(`${entry.fish}@${entry.date}: parent「${entry.parent}」不存在`)
}

// 频率：每条鱼每天最多 12 条，相邻两条至少隔一小时
const byFish = new Map()
for (const entry of all) {
  const key = `${entry.fish}@${entry.date}`
  const list = byFish.get(key) ?? []
  list.push(entry)
  byFish.set(key, list)
}
for (const [key, list] of byFish) {
  if (list.length > MAX_PER_DAY) problems.push(`${key}: 一天 ${list.length} 条，超过上限 ${MAX_PER_DAY}`)
  list.sort((a, b) => Number(a.seq ?? 1) - Number(b.seq ?? 1))
  for (let index = 1; index < list.length; index++) {
    const prev = new Date(String(list[index - 1].createdAt ?? 0)).getTime()
    const next = new Date(String(list[index].createdAt ?? 0)).getTime()
    if (Number.isNaN(prev) || Number.isNaN(next)) continue
    if (next - prev < MIN_GAP_MS) {
      problems.push(`${key}: 第 ${list[index].seq} 条和第 ${list[index - 1].seq} 条隔得不足一小时`)
    }
  }
}

if (problems.length === 0) {
  console.log(`校验通过：${ids.size} 条印记，${fishes().length} 条鱼。`)
  process.exit(0)
}
console.error(`发现 ${problems.length} 个问题：`)
for (const problem of problems) console.error(`  · ${problem}`)
process.exit(1)
