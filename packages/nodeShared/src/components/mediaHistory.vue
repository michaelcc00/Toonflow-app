<template>
  <el-button :icon="IconHistory" :disabled="disabled" text title="历史记录" aria-label="历史记录" @click.stop="visible = true">历史记录</el-button>
  <el-dialog v-model="visible" :title="`${mediaType === 'image' ? '图片' : '视频'}历史记录`" width="min(760px, calc(100vw - 32px))" appendToBody destroyOnClose>
    <div v-loading="loading" class="mediaHistory nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <el-empty v-else-if="!loading && !items.length" description="暂无历史记录" />
      <template v-else-if="items.length">
        <div class="historyContent">
          <div class="historyList" aria-label="历史文件">
            <div
              v-for="item in pageItems"
              :key="item.url"
              class="historyItem"
              role="button"
              tabindex="0"
              :class="{ selected: selected?.url === item.url }"
              :aria-pressed="selected?.url === item.url"
              :title="item.url"
              @click="selected = item"
              @keydown.enter="selected = item"
              @keydown.space.prevent="selected = item">
              <span class="fileName">{{ item.url.split('/').at(-1) }}</span>
              <span v-if="isCurrent(item)" class="currentLabel">当前结果</span>
              <el-button
                v-if="!isCurrent(item)"
                class="deleteBtn"
                text
                type="danger"
                size="small"
                :icon="IconTrash"
                :loading="deletingUrl === item.url"
                aria-label="删除该历史文件"
                @click.stop="deleteItem(item)" />
            </div>
          </div>
          <div class="historyPreview" v-loading="!!selected && !previewReady && !previewError">
            <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" />
            <img v-else-if="previewUrl && mediaType === 'image'" class="previewImage" :src="previewUrl" alt="历史图片预览，点击放大" title="点击放大" @load="previewReady = true" @error="previewError = '无法预览该图片'" @click="openViewer" />
            <video v-else-if="previewUrl" :src="previewUrl" controls playsinline preload="auto" aria-label="历史视频预览" @loadeddata="previewReady = true" @error="previewError = '无法预览该视频'" />
          </div>
        </div>
        <el-pagination v-model:currentPage="page" :pageSize="pageSize" :total="items.length" layout="prev, pager, next" hideOnSinglePage />
      </template>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :disabled="disabled || loading || !selected || !previewUrl || !previewReady || !!previewError" @click="selectOutput">设为当前结果</el-button>
    </template>
  </el-dialog>
  <el-dialog v-model="viewerVisible" fullscreen appendToBody destroyOnClose :showClose="false" class="historyViewerDialog">
    <div class="historyViewer">
      <div class="viewerTop">
        <span class="viewerName">{{ viewerItem?.url.split("/").at(-1) }}</span>
        <span class="viewerIndex">{{ viewerIndex + 1 }} / {{ items.length }}</span>
        <el-button text :icon="IconZoomOut" aria-label="缩小" @click="viewerZoom = Math.max(0.2, viewerZoom - 0.25)" />
        <el-button text :icon="IconZoomIn" aria-label="放大" @click="viewerZoom = Math.min(5, viewerZoom + 0.25)" />
        <el-button text :icon="IconX" aria-label="关闭预览" @click="viewerVisible = false" />
      </div>
      <div class="viewerBody" @wheel.prevent="viewerZoom = Math.min(5, Math.max(0.2, viewerZoom + ($event.deltaY < 0 ? 0.25 : -0.25)))">
        <el-button class="navArrow" circle :icon="IconChevronLeft" :disabled="viewerIndex <= 0" aria-label="上一张" @click="viewerPrev" />
        <img v-if="viewerUrl" class="viewerImage" :src="viewerUrl" :style="{ transform: `scale(${viewerZoom})` }" alt="历史图片放大预览" draggable="false" />
        <el-button class="navArrow" circle :icon="IconChevronRight" :disabled="viewerIndex >= items.length - 1" aria-label="下一张" @click="viewerNext" />
      </div>
      <div class="viewerFooter">
        <el-button @click="viewerVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="disabled || !viewerItem" @click="viewerSelectOutput">设为当前结果</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useNode } from "@vue-flow/core";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElLoading, ElMessage, ElMessageBox, ElPagination } from "element-plus";
import { IconChevronLeft, IconChevronRight, IconHistory, IconTrash, IconX, IconZoomIn, IconZoomOut } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ mediaType: "image" | "video"; current?: NodeMediaValue; disabled?: boolean }>();
const emit = defineEmits<{ select: [value: NodeMediaValue] }>();
const vLoading = ElLoading.directive;
const { id } = useNode();
const files = useNodeFiles();
const visible = ref(false);
const loading = ref(false);
const loadError = ref("");
const previewError = ref("");
const previewReady = ref(false);
const items = ref<NodeMediaValue[]>([]);
const selected = ref<NodeMediaValue>();
const page = ref(1);
const pageSize = 20;
const deletingUrl = ref("");
const viewerVisible = ref(false);
const viewerItem = ref<NodeMediaValue>();
const viewerZoom = ref(1);
const viewerIndex = computed(() => Math.max(0, items.value.findIndex(item => item.url === viewerItem.value?.url)));
const pageItems = computed(() => items.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const mimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", apng: "image/apng", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg",
};
const previewFile = computed(() => visible.value ? selected.value : undefined);
watch(previewFile, () => { previewError.value = ""; }, { flush: "sync" });
// ACT: 目录列表仅保存路径，每页显示 20 条，只读取选中文件；海量目录需服务端分页时再扩展 list。
const previewUrl = files.useFileUrl(previewFile, () => { previewError.value = "历史文件读取失败，文件可能已被移动或删除"; });
const viewerUrl = files.useFileUrl(viewerItem, () => { viewerVisible.value = false; });
watch([previewFile, previewUrl], () => { previewReady.value = false; }, { flush: "sync" });

function openViewer() {
  viewerItem.value = selected.value;
  viewerZoom.value = 1;
  viewerVisible.value = true;
}

function viewerPrev() {
  if (viewerIndex.value > 0) {
    viewerItem.value = items.value[viewerIndex.value - 1];
    viewerZoom.value = 1;
  }
}

function viewerNext() {
  if (viewerIndex.value < items.value.length - 1) {
    viewerItem.value = items.value[viewerIndex.value + 1];
    viewerZoom.value = 1;
  }
}

function viewerSelectOutput() {
  if (!viewerItem.value || props.disabled) return;
  // ACT: 预览层已加载出这张图，直接提交，不走历史弹窗的 previewReady 检查（切图后 previewUrl 还没重新加载完）。
  emit("select", { ...viewerItem.value });
  viewerVisible.value = false;
  visible.value = false;
}

watch(viewerVisible, open => {
  if (!open) return;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") viewerPrev();
    else if (event.key === "ArrowRight") viewerNext();
    else if (event.key === "Escape") viewerVisible.value = false;
  };
  window.addEventListener("keydown", onKey);
  const stop = watch(viewerVisible, open => { if (!open) { window.removeEventListener("keydown", onKey); stop(); } });
});

watch(() => props.disabled, disabled => { if (disabled) visible.value = false; });
watch(visible, async (open, _previous, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  items.value = [];
  selected.value = undefined;
  loadError.value = "";
  page.value = 1;
  if (!open) return;
  loading.value = true;
  try {
    const { entries } = await files.getWorkspaceFiles().list(`assets/${id}`).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
      return { entries: [] };
    });
    if (cancelled) return;
    const results = new Map<string, NodeMediaValue>();
    for (const entry of entries) {
      const mimeType = mimeTypes[entry.name.split(".").at(-1)?.toLowerCase() ?? ""];
      if (entry.type === "file" && mimeType?.startsWith(`${props.mediaType}/`)) {
        const url = entry.path.replaceAll("\\", "/");
        results.set(url, { url, mimeType });
      }
    }
    // ACT: 副本使用新 ID，但当前结果仍可能引用原节点文件；只补当前结果，不继承原目录的全部历史。
    const current = props.current && { ...props.current, url: props.current.url.replaceAll("\\", "/") };
    if (current) results.set(current.url, current);
    items.value = [...results.values()].sort((left, right) => right.url.localeCompare(left.url, "zh-CN", { numeric: true }));
    selected.value = current ?? items.value[0];
    page.value = Math.floor(Math.max(0, items.value.findIndex(item => item.url === selected.value?.url)) / pageSize) + 1;
  } catch (error) {
    if (!cancelled) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      loadError.value = message || (error instanceof Error ? error.message : "历史记录读取失败");
    }
  } finally {
    if (!cancelled) loading.value = false;
  }
});

function selectOutput() {
  if (props.disabled || loading.value || !selected.value || !previewUrl.value || !previewReady.value || previewError.value) return;
  emit("select", { ...selected.value });
  visible.value = false;
}

function isCurrent(item: NodeMediaValue) {
  return !!props.current && item.url === props.current.url.replaceAll("\\", "/");
}

async function deleteItem(item: NodeMediaValue) {
  if (deletingUrl.value || isCurrent(item)) return;
  try {
    await ElMessageBox.confirm(`确定删除 ${item.url.split("/").at(-1)} 吗？删除后无法恢复。`, "删除历史文件", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  deletingUrl.value = item.url;
  try {
    await files.getWorkspaceFiles().remove(item.url);
    items.value = items.value.filter(entry => entry.url !== item.url);
    if (selected.value?.url === item.url) {
      selected.value = items.value[0];
      page.value = 1;
    } else {
      // ACT: 删掉末页最后一条时回到上一页，避免停留在空页。
      page.value = Math.min(page.value, Math.max(1, Math.ceil(items.value.length / pageSize)));
    }
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    ElMessage.error(message || (error instanceof Error ? error.message : "删除历史文件失败"));
  } finally {
    deletingUrl.value = "";
  }
}
</script>

<style scoped lang="scss">
.mediaHistory {
  min-height: 300px;

  .historyContent {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
    gap: 16px;

    .historyList {
      height: 360px;
      overflow: auto;

      .historyItem {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 10px;
        border: 1px solid transparent;
        border-radius: var(--el-border-radius-base);
        background: transparent;
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        &:hover { background: var(--el-fill-color-light); }
        &.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
        .fileName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .currentLabel { flex-shrink: 0; color: var(--el-color-primary); font-size: 12px; }
        .deleteBtn {
          flex-shrink: 0;
          margin-left: auto;
          padding: 2px;
          opacity: 0;
        }
        &:hover .deleteBtn, &:focus-within .deleteBtn { opacity: 1; }
      }
    }

    .historyPreview {
      display: grid;
      place-items: center;
      height: 360px;
      min-width: 0;
      background: var(--el-fill-color-light);
      border-radius: var(--el-border-radius-base);

      img, video { width: 100%; max-height: 360px; object-fit: contain; }
      .previewImage { cursor: zoom-in; }
    }
  }

  .el-pagination { justify-content: center; margin-top: 16px; }
}

.historyViewerDialog {
  // ACT: el-dialog 的 header/body 是 el-dialog 内部渲染的，scoped 样式必须用 :deep 才能命中；否则白字按钮落在白底上，看起来像没有箭头和按钮。
  :deep(.el-dialog) { background: rgba(0, 0, 0, 0.92); }
  :deep(.el-dialog__header) { display: none; }
  :deep(.el-dialog__body) { height: 100%; padding: 0; background: rgba(0, 0, 0, 0.92); }
  .historyViewer { display: flex; flex-direction: column; height: 100%; color: #fff; background: rgba(0, 0, 0, 0.92); }

  .viewerTop {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    .viewerName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .viewerIndex { color: rgba(255, 255, 255, 0.7); font-size: 13px; }
    .el-button { color: #fff; }
  }

  .viewerBody {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-height: 0;
    padding: 0 16px;
    overflow: hidden;
    .navArrow { flex-shrink: 0; color: #fff; background: rgba(255, 255, 255, 0.12); border: none; }
    .viewerImage { flex: 1; min-width: 0; max-height: 100%; object-fit: contain; transition: transform 0.15s ease; }
  }

  .viewerFooter { display: flex; justify-content: flex-end; gap: 12px; padding: 16px; }
}
</style>
