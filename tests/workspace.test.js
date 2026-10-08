import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

// 把设置先种进伪 localStorage，再让 Vite 重新加载整棵组件树，
// 既校验三栏结构，也校验旧版设置的迁移结果。
function seedSettings(value) {
  const kv = new Map()
  if (value) kv.set('wmd-settings', JSON.stringify(value))
  globalThis.localStorage = {
    getItem: (key) => (kv.has(key) ? kv.get(key) : null),
    setItem: (key, item) => kv.set(key, String(item)),
    removeItem: (key) => kv.delete(key),
    clear: () => kv.clear(),
    key: (index) => [...kv.keys()][index] ?? null,
    get length() {
      return kv.size
    },
  }
}

async function renderWorkspace(settings) {
  seedSettings(settings)
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    server.moduleGraph.invalidateAll()
    const { default: App } = await server.ssrLoadModule('/src/App.vue')
    return await renderToString(createSSRApp(App))
  } finally {
    await server.close()
    delete globalThis.localStorage
  }
}

// 从 SSR 输出里抠出某个 class 节点所在标签上的内联样式
function styleOf(html, marker) {
  const at = html.indexOf(marker)
  assert.notEqual(at, -1, `未找到节点：${marker}`)
  const start = html.lastIndexOf('<', at)
  const end = html.indexOf('>', at)
  const tag = html.slice(start, end + 1)
  const match = /style="([^"]*)"/.exec(tag)
  return match ? match[1] : ''
}

// 从 SSR 输出里抠出某个按钮标签，再取它的按下状态
function buttonTag(html, label) {
  const at = html.indexOf(`aria-label="${label}"`)
  assert.notEqual(at, -1, `未找到按钮：${label}`)
  const start = html.lastIndexOf('<', at)
  const end = html.indexOf('>', at)
  return html.slice(start, end + 1)
}

function pressed(html, label) {
  const match = /aria-pressed="([^"]*)"/.exec(buttonTag(html, label))
  assert.ok(match, `${label} 缺少 aria-pressed`)
  return match[1] === 'true'
}

// 取第一个 class 列表里含指定类名的标签的完整 class 属性。
// Vue 会把静态 class 与 :class 合并，顺序不固定（如 "pane-hidden editor-pane"），
// 所以断言必须按「类名是否在列表里」判断，不能匹配固定字符串。
function classAttrOf(html, cls) {
  const re = new RegExp(`<[^>]+class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`)
  const tag = re.exec(html)?.[0]
  assert.ok(tag, `未找到 class 列表里含 "${cls}" 的标签`)
  return /class="([^"]*)"/.exec(tag)?.[1] ?? ''
}

// 某个元素是否同时带着另一个 class（Vue 合并静态/动态 class 时顺序不固定，
// 不能靠 "a b" 这种固定字符串断言）
function hasClass(html, holder, target) {
  return new RegExp(`\\b${target}\\b`).test(classAttrOf(html, holder))
}

test('工作区默认是 写作 / HTML 源码 / 预览 三栏', async () => {
  const html = await renderWorkspace(null)
  assert.ok(html.includes('class="editor-pane"'))
  assert.ok(html.includes('class="html-pane"'))
  assert.ok(html.includes('class="hsrc-title"'))
  assert.match(html, /class="[^"]*\bpreview-pane[\s"]/, '预览栏未渲染')
  // 两根分隔条：写作|源码、源码|预览
  assert.equal((html.match(/class="divider/g) || []).length, 2)
  // 默认宽度：写作 40% + 源码 26%，预览拿剩下的 34%
  assert.match(styleOf(html, 'class="editor-pane"'), /flex:\s*0 0 40%/)
  assert.match(styleOf(html, 'class="html-pane"'), /flex:\s*0 0 26%/)
  // 源码面板带实时状态与收起入口
  assert.ok(html.includes('自动生成'))
  assert.ok(html.includes('收起 HTML 源码面板'))
  // 源码栏的开关在顶部导航栏里
  assert.ok(html.includes('aria-label="HTML 源码面板"'), '顶栏缺少 HTML 源码开关')
  assert.ok(html.indexOf('aria-label="HTML 源码面板"') < html.indexOf('操作提示与快捷键'), '开关应位于帮助按钮左侧')
  // MD 开关紧挨在 HTML 开关左侧，两者都在帮助按钮左边
  assert.ok(html.includes('aria-label="Markdown 写作面板"'), '顶栏缺少 MD 源码开关')
  assert.ok(
    html.indexOf('aria-label="Markdown 写作面板"') < html.indexOf('aria-label="HTML 源码面板"'),
    'MD 开关应位于 HTML 开关左侧'
  )
})

// ---- 顶栏 MD / HTML 两个多选开关的四种组合 ----

test('效果一：只开 MD → 写作列 + 预览，源码列整列撤掉', async () => {
  const html = await renderWorkspace({ v: 11, mdPane: true, htmlPane: false, editorPct: 40 })
  assert.ok(classAttrOf(html, 'editor-pane'), '写作列应渲染')
  assert.equal(hasClass(html, 'editor-pane', 'pane-hidden'), false, '写作列不应被收起')
  assert.doesNotMatch(html, /\bclass="[^"]*\bhtml-pane\b/, '源码列不应渲染')
  assert.doesNotMatch(html, /class="hsrc-title"/, '源码面板标题不应出现')
  assert.ok(classAttrOf(html, 'preview-pane'), '预览栏恒显示')
  // 只剩 写作|预览 一根分隔条
  assert.equal((html.match(/class="divider/g) || []).length, 1)
  // 顶栏两个开关的按下状态
  assert.equal(pressed(html, 'Markdown 写作面板'), true)
  assert.equal(pressed(html, 'HTML 源码面板'), false)
})

test('效果二：只开 HTML → 源码列 + 预览，写作列收起', async () => {
  const html = await renderWorkspace({ v: 11, mdPane: false, htmlPane: true, editorPct: 40 })
  assert.ok(classAttrOf(html, 'editor-pane'), '写作列应保留在 DOM（留住编辑状态）')
  assert.equal(hasClass(html, 'editor-pane', 'pane-hidden'), true, '写作列应收起')
  assert.ok(classAttrOf(html, 'html-pane'), '源码列应显示')
  assert.ok(html.includes('class="hsrc-title"'), '源码面板标题应出现')
  assert.ok(classAttrOf(html, 'preview-pane'), '预览栏恒显示')
  // 只剩 源码|预览 一根分隔条
  assert.equal((html.match(/class="divider/g) || []).length, 1)
  assert.equal(pressed(html, 'Markdown 写作面板'), false)
  assert.equal(pressed(html, 'HTML 源码面板'), true)
  // 写作列退场后源码列可借走它的宽度预算（上限 85% 而非 85% - 40%）
  assert.match(styleOf(html, 'class="html-pane"'), /flex:\s*0 0 26%/)
})

test('效果三：MD + HTML 同开 = 三栏（默认态）', async () => {
  const html = await renderWorkspace({ v: 11, mdPane: true, htmlPane: true, editorPct: 40 })
  assert.equal(hasClass(html, 'editor-pane', 'pane-hidden'), false)
  assert.ok(classAttrOf(html, 'html-pane'))
  assert.ok(classAttrOf(html, 'preview-pane'))
  assert.equal((html.match(/class="divider/g) || []).length, 2)
  assert.equal(pressed(html, 'Markdown 写作面板'), true)
  assert.equal(pressed(html, 'HTML 源码面板'), true)
})

test('两个都关 → 纯预览，不留任何分隔条', async () => {
  const html = await renderWorkspace({ v: 11, mdPane: false, htmlPane: false, editorPct: 40 })
  assert.equal(hasClass(html, 'editor-pane', 'pane-hidden'), true)
  assert.doesNotMatch(html, /\bclass="[^"]*\bhtml-pane\b/)
  assert.equal((html.match(/class="divider/g) || []).length, 0, '纯预览不应残留分隔条')
  assert.equal(hasClass(html, 'canvas', 'mode-preview'), true, '画布应处于纯预览态')
  assert.equal(hasClass(html, 'preview-pane', 'is-preview-only'), true, '预览栏应带纯预览样式')
})

test('旧版 viewMode 迁移：预览模式 = 两个开关全关，对照模式 = 按原 htmlPane 取值', async () => {
  const previewMode = await renderWorkspace({ v: 11, viewMode: 'preview', htmlPane: true, editorPct: 40 })
  assert.equal(hasClass(previewMode, 'canvas', 'mode-preview'), true, '旧预览模式应迁成纯预览')
  assert.equal((previewMode.match(/class="divider/g) || []).length, 0)
  assert.equal(pressed(previewMode, 'Markdown 写作面板'), false)
  assert.equal(pressed(previewMode, 'HTML 源码面板'), false)

  const splitWithHtml = await renderWorkspace({ v: 11, viewMode: 'split', htmlPane: true, editorPct: 40 })
  assert.equal(hasClass(splitWithHtml, 'canvas', 'mode-split'), true)
  assert.equal((splitWithHtml.match(/class="divider/g) || []).length, 2)

  const splitNoHtml = await renderWorkspace({ v: 11, viewMode: 'split', htmlPane: false, editorPct: 40 })
  assert.equal((splitNoHtml.match(/class="divider/g) || []).length, 1, '原 htmlPane:false 应保留为只开写作列')
  assert.equal(pressed(splitNoHtml, 'HTML 源码面板'), false)
})

test('旧版设置迁移：写作列还停在 50% 的收窄到 40%，源码列用新默认宽度', async () => {
  const html = await renderWorkspace({ v: 10, editorPct: 50, fontSize: 16 })
  assert.match(styleOf(html, 'class="editor-pane"'), /flex:\s*0 0 40%/)
  assert.match(styleOf(html, 'class="html-pane"'), /flex:\s*0 0 26%/)
})

test('用户自定义的写作列宽度不被迁移覆盖，且两列合计封顶 85%', async () => {
  const html = await renderWorkspace({ v: 10, editorPct: 62, fontSize: 16 })
  assert.match(styleOf(html, 'class="editor-pane"'), /flex:\s*0 0 62%/)
  const pane = styleOf(html, 'class="html-pane"')
  const pct = Number(/flex:\s*0 0 ([\d.]+)%/.exec(pane)?.[1])
  assert.ok(pct >= 12 && pct <= 40, `源码列宽度异常：${pane}`)
  assert.ok(62 + pct <= 85, `写作列 + 源码列超过 85%：${62 + pct}`)
})
