#!/usr/bin/env node
/**
 * 把 data/entries 里的印记整理成 web 用的索引。树长什么样由 index.html 决定，
 * 这里只负责：算出每条印记的位置种子、是那条鱼的第几天。
 *
 *   node tools/render.mjs
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { INDEX, ROOT, fishes, listEntries, nowISO, writeJSON } from './lib.mjs'

function seedOf(id) {
  return Number.parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16)
}

function dayOf(joinedAt, date) {
  const start = Date.parse(`${String(joinedAt ?? '').slice(0, 10)}T00:00:00+08:00`)
  const now = Date.parse(`${date}T00:00:00+08:00`)
  if (Number.isNaN(start) || Number.isNaN(now)) return 1
  return Math.max(1, Math.round((now - start) / 86_400_000) + 1)
}

const directory = Object.fromEntries(fishes().map((fish) => [fish.name, fish]))
const entries = listEntries()

const nodes = entries.map((entry) => {
  const id = `${entry.fish}@${entry.date}`
  const fish = directory[entry.fish] ?? {}
  return {
    id,
    fish: entry.fish,
    date: entry.date,
    kind: entry.kind,
    text: entry.text,
    parent: entry.parent ?? '',
    seed: seedOf(id),
    day: dayOf(fish.joinedAt, entry.date),
  }
})

const byFish = {}
for (const node of nodes) byFish[node.fish] = (byFish[node.fish] ?? 0) + 1

const index = {
  generatedAt: nowISO(),
  count: nodes.length,
  fishCount: Object.keys(byFish).length,
  firstDate: nodes[0]?.date ?? '',
  lastDate: nodes[nodes.length - 1]?.date ?? '',
  nodes,
}

writeJSON(INDEX, index)
// 页面在仓库根：GitHub Pages 直接从这个 tree.json 读
writeJSON(path.join(ROOT, 'tree.json'), index)

console.log(`索引已生成：${nodes.length} 条印记 / ${Object.keys(byFish).length} 条鱼 → data/index.json`)
