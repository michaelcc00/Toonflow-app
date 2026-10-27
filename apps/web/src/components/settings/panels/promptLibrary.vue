<template>
  <div class="promptLibrary">
    <section class="settingSection" aria-label="常用提示词设置">
      <div class="promptList">
        <div class="listHeader">
          <h4>常用提示词</h4>
          <span class="listActions">
            <el-button :icon="IconDownload" :disabled="!prompts.length" aria-label="导出全部常用提示词" @click="exportPrompts">导出</el-button>
            <el-button :icon="IconPlus" aria-label="添加常用提示词" @click="openDialog()">添加</el-button>
          </span>
        </div>
        <div v-for="item in prompts" :key="item.id" class="promptRow" @click="openDialog(item)">
          <div class="promptMain">
            <span class="promptTitle">{{ item.title || "未命名" }}</span>
            <span class="promptContent">{{ item.content }}</span>
          </div>
          <el-tag :type="kindTags[item.type].tagType" size="small">{{ kindTags[item.type].label }}</el-tag>
          <span class="promptActions" @click.stop>
            <el-button :icon="IconPencil" size="small" text aria-label="编辑常用提示词" @click="openDialog(item)" />
            <el-button :icon="IconTrash" size="small" text type="danger" aria-label="删除常用提示词" @click="removePrompt(item)" />
          </span>
        </div>
        <el-empty v-if="!prompts.length" description="暂无常用提示词，点击添加" :imageSize="60" />
      </div>
      <p class="libraryHint">在图片、视频、音频生成节点的提示词输入框右上角，以及智能体对话框下方，都可以打开常用提示词列表，按类型自动过滤，多选后插入。</p>
    </section>
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑常用提示词' : '添加常用提示词'"
      width="min(720px, calc(100vw - 32px))"
      alignCenter
      appendToBody
      :closeOnClickModal="false">
      <div class="promptDialog">
        <el-input v-model="editingTitle" placeholder="标题" aria-label="常用提示词标题" />
        <el-select v-model="editingType" aria-label="常用提示词类型" style="width: 100%">
          <el-option label="图片生成" value="image" />
          <el-option label="视频生成" value="video" />
          <el-option label="音频生成" value="audio" />
          <el-option label="智能体" value="agent" />
        </el-select>
        <el-input
          v-model="editingContent"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 16 }"
          placeholder="提示词内容"
          aria-label="常用提示词内容" />
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!editingTitle.trim() || !editingContent.trim()" @click="confirmDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElButton, ElDialog, ElEmpty, ElInput, ElMessage, ElMessageBox, ElOption, ElSelect, ElTag } from "element-plus";
import { IconDownload, IconPencil, IconPlus, IconTrash } from "@tabler/icons-vue";
import { saveSettings, settings } from "@/stores/settings";
import { saveTextFile } from "@/lib/saveTextFile";

type PromptKind = "image" | "video" | "audio" | "agent";
type LibraryPrompt = { id: string; title: string; content: string; type: PromptKind };

const kindTags: Record<PromptKind, { label: string; tagType: "success" | "warning" | "info" | "primary" }> = {
  image: { label: "图片生成", tagType: "success" },
  video: { label: "视频生成", tagType: "warning" },
  audio: { label: "音频生成", tagType: "info" },
  agent: { label: "智能体", tagType: "primary" },
};

const prompts = computed<LibraryPrompt[]>(() => {
  const value = settings.value.promptLibrary;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<LibraryPrompt>;
    if (typeof raw.id !== "string" || typeof raw.content !== "string") return [];
    return [{
      id: raw.id,
      title: typeof raw.title === "string" ? raw.title : "",
      content: raw.content,
      type: raw.type === "video" || raw.type === "audio" || raw.type === "agent" ? raw.type : "image",
    }];
  });
});

const saving = ref(false);
const dialogVisible = ref(false);
const editingId = ref("");
const editingTitle = ref("");
const editingContent = ref("");
const editingType = ref<PromptKind>("image");

async function exportPrompts() {
  const payload = {
    kind: "toonflow-prompt-library",
    version: 1,
    prompts: prompts.value.map(item => ({ title: item.title, content: item.content, type: item.type })),
  };
  const result = await saveTextFile("prompt-library.json", JSON.stringify(payload, null, 2), "常用提示词");
  if (result === "saved") ElMessage.success("已导出全部常用提示词");
  else if (result === "downloaded") ElMessage.success("已导出到浏览器下载目录");
}

async function save(next: LibraryPrompt[]) {
  if (saving.value) return;
  saving.value = true;
  try {
    await saveSettings(() => ({ promptLibrary: next }));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
    throw error;
  } finally {
    saving.value = false;
  }
}

function openDialog(item?: LibraryPrompt) {
  editingId.value = item?.id ?? "";
  editingTitle.value = item?.title ?? "";
  editingContent.value = item?.content ?? "";
  editingType.value = item?.type ?? "image";
  dialogVisible.value = true;
}

async function confirmDialog() {
  const title = editingTitle.value.trim();
  const content = editingContent.value.trim();
  if (!title || !content) return;
  const next = editingId.value
    ? prompts.value.map(item => item.id === editingId.value ? { ...item, title, content, type: editingType.value } : item)
    : [...prompts.value, { id: crypto.randomUUID(), title, content, type: editingType.value }];
  try {
    await save(next);
    dialogVisible.value = false;
  } catch { /* save 已提示错误 */ }
}

async function removePrompt(item: LibraryPrompt) {
  try {
    await ElMessageBox.confirm(`确定删除常用提示词「${item.title || "未命名"}」吗？`, "删除常用提示词", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      confirmButtonClass: "el-button--danger",
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await save(prompts.value.filter(prompt => prompt.id !== item.id));
  } catch { /* save 已提示错误 */ }
}
</script>

<style scoped lang="scss">
.promptLibrary {
  .promptList {
    .listHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      h4 {
        margin: 0;
      }
      .listActions {
        display: flex;
        gap: 8px;
      }
    }
    .promptRow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      &:hover {
        border-color: var(--el-color-primary);
      }
      .promptMain {
        display: flex;
        flex: 1;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
        .promptTitle {
          font-weight: 600;
        }
        .promptContent {
          overflow: hidden;
          color: var(--el-text-color-secondary);
          font-size: 13px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
      .promptActions {
        display: flex;
        flex-shrink: 0;
        gap: 2px;
      }
    }
  }
  .libraryHint {
    margin: 12px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    line-height: 1.6;
  }
  .promptDialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
