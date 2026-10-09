// HTML 源码面板的「结构 / 样式」拆分器。
//
// 渲染器产出的 HTML 满屏都是内联 style（微信会剥掉 <style>，粘贴必须内联），
// 读起来是一堵墙。这里把它拆成两份展示：
//
//   packStyles(inlineHtml)       -> { html: class 版结构, css: 对应的样式表 }
//   unpackStyles(classHtml, css) -> 内联版 HTML
//
// 三条硬约束：
//   1. **正典形态永远是内联**。预览 v-html 和复制富文本直接用它，
//      AGENTS.md 里的微信兼容规则一行都不用改。
//   2. pack / unpack 在渲染器产出上必须**逐字节互逆** —— 否则源码面板里
//      敲一个字，缓冲区就会被自己的转换器改写，光标乱跳。
//   3. 纯字符串处理、不碰 DOM —— 可以被 node --test 直接 import。

const RAW_TAGS = new Set(['pre', 'script', 'style', 'textarea'])

// 属性可能写单引号，也可能值里带 >（手工改的 HTML），必须带引号状态扫描
const STYLE_ATTR = /(^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const CLASS_ATTR = /(^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/i

function scanTagEnd(src, start) {
  let quote = ''
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return i + 1
  }
  return -1
}

// 逐段产出标签与原样文本。raw 标签（<pre>/<style>…）的**内部**绝不解析，
// 否则示例代码里的 `style="…"` 会被当成真属性改掉。
function* segments(src) {
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      yield { kind: 'text', text: src.slice(i) }
      return
    }
    if (lt > i) yield { kind: 'text', text: src.slice(i, lt) }

    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4)
      const end = close === -1 ? src.length : close + 3
      yield { kind: 'text', text: src.slice(lt, end) }
      i = end
      continue
    }

    const closing = src[lt + 1] === '/'
    const nameStart = closing ? lt + 2 : lt + 1
    if (!/[a-zA-Z]/.test(src[nameStart] || '')) {
      yield { kind: 'text', text: '<' }
      i = lt + 1
      continue
    }

    const end = scanTagEnd(src, lt)
    if (end === -1) {
      yield { kind: 'text', text: src.slice(lt) }
      return
    }
    let j = nameStart
    while (j < end && /[a-zA-Z0-9:-]/.test(src[j])) j++
    const name = src.slice(nameStart, j).toLowerCase()
    yield { kind: 'tag', text: src.slice(lt, end), name, closing }
    i = end

    if (!closing && RAW_TAGS.has(name)) {
      const m = new RegExp(`</${name}\\s*>`, 'i').exec(src.slice(end))
      if (!m) return
      yield { kind: 'text', text: src.slice(end, end + m.index) }
      i = end + m.index // 下一轮自然处理 </style> 自身
    }
  }
}

const DECODE_TABLE = { amp: '&', quot: '"', lt: '<', gt: '>' }
const ENCODE_RE = /[&"<>]/g
const ENCODE_TABLE = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }

// 属性值在 HTML 里是转义过的；CSS 里展示成真实字符更好读，
// 复制回 style 属性时再转义回去。单趟正则，避免 &amp;quot; 被解两遍。
function decodeAttr(value) {
  return String(value).replace(/&(amp|quot|lt|gt);/g, (all, key) => DECODE_TABLE[key])
}

function encodeAttr(value) {
  return String(value).replace(ENCODE_RE, (ch) => ENCODE_TABLE[ch])
}

// 多条声明拼进同一个 style 属性：各段补上分隔的分号；单段原样返回，保证往返是逐字节的
function joinStyles(parts) {
  let out = ''
  for (const part of parts) {
    const body = String(part).trim()
    if (!body) continue
    if (out && !out.endsWith(';')) out += ';'
    out += body
  }
  return out
}

// ----------声明级工具：把 “a:b;c:d” 切开、拼回 ----------

// 按顶层分号切分。引号与括号内部的分号不算（url(data:…;base64,…) 一整条留着，
// 切碎了粘回公众号会变成非法 CSS）。
function splitDecls(body) {
  const parts = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

// 切完收干净：去掉段落空白、丢掉空段，并记住原文是否以分号收尾——
// 有没有收尾分号直接决定往返能否逐字节还原。
function decompose(body) {
  const parts = splitDecls(body)
  let trailing = false
  if (parts.length > 1 && parts[parts.length - 1].trim() === '') {
    parts.pop()
    trailing = true
  }
  const items = []
  for (const part of parts) {
    const item = part.trim()
    if (item) items.push(item)
  }
  return { items, trailing }
}

// 展示用：冒号后补一个空格，一行一条，看着才整齐
function prettyDecl(item) {
  return item.replace(/^([^:]*):\s*/, '$1: ')
}

// 回写用：把补进去的那个空格吃回去，让 “拆→合” 对渲染器产出逐字节还原
function plainDecl(item) {
  return item.replace(/^([^:]*):\s*/, '$1:')
}

// 样式表里的规则体 → style 属性值（折回单行、与原文同形）
function restoreDecl(body) {
  const { items, trailing } = decompose(body)
  if (!items.length) return ''
  const joined = items.map(plainDecl).join(';')
  return trailing ? `${joined};` : joined
}

function packTag(tag, byStyle, rules) {
  const m = STYLE_ATTR.exec(tag)
  if (!m) return tag
  const raw = m[2] ?? m[3] ?? ''
  if (!raw.trim()) return tag // 空样式没有可拆的内容，原样留着才谈得上往返

  const value = decodeAttr(raw)
  if (!decompose(value).items.length) return tag // 全是分号/空白，没有可展示的声明
  let name = byStyle.get(value)
  if (!name) {
    name = `s${rules.length + 1}`
    byStyle.set(value, name)
    rules.push([name, value])
  }

  const cls = CLASS_ATTR.exec(tag)
  if (cls) {
    const current = (cls[2] ?? cls[3] ?? '').trim()
    const merged = current ? `${current} ${name}` : name
    return tag.replace(CLASS_ATTR, (all, ws) => `${ws}class="${encodeAttr(merged)}"`).replace(STYLE_ATTR, '')
  }
  return tag.replace(STYLE_ATTR, (all, ws) => `${ws}class="${name}"`)
}

// 把内联 style 拆成 class 结构 + 一份 CSS。规则按首次出现排序，类名 s1/s2/… 由
// 样式内容去重决定，所以同一份文档多次拆分结果完全一致。
export function packStyles(input) {
  const src = String(input ?? '')
  const byStyle = new Map()
  const rules = []
  let html = ''
  for (const part of segments(src)) {
    html += part.kind === 'tag' && !part.closing ? packTag(part.text, byStyle, rules) : part.text
  }

  let css = ''
  for (const [name, value] of rules) css += formatRule(name, value)
  return { html, css }
}

// 一条规则一段，声明逐行缩进：
//   .s1 {
//     margin: 0 8px 1.3em;
//     text-indent: 2em;
//   }
function formatRule(name, body) {
  const { items, trailing } = decompose(body)
  let rule = `.${name} {\n`
  items.forEach((item, i) => {
    // 原文没写收尾分号时，最后一条也不写——往返才不会凭空多出一个分号
    const semi = i === items.length - 1 && !trailing ? '' : ';'
    rule += `  ${prettyDecl(item)}${semi}\n`
  })
  return `${rule}}\n`
}

// 解析样式表。容忍多余空白与缺失的收尾分号；遇到嵌套块（@media 之类）时按
// 第一个 } 截断——内联样式本来也表达不了 @media，宁可少解析也不要把 css 搞崩。
function parseCss(css) {
  const map = new Map()
  const head = /\.([A-Za-z_][\w-]*)\s*\{/g
  let m
  while ((m = head.exec(css))) {
    const bodyStart = m.index + m[0].length
    const close = css.indexOf('}', bodyStart)
    const body = close === -1 ? css.slice(bodyStart) : css.slice(bodyStart, close)
    // 折回单行、吃掉展示用的空格；后写的覆盖先写的，与 CSS 的层叠方向一致
    const value = restoreDecl(body)
    if (value) map.set(m[1], value)
    if (close === -1) break
    head.lastIndex = close + 1
  }
  return map
}

function hasPackedClass(src) {
  for (const part of segments(src)) {
    if (part.kind !== 'tag' || part.closing) continue
    const cls = CLASS_ATTR.exec(part.text)
    if (!cls) continue
    const tokens = (cls[2] ?? cls[3] ?? '').split(/\s+/)
    if (tokens.some((t) => /^s\d+$/.test(t))) return true
  }
  return false
}

function unpackTag(tag, map) {
  const cls = CLASS_ATTR.exec(tag)
  if (!cls) return tag
  const tokens = (cls[2] ?? cls[3] ?? '').split(/\s+/).filter(Boolean)
  const mapped = tokens.filter((t) => map.has(t))
  if (mapped.length === 0) return tag // 都解析不出来就别动，用户自己写的 class 留着
  const kept = tokens.filter((t) => !map.has(t))

  const style = STYLE_ATTR.exec(tag)
  const existing = style ? (style[2] ?? style[3] ?? '') : ''
  const bodies = mapped.map((t) => map.get(t))
  if (existing.trim()) bodies.push(existing.trim()) // 已有的内联 style 排在后，冲突时它赢
  const combined = encodeAttr(joinStyles(bodies))

  let next = tag
  if (style) next = next.replace(STYLE_ATTR, (all, ws) => `${ws}style="${combined}"`)
  if (kept.length) {
    const clsValue = encodeAttr(kept.join(' '))
    next = next.replace(CLASS_ATTR, (all, ws) =>
      style ? `${ws}class="${clsValue}"` : `${ws}class="${clsValue}" style="${combined}"`
    )
  } else {
    next = next.replace(CLASS_ATTR, style ? '' : (all, ws) => `${ws}style="${combined}"`)
  }
  return next
}

// 把 class 结构与样式表合成回内联 HTML（预览与复制用的正典形态）。
// 返回 null 表示“CSS 一条规则都解析不出来、而 HTML 还引用着拆出来的类”
// —— 即样式表被改崩了，调用方应当保留上一份有效结果，别把整篇样式抹掉。
export function unpackStyles(inputHtml, inputCss) {
  const src = String(inputHtml ?? '')
  const map = parseCss(String(inputCss ?? ''))
  if (map.size === 0 && hasPackedClass(src)) return null

  let html = ''
  for (const part of segments(src)) {
    html += part.kind === 'tag' && !part.closing ? unpackTag(part.text, map) : part.text
  }
  return html
}
