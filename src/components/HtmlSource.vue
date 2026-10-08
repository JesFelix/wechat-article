<template>
  <div class="hsrc">
    <div class="hsrc-bar">
      <span class="hsrc-title">HTML 源码</span>
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
import { EditorState } from '@codemirror/state'
import { html as htmlLang } from '@codemirror/lang-html'
import { formatHtml } from '../lib/htmlformat.js'

const props = defineProps({
  html: { type: String, default: '' },
  manual: { type: Boolean, default: false },
})
const emit = defineEmits(['edit', 'revert', 'collapse'])

const host = ref(null)
let view = null
let syncTimer = null
// 正在把外部内容写进编辑器：此时的 docChanged 不是用户在编辑
let syncing = false

// 手动模式下用户写什么就是什么；自动生成时排版后展示（渲染器产出是一整行）
function displayText() {
  const raw = String(props.html ?? '')
  if (props.manual) return raw
  // 排版器只是“让它好看”，出任何错都不能连累面板：退回原样显示
  try {
    return formatHtml(raw)
  } catch (err) {
    console.error('[htmlformat] 排版失败，已回退为原始 HTML', err)
    return raw
  }
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

// 排版与整篇替换都有成本，Markdown 连续敲键时合并成一次
watch(
  () => [props.html, props.manual],
  () => {
    clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      applyIncoming()
    }, 60)
  }
)

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: displayText(),
      extensions: [
        basicSetup,
        htmlLang(),
        EditorView.lineWrapping,
        // 与左侧写作区一样：写作者不需要多光标
        EditorState.allowMultipleSelections.of(false),
        placeholder('HTML 源码会实时显示在这里，可直接修改…'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !syncing) emit('edit', u.state.doc.toString())
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
