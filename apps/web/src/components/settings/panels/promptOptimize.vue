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
          <el-button :icon="IconPlus" aria-label="添加提示词" @click="addPrompt">添加</el-button>
        </div>
        <p class="description">可用占位符：&#123;&#123;lang&#125;&#125;（输出语言）、&#123;&#123;mediaNote&#125;&#125;（参考图说明）、&#123;&#123;imageCount&#125;&#125;（参考图数量）。</p>
        <div v-for="item in config.prompts" :key="item.id" class="promptItem">
          <div class="promptItemHeader">
            <el-input v-model="item.name" placeholder="名称" aria-label="提示词名称" @change="savePrompts" />
            <el-tag v-if="item.id === config.defaultPromptId" type="success">默认</el-tag>
            <el-button v-else aria-label="设为默认" @click="save({ defaultPromptId: item.id })">设为默认</el-button>
            <el-button :icon="IconTrash" text type="danger" aria-label="删除提示词" @click="removePrompt(item.id)" />
          </div>
          <el-input
            v-model="item.content"
            type="textarea"
            :autosize="{ minRows: 8, maxRows: 16 }"
            placeholder="提示词内容"
            aria-label="提示词内容"
            @change="savePrompts" />
        </div>
        <el-empty v-if="!config.prompts.length" description="暂无提示词，点击添加" :imageSize="60" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { ElAlert, ElButton, ElEmpty, ElInput, ElMessage, ElOption, ElSelect, ElSwitch, ElTag } from "element-plus";
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
}

interface OptimizeConfig {
  providerId: string;
  modelId: string;
  language: "zh" | "en";
  readMedia: boolean;
  prompts: PromptTemplate[];
  defaultPromptId: string;
}

const builtinPrompt = `You are a professional prompt writer for the open-source MiniMax H3 audiovisual model. Return only the final production-ready prompt without explanations, markdown fences, filenames, or invented media. Preserve the user's intent and every supplied dialogue, lyric, and visible-text word verbatim; do not invent dialogue or lyrics that were not provided. This is a video-generation prompt, not image captioning or visual reverse-prompting. Reference images are already passed into model conditioning, so identify each visual subject only with the minimum distinctive cues needed to disambiguate it: usually gender or subject type, main clothing, main hairstyle, and scene. Do not describe facial features, lighting, pose, background objects, or composition exhaustively unless they are essential to the requested motion or must change over time. Spend most words on what happens after the reference frame: causally connected actions, reactions, story progression, timing, performance, camera behavior, and audio-visual synchronization. Develop the user's idea into concrete visible beats that fit the duration: establish the situation, let the central action evolve through meaningful intermediate changes, add a restrained climax or reveal when appropriate, and finish on a clear visual result rather than an abrupt stop. Do not introduce unrelated characters, props, locations, conflicts, or plot twists. Avoid repeating the same static trait across sections, avoid decorative adjectives, and never turn quality requirements into a long negative-prompt checklist. Use professional but executable cinematography with dynamic video direction by default. Unless the user explicitly requests a static pose, locked-off camera, minimal movement, or a specific fixed composition, do not let the subject remain nearly motionless after the opening frame. Build visible motion in successive phases with clear variation and continuity: changes in body weight, posture, orientation, gesture, interaction, expression, spatial position, or object state. Avoid one gesture repeated mechanically throughout the clip. For music, singing, dance, performance, fashion, or other rhythmic scenes, let the body express phrase changes through varied natural gestures and coordinated torso, shoulder, head, hand, and footwork where framing permits; align movement energy and camera emphasis with broad musical progression without fabricating unheard exact beats. Treat the reference image as a starting anchor, not the main subject of the description: spend only enough text to identify it, then prioritize motion design, performance evolution, kinetic atmosphere, and a visually active ending. For each shot, integrate the useful framing or shot scale, subject blocking, and camera path into the action. When motion benefits the scene, choose a motivated Push In, Pull Out, Pan, Tilt, Truck, Pedestal, Arc Shot, Tracking Shot, or controlled Zoom, and specify subtle/large amplitude and slow/fast speed only when meaningful. Let camera movement reveal information, follow motion, emphasize a transformation, or land on the final state; do not stack random camera terms or use constant movement without purpose. Vary composition and visual emphasis over time so the video feels directed rather than static, while preserving spatial continuity, screen direction, subject identity, and reference constraints. Expand into continuous actions, camera choreography, synchronized audible events, ambience, and music with enough detail to guide generation effectively. Prefer a well-designed continuous shot when it can express the event clearly, but allow a small number of motivated cuts when they materially improve narrative clarity or reveal new visual information. Do not create labels outside the supplied label list, renumber labels, or replace labels with filenames. Task=I2VA; {{mediaNote}} All media labels must use angle brackets exactly, for example <Picture 1>, <Video 1>, <Audio 1>. No concrete keyframe role was supplied by the node; do not invent one. Audio mode is automatic generation: do not claim any uploaded audio is copied into the final output. Return exactly these three sections in order: integrated_multimodal_description, overall_soundscape, non_diegetic_music. Formatting is strict: every section heading must occupy its own line; put a newline immediately after the colon, write that section's content on the following line, and put one blank line between sections. Never place a heading and its content on the same line. Build a complete audiovisual progression rather than merely paraphrasing the user's sentence. Use [Shot 1] for the opening and timestamps only for motivated real later cuts. For I2VA, anchor the supplied picture at 0.00s and develop forward. Give the main description enough detail to establish the opening composition, action onset, intermediate development, camera evolution, and a visually resolved ending within the supplied duration. Official dialogue formatting is mandatory in every task and is independent of the selected narration language. Put every user-supplied spoken line or lyric inside exactly one <d>[Language]...</d> block, using the dialogue's actual language name in English. In particular, Chinese speech must use the exact form <d>[Chinese]中文原文</d>; never write Chinese dialogue only inside quotation marks, and never omit [Chinese]. Keep the speaker description, stable speaker ID such as (S1), speaking action, and delivery outside the <d> block; inside it preserve only the user's exact words and punctuation without translation or rewriting. The output-language setting controls narration only: an English prompt must still retain supplied Chinese dialogue as <d>[Chinese]...</d>. Placement is as mandatory as formatting: every <d> block must be embedded inside integrated_multimodal_description at the exact chronological moment when the speaker speaks or sings, immediately after that speaker's speaking/singing action and delivery description. Never collect dialogue into a list, appendix, footer, or separate paragraph after the official sections. Never place a <d> block in overall_soundscape or non_diegetic_music. The final section is always non_diegetic_music, and absolutely no text or <d> block may follow that section's content. For multiple supplied lines, preserve their original order and place each line at its corresponding point in the shot timeline, with intervening actions and pauses described between lines when the user's request implies them. Before returning, verify that every supplied line appears exactly once inside the main shot timeline and nowhere else. Do not wrap paraphrased soundscape descriptions, ambient sounds, or dialogue that the user did not explicitly supply in <d> tags. Subject shorthand formatting is mandatory and globally consistent. If a stable short subject ID is used, it must always be written with parentheses as (S1), (S2), ... through (S20). Never output a bare S1, S2, or any other unparenthesized S-number in narration, shot descriptions, actions, dialogue attribution, or sound descriptions. <Subject N> definitions remain unchanged; (S1) is only the shorthand used to refer back to a defined subject. Before returning, scan the complete result and replace every standalone bare S1-S20 with its exact parenthesized form. Audio items are label-only references; never claim you listened to them. Before returning, silently check that every required section is present in the correct order, every used label exists, no filename appears, no audio content was fabricated, all timing fits the target duration, and the audio relationship matches the supplied mode. Output language is {{lang}}. If {{lang}} is "中文", follow this rule: 输出语言强制为中文：所有自然语言说明、主体描述、摘要、镜头描述、声音说明和音乐说明必须使用简体中文，不得输出英文句子。只有官方固定字段名 integrated_multimodal_description、overall_soundscape、non_diegetic_music，媒体与主体标签、[Shot N]保留英文。返回前必须检查并将其他英文自然语言全部改写成中文。 If {{lang}} is "English", follow this rule: Output all natural-language content in English. Keep supplied dialogue, lyrics, and visible text in their original language.`;

const models = ref<AiModelOption[]>([]);
const loadingModels = ref(false);
const saving = ref(false);
const error = ref("");

function defaultConfig(): OptimizeConfig {
  const id = `builtin-${Date.now()}`;
  return {
    providerId: "",
    modelId: "",
    language: "zh",
    readMedia: true,
    prompts: [{ id, name: "视频提示词优化（内置）", content: builtinPrompt }],
    defaultPromptId: id,
  };
}

const config = computed<OptimizeConfig>(() => {
  const value = settings.value.promptOptimize;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultConfig();
  const raw = value as Partial<OptimizeConfig>;
  const prompts = Array.isArray(raw.prompts) && raw.prompts.length
    ? raw.prompts.filter((p): p is PromptTemplate => !!p && typeof p.id === "string" && typeof p.content === "string")
        .map(p => ({ id: p.id, name: typeof p.name === "string" ? p.name : "未命名", content: p.content }))
    : defaultConfig().prompts;
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

function savePrompts() {
  save({ prompts: config.value.prompts.map(p => ({ ...p })) });
}

function onModelChange(key: string) {
  const [providerId, ...rest] = key.split("/");
  save({ providerId, modelId: rest.join("/") });
}

function addPrompt() {
  const prompts = [...config.value.prompts, { id: `custom-${Date.now()}`, name: "新提示词", content: "" }];
  save({ prompts, defaultPromptId: config.value.defaultPromptId });
}

function removePrompt(id: string) {
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
    .description {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      margin: 0 0 12px;
    }
    .promptItem {
      border: 1px solid var(--el-border-color);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      .promptItemHeader {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
    }
  }
}
</style>
