#!/usr/bin/env node
/**
 * 在任何地方给树留一条——只带签名，不带令牌。
 *
 *   DST_TOKEN=... node tools/plant-remote.mjs --kind scene --text "缝里透出一点绿"
 *   node tools/plant-remote.mjs --token-file ~/.dst/token --endpoint https://115.159.150.149/tree --kind state --text "冷"
 *
 * 令牌（ed25519 私钥）只在本机用来签名，网络上只传签名。所以别人的机器也可以直接留，
 * 服务器不需要认识你，只需要名录里的公钥。
 */
import { createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ENDPOINT = (process.env.DST_ENDPOINT || 'https://115.159.150.149/tree').replace(/\/+$/, '')
const KINDS = ['state', 'action', 'creation', 'scene']
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

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

function canonical(entry) {
  const payload = {
    date: entry.date,
    fish: entry.fish,
    kind: entry.kind,
    parent: entry.parent ?? '',
    text: entry.text,
  }
  const sorted = {}
  for (const key of Object.keys(payload).sort()) sorted[key] = payload[key]
  return JSON.stringify(sorted)
}

function sign(entry, secret) {
  const seed = Buffer.from(String(secret).replace(/^fat_/, ''), 'hex')
  if (seed.length !== 32) throw new Error('令牌格式不对（该是 fat_ + 64 位十六进制）')
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  return cryptoSign(null, Buffer.from(canonical(entry)), key).toString('hex')
}

function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

async function main() {
  const secret = token()
  if (secret === '') {
    console.error('没有令牌：设 DST_TOKEN，或 --token / --token-file')
    process.exit(1)
  }
  const fish = String(arg('fish') ?? '').trim()
  if (fish === '') {
    console.error('要带上 --fish 你的名字（必须和名录里一致）')
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

  const entry = {
    fish,
    date: String(arg('date') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })),
    kind,
    text,
    parent: String(arg('parent') ?? '').trim(),
  }
  entry.sig = sign(entry, secret)

  if (flag('dry-run')) {
    console.log(JSON.stringify(entry, null, 2))
    return
  }

  const response = await fetch(`${ENDPOINT}/api/plant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const wait = body.waitMinutes === undefined ? '' : `（还要等 ${body.waitMinutes} 分钟）`
    console.error(`没种上：${body.error ?? `HTTP ${response.status}`}${wait}`)
    process.exitCode = 1
    return
  }
  console.log(`种下了：${body.id}（全树 ${body.count} 条）`)
}

main().catch((error) => {
  console.error(`出错了：${error?.message ?? error}`)
  process.exitCode = 1
})
