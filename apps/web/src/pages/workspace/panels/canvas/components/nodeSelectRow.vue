<template>
  <div class="nodeSelectRow" :class="{ selected }" @click="$emit('toggle', node)">
    <el-checkbox :modelValue="selected" aria-label="选择节点" @click.stop @change="$emit('toggle', node)" />
    <div
      class="thumbWrap"
      :class="{ clickable: !!thumbUrl }"
      :title="thumbUrl ? '点击查看' : undefined"
      @click.stop="onThumbClick">
      <img v-if="thumbUrl && thumbKind === 'image'" :src="thumbUrl" :alt="label" draggable="false" />
      <video v-else-if="thumbUrl && thumbKind === 'video'" :src="thumbUrl" muted preload="metadata" draggable="false" />
      <icon-photo v-else class="thumbPlaceholder" :size="28" aria-hidden="true" />
    </div>
    <div class="nodeInfo">
      <span class="nodeLabel">{{ label }}</span>
      <span class="nodeType">{{ typeLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { GraphNode } from "@vue-flow/core";
import { ElCheckbox } from "element-plus";
import { IconPhoto } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{
  node: GraphNode;
  selected: boolean;
  typeLabel: string;
}>();
const emit = defineEmits<{
  toggle: [node: GraphNode];
  preview: [node: GraphNode, url: string, kind: "image" | "video"];
}>();

const label = computed(() => String(props.node.data?.label ?? props.node.label ?? props.node.id));
const mediaOutput = computed(() => {
  const outputs = props.node.data?.outputs as Record<string, { dataType?: string; value?: NodeMediaValue }> | undefined;
  for (const output of Object.values(outputs ?? {})) {
    if ((output.dataType === "IMAGE" || output.dataType === "VIDEO") && output.value?.url) return output;
  }
  return undefined;
});
const thumbKind = computed(() => (mediaOutput.value?.dataType === "VIDEO" ? "video" : "image"));
const { useFileUrl } = useNodeFiles();
const thumbUrl = useFileUrl(computed(() => mediaOutput.value?.value), () => {});

function onThumbClick() {
  if (!thumbUrl.value) return;
  emit("preview", props.node, thumbUrl.value, thumbKind.value);
}
</script>

<style scoped lang="scss">
.nodeSelectRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;

  &:hover { border-color: var(--el-color-primary); }
  &.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }

  .thumbWrap {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--el-fill-color-light);

    &.clickable { cursor: zoom-in; }

    img, video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumbPlaceholder { color: var(--el-text-color-secondary); }
  }

  .nodeInfo {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    .nodeLabel {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nodeType {
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }
}
</style>
