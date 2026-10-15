<template>
  <div v-if="loaded" class="providerList">
    <div class="itemList">
      <el-card v-for="item in sortedProviders" :key="item.fileName" class="providerItem" shadow="never">
        <div class="providerHeader">
          <div v-if="item.icon || item.id.toLowerCase() === 'tfrouter'" class="providerMark" aria-hidden="true">
            <img class="providerLogo" :class="{ monochrome: item.id.toLowerCase() === 'tfrouter' }" :src="item.icon || logoUrl" alt="" />
          </div>
          <div class="providerInfo">
            <div class="providerHeading">
              <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
              <el-tag v-if="item.id.toLowerCase() === 'tfrouter'" size="small">官方</el-tag>
            </div>
            <el-text class="providerId" size="small" type="info" :title="item.fileName">{{ item.fileName }}</el-text>
          </div>
        </div>
        <el-alert v-if="item.loadError" :title="item.loadError" type="error" :closable="false" showIcon />
        <tfAccount v-if="item.id.toLowerCase() === 'tfrouter'" :apiKey="getProviderApiKey(item.id)" :visible="visible" :saveApiKey="(key) => saveProviderApiKey(item.id, key)" />
        <div class="providerFooter">
          <div class="providerMeta">
            <el-tag v-if="item.version" size="small" type="info" effect="plain">v{{ item.version }}</el-tag>
            <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
          </div>
          <el-space class="itemActions" wrap>
            <el-button v-if="item.modelsUrl" text :icon="IconDownload" :loading="fetchingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError || !item.revision" @click="fetchModels(item)">获取模型</el-button>
            <el-button text :icon="IconEdit" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError" @click="editProvider(item)">编辑模型</el-button>
            <el-button text :icon="IconUpload" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError" @click="exportProvider(item)">导出</el-button>
            <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item)">
              <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !item.revision">删除</el-button></template>
            </el-popconfirm>
          </el-space>
        </div>
      </el-card>
    </div>
    <div class="providerActions">
      <el-button class="addButton" :icon="IconPlus" @click="openAdd('builtin')">添加供应商</el-button>
      <el-button class="addButton" :icon="IconSettings" @click="openAdd('custom')">添加自定义供应商</el-button>
      <el-button class="addButton" :icon="IconDownload" @click="importProvider">导入供应商</el-button>
      <input ref="importInput" type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />
    </div>
    <component :is="mediaProviderDialog" v-model="providerDialogVisible" :mode="addMode" @added="saveProviderItem" />
    <component :is="editProviderDialog" v-model="editorVisible" :provider="editingProvider" @saved="saveProviderItem" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, shallowRef, type Component } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconSettings, IconEdit, IconTrash, IconDownload, IconUpload } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
import type { MediaProvider } from "./types";
import { settings, saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import tfAccount from "../../tfAccount.vue";

const { visible = true } = defineProps<{ visible?: boolean }>();
const mediaProviderDialog = shallowRef<Component>();
const editProviderDialog = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
const sortedProviders = computed(() => [...providers.value].sort((a, b) => Number(b.id.toLowerCase() === "tfrouter") - Number(a.id.toLowerCase() === "tfrouter")));
const loaded = ref(false);
const providerDialogVisible = ref(false);
const editorVisible = ref(false);
const addMode = ref<"builtin" | "custom">("builtin");
const editingProvider = ref<MediaProvider>();
const deletingFile = ref("");
const fetchingFile = ref("");
const importInput = ref<HTMLInputElement>();
let loadRequest = 0;

function getProviderApiKey(id: string) {
  const configs = settings.value.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  const apiKey = configs?.[id]?.apiKey;
  return typeof apiKey === "string" ? apiKey : "";
}

async function saveProviderApiKey(id: string, key: string) {
  await saveSettings(settings => {
    const configs = settings.mediaProviderConfigs;
    const current = configs && typeof configs === "object" && !Array.isArray(configs) ? configs as Record<string, unknown> : {};
    const existing = current[id];
    const config = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
    return { mediaProviderConfigs: { ...current, [id]: { ...config, apiKey: key } } };
  });
}

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "provider") void loadProviders();
}
onMounted(() => {
  void loadProviders();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
});

async function loadProviders() {
  const request = ++loadRequest;
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request === loadRequest) providers.value = data.data;
  } catch (error) {
    if (request === loadRequest) ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "读取媒体供应商失败");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

function openAdd(mode: "builtin" | "custom") {
  mediaProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  addMode.value = mode;
  providerDialogVisible.value = true;
}

function editProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || provider.loadError) return;
  editProviderDialog.value ??= defineAsyncComponent(() => import("./editProviderDialog.vue"));
  editingProvider.value = provider;
  editorVisible.value = true;
}

async function fetchModels(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.modelsUrl || !provider.revision || provider.loadError) return;
  fetchingFile.value = provider.fileName;
  try {
    const { data } = await axios.post<{ code: number; data: MediaProvider; message: string }>("/api/providers/media/models", {
      fileName: provider.fileName, revision: provider.revision,
    }, { timeout: 35000 });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "获取模型失败");
    saveProviderItem(data.data);
    invalidateNodeModels("media");
    ElMessage.success("模型列表已更新");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "获取模型失败，请重试");
  } finally { fetchingFile.value = ""; }
}

async function deleteProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.revision) return;
  deletingFile.value = provider.fileName;
  let deleted = false;
  try {
    await axios.delete("/api/providers/media/delete", { data: { fileName: provider.fileName, revision: provider.revision } });
    deleted = true;
    loadRequest++;
    invalidateNodeModels("media");
    providers.value = providers.value.filter(item => item.fileName !== provider.fileName);
    await saveSettings(settings => {
      const configs = settings.mediaProviderConfigs;
      if (!configs || typeof configs !== "object" || Array.isArray(configs) || !Object.hasOwn(configs, provider.id)) return;
      const current = { ...configs } as Record<string, unknown>;
      delete current[provider.id];
      return { mediaProviderConfigs: current };
    });
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "删除失败，请重试";
    ElMessage.error(deleted ? `供应商已删除，连接配置未清理：${message}` : message);
  } finally { deletingFile.value = ""; }
}

function saveProviderItem(provider: MediaProvider) {
  loadRequest++;
  const index = providers.value.findIndex(item => item.fileName === provider.fileName);
  if (index < 0) providers.value.push(provider);
  else providers.value.splice(index, 1, provider);
}

async function exportProvider(provider: MediaProvider) {
  try {
    const { data } = await axios.get<{ code: number; data: { fileName: string; source: string } }>(
      "/api/providers/media/source", { params: { fileName: provider.fileName } });
    if (data.code !== 200 || !data.data?.source) throw new Error("读取插件源码失败");
    const configs = settings.value.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
    const config = { ...(configs?.[provider.id] ?? {}) };
    delete config.apiKey;
    const payload = {
      kind: "toonflow-media-provider",
      version: 1,
      label: provider.label,
      fileName: provider.fileName,
      source: data.data.source,
      config,
      models: provider.models ?? [],
    };
    const content = JSON.stringify(payload, null, 2);
    const fileName = `${provider.fileName.replace(/\.ts$/, "")}.toonflow-provider.json`;
    // ACT: 桌面端 WebView 会拦截 Blob 下载链接，优先用 File System Access API 让用户选保存位置。
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    if (typeof picker === "function") {
      try {
        const handle = await picker.call(window, { suggestedName: fileName, types: [{ description: "Toonflow 供应商", accept: { "application/json": [".json"] } }] });
        if (!handle) return;
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        ElMessage.success("已导出（不含 API Key）");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 降级到 Blob 下载。
      }
    }
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ElMessage.success("已导出到浏览器下载目录（不含 API Key）");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "导出失败");
  }
}

function importProvider() {
  importInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.kind !== "toonflow-media-provider" || typeof payload.source !== "string" || !payload.source.trim()) {
      throw new Error("不是有效的供应商导出文件");
    }
    const { data } = await axios.post<{ code: number; data: MediaProvider; message: string }>(
      "/api/providers/media/add", { source: payload.source }, { timeout: 35000 });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "导入失败");
    const provider = data.data;
    if (payload.config && typeof payload.config === "object") {
      await saveSettings(s => {
        const configs = s.mediaProviderConfigs && typeof s.mediaProviderConfigs === "object" && !Array.isArray(s.mediaProviderConfigs)
          ? s.mediaProviderConfigs as Record<string, unknown> : {};
        return { mediaProviderConfigs: { ...configs, [provider.id]: { ...(payload.config as Record<string, unknown>) } } };
      });
    }
    if (Array.isArray(payload.models) && payload.models.length > 0 && provider.revision) {
      await axios.put("/api/providers/media/save", { fileName: provider.fileName, models: payload.models, revision: provider.revision });
    }
    saveProviderItem(provider);
    invalidateNodeModels("media");
    ElMessage.success(`已导入 ${provider.label}（需重新填写 API Key）`);
    await loadProviders();
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "导入失败");
  }
}
</script>

<style lang="scss" scoped src="../../providerList.scss"></style>
