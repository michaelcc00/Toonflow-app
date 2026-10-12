<template>
  <el-popover trigger="click" placement="top-start" width="min(340px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px' }">
    <template #reference>
      <el-button class="settingsButton" text size="small" :disabled="disabled" aria-label="图片生成设置">
        <span class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ ratio }} · {{ size }} · 1张</span>
        <icon-chevron-up :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div class="generationSettings nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div class="sectionLabel">分辨率</div>
      <el-radio-group v-model="size" class="sizeOptions" :disabled="disabled" aria-label="图片分辨率">
        <el-radio-button v-for="item in sizes" :key="item" :value="item">{{ item }}</el-radio-button>
      </el-radio-group>
      <div class="sectionLabel">比例</div>
      <div class="ratioOptions" role="group" aria-label="图片比例">
        <el-button
          v-for="item in ratios"
          :key="item"
          class="ratioButton"
          :disabled="disabled"
          :aria-label="`比例 ${item}`"
          :aria-pressed="ratio === item"
          @click="ratio = item">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item }}</span>
          </span>
        </el-button>
      </div>
      <template v-if="showExtra">
        <div class="sectionLabel extraTitle">RunningHub 参数</div>
        <div class="extraRow">
          <span class="extraLabel">生成三视图</span>
          <el-switch v-model="threeView" :disabled="disabled" aria-label="是否生成三视图" />
        </div>
        <div class="extraRow">
          <span class="extraLabel">放大</span>
          <el-switch v-model="upscale" :disabled="disabled" aria-label="是否放大" />
        </div>
        <div class="extraRow">
          <span class="extraLabel">放大倍数</span>
          <el-select
            v-model="upscaleFactor"
            :disabled="disabled || !upscale"
            filterable
            allow-create
            class="extraSelect"
            placeholder="选择或输入"
            aria-label="放大倍数">
            <el-option v-for="item in scaleOptions" :key="item" :label="String(item)" :value="item" />
          </el-select>
        </div>
      </template>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ElButton, ElPopover, ElRadioGroup, ElRadioButton, ElSwitch, ElSelect, ElOption } from "element-plus";
import { IconChevronUp } from "@tabler/icons-vue";

defineProps<{ sizes: string[]; ratios: string[]; disabled?: boolean; showExtra?: boolean }>();
const size = defineModel<string>("size", { required: true });
const ratio = defineModel<string>("ratio", { required: true });
// RunningHub 专属参数（仅 showExtra 时展示）；经 input.other 透传给供应商，节点上的值优先于供应商配置。
const threeView = defineModel<boolean>("threeView", { default: false });
const upscale = defineModel<boolean>("upscale", { default: false });
const upscaleFactor = defineModel<number | string>("upscaleFactor", { default: 2 });
const scaleOptions = [1.5, 2, 3, 4];

function ratioStyle(value: string) {
  const [width = 1, height = 1] = value.split(":").map(Number);
  return { width: `${16 * Math.min(width / height, 1)}px`, height: `${16 * Math.min(height / width, 1)}px` };
}
</script>

<style scoped lang="scss">
.ratioShape {
  display: inline-block;
  flex-shrink: 0;
  border: 1px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}

.settingsButton {
  flex-shrink: 0;
  :deep(> span) { gap: 6px; }
}

.generationSettings {
  text-align: left;
  .sectionLabel {
    margin-bottom: 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
  }

  .sizeOptions {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
    .el-radio-button {
      flex: 1;
      --el-radio-button-checked-bg-color: var(--el-fill-color);
      --el-radio-button-checked-text-color: var(--el-text-color-primary);
      --el-radio-button-checked-border-color: var(--el-text-color-regular);

      :deep(.el-radio-button__inner) {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--el-border-color);
        border-radius: var(--el-border-radius-base);
        box-shadow: none;

        &:hover { color: var(--el-text-color-primary); }
      }

      &.is-active :deep(.el-radio-button__inner) {
        border-color: var(--el-text-color-regular);
      }
    }
  }

  .ratioOptions {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;

    .ratioButton {
      height: 60px;
      margin: 0;
      padding: 8px 4px;
      color: var(--el-text-color-secondary);
      --el-button-bg-color: var(--el-fill-color-light);
      --el-button-hover-bg-color: var(--el-fill-color);
      --el-button-hover-text-color: var(--el-text-color-primary);
      --el-button-hover-border-color: var(--el-border-color-darker);

      &[aria-pressed="true"] {
        color: var(--el-text-color-primary);
        border-color: var(--el-text-color-regular);
        background: var(--el-fill-color);
      }

      .ratioContent {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
    }
  }

  .extraTitle { margin-top: 14px; }
  .extraRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    .extraLabel {
      color: var(--el-text-color-primary);
      font-size: 13px;
    }
    .extraSelect { width: 130px; }
  }
}
</style>
