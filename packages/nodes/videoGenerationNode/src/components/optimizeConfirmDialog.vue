<template>
  <el-dialog v-model="visible" title="确认优化后的提示词" width="min(720px, calc(100vw - 32px))" alignCenter appendToBody :closeOnClickModal="false">
    <div class="optimizeConfirm">
      <el-segmented v-model="tab" :options="[{ label: '优化后', value: 'optimized' }, { label: '原始', value: 'original' }]" aria-label="切换查看原始或优化后文本" />
      <div v-if="tab === 'optimized'" class="promptPreview" aria-label="优化后的提示词">
        <template v-for="(part, index) in renderedParts" :key="index">
          <span v-if="part.type === 'text'" class="previewText">{{ part.text }}</span>
          <span v-else class="pictureChip" :title="part.label">
            <img v-if="part.src" :src="part.src" alt="" draggable="false" />
            <span>{{ part.label }}</span>
          </span>
        </template>
      </div>
      <div v-else class="promptPreview" aria-label="原始提示词">
        <span class="previewText">{{ original }}</span>
      </div>
      <el-input
        v-model="edited"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 14 }"
        placeholder="可直接修改优化后的提示词"
        aria-label="编辑优化后的提示词" />
      <p class="hint">确认后将使用上方编辑框中的文本生成视频。</p>
    </div>
    <template #footer>
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :disabled="!edited.trim()" @click="emit('confirm', edited)">确认生成</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElDialog, ElInput, ElSegmented } from "element-plus";

const props = defineProps<{
  original: string;
  optimized: string;
  images: { src?: string; label: string }[];
}>();
const emit = defineEmits<{ confirm: [prompt: string]; cancel: [] }>();

const visible = defineModel<boolean>({ default: false });
const tab = ref<"optimized" | "original">("optimized");
const edited = ref("");

watch(visible, (value) => {
  if (value) {
    tab.value = "optimized";
    edited.value = props.optimized;
  }
});

const renderedParts = computed(() => {
  const parts: ({ type: "text"; text: string } | { type: "picture"; src?: string; label: string })[] = [];
  const text = tab.value === "optimized" ? edited.value : props.original;
  for (const token of text.split(/(<[Pp]icture \d+>)/g)) {
    const match = /^<[Pp]icture (\d+)>$/.exec(token);
    if (!match) {
      if (token) parts.push({ type: "text", text: token });
      continue;
    }
    const image = props.images[Number(match[1]) - 1];
    parts.push({ type: "picture", src: image?.src, label: `<Picture ${match[1]}>` });
  }
  return parts;
});
</script>

<style scoped lang="scss">
.optimizeConfirm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  .promptPreview {
    max-height: 320px;
    overflow-y: auto;
    padding: 12px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.7;
    .previewText {
      color: var(--el-text-color-primary);
    }
    .pictureChip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0 2px;
      padding: 2px 8px 2px 2px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      background: var(--el-fill-color-light);
      vertical-align: middle;
      font-size: 12px;
      img {
        width: 28px;
        height: 28px;
        object-fit: cover;
        border-radius: 4px;
      }
    }
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}
</style>
