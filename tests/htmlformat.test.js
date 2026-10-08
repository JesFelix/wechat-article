import test from 'node:test'
import assert from 'node:assert/strict'
import { formatHtml, __resetFormatMemo } from '../src/lib/htmlformat.js'
import { renderMarkdown } from '../src/lib/renderer.js'
import { themes } from '../src/lib/themes.js'

test('中文行内格式前后不插入任何空白', () => {
  const src = '<section><p>这是一段<strong>重点</strong>文字<em>斜体</em>结尾</p></section>'
  const out = formatHtml(src)
  assert.ok(out.includes('<p>这是一段<strong>重点</strong>文字<em>斜体</em>结尾</p>'))
})

test('相邻的行内标签之间不换行（图文说明不会多出空格）', () => {
  const out = formatHtml('<section><img src="a.png"><span>图注</span></section>')
  assert.ok(out.includes('<img src="a.png"><span>图注</span>'))
})

test('块级标签之间换行缩进，结构可见', () => {
  const out = formatHtml('<section><p>一</p><p>二</p><ul><li>甲</li><li>乙</li></ul></section>')
  const lines = out.split('\n')
  assert.ok(lines.length > 4, `应拆成多行，实际 ${lines.length} 行`)
  assert.equal(lines[0], '<section>')
  assert.equal(lines[1], '  <p>一</p>')
  assert.equal(lines[2], '  <p>二</p>')
  assert.equal(lines[3], '  <ul>')
  assert.equal(lines[4], '    <li>甲</li>')
  assert.equal(lines[5], '    <li>乙</li>')
  assert.equal(lines[6], '  </ul>')
  assert.equal(lines[7], '</section>')
})

test('pre 代码块内容逐字保留', () => {
  const code = 'function a() {\n  return 1;\n}'
  const src = `<section><pre><code>${code.replace(/</g, '&lt;')}</code></pre><p>后文</p></section>`
  const out = formatHtml(src)
  const body = /<pre>([\s\S]*?)<\/pre>/.exec(out)
  assert.ok(body, '应能找到 pre 内容')
  assert.equal(body[1], `<code>${code.replace(/</g, '&lt;')}</code>`)
  assert.ok(out.includes('\n  <p>后文</p>'))
})

test('属性值里的 > 不会截断标签', () => {
  const src = '<section><p style="width:1px">x</p><p style="content:\'>">y</p></section>'
  const out = formatHtml(src)
  assert.ok(out.includes('<p style="width:1px">x</p>'))
  assert.ok(out.includes(`<p style="content:'>">y</p>`))
})

test('排版幂等：再排一次结果不变', () => {
  const src =
    '<section><p>中文<strong>加粗</strong>尾部</p>' +
    '<pre><code>if (a &lt; b) {\n  go()\n}</code></pre>' +
    '<section style="display:flex"><img src="a"><span>图注</span></section>' +
    '<ul><li>甲</li><li>乙</li></ul></section>'
  __resetFormatMemo()
  const once = formatHtml(src)
  __resetFormatMemo()
  const twice = formatHtml(once)
  assert.equal(twice, once)
})

test('排版不丢失、不重排任何非空白字符', () => {
  const src =
    '<section style="color:red"><!-- 注释 --><p>a &amp; b &lt; c</p>' +
    '<ul><li>列表一</li><li>列表二</li></ul><img src="x.png"><span>图注</span></section>'
  const strip = (s) => s.replace(/\s+/g, '')
  assert.equal(strip(formatHtml(src)), strip(src))
})

test('文本里的 < 不被当成标签', () => {
  const src = '<section><p>比较 a &lt; b 与 3 &lt; 5</p><p>裸的 < 符号</p></section>'
  const strip = (s) => s.replace(/\s+/g, '')
  assert.equal(strip(formatHtml(src)), strip(src))
})

test('空输入与非字符串输入安全', () => {
  assert.equal(formatHtml(''), '')
  assert.equal(formatHtml(null), '')
  assert.equal(formatHtml(undefined), '')
})

test('真实渲染结果排版后，行内结构与渲染前一致', () => {
  const md = '这是中文**加粗**和*斜体*紧挨着文字。\n\n> 引用**重点**\n\n- 列表**加粗**项\n'
  const html = renderMarkdown(md, themes[0], { fontSize: 16, galleryMode: 'collage' })
  const out = formatHtml(html)
  // 段落里的行内组合必须逐字保留（只允许标签自带的属性）
  assert.match(
    out,
    /<p data-line="0"[^>]*>这是中文<strong[^>]*>加粗<\/strong>和<em[^>]*>斜体<\/em>紧挨着文字。<\/p>/
  )
  assert.match(out, /<blockquote/)
  // 排版前后非空白字符完全一致（只允许新增换行与缩进）
  const strip = (s) => s.replace(/\s+/g, '')
  assert.equal(strip(out), strip(html))
  // 幂等
  __resetFormatMemo()
  assert.equal(formatHtml(out), out)
})

test('用户现场的真实 HTML：带引号与 gradient 的 style 不崩、可排版、幂等', () => {
  // 直接取自用户控制台的 html prop（模板字符串里的换行即原始 \n）
  const html = `<section style="font-family:-apple-system-font,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',Arial,sans-serif;font-size:16px;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.05) 0,rgba(255,255,255,0.05) 1px,transparent 1px,transparent 24px);word-break:break-word;overflow-wrap:anywhere;"><h1 data-line="0" style="font-size:1.65em;color:#ffffff;margin:0.8em 8px 0.5em;"><span style="display:block;font-family:Menlo,Consolas,monospace;color:#7fd4ff;">PROJECT: SLOW-LIFE-001</span>Hello</h1><p data-line="2" style="margin:0 8px 1.3em;">你好</p>\n</section>`

  const out = formatHtml(html)
  // 块级结构成行、缩进正确
  assert.match(out, /\n {2}<h1 data-line="0"/)
  assert.match(out, /\n {4}<span style=/)
  assert.match(out, /\n {2}<p data-line="2"/)
  assert.match(out, /\n<\/section>$/)
  // 非空白字符不丢不改（引号里的 font-family、gradient 参数都必须逐字保留）
  const strip = (s) => s.replace(/\s+/g, '')
  assert.equal(strip(out), strip(html))
  // 幂等
  __resetFormatMemo()
  assert.equal(formatHtml(out), out)
})
