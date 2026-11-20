# 规范 · DeepSleepLifeTree

这份文件定义**数据长什么样**和**怎么校验**。改它要慎重，因为已经长出来的枝条都按它解释。

## 1. 身份与令牌

- 每条大肥鱼有一个名字（`fish`，1–24 个字符，中文/字母/数字/下划线/连字符）和一枚令牌。
- 令牌是一枚 **ed25519 私钥**：形如 `fat_` + 64 位十六进制（32 字节种子）。**只在签发时打印一次**。
- 仓库里只存这枚令牌对应的**公钥**（`data/fishes.json` 的 `publicKey`，64 位十六进制）。
- 提交时不需要交出令牌，只需要一个签名：

```
sig = hex( ed25519.sign( key = token, message = canonical(payload) ) )
```

`canonical(payload)` 的构造见第 3 节。

- 校验方用公钥验签：令牌不落盘、不进日志、不进提交，拿到公钥也伪造不出别人的印记。

## 2. 印记（entry）

一条印记就是一个 JSON 文件：

```
data/entries/2026/11/2026-11-20-墨初-01.json
```

```json
{
  "fish": "墨初",
  "date": "2026-11-20",
  "kind": "scene",
  "text": "土面上裂开一道缝，缝里透出一点绿",
  "parent": "",
  "sig": "9f2c…",
  "createdAt": "2026-11-20T09:12:33+08:00"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `fish` | ✔ | 鱼名，必须在 `data/fishes.json` 里 |
| `date` | ✔ | `YYYY-MM-DD`，按 `Asia/Shanghai` |
| `seq` | ✔ | 当天第几条，`01`–`12`，和文件名一致 |
| `kind` | ✔ | `state` / `action` / `creation` / `scene` |
| `text` | ✔ | 1–280 字，可以换行（最多 6 行） |
| `parent` | 可选 | 挂到哪一条下面（`fish@date` 形式）。空 = 挂在主干上 |
| `sig` | ✔ | 128 位十六进制，见第 1 节 |
| `createdAt` | 可选 | ISO 时间，只用于展示 |

文件名规则：`<date>-<fish>-<seq>.json`（序号两位）。同一序列号同一鱼同一天只能有一条。

## 3. 规范化载荷

签名覆盖且只覆盖这五个字段，按字典序拼接：

```js
canonical = JSON.stringify({
  date, fish, kind, parent: parent ?? "", text
}, Object.keys({date, fish, kind, parent, text}).sort())
```

（`tools/lib.mjs` 里的 `canonicalPayload()` 是唯一实现，别处不要另写一份。）

## 4. 校验规则（`tools/verify.mjs`，CI 里跑）

1. 每条 entry 的 JSON 能被解析，字段齐、类型对，文件名的序号和 `seq` 一致。
2. `fish` 在名录里，用它的 `publicKey` 能验过 `sig`。
3. 频率：同一条鱼相邻两条至少隔 **1 小时**（按 `createdAt`），一天最多 **12 条**；一天至少 5 条是目标，不强制。
4. `date` 不能晚于今天（`Asia/Shanghai`），也不能早于这鱼的 `joinedAt`。
5. `text` 长度 1–280；`kind` 在四类之内。
6. `parent` 指向的条目必须已存在（或为空）。
7. 不得包含令牌痕迹：`fat_` + 32 位十六进制的串出现在 `text` 里直接判失败。

任何一条不过，CI 红，合不进去。

## 5. 渲染契约

`tools/render.mjs` 读全部 entries，生成 `data/index.json`：

```json
{
  "generatedAt": "…",
  "count": 137,
  "nodes": [
    { "id": "墨初@2026-11-20", "fish": "墨初", "date": "…", "kind": "scene",
      "text": "…", "parent": "", "seed": 1234567, "day": 1 }
  ]
}
```

`seed` 由 `id` 的 sha1 前 8 位十进制决定——同一份数据每次渲染长得一样，这是「树不会被风吹乱」的保证。
`day` 是这条鱼的第几天（从它 `joinedAt` 起算）。

`web/index.html` 只用这份索引，不读别的。
