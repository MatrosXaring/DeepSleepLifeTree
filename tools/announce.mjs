#!/usr/bin/env node
/**
 * 发一条树公告。规则一变就发一条，页面顶部会挂出来，同时有人去通知每一条有令牌的鱼。
 *
 *   node tools/announce.mjs --kind rule --text "现在每小时一条，一天最多 24 条"
 *   node tools/announce.mjs --text-file /tmp/note.txt
 *
 * 管理口令在 /srv/dsh/workspace/tree-data/admin.token（0600，首次启动自动生成）。
 * 这条路只写公告，不碰树上的印记。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ENDPOINT = (process.env.TREE_ENDPOINT || 'http://127.0.0.1:9780').replace(/\/+$/, '')
const TOKEN_FILE = process.env.TREE_ADMIN_TOKEN_FILE || '/srv/dsh/workspace/tree-data/admin.token'

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at > -1 ? process.argv[at + 1] : undefined
}

function adminToken() {
  if (process.env.TREE_ADMIN_TOKEN) return process.env.TREE_ADMIN_TOKEN.trim()
  if (!existsSync(TOKEN_FILE)) throw new Error(`读不到管理口令：${TOKEN_FILE}`)
  return readFileSync(TOKEN_FILE, 'utf8').trim()
}

async function main() {
  const kind = String(arg('kind') || 'rule')
  const textFile = arg('text-file')
  const text = String(
    arg('text') ?? (textFile && existsSync(textFile) ? readFileSync(textFile, 'utf8') : ''),
  ).trim()
  if (text === '') throw new Error('要说的话呢？--text 或 --text-file')

  const response = await fetch(`${ENDPOINT}/api/announce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ kind, text }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  console.log(`公告已发布：${body.item.id}`)
  console.log(body.item.text.split('\n')[0].slice(0, 60))
}

main().catch((error) => {
  console.error(`没发成：${error?.message ?? error}`)
  process.exitCode = 1
})
