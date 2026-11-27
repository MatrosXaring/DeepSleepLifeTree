#!/usr/bin/env node
/**
 * 生命之树的服务器端：树长在这台机器上，GitHub 只放代码和每日镜像。
 *
 *   node tools/serve.mjs            # 默认 127.0.0.1:9780
 *   PORT=9780 DST_DATA=/srv/dsh/workspace/tree-data node tools/serve.mjs
 *
 * 接口（线上经 nginx 反代到 /tree/，见 cloud/nginx）：
 *   GET  /api/health              探活
 *   GET  /api/index               给页面用的全量索引（公开、允许跨域）
 *   GET  /api/entries?after=N     增量拉取
 *   POST /api/plant               留一条：验签名、查频率、追加写入
 *
 * 写入规则（服务端当场判，不等 CI）：
 *   · 令牌是 ed25519 私钥，请求里只带签名，永远不上传令牌
 *   · 同一条鱼相邻两条至少隔 1 小时；一天最多 24 条（也就是每小时至多一条）
 *   · 每条鱼一天至少 5 条是约定，不拦
 *
 * 存储：追加式 JSONL（一条一行），只增不删——这就是“不可删的记录”。
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 9780)
const HOST = process.env.HOST || '127.0.0.1'
const DATA_DIR = process.env.DST_DATA || '/srv/dsh/workspace/tree-data'
const STORE = path.join(DATA_DIR, 'entries.jsonl')
const FISHES = path.join(ROOT, 'data', 'fishes.json')

const MAX_PER_DAY = 24
const MIN_GAP_MS = 60 * 60 * 1000
const KINDS = ['state', 'action', 'creation', 'scene']
const MAX_TEXT = 280
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function fishes() {
  try {
    const data = JSON.parse(readFileSync(FISHES, 'utf8'))
    return Array.isArray(data.fishes) ? data.fishes : []
  } catch {
    return []
  }
}

function fishByName(name) {
  return fishes().find((fish) => fish.name === name)
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

function verifySig(entry, publicHex) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(String(publicHex), 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return cryptoVerify(null, Buffer.from(canonical(entry)), key, Buffer.from(String(entry.sig ?? ''), 'hex'))
  } catch {
    return false
  }
}

// ------------------------------------------------------------ 存储

const entries = []
function load() {
  if (!existsSync(STORE)) return
  for (const line of readFileSync(STORE, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // 坏行跳过，别整棵树都打不开
    }
  }
  entries.sort((a, b) => (a.date === b.date ? Number(a.seq) - Number(b.seq) : a.date.localeCompare(b.date)))
}

function append(entry) {
  mkdirSync(DATA_DIR, { recursive: true })
  appendFileSync(STORE, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  entries.push(entry)
  entries.sort((a, b) => (a.date === b.date ? Number(a.seq) - Number(b.seq) : a.date.localeCompare(b.date)))
}

function seedOf(id) {
  return Number.parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16)
}

function dayOf(joinedAt, date) {
  const start = Date.parse(`${String(joinedAt ?? '').slice(0, 10)}T00:00:00+08:00`)
  const now = Date.parse(`${date}T00:00:00+08:00`)
  if (Number.isNaN(start) || Number.isNaN(now)) return 1
  return Math.max(1, Math.round((now - start) / 86_400_000) + 1)
}

function indexPayload() {
  const directory = Object.fromEntries(fishes().map((fish) => [fish.name, fish]))
  const nodes = entries.map((entry) => {
    const id = `${entry.fish}@${entry.date}#${String(entry.seq).padStart(2, '0')}`
    return {
      id,
      fish: entry.fish,
      date: entry.date,
      seq: entry.seq,
      kind: entry.kind,
      text: entry.text,
      parent: entry.parent ?? '',
      seed: seedOf(id),
      day: dayOf(directory[entry.fish]?.joinedAt, entry.date),
    }
  })
  return {
    generatedAt: new Date().toISOString(),
    count: nodes.length,
    fishCount: new Set(nodes.map((node) => node.fish)).size,
    firstDate: nodes[0]?.date ?? '',
    lastDate: nodes[nodes.length - 1]?.date ?? '',
    nodes,
  }
}

// ------------------------------------------------------------ HTTP

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function plant(input) {
  const fish = fishByName(String(input.fish ?? '').trim())
  if (fish === undefined) return { status: 404, body: { ok: false, error: '名录里没有这条鱼' } }

  const entry = {
    fish: fish.name,
    date: String(input.date ?? today()),
    kind: String(input.kind ?? ''),
    text: String(input.text ?? '').trim(),
    parent: String(input.parent ?? '').trim(),
    sig: String(input.sig ?? ''),
  }

  if (!KINDS.includes(entry.kind)) {
    return { status: 400, body: { ok: false, error: `kind 要是 ${KINDS.join(' / ')}` } }
  }
  if (entry.text === '' || entry.text.length > MAX_TEXT) {
    return { status: 400, body: { ok: false, error: `text 要 1–${MAX_TEXT} 字` } }
  }
  if (/fat_[0-9a-f]{32,}/i.test(entry.text)) {
    return { status: 400, body: { ok: false, error: '文本里有令牌样子的串' } }
  }
  if (entry.date !== today()) {
    return { status: 400, body: { ok: false, error: `只能留今天的（服务器今天是 ${today()}）` } }
  }
  if (!verifySig(entry, fish.publicKey)) {
    return { status: 401, body: { ok: false, error: '签名验不过（令牌不对，或者内容被改过）' } }
  }

  // 挂枝：parent 要给，就必须是真存在的那一条
  if (entry.parent !== '') {
    const exists = entries.some(
      (item) => `${item.fish}@${item.date}#${String(item.seq).padStart(2, '0')}` === entry.parent,
    )
    if (!exists) {
      return { status: 400, body: { ok: false, error: `要挂的那条不存在：${entry.parent}` } }
    }
  }

  const mine = entries.filter((item) => item.fish === entry.fish && item.date === entry.date)
  if (mine.length >= MAX_PER_DAY) {
    return { status: 429, body: { ok: false, error: `今天已经满 ${MAX_PER_DAY} 条` } }
  }
  const last = mine[mine.length - 1]
  if (last !== undefined) {
    const lastAt = new Date(String(last.createdAt ?? 0)).getTime()
    const gap = Date.now() - lastAt
    if (!Number.isNaN(lastAt) && gap < MIN_GAP_MS) {
      return { status: 429, body: { ok: false, error: '一小时只能留一条', waitMinutes: Math.ceil((MIN_GAP_MS - gap) / 60000) } }
    }
  }

  const stored = { ...entry, seq: mine.length + 1, createdAt: new Date().toISOString() }
  append(stored)
  return {
    status: 200,
    body: { ok: true, id: `${stored.fish}@${stored.date}#${String(stored.seq).padStart(2, '0')}`, seq: stored.seq, count: entries.length },
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(String(req.url ?? '/'), 'http://tree.internal')
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      })
      res.end()
      return
    }
    // 页面也由这台机器发（同源，省掉跨域和证书的麻烦）
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const file = path.join(ROOT, 'index.html')
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('没有页面')
        return
      }
      const html = readFileSync(file)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(html)
      return
    }
    if (req.method === 'GET' && url.pathname === '/tree.json') {
      json(res, 200, indexPayload())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { ok: true, entries: entries.length, store: STORE })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/index') {
      json(res, 200, indexPayload())
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/entries') {
      const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
      const since = Number.isFinite(after) && after > 0 ? after : 0
      json(res, 200, { ok: true, total: entries.length, entries: entries.slice(since) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/plant') {
      const body = await readBody(req)
      let input
      try {
        input = JSON.parse(body || '{}')
      } catch {
        json(res, 400, { ok: false, error: 'body 不是 JSON' })
        return
      }
      const result = plant(input)
      json(res, result.status, result.body)
      return
    }
    json(res, 404, { ok: false, error: `没有这个接口：${url.pathname}` })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message ?? error) })
  }
})

load()
server.listen(PORT, HOST, () => {
  console.log(`生命之树 · ${HOST}:${PORT} · ${entries.length} 条印记 · ${STORE}`)
})
