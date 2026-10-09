import test from 'node:test'
import assert from 'node:assert/strict'
import { packStyles, unpackStyles } from '../src/lib/stylepack.js'
import { renderMarkdown } from '../src/lib/renderer.js'
import { themes } from '../src/lib/themes.js'
import { sample } from '../src/lib/sample.js'

test('拆分：内联 style 变成 class 结构 + 一份 CSS', () => {
  const src = '<section><p style="margin:0 8px 1.3em;">正文</p><p style="color:red;">强调</p></section>'
  const { html, css } = packStyles(src)
  assert.ok(!html.includes('style='), `不应再有内联样式：${html}`)
  assert.match(html, /<p class="s1">正文<\/p>/)
  assert.match(html, /<p class="s2">强调<\/p>/)
  assert.equal(css, '.s1 {\n  margin: 0 8px 1.3em;\n}\n.s2 {\n  color: red;\n}\n')
})

test('拆分：同样的样式只出一条规则（去重）', () => {
  const src = '<p style="color:red;">一</p><p style="color:red;">二</p><p style="color:blue;">三</p>'
  const { html, css } = packStyles(src)
  assert.equal(css, '.s1 {\n  color: red;\n}\n.s2 {\n  color: blue;\n}\n')
  assert.match(html, /<p class="s1">一<\/p><p class="s1">二<\/p><p class="s2">三<\/p>/)
})

test('样式表格式：每条声明独占一行，两级缩进，冒号后带一个空格', () => {
  const src = '<p style="margin:0 8px 1.3em;text-indent:2em;color:red;">正文</p>'
  const packed = packStyles(src)
  assert.equal(
    packed.css,
    '.s1 {\n  margin: 0 8px 1.3em;\n  text-indent: 2em;\n  color: red;\n}\n'
  )
  assert.equal(unpackStyles(packed.html, packed.css), src, '折行与补空格都必须能还原')
  // 只有一条声明时同样成块，不留单行特例
  assert.equal(packStyles('<p style="color:red;">正文</p>').css, '.s1 {\n  color: red;\n}\n')
})

test('手写成一行、或拆了行的 CSS 都能合并（两栏来回切不崩）', () => {
  const packed = packStyles('<p style="margin:0 8px;text-indent:2em;">正文</p>')
  const oneLine = '.s1 { margin:0 8px; text-indent:2em }'
  assert.equal(unpackStyles(packed.html, oneLine), '<p style="margin:0 8px;text-indent:2em">正文</p>')
  const broken = '.s1 {\n  margin:0 8px;\n  text-indent:2em;\n'
  assert.equal(unpackStyles(packed.html, broken), '<p style="margin:0 8px;text-indent:2em;">正文</p>')
})

test('合并：class 还原成内联 style，且与拆分前逐字节一致', () => {
  const src = '<section><p style="margin:0 8px 1.3em;">正文</p><p style="color:red;">强调</p></section>'
  const packed = packStyles(src)
  assert.equal(unpackStyles(packed.html, packed.css), src)
})

test('往返稳定：拆→合→拆，两份产物完全一致', () => {
  const src =
    '<section style="font-size:16px;"><h1 style="color:#fff;">标题</h1>' +
    '<p style="margin:0 8px 1.3em;">正文<strong style="font-weight:700;">粗</strong></p>' +
    '<img src="x.png" style="width:100%;"><p>没有样式的段落</p></section>'
  const once = packStyles(src)
  const twice = packStyles(unpackStyles(once.html, once.css))
  assert.equal(twice.html, once.html)
  assert.equal(twice.css, once.css)
})

test('渲染器全部主题：拆合往返逐字节还原', () => {
  let checked = 0
  for (const theme of themes) {
    const html = renderMarkdown(sample, theme, {
      fontSize: 16,
      fontFamily: 'sans',
      macCode: true,
      galleryMode: 'collage',
    })
    const packed = packStyles(html)
    assert.equal(unpackStyles(packed.html, packed.css), html, `主题「${theme.name}」往返不一致`)
    assert.ok(packed.css.length > 0, `主题「${theme.name}」没拆出任何规则`)
    checked++
  }
  assert.equal(checked, themes.length)
})

test('拆出来的 class 结构里不再有内联 style（渲染器产出）', () => {
  const html = renderMarkdown(sample, themes[0], { fontSize: 16, galleryMode: 'collage' })
  const packed = packStyles(html)
  assert.doesNotMatch(packed.html, /\sstyle=/, 'class 版结构里不应残留 style 属性')
  // 每个引用到的类都要有对应规则
  const used = new Set()
  for (const m of packed.html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (/^s\d+$/.test(t)) used.add(t)
  }
  assert.ok(used.size > 0)
  for (const name of used) assert.match(packed.css, new RegExp(`\\.${name} \\{`))
})

test('样式表被改崩时返回 null，调用方保留上一份结果', () => {
  const packed = packStyles('<p style="color:red;">正文</p>')
  assert.equal(unpackStyles(packed.html, ''), null, 'CSS 全空且还引用着类时应判为崩了')
  // 收尾大括号没打完也要能解析出规则（少写个 } 不该让整篇样式失效）
  assert.equal(unpackStyles(packed.html, '.s1 {color:'), '<p style="color:">正文</p>')
  // 合法（哪怕缺收尾分号）必须能用
  assert.equal(unpackStyles(packed.html, '.s1 {color:blue'), '<p style="color:blue">正文</p>')
  // HTML 里没有拆出来的类时，空 CSS 不算崩
  assert.equal(unpackStyles('<p>纯文本</p>', ''), '<p>纯文本</p>')
})

test('CSS 里不存在的 class 原样保留', () => {
  const html = '<p class="user-note s9">正文</p>'
  const out = unpackStyles(html, '.s1 {color:red;}')
  assert.equal(out, '<p class="user-note s9">正文</p>')
})

test('已有的内联 style 与 class 合并，且已有 style 排在后面（冲突时它赢）', () => {
  const out = unpackStyles('<p class="s1" style="color:blue;">正文</p>', '.s1 {color:red;font-weight:700;}')
  assert.equal(out, '<p style="color:red;font-weight:700;color:blue;">正文</p>')
})

test('文本、注释、raw 标签里的 style="…" 不会被当成属性', () => {
  const src =
    '<section><p>说明 style="color:red" 这段文字</p>' +
    '<!-- <p style="color:red;">注释里也不动 --></p>' +
    '<p>裸的 < 符号</p></section>'
  const packed = packStyles(src)
  assert.equal(packed.css, '', '不应凭空拆出规则')
  assert.equal(packed.html, src)
})

test('<style> 块内部不解析（CSS 里出现 < 也不会被切开）', () => {
  const src = '<style>.a { content: "<b>"; }</style><p style="color:red;">正文</p>'
  const packed = packStyles(src)
  assert.ok(packed.html.startsWith('<style>.a { content: "<b>"; }</style>'), packed.html)
  assert.equal(packed.css, '.s1 {\n  color: red;\n}\n')
})

test('属性值里的 > 与单引号不会截断标签', () => {
  const raw = `<p style="width:1px">一</p><p style="content:'>'">二</p>`
  const packed = packStyles(raw)
  // 手写的裸 > 回写时会被规范化成 &gt;（与渲染器产出一致，渲染结果相同），之后稳定
  const merged = unpackStyles(packed.html, packed.css)
  assert.equal(merged, `<p style="width:1px">一</p><p style="content:'&gt;'">二</p>`)
  const again = packStyles(merged)
  assert.equal(unpackStyles(again.html, again.css), merged, '第二轮起必须逐字节稳定')

  // 渲染器产出的 &gt; 形式则是逐字节还原
  const escaped = `<p style="content:'&gt;'">二</p>`
  const p2 = packStyles(escaped)
  assert.equal(unpackStyles(p2.html, p2.css), escaped)
})

test('属性值里的 HTML 实体：CSS 展示成真实字符，合并后仍能还原', () => {
  const src = `<p style="font-family:&quot;X&quot; &amp; Y;">正文</p>`
  const packed = packStyles(src)
  assert.ok(packed.css.includes('font-family: "X" & Y;'), 'CSS 里应是可读的真实字符')
  assert.equal(unpackStyles(packed.html, packed.css), src)
})

test('空输入与非字符串输入安全', () => {
  assert.deepEqual(packStyles(''), { html: '', css: '' })
  assert.deepEqual(packStyles(null), { html: '', css: '' })
  assert.equal(unpackStyles('', ''), '')
  assert.equal(unpackStyles(undefined, undefined), '')
})

test('手改 HTML：多出来的 class 会被并进同一个 class 属性', () => {
  const packed = packStyles('<p class="note" style="color:red;">正文</p>')
  assert.match(packed.html, /<p class="note s1">正文<\/p>/)
  assert.equal(unpackStyles(packed.html, packed.css), '<p class="note" style="color:red;">正文</p>')
})
