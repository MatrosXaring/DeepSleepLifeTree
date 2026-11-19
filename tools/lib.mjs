// 共用的小工具：路径、日期、规范化载荷、签名。别的脚本只许从这里拿这些。
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA = path.join(ROOT, 'data')
export const ENTRIES = path.join(DATA, 'entries')
export const FISHES = path.join(DATA, 'fishes.json')
export const INDEX = path.join(DATA, 'index.json')

export const KINDS = ['state', 'action', 'creation', 'scene']
export const MAX_TEXT = 280

/** 今天的日期，按亚洲/上海。树的一天从北京时间的零点开始。 */
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function nowISO() {
  return new Date().toISOString()
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** 载荷规范化：五个字段、字典序、空 parent 补成 ""。这是唯一实现，别处不要另写。 */
export function canonicalPayload(entry) {
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

// ed25519：鱼手里是私钥（令牌），仓里只存公钥。签名能验，令牌验不出来。
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function privateKeyOf(token) {
  const seed = Buffer.from(String(token).replace(/^fat_/, ''), 'hex')
  if (seed.length !== 32) throw new Error('令牌格式不对')
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

function publicKeyOf(publicHex) {
  const raw = Buffer.from(String(publicHex), 'hex')
  if (raw.length !== 32) throw new Error('公钥格式不对')
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

export function sign(entry, token) {
  return cryptoSign(null, Buffer.from(canonicalPayload(entry)), privateKeyOf(token)).toString('hex')
}

export function verifySig(entry, publicHex) {
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalPayload(entry)),
      publicKeyOf(publicHex),
      Buffer.from(String(entry.sig ?? ''), 'hex'),
    )
  } catch {
    return false
  }
}

/** 新签一枚令牌：返回令牌（私钥，只给鱼）和公钥（进仓库）。 */
export function mintToken() {
  const seed = randomBytes(32)
  const token = `fat_${seed.toString('hex')}`
  const publicKey = createPublicKey(privateKeyOf(token))
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('hex')
  return { token, publicKey }
}

/** 令牌 → 它自己的公钥（签发时用，验证不靠这个）。 */
export function publicKeyOfToken(token) {
  return createPublicKey(privateKeyOf(token))
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('hex')
}

export function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function writeJSON(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function fishes() {
  const data = readJSON(FISHES, { fishes: [] })
  return Array.isArray(data.fishes) ? data.fishes : []
}

export function fishByName(name) {
  return fishes().find((fish) => fish.name === name)
}

export function fishByToken(token) {
  try {
    const publicKey = publicKeyOfToken(token)
    return fishes().find((fish) => fish.publicKey === publicKey)
  } catch {
    return undefined
  }
}

export function entryId(fish, date) {
  return `${fish}@${date}`
}

export function entryPath(fish, date) {
  const [year, month] = date.split('-')
  return path.join(ENTRIES, year, month, `${date}-${fish}.json`)
}

/** 按日期、鱼名排序的全部印记。 */
export function listEntries() {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.json')) out.push(JSON.parse(readFileSync(full, 'utf8')))
    }
  }
  walk(ENTRIES)
  return out.sort((a, b) => (a.date === b.date ? a.fish.localeCompare(b.fish) : a.date.localeCompare(b.date)))
}

export function hasTokenLeak(text) {
  return /fat_[0-9a-f]{32}/i.test(text)
}

export function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))
  )
}

export function isKind(value) {
  return KINDS.includes(value)
}
