<template>
  <div
    class="mergeVideoItem"
    draggable="true"
    @dragstart="$emit('dragstart', index)"
    @dragover.prevent="$emit('dragover', index)"
    @dragend="$emit('dragend')">
    <icon-grip-vertical class="dragHandle" :size="16" aria-hidden="true" />
    <span class="itemIndex">{{ index + 1 }}</span>
    <div class="thumbWrap">
      <video v-if="thumbUrl" :src="thumbUrl" muted preload="metadata" draggable="false" />
      <icon-video v-else class="thumbPlaceholder" :size="28" aria-hidden="true" />
    </div>
    <div class="itemInfo">
      <span class="itemLabel">{{ label }}</span>
      <span class="itemDuration">{{ durationText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconGripVertical, IconVideo } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import type { NodeInputValue, NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ item: NodeInputValue; index: number; label: string }>();
defineEmits<{ dragstart: [index: number]; dragover: [index: number]; dragend: [] }>();

const { useFileUrl } = useNodeFiles();
const mediaValue = computed(() => (props.item.dataType === "VIDEO" ? props.item.value as NodeMediaValue | undefined : undefined));
const thumbUrl = useFileUrl(mediaValue, () => {});
const durationText = ref("");
watch(thumbUrl, (url) => {
  durationText.value = "";
  if (!url) return;
  const video = document.createElement("video");
  video.preload = "metadata";
  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration) && video.duration > 0) durationText.value = `${video.duration.toFixed(1)}s`;
  };
  video.src = url;
});
</script>

<style scoped lang="scss">
.mergeVideoItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  cursor: grab;

  &:active { cursor: grabbing; }

  .dragHandle { flex-shrink: 0; color: var(--el-text-color-secondary); }
  .itemIndex { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 12px; }

  .thumbWrap {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 96px;
    height: 54px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--el-fill-color-light);

    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumbPlaceholder { color: var(--el-text-color-secondary); }
  }

  .itemInfo {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    .itemLabel {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .itemDuration {
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }
}
</style>
