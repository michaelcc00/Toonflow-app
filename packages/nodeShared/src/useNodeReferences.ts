import { computed, ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import { useNodeEvent } from "@toonflow/nodes-scaffold/nodeEvent";
import type { NodeInputValue } from "@toonflow/nodes-scaffold/values";

export function useNodeReferences(handleId = "in", options?: { goohaiLabels?: boolean }) {
  const { id, node } = useNode<NodeData & { referenceOrder?: Record<string, string[]> }>();
  const { removeEdges } = useVueFlow();
  const inputValues = ref<NodeInputValue[]>([]);
  const previews = ref(new Map<string, string>());
  const refList = computed({
    get() {
      const order = new Map(node.data.referenceOrder?.[handleId]?.map((key, index) => [key, index]));
      return [...inputValues.value].sort((a, b) => (order.get(referenceKey(a)) ?? order.size) - (order.get(referenceKey(b)) ?? order.size));
    },
    set(values: NodeInputValue[]) {
      node.data.referenceOrder = { ...node.data.referenceOrder, [handleId]: values.map(referenceKey) };
    },
  });
  const referenceMentions = computed(() => {
    // Goohai 式标签：按媒体类型独立编号（<Picture N>/<Video N>/<Audio N>）
    const counters: Record<string, number> = {};
    return refList.value.flatMap((item, index) => {
      if (typeof item.dataType !== "string" || !["IMAGE", "VIDEO", "AUDIO", "STRING"].includes(item.dataType)) return [];
      const base = {
        id: referenceKey(item),
        avatar: previews.value.get(referenceKey(item)) || undefined,
        mediaType: item.dataType,
      };
      if (options?.goohaiLabels && item.dataType !== "STRING") {
        counters[item.dataType] = (counters[item.dataType] ?? 0) + 1;
        const n = counters[item.dataType]!;
        const label = item.dataType === "IMAGE" ? `<Picture ${n}>` : item.dataType === "VIDEO" ? `<Video ${n}>` : `<Audio ${n}>`;
        return [{ ...base, name: label, value: label }];
      }
      return [{ ...base, name: `参考 ${index + 1}`, value: `{{ref ${index + 1}}}` }];
    });
  });

  useNodeEvent().on(`input:${handleId}`, (values) => {
    inputValues.value = values;
    const ids = new Set(values.filter(item => item.dataType === "IMAGE" || item.dataType === "VIDEO").map(referenceKey));
    for (const key of previews.value.keys()) {
      if (!ids.has(key)) previews.value.delete(key);
    }
  });

  function setReferencePreview(item: NodeInputValue, url: string) {
    previews.value.set(referenceKey(item), url);
  }

  function removeReference(item: NodeInputValue) {
    removeEdges(edges => edges.filter(edge =>
      edge.target === id && edge.targetHandle === handleId && edge.source === item.source && edge.sourceHandle === item.sourceHandle
    ));
  }

  return { refList, referenceMentions, setReferencePreview, removeReference };
}

function referenceKey(item: NodeInputValue) {
  return encodeURIComponent(JSON.stringify([item.source, item.sourceHandle]));
}
