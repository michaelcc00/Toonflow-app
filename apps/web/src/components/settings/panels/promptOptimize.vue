<template>
  <div class="promptOptimize">
    <section class="settingSection" aria-label="提示词优化设置">
      <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
      <div class="optimizeRow">
        <div class="optimizeField">
          <span class="fieldLabel">模型</span>
          <el-select
            :modelValue="modelKey"
            :loading="loadingModels"
            :disabled="!models.length"
            placeholder="选择文本模型"
            aria-label="优化模型"
            @change="onModelChange">
            <el-option v-for="item in models" :key="item.providerId + '/' + item.modelId" :label="item.providerLabel + ' / ' + item.label" :value="item.providerId + '/' + item.modelId" />
          </el-select>
        </div>
        <div class="optimizeField">
          <span class="fieldLabel">语言</span>
          <el-select :modelValue="config.language" aria-label="优化输出语言" @change="(value) => save({ language: value })">
            <el-option label="中文" value="zh" />
            <el-option label="English" value="en" />
          </el-select>
        </div>
        <div class="optimizeField">
          <span class="fieldLabel">读取素材</span>
          <el-switch :modelValue="config.readMedia" aria-label="优化时读取视觉素材" @change="(value) => save({ readMedia: value === true })" />
        </div>
      </div>
      <div class="promptList">
        <div class="listHeader">
          <h4>优化提示词</h4>
          <el-button :icon="IconPlus" aria-label="添加提示词" @click="openDialog()">添加</el-button>
        </div>
        <div v-for="item in config.prompts" :key="item.id" class="promptRow" :class="{ locked: item.locked }" @click="item.locked ? undefined : openDialog(item)">
          <span class="promptName">{{ item.name || "未命名" }}</span>
          <el-tag v-if="item.id === config.defaultPromptId" type="success" size="small">默认</el-tag>
          <el-tag v-if="item.locked" type="info" size="small">内置</el-tag>
          <span class="promptActions" @click.stop>
            <el-button v-if="item.id !== config.defaultPromptId" size="small" aria-label="设为默认" @click="save({ defaultPromptId: item.id })">设为默认</el-button>
            <el-button v-if="!item.locked" :icon="IconTrash" size="small" text type="danger" aria-label="删除提示词" @click="removePrompt(item.id)" />
          </span>
        </div>
        <el-empty v-if="!config.prompts.length" description="暂无提示词，点击添加" :imageSize="60" />
      </div>
    </section>
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑提示词' : '添加提示词'"
      width="min(720px, calc(100vw - 32px))"
      alignCenter
      appendToBody
      :closeOnClickModal="false">
      <div class="promptDialog">
        <el-input v-model="editingName" placeholder="名称" aria-label="提示词名称" />
        <el-input
          v-model="editingContent"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 18 }"
          placeholder="提示词内容"
          aria-label="提示词内容" />
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!editingName.trim() || !editingContent.trim()" @click="confirmDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { ElAlert, ElButton, ElDialog, ElEmpty, ElInput, ElMessage, ElOption, ElSelect, ElSwitch, ElTag } from "element-plus";
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import { saveSettings, settings } from "@/stores/settings";

interface AiModelOption {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  /** 锁定后不可编辑/删除，只能设为默认 */
  locked?: boolean;
}

interface OptimizeConfig {
  providerId: string;
  modelId: string;
  language: "zh" | "en";
  readMedia: boolean;
  prompts: PromptTemplate[];
  defaultPromptId: string;
}


const models = ref<AiModelOption[]>([]);
const loadingModels = ref(false);
const saving = ref(false);
const error = ref("");
const dialogVisible = ref(false);
const editingId = ref("");
const editingName = ref("");
const editingContent = ref("");

function defaultConfig(): OptimizeConfig {
  return {
    providerId: "",
    modelId: "",
    language: "zh",
    readMedia: true,
    prompts: [{ id: "goohai-builtin", name: "视频提示词优化（内置）", content: "", locked: true }],
    defaultPromptId: "goohai-builtin",
  };
}

const config = computed<OptimizeConfig>(() => {
  const value = settings.value.promptOptimize;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultConfig();
  const raw = value as Partial<OptimizeConfig>;
  let prompts = Array.isArray(raw.prompts) && raw.prompts.length
    ? raw.prompts.filter((p): p is PromptTemplate => !!p && typeof p.id === "string")
        .map(p => ({
          id: p.id,
          name: typeof p.name === "string" ? p.name : "未命名",
          content: typeof p.content === "string" ? p.content : "",
          locked: p.id === "goohai-builtin" || p.locked === true,
        }))
    : defaultConfig().prompts;
  // 迁移：旧版内置模板（id 为 builtin-时间戳）转为锁定版
  const legacyIdx = prompts.findIndex(p => !p.locked && p.name === "视频提示词优化（内置）");
  if (legacyIdx >= 0) {
    const legacy = prompts[legacyIdx]!;
    const wasDefault = raw.defaultPromptId === legacy.id;
    prompts = prompts.filter((_, i) => i !== legacyIdx);
    if (!prompts.some(p => p.id === "goohai-builtin")) {
      prompts = [{ id: "goohai-builtin", name: "视频提示词优化（内置）", content: "", locked: true }, ...prompts];
    }
    if (wasDefault) raw.defaultPromptId = "goohai-builtin";
  }
  // 兜底：确保内置模板始终存在
  if (!prompts.some(p => p.id === "goohai-builtin")) {
    prompts = [{ id: "goohai-builtin", name: "视频提示词优化（内置）", content: "", locked: true }, ...prompts];
  }
  const defaultPromptId = prompts.some(p => p.id === raw.defaultPromptId) ? raw.defaultPromptId as string : prompts[0]!.id;
  return {
    providerId: typeof raw.providerId === "string" ? raw.providerId : "",
    modelId: typeof raw.modelId === "string" ? raw.modelId : "",
    language: raw.language === "en" ? "en" : "zh",
    readMedia: raw.readMedia !== false,
    prompts,
    defaultPromptId,
  };
});

const modelKey = computed(() => (config.value.providerId && config.value.modelId ? `${config.value.providerId}/${config.value.modelId}` : ""));

async function loadModels() {
  loadingModels.value = true;
  try {
    const { data } = await axios.get<{ code: number; data: AiModelOption[] }>("/api/ai/models");
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error("获取模型列表失败");
    models.value = data.data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "获取模型列表失败";
  } finally {
    loadingModels.value = false;
  }
}

async function save(patch: Partial<OptimizeConfig>) {
  if (saving.value) return;
  saving.value = true;
  try {
    await saveSettings(() => ({ promptOptimize: { ...config.value, ...patch } }));
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

function onModelChange(key: string) {
  const [providerId, ...rest] = key.split("/");
  save({ providerId, modelId: rest.join("/") });
}

function openDialog(item?: PromptTemplate) {
  editingId.value = item?.id ?? "";
  editingName.value = item?.name ?? "";
  editingContent.value = item?.content ?? "";
  dialogVisible.value = true;
}

function confirmDialog() {
  const name = editingName.value.trim();
  const content = editingContent.value.trim();
  if (!name || !content) return;
  let prompts: PromptTemplate[];
  let defaultPromptId = config.value.defaultPromptId;
  if (editingId.value) {
    prompts = config.value.prompts.map(p => p.id === editingId.value ? { ...p, name, content } : p);
  } else {
    const id = `custom-${Date.now()}`;
    prompts = [...config.value.prompts, { id, name, content }];
    if (!prompts.some(p => p.id === defaultPromptId)) defaultPromptId = id;
  }
  dialogVisible.value = false;
  save({ prompts, defaultPromptId });
}

function removePrompt(id: string) {
  const target = config.value.prompts.find(p => p.id === id);
  if (target?.locked) {
    ElMessage.warning("内置模板不可删除");
    return;
  }
  const prompts = config.value.prompts.filter(p => p.id !== id);
  if (!prompts.length) {
    ElMessage.warning("至少保留一条提示词");
    return;
  }
  const defaultPromptId = id === config.value.defaultPromptId ? prompts[0]!.id : config.value.defaultPromptId;
  save({ prompts, defaultPromptId });
}

onMounted(loadModels);
</script>

<style scoped lang="scss">
.promptOptimize {
  .optimizeRow {
    display: flex;
    gap: 16px;
    align-items: flex-end;
    margin-bottom: 20px;
    .optimizeField {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      &:first-child {
        flex: 2;
      }
      &:nth-child(2) {
        flex: 1;
      }
      .fieldLabel {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }
  }
  .promptList {
    .listHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      h4 {
        margin: 0;
      }
    }
    .promptRow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      &:hover {
        border-color: var(--el-color-primary);
      }
      &.locked {
        cursor: default;
        &:hover {
          border-color: var(--el-border-color);
        }
      }
      .promptName {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .promptActions {
        display: flex;
        gap: 4px;
        align-items: center;
      }
    }
  }
  .promptDialog {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
