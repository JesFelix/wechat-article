// HTML 源码面板的展示排版器。
//
// 渲染器产出的 HTML 是“一整行”（markdown-it 的规则不输出换行），直接塞进源码
// 面板只能看到一堵墙。这里按标签边界换行 + 缩进，让文档结构一眼可见。
//
// 唯一的硬约束：**不能改变渲染结果**。中文写作里 `中文**粗体**` 会渲染成
// `<p>中文<strong>粗体</strong></p>`，在 <strong> 前后插入换行就凭空多出一个空格。
// 于是规则收敛成一条：
//
//   只有“上一个标签是块级”或“当前标签是块级”时才换行；
//   行内 ↔ 行内 的相邻标签之间一个字符都不加（块级两侧的空白会被折叠掉，
//   不参与渲染，所以块级相邻处换行是安全的）。
//
// 另外：
//   - <pre>/<script>/<style>/<textarea> 的内容原样搬运，绝不重新缩进；
//   - 只在标签之间插入空白，纯文本节点始终逐字保留；
//   - 输出幂等（formatHtml(formatHtml(x)) === formatHtml(x)），测试里有校验。

// 只列“确定是块级”的标签：把行内标签误判成块级会破坏渲染，反过来最多只是
// 少几行换行，所以这里宁可保守。
const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'address',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'figure', 'figcaption', 'details', 'summary', 'fieldset', 'legend',
  'form', 'table', 'caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr',
  'td', 'th', 'hr', 'center', 'dir', 'menu',
])

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
])

// 原始文本元素：内部必须逐字保留，不能按标签解析（代码里的 `<` 会被转义，
// 但 hljs 高亮产出的 <span> 与换行都在其中，重新缩进会改掉代码块的显示）。
const RAW_TAGS = new Set(['pre', 'script', 'style', 'textarea'])

const isBlock = (name) => BLOCK_TAGS.has(name)

// 从 `<` 开始读一个标签，返回 { end, kind, name, block }；不是标签则返回 null。
// 属性值里的 `>` 用引号状态机跳过，避免 `style="a>b"` 提前截断。
function readTag(src, start) {
  if (src[start] !== '<') return null
  const next = src[start + 1]

  if (next === '!' || next === '?') {
    if (src.startsWith('<!--', start)) {
      const close = src.indexOf('-->', start + 4)
      return { end: close === -1 ? src.length : close + 3, kind: 'meta', name: '', block: false }
    }
    const end = scanTagEnd(src, start)
    return end === -1 ? null : { end, kind: 'meta', name: '', block: false }
  }

  const isClose = next === '/'
  const nameStart = start + (isClose ? 2 : 1)
  if (!/[a-zA-Z]/.test(src[nameStart] || '')) return null
  let cursor = nameStart
  while (cursor < src.length && !/[\s/>]/.test(src[cursor])) cursor++
  const name = src.slice(nameStart, cursor).toLowerCase()
  const end = scanTagEnd(src, start)
  if (end === -1) return null

  if (isClose) return { end, kind: 'close', name, block: isBlock(name) }
  if (src[end - 2] === '/' || VOID_TAGS.has(name)) {
    return { end, kind: 'void', name, block: isBlock(name) }
  }
  if (RAW_TAGS.has(name)) {
    // 找到配套的闭合标签，把整段当成一个不可拆的单元
    const closeRe = new RegExp(`</${name}\\s*>`, 'i')
    const rest = src.slice(end)
    const m = closeRe.exec(rest)
    return { end: end + (m ? m.index + m[0].length : rest.length), kind: 'raw', name, block: isBlock(name) }
  }
  return { end, kind: 'open', name, block: isBlock(name) }
}

// 从 `<` 起扫描到标签结束的 `>`（返回 `>` 之后的位置），引号内的 `>` 不算数
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

const onlyWhitespace = (text) => !/\S/.test(text)

// 同步缓存：Markdown 每敲一个键都会送来一份新的 HTML，同输入直接复用上次结果
let memoKey = null
let memoRaw = null
let memoOut = null

export function formatHtml(input, indentUnit = '  ') {
  const src = String(input ?? '')
  if (!src) return ''
  if (src === memoRaw && indentUnit === memoKey) return memoOut

  const out = []
  let depth = 0
  // 'start' 尚未输出任何内容 | 'tag' 上一个输出的是标签 | 'text' 上一个输出的是文本
  let prev = 'start'
  let prevBlock = false

  const newLine = () => out.push('\n' + indentUnit.repeat(depth))

  // 标签之间的纯空白先扣住不发：换行要在**下一个标签确定之后**才知道该用哪一级
  // 缩进（闭合标签要先出栈），否则缩进会逐层漂移。等到标签落地时再决定——
  // 能换行就用规范缩进顶掉这段空白，换不了行（行内 ↔ 行内）就原样保留。
  let pendingWs = null
  const flushWs = () => {
    if (pendingWs !== null) {
      out.push(pendingWs)
      pendingWs = null
    }
  }

  const pushText = (text) => {
    if (onlyWhitespace(text)) {
      if (prev === 'tag' && pendingWs === null) {
        pendingWs = text
      } else {
        out.push(text)
      }
      return
    }
    flushWs()
    out.push(text)
    prev = 'text'
  }

  const pushTag = (text, block) => {
    // 行内 ↔ 行内不换行：那会凭空插入一个渲染得出来的空格
    if (prev === 'tag' && (prevBlock || block)) {
      pendingWs = null
      newLine()
    } else {
      flushWs()
    }
    out.push(text)
    prev = 'tag'
    prevBlock = block
  }

  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      pushText(src.slice(i))
      break
    }
    if (lt > i) pushText(src.slice(i, lt))

    const tok = readTag(src, lt)
    if (!tok) {
      // 不是标签的 `<`（例如文本里的 a < b）：当作普通字符
      flushWs()
      out.push('<')
      prev = 'text'
      i = lt + 1
      continue
    }

    const text = src.slice(lt, tok.end)
    if (tok.kind === 'open') {
      pushTag(text, tok.block)
      depth++
    } else if (tok.kind === 'close') {
      // 先出栈再落地：换行缩进要用父级的深度
      depth = Math.max(0, depth - 1)
      pushTag(text, tok.block)
    } else {
      // raw 整段搬运 / void / 注释：深度不变
      pushTag(text, tok.block)
    }
    i = tok.end
  }
  // 文档以标签之间的空白收尾：原样保留
  flushWs()

  const result = out.join('')
  memoKey = indentUnit
  memoRaw = src
  memoOut = result
  return result
}

// 仅用于测试：清掉排版缓存
export function __resetFormatMemo() {
  memoKey = null
  memoRaw = null
  memoOut = null
}
