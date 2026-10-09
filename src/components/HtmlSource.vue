<template>
  <div class="hsrc">
    <div class="hsrc-bar">
      <span class="hsrc-title">{{ tab === 'css' ? 'CSS 样式' : 'HTML 源码' }}</span>
      <span
        class="hsrc-chip"
        :class="{ manual }"
        :title="
          manual
            ? '当前预览显示的就是这份手改的 HTML；改动 Markdown 或排版设置会重新生成'
            : '按当前 Markdown 与主题实时生成，可直接编辑'
        "
      >
        {{ manual ? '手动修改' : '自动生成' }}
      </span>
      <!-- 结构与样式拆开显示：HTML 里只剩标签与 class，规则都在 CSS 那一侧 -->
      <div class="hsrc-tabs" role="tablist" aria-label="源码面板视图">
        <button
          class="hsrc-tab"
          type="button"
          role="tab"
          :aria-selected="tab === 'html'"
          :class="{ on: tab === 'html' }"
          title="查看 / 编辑标签结构（样式已拆成 class）"
          @click="switchTab('html')"
        >
          HTML
        </button>
        <button
          class="hsrc-tab"
          type="button"
          role="tab"
          :aria-selected="tab === 'css'"
          :class="{ on: tab === 'css' }"
          title="查看 / 编辑拆出来的 CSS 规则（复制出去时会并回内联样式）"
          @click="switchTab('css')"
        >
          CSS
        </button>
      </div>
      <span class="spacer"></span>
      <button
        v-if="manual"
        class="hsrc-btn hsrc-warn"
        type="button"
        title="放弃手动修改，按 Markdown 重新生成"
        @click="emit('revert')"
      >
        还原
      </button>
      <button class="hsrc-btn" type="button" title="收起 HTML 源码面板" @click="emit('collapse')">收起</button>
    </div>
    <div class="hsrc-body">
      <div ref="host" class="cm-host"></div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { placeholder } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { html as htmlLang } from '@codemirror/lang-html'
import { css as cssLang } from '@codemirror/lang-css'
import { formatHtml } from '../lib/htmlformat.js'
import { packStyles, unpackStyles } from '../lib/stylepack.js'

const props = defineProps({
  html: { type: String, default: '' },
  manual: { type: Boolean, default: false },
})
const emit = defineEmits(['edit', 'revert', 'collapse', 'warn'])

const tab = ref('html')
// 两个缓冲区：class 版结构与拆出来的样式表。正典形态始终是 props.html 里的
// 内联 HTML（预览与复制直接用它），面板只是把它拆开来看、编辑后再合回去。
const htmlBuf = ref('')
const cssBuf = ref('')
// 最近一次由本面板发出去的内联 HTML。props.html 等于它 = 自己的回声，
// 说明缓冲区已经是最新的，绝不能再 pack 一遍覆盖用户正在编辑的内容（光标会乱跳）。
let lastEmitted = null
// 样式表被改崩的提示只弹一次，连续敲键不刷屏
let warnedBroken = false

const host = ref(null)
let view = null
let syncTimer = null
// 正在把外部内容写进编辑器：此时的 docChanged 不是用户在编辑
let syncing = false
// 语法高亮与占位文案跟着标签页切换
const langSlot = new Compartment()

function makeLang() {
  return tab.value === 'css'
    ? [cssLang(), placeholder('拆出来的 CSS 规则会显示在这里，可直接修改…')]
    : [htmlLang(), placeholder('HTML 源码会实时显示在这里，可直接修改…')]
}

// 排版器只是“让它好看”，出任何错都不能连累面板：退回原样显示
function formatSafe(text) {
  try {
    return formatHtml(text)
  } catch (err) {
    console.error('[htmlformat] 排版失败，已回退为原始 HTML', err)
    return text
  }
}

// 外部（渲染器 / 还原 / 恢复上次手改）给了新的内联 HTML：拆成两份塞进缓冲区
function rebuild(nextHtml) {
  lastEmitted = null // 已经不是刚才那份手改结果了，之后的变化都要重新拆
  const raw = String(nextHtml ?? '')
  let packed
  try {
    packed = packStyles(raw)
  } catch (err) {
    console.error('[stylepack] 拆分失败，已回退为原始 HTML', err)
    packed = { html: raw, css: cssBuf.value }
  }
  cssBuf.value = packed.css
  // 手动模式下用户写什么就是什么；自动生成时排版后展示（渲染器产出是一整行）
  htmlBuf.value = props.manual ? packed.html : formatSafe(packed.html)
}

function displayText() {
  return tab.value === 'css' ? cssBuf.value : htmlBuf.value
}

function applyIncoming() {
  if (!view) return
  const next = displayText()
  const current = view.state.doc.toString()
  if (next === current) return

  const { anchor, head } = view.state.selection.main
  const scrollTop = view.scrollDOM.scrollTop
  syncing = true
  try {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next },
      selection: {
        anchor: Math.min(anchor, next.length),
        head: Math.min(head, next.length),
      },
    })
  } finally {
    syncing = false
  }
  // Markdown 持续输入时整篇替换，尽量保住源码面板的阅读位置
  requestAnimationFrame(() => {
    if (view) view.scrollDOM.scrollTop = scrollTop
  })
}

// 用户在编辑器里敲字：更新对应缓冲区，两份合成内联 HTML 交给外面
// （预览与复制拿到的永远是内联形态，class 只存在于这块面板里）
function onEdit(text) {
  if (tab.value === 'css') cssBuf.value = text
  else htmlBuf.value = text

  let next = null
  try {
    next = unpackStyles(htmlBuf.value, cssBuf.value)
  } catch (err) {
    console.error('[stylepack] 合并失败，本次修改未应用', err)
    return
  }
  if (next == null) {
    if (!warnedBroken) {
      warnedBroken = true
      emit('warn', 'CSS 规则不完整，已保留上一份样式')
    }
    return
  }
  warnedBroken = false
  lastEmitted = next
  emit('edit', next)
}

function switchTab(next) {
  if (next === tab.value) return
  tab.value = next
  if (!view) return
  view.dispatch({ effects: langSlot.reconfigure(makeLang()) })
  applyIncoming()
}

// 排版与整篇替换都有成本，Markdown 连续敲键时合并成一次
watch(
  () => [props.html, props.manual],
  () => {
    if (props.html === lastEmitted) return // 自己发出去的回声，缓冲区已经是最新的
    clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      // 排队这 60ms 里用户可能又敲了字，落笔前再确认一次
      if (props.html === lastEmitted) return
      rebuild(props.html)
      applyIncoming()
    }, 60)
  }
)

onMounted(() => {
  rebuild(props.html)
  view = new EditorView({
    state: EditorState.create({
      doc: displayText(),
      extensions: [
        basicSetup,
        langSlot.of(makeLang()),
        EditorView.lineWrapping,
        // 与左侧写作区一样：写作者不需要多光标
        EditorState.allowMultipleSelections.of(false),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !syncing) onEdit(u.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px', backgroundColor: '#f7f8fa' },
          '.cm-scroller': {
            fontFamily: "Menlo, Consolas, 'Courier New', monospace",
            lineHeight: '1.7',
          },
          '.cm-gutters': {
            backgroundColor: '#eef0f4',
            border: 'none',
            color: '#a8adb8',
            userSelect: 'none',
          },
          '.cm-activeLine': { backgroundColor: 'rgba(47, 111, 237, 0.06)' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6b7280' },
          '.cm-selectionBackground': { backgroundColor: '#cfe1ff' },
          '&.cm-focused .cm-selectionBackground, ::selection': {
            backgroundColor: '#cfe1ff !important',
          },
          '.cm-cursor': { borderLeftColor: '#2f6fed', borderLeftWidth: '2px' },
          '.cm-content': { caretColor: '#2f6fed' },
        }),
      ],
    }),
    parent: host.value,
  })
})

onBeforeUnmount(() => {
  clearTimeout(syncTimer)
  view?.destroy()
  view = null
})
</script>

<style scoped>
.hsrc {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.hsrc-bar {
  display: flex;
  height: 46px;
  box-sizing: border-box;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid var(--line);
  user-select: none;
}

.hsrc-title {
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 680;
  white-space: nowrap;
}

.hsrc-chip {
  padding: 2px 8px;
  color: var(--ink-3);
  background: var(--panel-2);
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
}

.hsrc-chip.manual {
  color: #a8551f;
  background: #fdeee0;
}

/* HTML / CSS 两档切换 */
.hsrc-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  background: var(--panel-2);
  border-radius: 8px;
}

.hsrc-tab {
  height: 22px;
  padding: 0 9px;
  color: var(--ink-3);
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 640;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.hsrc-tab:hover {
  color: var(--ink);
}

.hsrc-tab.on {
  color: var(--ink);
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1);
}

.hsrc-btn {
  height: 28px;
  padding: 0 10px;
  color: var(--ink-2);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 11.5px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}

.hsrc-btn:hover {
  color: var(--ink);
  background: var(--surface-soft);
}

.hsrc-warn {
  color: #a8551f;
  border-color: #f0d3ba;
  background: #fff7f0;
}

.hsrc-warn:hover {
  color: #8f4515;
  background: #fdeee0;
  border-color: #e8bf9c;
}

.hsrc-body {
  min-height: 0;
  flex: 1;
}

.cm-host {
  height: 100%;
}

.cm-host :deep(.cm-editor) {
  height: 100%;
}

.cm-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
