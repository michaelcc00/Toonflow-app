<template>
  <el-dialog
    v-model="visible"
    title="抽帧"
    width="760px"
    top="6vh"
    appendToBody
    destroyOnClose
    :closeOnClickModal="!extracting"
    :closeOnPressEscape="!extracting"
    :showClose="!extracting"
    :style="{ maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(94vh - 12px)', overflow: 'auto' }">
    <div class="frameExtractPanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <video ref="preview" class="extractPreview" :src="src" controls playsinline preload="metadata" aria-label="抽帧预览" @loadedmetadata="readDuration" @error="duration = 0" />
      <div class="windowSelector">
        <span class="windowLabel">抽帧区间（1 秒）</span>
        <el-button :icon="IconArrowLeft" circle size="small" :disabled="extracting || !duration || windowStart <= 0" aria-label="前移一秒" @click="stepWindow(-1)" />
        <el-slider
          v-model="windowStart"
          :min="0"
          :max="maxWindowStart"
          :step="0.1"
          :disabled="extracting || !duration"
          aria-label="抽帧区间开始时间"
          @change="extractFrames" />
        <el-button :icon="IconArrowRight" circle size="small" :disabled="extracting || !duration || windowStart >= maxWindowStart" aria-label="后移一秒" @click="stepWindow(1)" />
        <span class="windowTime">{{ windowStart.toFixed(1) }}s – {{ Math.min(duration, windowStart + 1).toFixed(1) }}s</span>
      </div>
      <div v-if="extracting" class="extractingStatus" role="status">
        <el-progress :percentage="extractProgress" />
        <span>正在抽取视频帧…</span>
      </div>
      <div v-else-if="frames.length" class="frameGrid">
        <div
          v-for="(frame, index) in frames"
          :key="index"
          class="frameCell"
          :class="{ selected: selected.has(index) }"
          @click="toggleSelect(index)">
          <img :src="frame.url" alt="" draggable="false" />
          <span class="frameTime">{{ frame.time.toFixed(2) }}s</span>
          <span v-if="selected.has(index)" class="checkMark">✓</span>
        </div>
      </div>
      <p v-else class="actionHint">拖动滑块选择 1 秒区间，自动抽取该区间内的视频帧。</p>
      <div class="panelActions">
        <el-button :disabled="extracting" @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="extracting || creating || !selected.size" @click="confirm">
          确定（{{ selected.size }} 张）
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElMessage, ElProgress, ElSlider } from "element-plus";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/runtime";

const { src, label = "节点视频" } = defineProps<{ src: string; label?: string }>();

const visible = ref(false);
const preview = ref<HTMLVideoElement>();
const duration = ref(0);
const maxWindowStart = ref(0);
const windowStart = ref(0);
const extracting = ref(false);
const extractProgress = ref(0);
const creating = ref(false);
const frames = ref<{ url: string; time: number; blob: Blob }[]>([]);
const selected = ref<Set<number>>(new Set());

const { node } = useNode();
const { addNodes, getNodes, findNode, nodeTypes } = useVueFlow();
const files = useNodeFiles();

function open() {
  frames.value = [];
  selected.value = new Set();
  windowStart.value = 0;
  duration.value = 0;
  visible.value = true;
}

function readDuration() {
  const value = preview.value?.duration ?? 0;
  duration.value = Number.isFinite(value) ? value : 0;
  maxWindowStart.value = Math.max(0, duration.value - 1);
  windowStart.value = maxWindowStart.value;
  void nextTick(() => extractFrames());
}

function toggleSelect(index: number) {
  const next = new Set(selected.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  selected.value = next;
}

function stepWindow(direction: 1 | -1) {
  windowStart.value = Math.min(maxWindowStart.value, Math.max(0, Math.round((windowStart.value + direction) * 10) / 10));
  extractFrames();
}

async function extractFrames() {
  if (!duration.value || extracting.value) return;
  extracting.value = true;
  extractProgress.value = 0;
  frames.value = [];
  selected.value = new Set();
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = src;
  const FRAME_COUNT = 10;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("视频加载失败"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("视频帧尚未就绪");
    const start = windowStart.value;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const time = Math.min(start + (i / FRAME_COUNT), duration.value - 0.01);
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        const onError = () => { video.removeEventListener("seeked", onSeeked); reject(new Error("定位失败")); };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(value => value ? resolve(value) : reject(new Error("截图生成失败")), "image/png"));
      frames.value.push({ url: URL.createObjectURL(blob), time, blob });
      extractProgress.value = Math.round(((i + 1) / FRAME_COUNT) * 100);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "抽帧失败");
  } finally {
    video.removeAttribute("src");
    video.load();
    extracting.value = false;
  }
}

async function confirm() {
  if (!selected.value.size || creating.value) return;
  if (!nodeTypes?.value?.["remote-imageNode"]) return void ElMessage.error("请先启用图片节点插件");
  creating.value = true;
  const indices = [...selected.value].sort((a, b) => a - b);
  try {
    const workspace = files.getWorkspaceFiles();
    const x = node.computedPosition.x + node.dimensions.width + 40;
    let y = node.computedPosition.y;
    for (const index of indices) {
      const frame = frames.value[index];
      if (!frame) continue;
      const id = crypto.randomUUID();
      const path = await files.uploadFile(id, new File([frame.blob], "frame.png", { type: "image/png" }));
      const width = 240 * 16 / 9 + 18;
      for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
        const position = other.computedPosition;
        if (position.x < x + width && position.x + other.dimensions.width > x && position.y < y + 300 && position.y + other.dimensions.height > y) {
          y = position.y + other.dimensions.height + 24;
        }
      }
      addNodes({
        id,
        type: "remote-imageNode",
        position: { x, y },
        data: {
          label: `${node.data.label || label} · ${frame.time.toFixed(2)}s`,
          outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } },
        },
      });
      y += 324;
    }
    ElMessage.success(`已创建 ${indices.length} 个图片节点`);
    visible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "创建节点失败");
  } finally {
    creating.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped lang="scss">
.frameExtractPanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.extractPreview {
  width: 100%;
  max-height: 320px;
  background: #000;
  border-radius: 8px;
}
.windowSelector {
  display: flex;
  align-items: center;
  gap: 12px;
  .windowLabel { white-space: nowrap; font-size: 13px; }
  .el-slider { flex: 1; }
  .windowTime { white-space: nowrap; font-size: 12px; color: var(--el-text-color-secondary); }
}
.extractingStatus {
  display: flex;
  align-items: center;
  gap: 12px;
  .el-progress { flex: 1; }
}
.frameGrid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.frameCell {
  position: relative;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
  .frameTime {
    position: absolute;
    bottom: 2px;
    right: 4px;
    font-size: 10px;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .checkMark {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--el-color-primary);
    color: #fff;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  &.selected { border-color: var(--el-color-primary); }
}
.actionHint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 24px 0;
}
.panelActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
