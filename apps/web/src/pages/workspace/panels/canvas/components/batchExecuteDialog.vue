<template>
  <el-dialog
    v-model="store.dialogVisible"
    :title="store.mode === 'optimize' ? '批量优化提示词' : '批量执行'"
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
          :draggable="canEditItem(item)"
          @dragstart="onDragStart(index, item)"
          @dragover.prevent="onDragOver(index, item)"
          @dragend="onDragEnd"
          @drop="onDrop">
          <icon-grip-vertical v-if="canEditItem(item)" class="dragHandle" :size="16" aria-hidden="true" />
          <span class="batchIndex">{{ index + 1 }}</span>
          <span class="batchLabel">{{ item.label }}</span>
          <el-tag size="small" :type="item.nodeType === 'image' ? 'success' : 'warning'">{{ item.nodeType === "image" ? "图片" : "视频" }}</el-tag>
          <span class="batchStatus" :class="item.status">{{ statusTexts[item.status] }}</span>
          <el-button v-if="canEditItem(item)" text type="danger" size="small" :icon="IconTrash" :aria-label="`移除 ${item.label}`" @click="removeItem(index)" />
        </div>
        <el-empty v-if="!store.items.length" description="暂无可批量执行的节点" />
      </div>
      <div v-if="store.active" class="batchAdd">
        <el-select v-model="selectedAddIds" multiple filterable clearable placeholder="选择要追加的节点" aria-label="选择要追加的节点">
          <el-option v-for="item in candidateItems" :key="item.nodeId" :label="item.label" :value="item.nodeId" />
        </el-select>
        <el-button type="primary" :disabled="!selectedAddIds.length" @click="addSelectedItems">添加到队列</el-button>
      </div>
      <div class="batchSettings">
        <span class="settingsLabel">并发数量</span>
        <el-input-number v-model="store.concurrency" :min="1" :max="10" :disabled="store.active" aria-label="并发数量" />
        <el-text type="info" size="small">同时执行的节点数</el-text>
      </div>
      <div v-if="store.mode === 'generate'" class="batchSettings">
        <span class="settingsLabel">每个节点执行批次</span>
        <el-select v-model="store.perNodeBatch" :disabled="store.active" aria-label="每个节点执行批次" style="width: 120px">
          <el-option v-for="n in 5" :key="n" :label="`${n}`" :value="n" />
        </el-select>
        <el-text type="info" size="small">批量执行时每个节点生成次数，不影响单独生成</el-text>
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
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElDialog, ElEmpty, ElInputNumber, ElOption, ElProgress, ElSelect, ElTag, ElText } from "element-plus";
import { IconGripVertical, IconTrash } from "@tabler/icons-vue";
import { batchDialogEvent, getBatchQueueMap } from "@toonflow/nodes-scaffold/runtime";
import { useNodeToolsContext } from "@toonflow/nodes-scaffold/nodeTools";
import { useBatchGenerationStore, useBatchOptimizeStore, type BatchItem, type BatchMode } from "@/stores/batchExecution";

const props = defineProps<{ mode: BatchMode }>();
const store = (props.mode === "optimize" ? useBatchOptimizeStore : useBatchGenerationStore)();
const flow = useVueFlow();
const toolsContext = useNodeToolsContext()();
const queueMap = getBatchQueueMap(flow);
const dragIndex = ref(-1);
const selectedAddIds = ref<string[]>([]);
let cancelled = false;
let managesExecution = false;
let executionId = 0;
let activeWorkers = 0;
let currentBatchCount = 1;
let currentConcurrency = 1;
const statusTexts = { queued: "排队中", running: "执行中", done: "已完成", failed: "失败", cancelled: "已取消" } as const;
const hasPending = computed(() => store.items.some(item => item.status === "queued" || item.status === "running"));
const candidateItems = computed<BatchItem[]>(() => {
  const existingIds = new Set(store.items.map(item => item.nodeId));
  const seen = new Set<string>();
  return flow.getNodes.value.flatMap(node => {
    if (existingIds.has(node.id) || seen.has(node.id)) return [];
    const nodeType = node.type === "remote-imageGenerationNode" && store.mode === "generate" ? "image"
      : node.type === "remote-videoGenerationNode" ? "video" : undefined;
    if (!nodeType) return [];
    seen.add(node.id);
    return [{ nodeId: node.id, label: String(node.data?.label ?? node.label ?? node.id), nodeType, status: "queued" as const }];
  });
});

function canEditItem(item: BatchItem) {
  // 执行中只允许调整还没开始的队列项；正在执行的节点锁定。
  return !store.active || item.status === "queued";
}

function removeItem(index: number) {
  const item = store.items[index];
  if (!item || !canEditItem(item)) return;
  store.items.splice(index, 1);
  refreshQueueOverlays();
}

function addSelectedItems() {
  const candidates = new Map(candidateItems.value.map(item => [item.nodeId, item]));
  const nextItems = selectedAddIds.value.flatMap(nodeId => {
    const item = candidates.get(nodeId);
    return item ? [{ ...item }] : [];
  });
  if (!nextItems.length) return;
  store.appendItems(nextItems);
  selectedAddIds.value = [];
  refreshQueueOverlays();
  ensureWorkers();
}

function closeDialog() {
  // 全部完成后关闭即清理状态，右上角图标消失；设置阶段关闭只隐藏弹窗。
  if (store.active) {
    cancelled = true;
    managesExecution = false;
    executionId++;
    activeWorkers = 0;
    store.reset();
  } else store.dialogVisible = false;
  refreshQueueOverlays();
}

function onOpenRequest(event: Event) {
  // 生成与优化两个弹窗都监听同一事件，只响应自己模式的打开请求。
  const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
  if (mode && mode !== store.mode) return;
  store.dialogVisible = true;
}

onMounted(() => {
  window.addEventListener(batchDialogEvent, onOpenRequest);
});
onScopeDispose(() => {
  window.removeEventListener(batchDialogEvent, onOpenRequest);
});

watch(
  () => store.items.map(item => `${item.nodeId}:${item.status}`).join("|"),
  () => {
    refreshQueueOverlays();
    ensureWorkers();
  },
);

function refreshQueueOverlays() {
  // 只维护自己模式的排队遮罩，另一个模式的批量可能同时在跑，不能清掉它的。
  for (const [key, info] of [...queueMap.entries()]) if (info.mode === store.mode) queueMap.delete(key);
  // ACT: 遮罩只在执行中显示；设置阶段拖动排序也不画遮罩。
  if (!store.active) return;
  const total = store.items.length;
  store.items.forEach((item, index) => {
    if (item.status === "queued") queueMap.set(item.nodeId, { position: index + 1, total, mode: store.mode });
  });
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function waitForNodeDone(nodeId: string, runId: number) {
  while (!cancelled && runId === executionId) {
    await sleep(2000);
    if (cancelled || runId !== executionId) return;
    const result = await toolsContext.call({ nodeId, name: "node:getGenerationStatus", args: {} }) as { status: string; error?: string };
    if (result.status === "succeeded") return;
    if (result.status === "failed") throw new Error(result.error || "生成失败");
  }
}

async function waitForOptimizeDone(nodeId: string, runId: number) {
  while (!cancelled && runId === executionId) {
    await sleep(2000);
    if (cancelled || runId !== executionId) return;
    const result = await toolsContext.call({ nodeId, name: "node:getOptimizeStatus", args: {} }) as { status: string; error?: string };
    if (result.status === "succeeded") return;
    if (result.status === "failed") throw new Error(result.error || "提示词优化失败");
  }
}

async function runWorker(runId: number) {
  while (!cancelled && runId === executionId && store.active) {
    const item: BatchItem | undefined = store.items.find(item => item.status === "queued");
    if (!item) return;
    store.setStatus(item.nodeId, "running");
    refreshQueueOverlays();
    try {
      if (store.mode === "optimize") {
        try {
          await toolsContext.call({ nodeId: item.nodeId, name: "node:optimizePrompt", args: {} });
        } catch (error) {
          // 节点已在手动优化：不重复触发，等它跑完。
          if (!String((error as Error)?.message ?? "").includes("正在优化")) throw error;
        }
        await waitForOptimizeDone(item.nodeId, runId);
      } else {
        try {
          await toolsContext.call({ nodeId: item.nodeId, name: item.nodeType === "image" ? "node:generateImage" : "node:generateVideo", args: { batchCount: currentBatchCount } });
        } catch (error) {
          // 节点已在手动生成：不重复触发，等它跑完。
          if (!String((error as Error)?.message ?? "").includes("正在生成")) throw error;
        }
        await waitForNodeDone(item.nodeId, runId);
      }
      if (cancelled || runId !== executionId) return;
      store.setStatus(item.nodeId, "done");
    } catch {
      if (cancelled || runId !== executionId) return;
      store.setStatus(item.nodeId, "failed");
    }
    refreshQueueOverlays();
  }
}

function ensureWorkers() {
  if (!managesExecution || cancelled || !store.active) return;
  const runId = executionId;
  const workerCount = Math.max(1, Math.floor(currentConcurrency) || 1);
  while (activeWorkers < workerCount && store.items.some(item => item.status === "queued")) {
    activeWorkers++;
    void runWorker(runId).finally(() => {
      if (runId !== executionId) return;
      activeWorkers = Math.max(0, activeWorkers - 1);
      ensureWorkers();
    });
  }
}

function startBatch() {
  if (store.active || !store.items.length) return;
  managesExecution = true;
  executionId++;
  activeWorkers = 0;
  cancelled = false;
  // ACT: 本轮的批次与并发在开始时定格，执行中追加的节点沿用同一设置。
  currentBatchCount = Math.min(5, Math.max(1, Math.floor(store.perNodeBatch) || 1));
  currentConcurrency = Math.max(1, Math.floor(store.concurrency) || 1);
  store.active = true;
  store.items.forEach(item => { item.status = "queued"; });
  refreshQueueOverlays();
  // ACT: 确定后关闭弹窗，执行在后台继续；右上角图标可重新打开。
  store.dialogVisible = false;
  ensureWorkers();
}

function cancelBatch() {
  cancelled = true;
  managesExecution = false;
  executionId++;
  activeWorkers = 0;
  store.items.forEach(item => { if (item.status === "queued") item.status = "cancelled"; });
  refreshQueueOverlays();
  store.active = false;
  store.dialogVisible = false;
}

function onClosed() {
  // 关闭弹窗不中断执行；正在执行的节点继续，排队遮罩由引擎维护；未开始时清掉拖动产生的遮罩。
  refreshQueueOverlays();
}

function onDragStart(index: number, item: BatchItem) {
  if (!canEditItem(item)) return;
  dragIndex.value = index;
}

function onDragOver(index: number, target: BatchItem) {
  if (dragIndex.value < 0 || dragIndex.value === index) return;
  const movedItem = store.items[dragIndex.value];
  if (!movedItem || !canEditItem(movedItem) || !canEditItem(target)) return;
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

  .batchAdd {
    display: flex;
    align-items: center;
    gap: 10px;

    .el-select { flex: 1; }
    .el-button { flex-shrink: 0; }
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
