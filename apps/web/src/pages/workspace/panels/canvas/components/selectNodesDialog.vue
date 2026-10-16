<template>
  <el-dialog
    v-model="visible"
    title="选择节点"
    width="min(780px, calc(100vw - 32px))"
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    @closed="reset">
    <div class="selectNodes">
      <el-input
        v-model="search"
        placeholder="搜索节点名称"
        clearable
        :prefixIcon="IconSearch"
        aria-label="搜索节点名称" />
      <el-tabs v-model="activeCategory" class="categoryTabs">
        <el-tab-pane :label="`全部（${candidateNodes.length}）`" name="all" />
        <el-tab-pane
          v-for="category in categories"
          :key="category.type"
          :label="`${category.label}（${category.count}）`"
          :name="category.type" />
      </el-tabs>
      <div class="nodeList" aria-label="节点列表">
        <nodeSelectRow
          v-for="node in filteredList"
          :key="node.id"
          :node="node"
          :selected="isSelected(node.id)"
          :typeLabel="typeLabel(node.type)"
          @toggle="toggleNode"
          @preview="onPreview" />
        <el-empty v-if="!filteredList.length" description="没有符合条件的节点" />
      </div>
      <div class="selectedSection">
        <div class="selectedHeader">
          <span>已选 {{ selectedNodes.length }} 个</span>
          <el-button v-if="selectedNodes.length" text type="danger" size="small" @click="selectedNodes = []">清空</el-button>
        </div>
        <div class="selectedList" aria-label="已选节点，拖动排序">
          <div
            v-for="(node, index) in selectedNodes"
            :key="node.id"
            class="selectedItem"
            draggable="true"
            @dragstart="onDragStart(index)"
            @dragover.prevent="onDragOver(index)"
            @dragend="onDragEnd">
            <icon-grip-vertical class="dragHandle" :size="16" aria-hidden="true" />
            <span class="selectedIndex">{{ index + 1 }}</span>
            <span class="selectedLabel">{{ node.label }}</span>
            <el-button text type="danger" size="small" :icon="IconX" aria-label="移除已选节点" @click="removeSelected(index)" />
          </div>
          <el-text v-if="!selectedNodes.length" type="info" size="small">点击上方节点加入选择</el-text>
        </div>
        <el-text type="info" size="small">确定后按顺序把线连接到所选节点的右边；取消勾选已连线的节点会断开连线</el-text>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
  <el-dialog
    v-model="previewVisible"
    :title="previewLabel"
    width="min(720px, calc(100vw - 32px))"
    appendToBody
    destroyOnClose>
    <div class="previewBody">
      <img v-if="previewKind === 'image'" :src="previewUrl" :alt="previewLabel" />
      <video v-else-if="previewKind === 'video'" :src="previewUrl" controls autoplay />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { ElButton, ElDialog, ElEmpty, ElInput, ElTabs, ElTabPane, ElText } from "element-plus";
import { IconGripVertical, IconSearch, IconX } from "@tabler/icons-vue";
import nodeSelectRow from "./nodeSelectRow.vue";

const props = defineProps<{
  pendingNodeId?: string;
  pendingHandleId?: string;
  remoteNodes: { type: string; label: string }[];
}>();
const emit = defineEmits<{ confirm: [nodeIds: string[]] }>();
const visible = defineModel<boolean>("visible");
const flow = useVueFlow();
const search = ref("");
const activeCategory = ref("all");
const selectedNodes = ref<{ id: string; label: string }[]>([]);
const previewVisible = ref(false);
const previewUrl = ref("");
const previewKind = ref<"image" | "video">("image");
const previewLabel = ref("");
const dragIndex = ref(-1);

const candidateNodes = computed(() => {
  const nodes = flow.getNodes.value.filter(node => {
    if (node.hidden || node.type === "canvasGroup" || node.id === props.pendingNodeId) return false;
    return true;
  });
  return [...nodes].sort((left, right) => String(left.data?.label ?? left.label ?? left.id).localeCompare(String(right.data?.label ?? right.label ?? right.id)));
});
// ACT: 已连到该端口的节点，按连线（边数组）顺序排列。
const connectedNodeIds = computed(() => {
  const seen = new Map<string, number>();
  flow.getEdges.value.forEach((edge, index) => {
    if (edge.target === props.pendingNodeId && edge.targetHandle === props.pendingHandleId && !seen.has(edge.source)) {
      seen.set(edge.source, index);
    }
  });
  return [...seen.entries()].sort((left, right) => left[1] - right[1]).map(([nodeId]) => nodeId);
});
const categories = computed(() => {
  const map = new Map<string, { type: string; label: string; count: number }>();
  for (const node of candidateNodes.value) {
    const entry = map.get(node.type) ?? { type: node.type, label: typeLabel(node.type), count: 0 };
    entry.count += 1;
    map.set(node.type, entry);
  }
  return [...map.values()].sort((left, right) => left.label.localeCompare(right.label));
});
const filteredList = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return candidateNodes.value.filter(node =>
    (activeCategory.value === "all" || node.type === activeCategory.value)
    && (!keyword || nodeLabel(node).toLowerCase().includes(keyword)));
});
function isSelected(nodeId: string) {
  return selectedNodes.value.some(node => node.id === nodeId);
}

function typeLabel(type: string) {
  return props.remoteNodes.find(item => item.type === type)?.label ?? type;
}
function nodeLabel(node: GraphNode) {
  return String(node.data?.label ?? node.label ?? node.id);
}
function toggleNode(node: GraphNode) {
  const index = selectedNodes.value.findIndex(item => item.id === node.id);
  if (index >= 0) selectedNodes.value.splice(index, 1);
  else selectedNodes.value.push({ id: node.id, label: nodeLabel(node) });
}
function removeSelected(index: number) {
  selectedNodes.value.splice(index, 1);
}
function onDragStart(index: number) {
  dragIndex.value = index;
}
function onDragOver(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return;
  const [moved] = selectedNodes.value.splice(dragIndex.value, 1);
  selectedNodes.value.splice(index, 0, moved);
  dragIndex.value = index;
}
function onDragEnd() {
  dragIndex.value = -1;
}
function onPreview(node: GraphNode, url: string, kind: "image" | "video") {
  previewLabel.value = nodeLabel(node);
  previewUrl.value = url;
  previewKind.value = kind;
  previewVisible.value = true;
}
function reset() {
  search.value = "";
  activeCategory.value = "all";
  // ACT: 已连线的节点预选，按连线顺序排列。
  const byId = new Map<string, GraphNode>();
  for (const node of candidateNodes.value) byId.set(node.id, node);
  selectedNodes.value = [];
  for (const nodeId of connectedNodeIds.value) {
    const node = byId.get(nodeId);
    if (node) selectedNodes.value.push({ id: node.id, label: nodeLabel(node) });
  }
  previewVisible.value = false;
}
function confirm() {
  emit("confirm", selectedNodes.value.map(node => node.id));
  visible.value = false;
}

watch(visible, (open) => {
  if (open) reset();
});
</script>

<style scoped lang="scss">
.selectNodes {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .categoryTabs {
    :deep(.el-tabs__header) { margin-bottom: 0; }
  }

  .nodeList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .selectedSection {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--el-border-color);

    .selectedHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
    }

    .selectedList {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 160px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .selectedItem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      background: var(--el-bg-color);
      cursor: grab;

      .dragHandle { color: var(--el-text-color-secondary); }
      .selectedIndex { color: var(--el-text-color-secondary); font-size: 12px; }
      .selectedLabel {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }
}

.previewBody {
  display: grid;
  place-items: center;

  img, video {
    max-width: 100%;
    max-height: 70vh;
    border-radius: 8px;
  }
}
</style>
