<template>
  <el-dialog
    v-model="store.dialogVisible"
    title="批量执行"
    width="min(640px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    :closeOnClickModal="false"
    @closed="onClosed">
    <div class="batchExecute">
      <div v-if="store.active && hasPending" class="batchRunningBanner" aria-live="polite">
        <span class="runningDot" aria-hidden="true" />
        <span class="runningText">正在执行中</span>
        <span class="runningProgress">已完成 {{ store.doneCount }}/{{ store.total }}</span>
        <el-progress class="runningBar" :percentage="Math.round(store.total ? (store.doneCount / store.total) * 100 : 0)" :showText="false" />
      </div>
      <div class="batchList">
        <div
          v-for="(item, index) in store.items"
          :key="item.nodeId"
          class="batchRow"
          :class="{ dragging: dragIndex === index, running: item.status === 'running' }"
          :draggable="!store.active"
          @dragstart="onDragStart(index)"
          @dragover.prevent="onDragOver(index)"
          @dragend="onDragEnd"
          @drop="onDrop">
          <icon-grip-vertical v-if="!store.active" class="dragHandle" :size="16" aria-hidden="true" />
          <span class="batchIndex">{{ index + 1 }}</span>
          <span class="batchLabel">{{ item.label }}</span>
          <el-tag size="small" :type="item.nodeType === 'image' ? 'success' : 'warning'">{{ item.nodeType === "image" ? "图片" : "视频" }}</el-tag>
          <span class="batchStatus" :class="item.status">{{ statusTexts[item.status] }}</span>
          <el-button v-if="!store.active" text type="danger" size="small" :icon="IconTrash" :aria-label="`移除 ${item.label}`" @click="store.items.splice(index, 1)" />
        </div>
        <el-empty v-if="!store.items.length" description="暂无可批量执行的节点" />
      </div>
      <div class="batchSettings">
        <span class="settingsLabel">并发数量</span>
        <el-input-number v-model="store.concurrency" :min="1" :max="10" :disabled="store.active" aria-label="并发数量" />
        <el-text type="info" size="small">同时执行的节点数</el-text>
      </div>
    </div>
    <template #footer>
      <el-button v-if="store.active && hasPending" @click="cancelBatch">取消</el-button>
      <el-button v-else @click="closeDialog">关闭</el-button>
      <el-button v-if="!store.active" type="primary" :disabled="!store.items.length" @click="startBatch">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElEmpty, ElInputNumber, ElProgress, ElTag, ElText } from "element-plus";
import { IconGripVertical, IconTrash } from "@tabler/icons-vue";
import { batchDialogEvent, getBatchQueueMap } from "@toonflow/nodes-scaffold/runtime";
import { useNodeToolsContext } from "@toonflow/nodes-scaffold/nodeTools";
import { useBatchExecutionStore, type BatchItem } from "@/stores/batchExecution";

const store = useBatchExecutionStore();
const flow = useVueFlow();
const toolsContext = useNodeToolsContext()();
const queueMap = getBatchQueueMap(flow);
const dragIndex = ref(-1);
let cancelled = false;
const statusTexts = { queued: "排队中", running: "执行中", done: "已完成", failed: "失败", cancelled: "已取消" } as const;
const hasPending = computed(() => store.items.some(item => item.status === "queued" || item.status === "running"));

function closeDialog() {
  // 全部完成后关闭即清理状态，右上角图标消失；设置阶段关闭只隐藏弹窗。
  if (store.active) store.reset();
  else store.dialogVisible = false;
  refreshQueueOverlays();
}

function onOpenRequest() {
  store.dialogVisible = true;
}

onMounted(() => {
  window.addEventListener(batchDialogEvent, onOpenRequest);
});
onScopeDispose(() => {
  window.removeEventListener(batchDialogEvent, onOpenRequest);
});

function refreshQueueOverlays() {
  for (const key of [...queueMap.keys()]) queueMap.delete(key);
  // ACT: 遮罩只在执行中显示；设置阶段拖动排序也不画遮罩。
  if (!store.active) return;
  const total = store.items.length;
  store.items.forEach((item, index) => {
    if (item.status === "queued") queueMap.set(item.nodeId, { position: index + 1, total });
  });
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function waitForNodeDone(nodeId: string) {
  while (!cancelled) {
    await sleep(2000);
    if (cancelled) return;
    const result = await toolsContext.call({ nodeId, name: "node:getGenerationStatus", args: {} }) as { status: string; error?: string };
    if (result.status === "succeeded") return;
    if (result.status === "failed") throw new Error(result.error || "生成失败");
  }
}

async function runWorker() {
  while (!cancelled) {
    const item: BatchItem | undefined = store.items.find(item => item.status === "queued");
    if (!item) return;
    store.setStatus(item.nodeId, "running");
    refreshQueueOverlays();
    try {
      try {
        await toolsContext.call({ nodeId: item.nodeId, name: item.nodeType === "image" ? "node:generateImage" : "node:generateVideo", args: {} });
      } catch (error) {
        // 节点已在手动生成：不重复触发，等它跑完。
        if (!String((error as Error)?.message ?? "").includes("正在生成")) throw error;
      }
      await waitForNodeDone(item.nodeId);
      if (cancelled) return;
      store.setStatus(item.nodeId, "done");
    } catch {
      if (cancelled) return;
      store.setStatus(item.nodeId, "failed");
    }
    refreshQueueOverlays();
  }
}

async function startBatch() {
  if (store.active || !store.items.length) return;
  store.active = true;
  cancelled = false;
  store.items.forEach(item => { item.status = "queued"; });
  refreshQueueOverlays();
  // ACT: 确定后关闭弹窗，执行在后台继续；右上角图标可重新打开。
  store.dialogVisible = false;
  const workerCount = Math.min(Math.max(1, Math.floor(store.concurrency) || 1), store.items.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));
  refreshQueueOverlays();
}

function cancelBatch() {
  cancelled = true;
  store.items.forEach(item => { if (item.status === "queued") item.status = "cancelled"; });
  refreshQueueOverlays();
  store.active = false;
  store.dialogVisible = false;
}

function onClosed() {
  // 关闭弹窗不中断执行；正在执行的节点继续，排队遮罩由引擎维护；未开始时清掉拖动产生的遮罩。
  refreshQueueOverlays();
}

function onDragStart(index: number) {
  dragIndex.value = index;
}

function onDragOver(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return;
  const [moved] = store.items.splice(dragIndex.value, 1);
  store.items.splice(index, 0, moved);
  dragIndex.value = index;
  refreshQueueOverlays();
}

function onDragEnd() {
  dragIndex.value = -1;
}

function onDrop() {
  dragIndex.value = -1;
}
</script>

<style scoped lang="scss">
.batchExecute {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .batchRunningBanner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-size: 14px;
    font-weight: 600;

    .runningDot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--el-color-primary);
      animation: batchPulse 1.2s ease-in-out infinite;
    }

    .runningText { flex-shrink: 0; }
    .runningProgress { flex-shrink: 0; margin-left: auto; font-weight: 400; }
    .runningBar { flex: 1; min-width: 60px; }
  }

  .batchList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 50dvh;
    overflow-y: auto;

    .batchRow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      background: var(--el-bg-color);

      &.dragging { opacity: 0.5; }
      &.running { border-color: var(--el-color-primary); }

      .dragHandle {
        flex-shrink: 0;
        color: var(--el-text-color-secondary);
        cursor: grab;
      }

      .batchIndex {
        flex-shrink: 0;
        width: 20px;
        color: var(--el-text-color-secondary);
        font-size: 13px;
        text-align: center;
      }

      .batchLabel {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .batchStatus {
        flex-shrink: 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);

        &.running { color: var(--el-color-primary); }
        &.done { color: var(--el-color-success); }
        &.failed { color: var(--el-color-danger); }
      }
    }
  }

  .batchSettings {
    display: flex;
    align-items: center;
    gap: 10px;

    .settingsLabel { font-size: 14px; }
  }
}

@keyframes batchPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
