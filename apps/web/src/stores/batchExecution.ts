import { computed, ref } from "vue";
import { defineStore } from "pinia";

export type BatchItemStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type BatchMode = "generate" | "optimize";
export type BatchItem = {
  /** 队列条目唯一 id：同一节点可重复入队，每条独立计数、独立执行 */
  id: string;
  nodeId: string;
  label: string;
  nodeType: "image" | "video";
  status: BatchItemStatus;
};
export type BatchItemInput = Omit<BatchItem, "id"> & { id?: string };

let batchItemSeq = 0;
function stampIds(nextItems: BatchItemInput[]): BatchItem[] {
  return nextItems.map(item => ({ ...item, id: item.id ?? `batch-${++batchItemSeq}` }));
}

// ACT: 生成与优化各用一个独立 store，两种批量可同时进行，互不阻塞。
function batchSetup(mode: BatchMode) {
  return () => {
    const items = ref<BatchItem[]>([]);
    const concurrency = ref(1);
    const perNodeBatch = ref(1);
    const active = ref(false);
    const dialogVisible = ref(false);
    const running = computed(() => items.value.some(item => item.status === "running"));
    const queuedCount = computed(() => items.value.filter(item => item.status === "queued").length);
    const doneCount = computed(() => items.value.filter(item => item.status === "done" || item.status === "failed").length);
    const total = computed(() => items.value.length);

    function openDialog(nextItems: BatchItemInput[]) {
      items.value = stampIds(nextItems);
      dialogVisible.value = true;
    }

    // 不按节点去重：正在执行或已完成的节点也能再次追加到队尾，轮到时再执行一次。
    function appendItems(nextItems: BatchItemInput[]) {
      const added = stampIds(nextItems);
      items.value.push(...added);
      return added.length;
    }

    function reset() {
      items.value = [];
      active.value = false;
      dialogVisible.value = false;
    }

    return {
      items, mode, concurrency, perNodeBatch, active, dialogVisible, running, queuedCount, doneCount, total,
      openDialog, appendItems, reset,
    };
  };
}

export const useBatchGenerationStore = defineStore("batchGeneration", batchSetup("generate"));
export const useBatchOptimizeStore = defineStore("batchOptimization", batchSetup("optimize"));
