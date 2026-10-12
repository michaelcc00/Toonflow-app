<template>
  <el-dialog
    v-model="visible"
    :title="`编辑媒体供应商：${provider?.label ?? ''}`"
    width="min(800px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!saving"
    :showClose="!saving"
    @closed="formApi = undefined">
    <div class="providerEditor">
      <messageMarkdown v-if="provider?.readme" class="providerReadme" :content="provider.readme" />
      <form-create v-model="formValues" v-model:api="formApi" :rule="formRules" :option="formOptions" />
      <div class="modelHeader">
        <h4>自定义参数</h4>
        <el-button :icon="IconPlus" size="small" :disabled="saving" @click="editParam()">添加</el-button>
      </div>
      <div class="paramList">
        <div v-for="(param, index) in customParams" :key="param.id" class="paramRow" @click="editParam(index)">
          <span class="paramLabel">{{ param.label }}</span>
          <el-text type="info" size="small">节点 {{ param.nodeId }} · {{ param.fieldName }}</el-text>
          <span class="paramActions" @click.stop>
            <el-button text size="small" type="danger" :icon="IconTrash" :disabled="saving" :aria-label="`删除参数 ${param.label}`" @click="customParams.splice(index, 1)" />
          </span>
        </div>
        <el-text v-if="!customParams.length" type="info">暂无自定义参数，点击添加</el-text>
      </div>
      <div class="modelHeader">
        <h4>模型配置 <el-text type="info">{{ models.length }}</el-text></h4>
        <el-button :icon="IconPlus" size="small" :disabled="saving" @click="editModel()">手动添加</el-button>
      </div>
      <div class="modelList">
        <el-card v-for="(item, index) in models" :key="index" class="modelCard" shadow="never">
          <div class="topInfo">
            <div class="modelNameWrap">
              <modelIcon :model="item.id" :size="24" />
              <div class="modelInfo">
                <span class="modelName">{{ item.label }}</span>
                <el-text class="modelId" type="info" size="small">{{ item.id }}</el-text>
              </div>
            </div>
            <div class="actionButtons">
              <el-button text size="small" :icon="IconEdit" :disabled="saving" :aria-label="`编辑模型 ${item.label}`" @click="editModel(index)">编辑</el-button>
              <el-button text size="small" type="danger" :icon="IconTrash" :disabled="saving" :aria-label="`删除模型 ${item.label}`" @click="models.splice(index, 1)">删除</el-button>
            </div>
          </div>
          <div class="modelTags">
            <el-tag size="small">{{ modelTypes[item.type] }}</el-tag>
            <el-tag v-for="(tag, tagIndex) in modelTags(item)" :key="tagIndex" size="small" type="info">{{ tag }}</el-tag>
          </div>
        </el-card>
        <el-text v-if="!models.length" type="info">暂无模型</el-text>
      </div>
    </div>
    <el-alert v-if="formError" class="formError" :title="formError" type="error" :closable="false" showIcon />
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :icon="IconDeviceFloppy" :loading="saving" :disabled="!formApi" @click="saveModels">保存</el-button>
    </template>
    <component
      :is="modelEditorDialog"
      v-model="modelEditorVisible"
      :model="editingModelIndex === undefined ? undefined : models[editingModelIndex]"
      :models="models"
      @confirmed="confirmModel" />
    <el-dialog
      v-model="paramEditorVisible"
      :title="editingParamIndex === undefined ? '添加参数' : '编辑参数'"
      width="min(560px, calc(100vw - 32px))"
      alignCenter
      appendToBody
      :closeOnClickModal="false">
      <div class="paramForm">
        <el-input v-model="editingParam.label" placeholder="标签，如：是否生成三视图" aria-label="参数标签" />
        <div class="paramRow2">
          <el-input v-model="editingParam.nodeId" placeholder="节点 ID，如：196" aria-label="节点 ID" />
          <el-input v-model="editingParam.fieldName" placeholder="字段名，如：value" aria-label="字段名" />
        </div>
        <el-select v-model="editingParam.type" aria-label="参数类型">
          <el-option label="开关" value="switch" />
          <el-option label="下拉选择" value="select" />
          <el-option label="文本输入" value="input" />
          <el-option label="数字输入" value="number" />
        </el-select>
        <template v-if="editingParam.type === 'select'">
          <el-input v-model="editingParam.optionsText" placeholder="选项，用逗号分隔，如：1.5,2,3,4" aria-label="下拉选项" />
          <el-select v-model="editingParam.display" aria-label="展示方式">
            <el-option label="下拉框" value="dropdown" />
            <el-option label="平铺按钮" value="tiles" />
          </el-select>
        </template>
        <el-select v-if="editingParam.type === 'switch'" v-model="editingParam.defaultText" aria-label="默认值">
          <el-option label="默认关闭 (false)" value="false" />
          <el-option label="默认开启 (true)" value="true" />
        </el-select>
        <el-input v-else v-model="editingParam.defaultText" placeholder="默认值" aria-label="默认值" />
        <div class="paramRow2">
          <el-select v-model="editingParam.visibleWhenParamId" placeholder="仅当此参数…" aria-label="条件参数" clearable>
            <el-option
              v-for="p in customParams.filter(p => p.id !== editingParamId)"
              :key="p.id"
              :label="p.label"
              :value="p.id" />
          </el-select>
          <el-select
            v-if="visibleWhenTarget?.type === 'switch'"
            v-model="editingParam.visibleWhenEquals"
            aria-label="条件值"
            :disabled="!editingParam.visibleWhenParamId">
            <el-option label="开启时" value="true" />
            <el-option label="关闭时" value="false" />
          </el-select>
          <el-input
            v-else
            v-model="editingParam.visibleWhenEquals"
            placeholder="等于该值时显示"
            aria-label="条件值"
            :disabled="!editingParam.visibleWhenParamId" />
        </div>
      </div>
      <template #footer>
        <el-button @click="paramEditorVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!canSaveParam" @click="confirmParam">确定</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";

import axios from "axios";
import { computed, defineAsyncComponent, ref, shallowRef, toRaw, watch, type Component } from "vue";
import { IconPlus, IconTrash, IconDeviceFloppy, IconEdit } from "@tabler/icons-vue";
import { ElButton, ElCard, ElDialog, ElInput, ElOption, ElSelect, ElText, ElTag, ElAlert } from "element-plus";
import formCreate, { type Api, type Options } from "../../formCreate";
import { modelIcon } from "@toonflow/model-icons";
import messageMarkdown from "@/components/messageMarkdown.vue";
import type { CustomParamDef, MediaProvider, MediaProviderModel } from "./types";
import { settings, saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

const { provider } = defineProps<{ provider?: MediaProvider }>();
const modelEditorDialog = shallowRef<Component>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [provider: MediaProvider] }>();
const models = ref<MediaProviderModel[]>([]);
const modelEditorVisible = ref(false);
const editingModelIndex = ref<number>();
const saving = ref(false);
const formApi = shallowRef<Api>();
const formRules = shallowRef<ReturnType<typeof formCreate.copyRules>>([]);
const formValues = ref<Record<string, unknown>>({});
const formOptions = computed<Options>(() => ({ form: { labelPosition: "top", disabled: saving.value }, appendValue: false, submitBtn: false, resetBtn: false }));
const revision = ref("");
const formError = ref("");
const customParams = ref<CustomParamDef[]>([]);
const paramEditorVisible = ref(false);
const editingParamIndex = ref<number>();
const editingParam = ref({
  label: "", nodeId: "", fieldName: "", type: "switch" as CustomParamDef["type"],
  display: "dropdown" as "dropdown" | "tiles",
  optionsText: "", defaultText: "", visibleWhenParamId: "", visibleWhenEquals: "",
});
const modelTypes = { get image() { return translate("图片"); }, get video() { return translate("视频"); }, get audio() { return translate("音频"); }, get text() { return translate("文本"); } };
const modeLabels: Record<string, string> = {
  singleImage: "单图参考", multiReference: "多图参考", startEndRequired: "首尾帧必填",
  endFrameOptional: "尾帧可选", startFrameOptional: "首帧可选",
  imageReference: "图片参考", videoReference: "视频参考", audioReference: "音频参考",
};

watch(visible, isVisible => {
  if (!isVisible) return;
  formError.value = "";
  modelEditorVisible.value = false;
  editingModelIndex.value = undefined;
  paramEditorVisible.value = false;
  editingParamIndex.value = undefined;
  const configs = settings.value.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  formRules.value = formCreate.copyRules(provider?.rules ?? []);
  const providerConfig = provider && configs?.[provider.id];
  formValues.value = structuredClone(toRaw(providerConfig ?? {}));
  const rawParams = (providerConfig as { customParams?: unknown } | undefined)?.customParams;
  customParams.value = Array.isArray(rawParams) ? rawParams.filter((p): p is CustomParamDef =>
    !!p && typeof p === "object" && typeof (p as CustomParamDef).id === "string" && typeof (p as CustomParamDef).label === "string"
    && typeof (p as CustomParamDef).nodeId === "string" && typeof (p as CustomParamDef).fieldName === "string") : [];
  revision.value = provider?.revision ?? "";
  models.value = JSON.parse(JSON.stringify(provider?.models ?? []));
}, { immediate: true });

function modelTags(model: MediaProviderModel) {
  const modes = Array.isArray(model.mode) ? model.mode.flat().filter((mode): mode is string => typeof mode === "string") : [];
  return modes.map(mode => {
    if (mode === "text") return model.type === "image" ? translate("文生图") : translate("文生视频");
    const reference = /^(imageReference|videoReference|audioReference):(\d+)$/.exec(mode);
    return reference ? `${modeLabels[reference[1]!]} ×${reference[2]}` : modeLabels[mode] ?? mode;
  });
}

function editModel(index?: number) {
  modelEditorDialog.value ??= defineAsyncComponent(() => import("./modelEditorDialog.vue"));
  editingModelIndex.value = index;
  modelEditorVisible.value = true;
}

function confirmModel(model: MediaProviderModel) {
  const index = editingModelIndex.value;
  if (index === undefined) models.value.push(model);
  else models.value.splice(index, 1, model);
}

function editParam(index?: number) {
  editingParamIndex.value = index;
  const param = index === undefined ? undefined : customParams.value[index];
  const visibleWhen = param?.visibleWhen;
  editingParam.value = {
    label: param?.label ?? "",
    nodeId: param?.nodeId ?? "",
    fieldName: param?.fieldName ?? "",
    type: param?.type ?? "switch",
    display: param?.display ?? "dropdown",
    optionsText: param?.options?.join(",") ?? "",
    defaultText: param === undefined ? "" : String(param.defaultValue),
    visibleWhenParamId: visibleWhen?.paramId ?? "",
    visibleWhenEquals: visibleWhen === undefined ? "" : String(visibleWhen.equals),
  };
  paramEditorVisible.value = true;
}

const canSaveParam = computed(() => {
  const p = editingParam.value;
  return !!p.label.trim() && !!p.nodeId.trim() && !!p.fieldName.trim()
    && (p.type !== "select" || !!p.optionsText.trim());
});

const editingParamId = computed(() => editingParamIndex.value === undefined
  ? ""
  : customParams.value[editingParamIndex.value]?.id ?? "");

const visibleWhenTarget = computed(() => customParams.value.find(p => p.id === editingParam.value.visibleWhenParamId));

function parseDefaultValue(type: CustomParamDef["type"], text: string): string | number | boolean {
  const trimmed = text.trim();
  if (type === "switch") return trimmed === "true";
  if (type === "number") {
    const num = Number(trimmed);
    return trimmed !== "" && Number.isFinite(num) ? num : 0;
  }
  return trimmed;
}

function confirmParam() {
  if (!canSaveParam.value) return;
  const p = editingParam.value;
  const param: CustomParamDef = {
    id: editingParamIndex.value === undefined ? `param-${Date.now()}` : customParams.value[editingParamIndex.value]!.id,
    label: p.label.trim(),
    nodeId: p.nodeId.trim(),
    fieldName: p.fieldName.trim(),
    type: p.type,
    defaultValue: parseDefaultValue(p.type, p.defaultText),
  };
  if (p.type === "select") {
    param.options = p.optionsText.split(",").map(s => s.trim()).filter(Boolean);
    param.display = p.display;
  }
  if (p.visibleWhenParamId) {
    const target = customParams.value.find(t => t.id === p.visibleWhenParamId);
    const equalsText = p.visibleWhenEquals.trim();
    param.visibleWhen = {
      paramId: p.visibleWhenParamId,
      // ACT: 开关条件存布尔值，节点弹窗按布尔比较，避免 "true"/true 混淆。
      equals: target?.type === "switch" ? equalsText === "true" : equalsText,
    };
  }
  if (editingParamIndex.value === undefined) customParams.value.push(param);
  else customParams.value.splice(editingParamIndex.value, 1, param);
  paramEditorVisible.value = false;
}

async function saveModels() {
  if (saving.value || !provider || !formApi.value) return;
  const { id: providerId, fileName } = provider;
  formError.value = "";
  let modelsSaved = false;
  let configSaved = false;
  saving.value = true;
  try {
    if (!(await formApi.value.validate().then(() => true, () => false))) return;
    const config = formApi.value.formData();
    if ("apiKey" in config) {
      config.apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
      if ((config.apiKey as string).length > 8192) throw new Error("API Key 过长");
    }
    config.customParams = customParams.value;
    const ids = new Set<string>();
    const values = models.value.map((item, index) => {
      const id = item.id.trim();
      const label = item.label.trim();
      if (!id || !label) throw new Error(`请填写第 ${index + 1} 个模型的 ID 和显示名称`);
      if (ids.has(id)) throw new Error(`模型 ID 重复：${id}`);
      ids.add(id);
      return { ...item, id, label };
    });
    const { data } = await axios.put<{ code: number; data: MediaProvider; message?: string }>("/api/providers/media/save", {
      fileName, revision: revision.value, models: values,
    });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "保存模型失败");
    revision.value = data.data.revision;
    modelsSaved = true;
    invalidateNodeModels("media");
    await saveSettings(settings => {
      const configs = settings.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
      if (configs !== undefined && (!configs || typeof configs !== "object" || Array.isArray(configs))) throw new Error("媒体供应商配置格式无效");
      const current = configs?.[providerId];
      if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) throw new Error("当前供应商配置格式无效");
      if (Object.entries(config).every(([field, value]) => JSON.stringify(value) === JSON.stringify(current?.[field]))) return;
      return { mediaProviderConfigs: { ...configs, [providerId]: { ...current, ...config } } };
    });
    configSaved = true;
    const response = await axios.get<{ code: number; data: MediaProvider[]; message?: string }>("/api/providers/media/list");
    if (response.data.code !== 200 || !Array.isArray(response.data.data)) throw new Error(response.data.message || "读取最新模型失败");
    const latest = response.data.data.find(item => item.fileName === fileName);
    if (!latest) throw new Error("供应商已不存在");
    revision.value = latest.revision;
    emit("saved", latest);
    visible.value = false;
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "保存失败，请重试";
    formError.value = configSaved ? `模型与连接配置已保存，读取最新模型失败：${message}。请重新打开编辑。`
      : modelsSaved ? `模型已保存，连接配置未保存：${message}。填写内容已保留，请重试。` : message;
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.providerEditor {
  max-height: 65dvh;
  padding: 8px 4px;
  overflow-y: auto;
  overscroll-behavior: contain;

  .providerReadme { margin-bottom: 20px; }

  .modelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    margin-top: 20px;

    h4 { margin: 0; }
  }

  .paramList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 8px;

    .paramRow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      cursor: pointer;

      &:hover { border-color: var(--el-color-primary); }

      .paramLabel {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .paramActions { display: flex; align-items: center; }
    }
  }

  .modelList {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .modelCard {
      .topInfo {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;

        .modelNameWrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;

          .modelInfo {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            overflow-wrap: anywhere;

            .modelName { font-size: 15px; font-weight: 600; }
            .modelId { align-self: flex-start; }
          }
        }

        .actionButtons {
          display: flex;
          flex-shrink: 0;
          margin-left: auto;
        }
      }

      .modelTags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
    }
  }
}

.formError { margin-top: 16px; }

.paramForm {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .paramRow2 {
    display: flex;
    gap: 12px;

    > * { flex: 1; min-width: 0; }
  }
}
</style>
