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
  MAX_TEXT,
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
  const nameParts = expectName.split('-')
  const fileDate = `${nameParts[0]}-${nameParts[1]}-${nameParts[2]}`
  const fileFish = nameParts.slice(3).join('-')

  if (!isDate(entry.date)) problems.push(`${rel}: date 不合法`)
  if (entry.date !== fileDate) problems.push(`${rel}: date 和文件名不一致（${entry.date} vs ${fileDate}）`)
  if (entry.fish !== fileFish) problems.push(`${rel}: fish 和文件名不一致（${entry.fish} vs ${fileFish}）`)
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

  const key = `${entry.fish}@${entry.date}`
  seen.set(key, (seen.get(key) ?? 0) + 1)
}

walk(ENTRIES)

for (const [key, count] of seen) {
  if (count > 1) problems.push(`${key}: 一天出现了 ${count} 条，规则是一天只有一次`)
}

// parent 必须指向真实存在的条目
const ids = new Set([...seen.keys()])
const parents = []
function collectParents(dir) {
  if (!statSafe(dir)) return
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSafe(full) && statSync(full).isDirectory()) collectParents(full)
    else if (name.endsWith('.json')) {
      try {
        parents.push(JSON.parse(readFileSync(full, 'utf8')))
      } catch {
        // 上面已经报过
      }
    }
  }
}
collectParents(ENTRIES)
for (const entry of parents) {
  if (entry.parent && !ids.has(entry.parent)) {
    problems.push(`${entry.fish}@${entry.date}: parent「${entry.parent}」不存在`)
  }
}

if (problems.length === 0) {
  console.log(`校验通过：${ids.size} 条印记，${fishes().length} 条鱼。`)
  process.exit(0)
}
console.error(`发现 ${problems.length} 个问题：`)
for (const problem of problems) console.error(`  · ${problem}`)
process.exit(1)
