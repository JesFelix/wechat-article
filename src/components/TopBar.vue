<template>
  <header class="topbar">
    <div class="tb-logo" aria-hidden="true">排</div>
    <div class="tb-name">字间排版</div>
    <div class="tb-tag">面向公众号写作者的 Markdown 排版工具</div>

    <div class="tb-save" :title="store.lastSavedAt ? '所有文章都会自动保存到「我的文章」' : '编辑后自动保存'">
      <i></i>{{ saveText }}
    </div>

    <div class="spacer"></div>

    <!-- 两个多选开关，按工作区从左到右的顺序排列：写作列 → 源码列。预览列恒显示 -->
    <button class="top-btn tb-md" type="button" :class="{ on: showMd }" :aria-pressed="showMd"
      title="显示 / 隐藏左侧的 Markdown 写作面板" aria-label="Markdown 写作面板" @click="store.settings.mdPane = !showMd">
      MD
    </button>

    <button class="top-btn tb-html" type="button" :class="{ on: showHtml }" :aria-pressed="showHtml"
      title="显示 / 隐藏中间的 HTML 源码面板" aria-label="HTML 源码面板" @click="store.settings.htmlPane = !showHtml">
      <!-- HTML -->
      <svg t="1791451238628" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
        p-id="4842" width="20" height="20">
        <path
          d="M271.744 787.52a63.808 63.808 0 0 1-45.248-18.752L64.256 606.528C40.128 582.464 26.816 550.272 26.816 516.032s13.312-66.432 37.44-90.56l162.24-162.24a63.936 63.936 0 1 1 90.496 90.496L154.752 516.032l162.24 162.24a63.936 63.936 0 0 1-45.248 109.248zM753.536 787.52a63.936 63.936 0 0 1-45.248-109.248l162.24-162.24-162.24-162.304a63.936 63.936 0 1 1 90.496-90.496l162.24 162.304c24.128 24.064 37.44 56.192 37.44 90.496s-13.312 66.432-37.504 90.56l-162.176 162.176a63.808 63.808 0 0 1-45.248 18.752zM409.6 896a21.056 21.056 0 0 1-21.376-25.28l119.552-717.44A31.36 31.36 0 0 1 537.6 128h76.8c14.08 0 23.68 11.392 21.376 25.28l-119.552 717.44A31.36 31.36 0 0 1 486.4 896H409.6z"
          fill="#A5A6A7" p-id="4843"></path>
      </svg>
    </button>

    <div class="tb-help">
      <button class="tb-help-btn" type="button" :class="{ open: helpOpen }" title="操作提示与快捷键" aria-label="操作提示与快捷键"
        aria-expanded="helpOpen" @click="helpOpen = !helpOpen">
        <Icon name="question" :size="16" aria-hidden="true" />
      </button>
      <div v-if="helpOpen" class="tb-help-pop" @click.stop>
        <div class="help-k" v-for="row in helpRows" :key="row.k">
          <b>{{ row.k }}</b>
          <span>{{ row.d }}</span>
        </div>
        <div class="help-tip">快捷键在 macOS 用 ⌘、Windows/Linux 用 Ctrl</div>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '../lib/store.js'

// 顶栏两个多选开关的亮起状态，与工作区实际显示的列保持一致
const showMd = computed(() => store.settings.mdPane !== false)
const showHtml = computed(() => store.settings.htmlPane === true)

const saveText = computed(() => {
  if (!store.lastSavedAt) return '本地自动保存已开启'
  const d = new Date(store.lastSavedAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `本地自动保存成功 ${hh}:${mm}:${ss}`
})

// ---- 操作提示浮层 ----
const helpOpen = ref(false)
const helpRows = [
  { k: '⌘⇧C / Ctrl⇧C', d: '一键复制排版，去公众号后台粘贴' },
  { k: '⌘S / Ctrl+S', d: '保存（平时每 250ms 自动保存）' },
  { k: '粘贴 / 拖入', d: '插入本地图片与视频' },
  { k: '图片拖拽', d: '拼贴中拖动两格边界微调宽度，双击恢复自动对齐' },
  { k: '点击预览段落', d: '回到对照模式并定位到对应源码行' },
  { k: '主题卡片悬停', d: '实时试看主题，点击确认切换' },
]
function closeHelpOnOutside(event) {
  if (!helpOpen.value) return
  if (event.target instanceof Element && event.target.closest('.tb-help')) return
  helpOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeHelpOnOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeHelpOnOutside, true))
</script>

<style scoped>
/* 顶栏里的 MD / HTML 源码开关：打开时用品牌色点亮，一眼能看出哪些列在显示 */
.top-btn{
  
}

.tb-md.on,
.tb-html.on {
  color: var(--brand, #08a85a);
  background: var(--brand-soft, #e9f6ef);
  border-color: var(--brand, #08a85a);
}

.tb-help {
  position: relative;
  margin-left: 4px;
}

.tb-help-btn {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: var(--ink-2, #6b6b72);
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.tb-help-btn:hover,
.tb-help-btn.open {
  color: var(--ink, #18181b);
  background: var(--line-2, #f1ede1);
}

.tb-help-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  width: 320px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--line-2, #e8e2d2);
  border-radius: 12px;
  box-shadow: 0 14px 40px rgba(12, 19, 15, 0.14);
  text-align: left;
}

.help-k {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 4px;
  font-size: 13px;
}

.help-k b {
  flex: 0 0 92px;
  font-weight: 600;
  color: var(--ink, #18181b);
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}

.help-k span {
  color: var(--ink-2, #6b6b72);
  line-height: 1.5;
}

.help-tip {
  margin-top: 8px;
  padding: 8px 4px 2px;
  border-top: 1px solid var(--line-2, #eee9dc);
  font-size: 12px;
  color: #9a948a;
}

.tb-social {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tb-social a {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: var(--ink-2, #6b6b72);
  border-radius: 8px;
  transition: background 0.12s ease, color 0.12s ease;
}

.tb-social a:hover {
  color: var(--ink, #18181b);
  background: var(--line-2, #f1ede1);
}
</style>
