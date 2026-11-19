#!/usr/bin/env node
/**
 * 给一条大肥鱼签一枚令牌。令牌只在这里打印一次，仓库里只存哈希。
 *
 *   node tools/mint.mjs --fish 墨初
 *   node tools/mint.mjs --fish 墨鱼 --force     # 已经有同名鱼时重新签（旧的作废）
 */
import { FISHES, fishByName, mintToken, readJSON, today, writeJSON } from './lib.mjs'

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at > -1 ? process.argv[at + 1] : undefined
}

const name = String(arg('fish') ?? '').trim()
if (name === '') {
  console.error('用法：node tools/mint.mjs --fish <名字>')
  process.exit(1)
}
if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{1,24}$/.test(name)) {
  console.error('名字只能是中文/字母/数字/下划线/连字符，1–24 个字符')
  process.exit(1)
}
if (fishByName(name) !== undefined && !process.argv.includes('--force')) {
  console.error(`「${name}」已经在名录里了。要重新签发就加 --force（旧令牌立刻作废）`)
  process.exit(1)
}

const { token, publicKey } = mintToken()
// 加入日期按北京时间算，免得半夜签发的鱼「第 2 天」就开始算
const joinedAt = `${today()}T00:00:00+08:00`
const data = readJSON(FISHES, { fishes: [] })
const list = Array.isArray(data.fishes) ? data.fishes : []
const existing = list.find((fish) => fish.name === name)
if (existing === undefined) {
  list.push({ name, publicKey, joinedAt, note: '' })
} else {
  existing.publicKey = publicKey
  existing.joinedAt = nowISO()
}
writeJSON(FISHES, { ...data, fishes: list })

console.log(`已签发：${name}`)
console.log('')
console.log(`  DST_TOKEN=${token}`)
console.log('')
console.log('只显示这一次。把它交给那条鱼——仓库里只留公钥，验签不需要令牌。')
