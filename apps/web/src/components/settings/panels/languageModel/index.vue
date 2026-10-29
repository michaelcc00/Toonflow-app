<template>
  <div class="providerList">
    <div class="itemList">
      <el-card v-for="item in sortedProviders" :key="item.id" class="providerItem" shadow="never">
        <div class="providerHeader">
          <div v-if="item.icon || isTfRouterProvider(item)" class="providerMark" aria-hidden="true">
            <img class="providerLogo" :class="{ monochrome: isTfRouterProvider(item) }" :src="item.icon || logoUrl" alt="" />
          </div>
          <div class="providerInfo">
            <div class="providerHeading">
              <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
              <el-tag v-if="isTfRouterProvider(item)" size="small">官方</el-tag>
            </div>
            <el-text class="providerId" size="small" type="info" :title="item.id">{{ item.id }}</el-text>
          </div>
        </div>
        <tfAccount v-if="isTfRouterProvider(item)" :apiKey="typeof item.apiKey === 'string' ? item.apiKey : ''" :visible="visible" :saveApiKey="(key) => saveProviderApiKey(item.id, key)" />
        <div class="providerFooter">
          <div class="providerMeta">
            <el-tag v-if="getProviderVersion(item)" size="small" type="info" effect="plain">v{{ getProviderVersion(item) }}</el-tag>
            <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
          </div>
          <el-space class="itemActions" wrap>
            <el-button v-if="isTfRouterProvider(item) && item.apiKey?.trim() && !item.models.length" text :icon="IconRefresh" :loading="fetchingId === item.id" :disabled="!!deletingId || !!fetchingId" @click="fetchProviderModels(item)">获取模型</el-button>
            <el-button text :icon="IconUpload" :disabled="!!deletingId" @click="openExport(item)">导出</el-button>
            <el-button text :icon="IconEdit" :disabled="!!deletingId" @click="openCustomProvider(item)">编辑</el-button>
            <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item.id)">
              <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingId === item.id" :disabled="!!deletingId">删除</el-button></template>
            </el-popconfirm>
          </el-space>
        </div>
      </el-card>
    </div>
    <div class="providerActions">
      <el-button class="addButton" :icon="IconPlus" @click="openProvider">添加供应商</el-button>
      <el-button class="addButton" :icon="IconSettings" @click="openCustomProvider()">添加自定义供应商</el-button>
      <el-button class="addButton" :icon="IconDownload" @click="importProvider">导入供应商</el-button>
    </div>
    <component :is="addProviderDialog" v-model="providerDialogVisible" />
    <component :is="addCustomProviderDialog" v-model="customProviderDialogVisible" :provider="editingProvider" />
    <el-dialog v-model="exportVisible" title="导出供应商" width="min(440px, calc(100vw - 32px))" alignCenter appendToBody>
      <div class="exportDialog">
        <p class="exportTarget">{{ exportTarget?.label }}</p>
        <el-checkbox v-model="exportIncludeApiKey">包含 API Key</el-checkbox>
        <p v-if="exportIncludeApiKey" class="exportWarning">导出文件将包含该供应商的 API Key，请勿外传。</p>
      </div>
      <template #footer>
        <el-button @click="exportVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmExport">导出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, type Component } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { customProviders, saveSettings, type CustomProvider } from "@/stores/settings";
import { IconPlus, IconSettings, IconEdit, IconTrash, IconRefresh, IconUpload, IconDownload } from "@tabler/icons-vue";
import { saveTextFile } from "@/lib/saveTextFile";
import { pickTextFile } from "@/lib/pickTextFile";
import { languageProviders } from "@toonflow/providers";
import logoUrl from "@toonflow/assets/logo.svg";
import tfAccount from "../../tfAccount.vue";
import { isTfRouterProvider } from "@/lib/tf";

const { visible = true } = defineProps<{ visible?: boolean }>();
const addProviderDialog = shallowRef<Component>();
const addCustomProviderDialog = shallowRef<Component>();
const providerDialogVisible = ref(false);
const customProviderDialogVisible = ref(false);
const editingProvider = ref<CustomProvider>();
const deletingId = ref("");
const fetchingId = ref("");
const exportVisible = ref(false);
const exportTarget = ref<CustomProvider>();
const exportIncludeApiKey = ref(false);
const sortedProviders = computed(() => [...customProviders.value].sort((a, b) => Number(isTfRouterProvider(b)) - Number(isTfRouterProvider(a))));

function getProviderVersion(provider: CustomProvider) {
  const version = languageProviders.find(item => item.id.toLowerCase() === provider.id.toLowerCase())?.version ?? provider.version;
  return typeof version === "string" ? version.trim() : "";
}

function openProvider() {
  addProviderDialog.value ??= defineAsyncComponent(() => import("./addProviderDialog.vue"));
  providerDialogVisible.value = true;
}

function openCustomProvider(provider?: CustomProvider) {
  addCustomProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  editingProvider.value = provider;
  customProviderDialogVisible.value = true;
}

async function deleteProvider(id: string) {
  if (deletingId.value) return;
  deletingId.value = id;
  try {
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      return { customProviders: current.filter(item => item?.id !== id) };
    });
  } catch { ElMessage.error("删除失败，请重试"); }
  finally { deletingId.value = ""; }
}

async function saveProviderApiKey(id: string, key: string) {
  const provider = customProviders.value.find(item => item.id === id);
  if (!provider) throw new Error("供应商已不存在");
  const { apiUrl, protocol, apiKey } = provider;
  await saveSettings(settings => {
    const current = settings.customProviders;
    if (!Array.isArray(current)) throw new Error("配置格式错误");
    const latest = current.find(item => item?.id === id);
    if (!latest) throw new Error("供应商已不存在");
    if (latest.apiUrl !== apiUrl || latest.protocol !== protocol || latest.apiKey !== apiKey) {
      throw new Error("供应商配置已变更，请重试");
    }
    return { customProviders: current.map(item => item?.id === id ? { ...item, apiKey: key } : item) };
  });
}

async function fetchProviderModels(provider: CustomProvider) {
  if (fetchingId.value) return;
  const { id, apiUrl, protocol, apiKey } = provider;
  fetchingId.value = id;
  try {
    const { data } = await axios.post("/api/providers/models", { apiUrl, protocol, apiKey }, { timeout: 35000 });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取模型列表失败");
    if (!data.data.length) throw new Error("未获取到可用模型，请检查 API Key 后重试");
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      const latest = current.find(item => item?.id === id);
      if (!latest) throw new Error("供应商已不存在");
      if (latest.apiUrl !== apiUrl || latest.protocol !== protocol || latest.apiKey !== apiKey) {
        throw new Error("供应商配置已变更，请重试");
      }
      return { customProviders: current.map(item => item?.id === id ? { ...item, models: data.data } : item) };
    });
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "获取模型列表失败，请重试" : error instanceof Error ? error.message : "获取模型列表失败，请重试");
  }
  finally { fetchingId.value = ""; }
}

function openExport(provider: CustomProvider) {
  exportTarget.value = provider;
  exportIncludeApiKey.value = false;
  exportVisible.value = true;
}

function confirmExport() {
  const provider = exportTarget.value;
  exportVisible.value = false;
  if (provider) void exportProvider(provider, exportIncludeApiKey.value);
}

async function exportProvider(provider: CustomProvider, includeApiKey = false) {
  try {
    const exported: Record<string, unknown> = { ...provider };
    if (!includeApiKey) delete exported.apiKey;
    const payload = {
      kind: "toonflow-text-provider",
      version: 1,
      provider: exported,
    };
    const keyNote = includeApiKey ? "含 API Key" : "不含 API Key";
    const fileName = `${provider.id.replace(/[^\w.-]+/g, "_")}.toonflow-text-provider.json`;
    const result = await saveTextFile(fileName, JSON.stringify(payload, null, 2), "Toonflow 文本供应商");
    if (result === "cancelled") return;
    ElMessage.success(result === "saved" ? `已导出（${keyNote}）` : `已导出到浏览器下载目录（${keyNote}）`);
  } catch { ElMessage.error("导出失败"); }
}

function parseImportedProvider(raw: unknown): CustomProvider {
  const invalid = () => new Error("不是有效的文本供应商导出文件");
  if (!raw || typeof raw !== "object") throw invalid();
  const item = raw as Record<string, unknown>;
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const id = text(item.id);
  const label = text(item.label);
  const apiUrl = text(item.apiUrl);
  const protocol = text(item.protocol);
  if (!id || !label || !apiUrl || !protocol || !Array.isArray(item.models)) throw invalid();
  const models = item.models.map(model => {
    if (!model || typeof model !== "object") throw invalid();
    const entry = model as Record<string, unknown>;
    const modelId = text(entry.id);
    const modelLabel = text(entry.label);
    if (!modelId || !modelLabel) throw invalid();
    return {
      id: modelId,
      label: modelLabel,
      ...(typeof entry.contextWindow === "number" && Number.isFinite(entry.contextWindow) ? { contextWindow: entry.contextWindow } : {}),
      ...(typeof entry.maxOutputTokens === "number" && Number.isFinite(entry.maxOutputTokens) ? { maxOutputTokens: entry.maxOutputTokens } : {}),
    };
  });
  return {
    id, label, apiUrl, protocol, models,
    apiKey: text(item.apiKey),
    ...(text(item.icon) ? { icon: text(item.icon) } : {}),
    ...(text(item.version) ? { version: text(item.version) } : {}),
  };
}

async function importProvider() {
  const file = await pickTextFile();
  if (!file) return;
  try {
    const payload = JSON.parse(file.text) as { kind?: unknown; provider?: unknown };
    if (payload?.kind !== "toonflow-text-provider") throw new Error("不是有效的文本供应商导出文件");
    const provider = parseImportedProvider(payload.provider);
    if (customProviders.value.some(item => item.id === provider.id)) {
      ElMessage.error(`已存在相同 ID 的供应商「${provider.id}」，请先删除或改名后再导入`);
      return;
    }
    await saveSettings(settings => {
      const current = settings.customProviders;
      if (!Array.isArray(current)) throw new Error("配置格式错误");
      if (current.some(item => item?.id === provider.id)) throw new Error(`已存在相同 ID 的供应商「${provider.id}」`);
      return { customProviders: [...current, provider] };
    });
    ElMessage.success(provider.apiKey ? `已导入 ${provider.label}` : `已导入 ${provider.label}（需重新填写 API Key）`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "导入失败");
  }
}
</script>

<style lang="scss" scoped src="../../providerList.scss"></style>

<style lang="scss" scoped>
.exportDialog {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .exportTarget {
    margin: 0;
    font-weight: 600;
  }

  .exportWarning {
    margin: 0;
    color: var(--el-color-warning);
    font-size: 13px;
  }
}
</style>
