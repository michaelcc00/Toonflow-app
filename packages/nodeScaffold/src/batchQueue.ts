import { computed, reactive } from "vue";
import { useNodeId, useVueFlow } from "@vue-flow/core";

export type BatchQueueMode = "generate" | "optimize";
export type BatchQueueInfo = { position: number; total: number; mode: BatchQueueMode };

// 节点排队遮罩点击时打开对应模式的批量弹窗；节点与画布分属不同包，用 window 事件通信，detail 带模式区分生成/优化。
export const batchDialogEvent = "toonflow:openBatchDialog";
export function openBatchDialog(mode: BatchQueueMode = "generate") {
  window.dispatchEvent(new CustomEvent(batchDialogEvent, { detail: { mode } }));
}

// 挂在共享画布实例上，让独立 UMD 共用；排队信息是临时状态，不进入画布 JSON。
const batchQueueKey = Symbol.for("toonflow.batchQueue");

type BatchQueueHost = ReturnType<typeof useVueFlow> & {
  [batchQueueKey]?: Map<string, BatchQueueInfo>;
};

export function getBatchQueueMap(flow: ReturnType<typeof useVueFlow>) {
  const host = flow as BatchQueueHost;
  if (!host[batchQueueKey]) Object.defineProperty(host, batchQueueKey, { value: reactive(new Map<string, BatchQueueInfo>()) });
  return host[batchQueueKey]!;
}

// 节点组件读取自身的排队信息；未排队时返回 undefined。
export function useBatchQueue(nodeId = useNodeId(), flow = useVueFlow()) {
  const map = getBatchQueueMap(flow);
  return computed(() => (nodeId ? map.get(nodeId) : undefined));
}
