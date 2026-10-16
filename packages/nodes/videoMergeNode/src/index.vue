<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    :bottomWidth="520"
    :style="{ width: previewUrl && videoWidth ? `${videoWidth + 18}px` : undefined }">
    <template #topActions>
      <mediaHistory mediaType="video" :current="outputFile" :disabled="merging || deleting" @select="outputs.video = { dataType: 'VIDEO', value: $event }" />
    </template>
    <div v-loading="merging" class="mergeContent nopan" :aria-busy="merging" elementLoadingText="正在合成…">
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        label="合成视频"
        @loadedmetadata="resizeVideo" />
      <div v-else class="mergeEmpty" role="img" aria-label="暂无合成视频">
        <icon-movie :size="48" stroke="1.25" aria-hidden="true" />
      </div>
      <div v-if="mergeDone" class="mergeDoneMask" @click.stop="mergeDone = false" role="button" aria-label="合成已完成，点击关闭">
        <span class="mergeDoneText">合成已完成</span>
      </div>
    </div>
    <template #bottom>
      <el-card class="mergeCard" shadow="never" :bodyStyle="{ padding: '12px' }">
        <div class="mergeList" aria-label="待合成视频，拖动排序">
          <mergeVideoItem
            v-for="(item, index) in refList"
            :key="item.source + item.sourceHandle"
            :item="item"
            :index="index"
            :label="sourceLabel(item.source)"
            @dragstart="onDragStart(index)"
            @dragover="onDragOver(index)"
            @dragend="onDragEnd" />
          <el-empty v-if="!refList.length" description="请先连线视频节点" />
        </div>
        <el-button
          type="primary"
          :loading="merging"
          :disabled="merging || deleting || refList.length < 2"
          @click="startMerge().catch((error) => showNodeError(error, '视频合成失败'))">
          合成
        </el-button>
      </el-card>
    </template>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useVueFlow } from "@vue-flow/core";
import { ElButton, ElCard, ElEmpty, ElLoading } from "element-plus";
import { IconMovie } from "@tabler/icons-vue";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle, type NodeInputValue } from "@toonflow/nodes-scaffold/runtime";
import { showNodeError } from "@toonflow/node-shared/showNodeError";
import { useNodeGeneration } from "@toonflow/node-shared/useNodeGeneration";
import { useNodeReferences } from "@toonflow/node-shared/useNodeReferences";
import videoPlayer from "@toonflow/node-video/videoPlayer";
import mediaHistory from "@toonflow/node-shared/mediaHistory";
import mergeVideoItem from "./components/mergeVideoItem.vue";
import { mergeVideos, mergedFileName } from "./videoMerge";

defineOptions({
  inheritAttrs: false,
  icon: IconMovie,
  handles: [
    { id: "in", type: "target", dataType: "VIDEO", label: "视频输入" },
    { id: "video", type: "source", dataType: "VIDEO", label: "合成视频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ffmpeg, updateNodeInternals } = useNode({
  label: "视频合成",
});
const flow = useVueFlow();
const { refList } = useNodeReferences("in");
const generationState = useNodeGeneration(outputs, () => mergeController?.abort());
const { generating: merging } = generationState;
const mergeDone = ref(false);
const deleting = ref(false);
const videoWidth = ref(0);
const player = ref<InstanceType<typeof videoPlayer>>();
const dragIndex = ref(-1);
let mergeController: AbortController | undefined;
let mergeTask: Promise<void> | undefined;

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(outputFile, (error) => showNodeError(error, "视频预览失败"));

function sourceLabel(nodeId: string) {
  const source = flow.findNode(nodeId);
  return String(source?.data?.label ?? source?.label ?? nodeId);
}

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function onDragStart(index: number) {
  dragIndex.value = index;
}
function onDragOver(index: number) {
  if (dragIndex.value < 0 || dragIndex.value === index) return;
  const items = [...refList.value];
  const [moved] = items.splice(dragIndex.value, 1);
  items.splice(index, 0, moved);
  // ACT: refList 的 setter 写 referenceOrder，顺序随画布保存。
  refList.value = items;
  dragIndex.value = index;
}
function onDragEnd() {
  dragIndex.value = -1;
}

function videoUrl(item: NodeInputValue) {
  const value = item.value as { url?: unknown } | undefined;
  return item.dataType === "VIDEO" && typeof value?.url === "string" ? value.url : undefined;
}

async function startMerge() {
  if (merging.value) throw new Error("视频正在合成，请等待完成");
  const sources = refList.value.map(videoUrl).filter((url): url is string => !!url);
  if (sources.length < 2) throw new Error("至少需要 2 个视频才能合成");
  const workspace = files.getWorkspaceFiles();
  const controller = new AbortController();
  mergeController = controller;
  mergeDone.value = false;
  mergeTask = generationState.run(async () => {
    const { directory } = await workspace.list();
    // ACT: ffmpeg 不自动建输出目录，先建 assets/<节点ID>，否则报 No such file。
    for (const path of ["assets", `assets/${id}`]) {
      await workspace.mkdir(path).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
        if (error.response?.data?.data?.code !== "EEXIST") throw error;
      });
    }
    const outputPath = `assets/${id}/${mergedFileName()}`;
    const factory = await ffmpeg(controller.signal);
    await mergeVideos(factory, sources, outputPath, controller.signal);
    outputs.value.video = { dataType: "VIDEO", value: { url: outputPath, mimeType: "video/mp4" } };
  })
    .then(() => { mergeDone.value = true; })
    .catch((error) => showNodeError(error, "视频合成失败"))
    .finally(() => { mergeController = undefined; });
  return { status: "merging" };
}

nodeTools.register({
  name: "mergeVideo",
  description: "按当前列表顺序合成连线进来的视频",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startMerge();
  },
});

nodeEvent.on("delete", async () => {
  deleting.value = true;
  mergeController?.abort();
  try {
    await mergeTask;
    await files.removeNodeFiles();
  } catch { /* 删除时忽略合成中断 */ }
  finally { deleting.value = false; }
});
</script>

<style scoped lang="scss">
.mergeContent {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .mergeEmpty {
    display: grid;
    place-items: center;
    min-height: 144px;
    color: var(--el-text-color-secondary);
  }

  .mergeDoneMask {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0009;
    cursor: pointer;
    z-index: 3;
    .mergeDoneText {
      padding: 8px 20px;
      border-radius: 8px;
      background: var(--el-color-success);
      color: #fff;
      font-size: 14px;
    }
  }
}

.mergeCard {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .mergeList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
    padding-right: 4px;
  }
}
</style>
