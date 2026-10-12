<template>
  <div class="promptOptimize">
    <section class="settingSection" aria-labelledby="promptOptimizeTitle">
      <div class="settingInfo">
        <h3 id="promptOptimizeTitle">提示词优化</h3>
        <p class="description">用你配置的文本模型把提示词改写成结构化的视频提示词（subject_definitions + summary）。视频节点开启后，先优化、确认无误再生成。</p>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
      <div class="optimizeOptions">
        <div class="settingHeader">
          <div class="settingInfo">
            <h4>启用提示词优化</h4>
            <p class="description">关闭后视频节点不再提供优化入口。</p>
          </div>
          <el-switch :modelValue="config.enabled" :loading="saving" aria-label="启用提示词优化" @change="(value) => save({ enabled: value === true })" />
        </div>
        <div class="settingHeader">
          <div class="settingInfo">
            <h4>优化模型</h4>
            <p class="description">使用哪个文本模型做优化，需要支持图片输入才能读取视觉素材。</p>
          </div>
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
        <div class="settingHeader">
          <div class="settingInfo">
            <h4>优化输出语言</h4>
          </div>
          <el-select :modelValue="config.language" aria-label="优化输出语言" @change="(value) => save({ language: value })">
            <el-option label="中文" value="zh" />
            <el-option label="English" value="en" />
          </el-select>
        </div>
        <div class="settingHeader">
          <div class="settingInfo">
            <h4>优化时读取视觉素材</h4>
            <p class="description">把参考图发给优化模型，让它按图写主体定义。关闭则只按文字改写。</p>
          </div>
          <el-switch :modelValue="config.readMedia" aria-label="优化时读取视觉素材" @change="(value) => save({ readMedia: value === true })" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { ElAlert, ElMessage, ElOption, ElSelect, ElSwitch } from "element-plus";
import { saveSettings, settings } from "@/stores/settings";

interface AiModelOption {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
}

interface OptimizeConfig {
  enabled: boolean;
  providerId: string;
  modelId: string;
  language: "zh" | "en";
  readMedia: boolean;
}

const defaultConfig: OptimizeConfig = { enabled: true, providerId: "", modelId: "", language: "zh", readMedia: true };
const models = ref<AiModelOption[]>([]);
const loadingModels = ref(false);
const saving = ref(false);
const error = ref("");

const config = computed<OptimizeConfig>(() => {
  const value = settings.value.promptOptimize;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultConfig;
  const raw = value as Partial<OptimizeConfig>;
  return {
    enabled: raw.enabled !== false,
    providerId: typeof raw.providerId === "string" ? raw.providerId : "",
    modelId: typeof raw.modelId === "string" ? raw.modelId : "",
    language: raw.language === "en" ? "en" : "zh",
    readMedia: raw.readMedia !== false,
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
    await saveSettings((current) => {
      const prev = config.value;
      return { promptOptimize: { ...prev, ...patch } };
    });
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

onMounted(loadModels);
</script>

<style scoped lang="scss">
.promptOptimize {
  .optimizeOptions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }
}
</style>
