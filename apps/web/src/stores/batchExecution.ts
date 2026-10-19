import { computed, ref } from "vue";
import { defineStore } from "pinia";

export type BatchItemStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type BatchItem = {
  nodeId: string;
  label: string;
  nodeType: "image" | "video";
  status: BatchItemStatus;
};

export const useBatchExecutionStore = defineStore("batchExecution", () => {
  const items = ref<BatchItem[]>([]);
  const concurrency = ref(1);
  const perNodeBatch = ref(1);
  const active = ref(false);
  const dialogVisible = ref(false);
  const running = computed(() => items.value.some(item => item.status === "running"));
  const queuedCount = computed(() => items.value.filter(item => item.status === "queued").length);
  const doneCount = computed(() => items.value.filter(item => item.status === "done" || item.status === "failed").length);
  const total = computed(() => items.value.length);

  function openDialog(nextItems: BatchItem[]) {
    items.value = nextItems;
    dialogVisible.value = true;
  }

  function setStatus(nodeId: string, status: BatchItemStatus) {
    const item = items.value.find(item => item.nodeId === nodeId);
    if (item) item.status = status;
  }

  function reset() {
    items.value = [];
    active.value = false;
    dialogVisible.value = false;
  }

  return {
    items, concurrency, perNodeBatch, active, dialogVisible, running, queuedCount, doneCount, total,
    openDialog, setStatus, reset,
  };
});
