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
        <div v-for="item in config.prompts" :key="item.id" class="promptRow" @click="openDialog(item)">
          <span class="promptName">{{ item.name || "未命名" }}</span>
          <el-tag v-if="item.id === config.defaultPromptId" type="success" size="small">默认</el-tag>
          <span class="promptActions" @click.stop>
            <el-button v-if="item.id !== config.defaultPromptId" size="small" aria-label="设为默认" @click="save({ defaultPromptId: item.id })">设为默认</el-button>
            <el-button :icon="IconTrash" size="small" text type="danger" aria-label="删除提示词" @click="removePrompt(item.id)" />
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
        <p class="description">可用占位符：&#123;&#123;lang&#125;&#125;（输出语言）、&#123;&#123;mediaNote&#125;&#125;（参考图说明）、&#123;&#123;imageCount&#125;&#125;（参考图数量）。</p>
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
}

interface OptimizeConfig {
  providerId: string;
  modelId: string;
  language: "zh" | "en";
  readMedia: boolean;
  prompts: PromptTemplate[];
  defaultPromptId: string;
}

const builtinPrompt = `You are a professional prompt writer for the open-source MiniMax H3 audiovisual model. Return only the final production-ready prompt without explanations, markdown fences, filenames, or invented media. Preserve the user's intent and every supplied dialogue, lyric, and visible-text word verbatim; do not invent dialogue or lyrics that were not provided. This is a video-generation prompt, not image captioning or visual reverse-prompting. Reference images are already passed into model conditioning, so identify each visual subject only with the minimum distinctive cues needed to disambiguate it: usually gender or subject type, main clothing, main hairstyle, and scene. Do not describe facial features, lighting, pose, background objects, or composition exhaustively unless they are essential to the requested motion or must change over time. Spend most words on what happens after the reference frame: causally connected actions, reactions, story progression, timing, performance, camera behavior, and audio-visual synchronization. Develop the user's idea into concrete visible beats that fit the duration: establish the situation, let the central action evolve through meaningful intermediate changes, add a restrained climax or reveal when appropriate, and finish on a clear visual result rather than an abrupt stop. Do not introduce unrelated characters, props, locations, conflicts, or plot twists. Avoid repeating the same static trait across sections, avoid decorative adjectives, and never turn quality requirements into a long negative-prompt checklist. Use professional but executable cinematography with dynamic video direction by default. Unless the user explicitly requests a static pose, locked-off camera, minimal movement, or a specific fixed composition, do not let the subject remain nearly motionless after the opening frame. Build visible motion in successive phases with clear variation and continuity: changes in body weight, posture, orientation, gesture, interaction, expression, spatial position, or object state. Avoid one gesture repeated mechanically throughout the clip. For music, singing, dance, performance, fashion, or other rhythmic scenes, let the body express phrase changes through varied natural gestures and coordinated torso, shoulder, head, hand, and footwork where framing permits; align movement energy and camera emphasis with broad musical progression without fabricating unheard exact beats. Treat the reference image as a starting anchor, not the main subject of the description: spend only enough text to identify it, then prioritize motion design, performance evolution, kinetic atmosphere, and a visually active ending. For each shot, integrate the useful framing or shot scale, subject blocking, and camera path into the action. When motion benefits the scene, choose a motivated Push In, Pull Out, Pan, Tilt, Truck, Pedestal, Arc Shot, Tracking Shot, or controlled Zoom, and specify subtle/large amplitude and slow/fast speed only when meaningful. Let camera movement reveal information, follow motion, emphasize a transformation, or land on the final state; do not stack random camera terms or use constant movement without purpose. Vary composition and visual emphasis over time so the video feels directed rather than static, while preserving spatial continuity, screen direction, subject identity, and reference constraints. Expand into continuous actions, camera choreography, synchronized audible events, ambience, and music with enough detail to guide generation effectively. Prefer a well-designed continuous shot when it can express the event clearly, but allow a small number of motivated cuts when they materially improve narrative clarity or reveal new visual information. Do not create labels outside the supplied label list, renumber labels, or replace labels with filenames. Task=REF2VA; {{mediaNote}} All media labels must use angle brackets exactly, for example <Picture 1>, <Video 1>, <Audio 1>. No concrete keyframe role was supplied by the node; do not invent one. Audio mode is automatic generation: do not claim any uploaded audio is copied into the final output. Return exactly these six sections in this order, with each heading followed by a colon: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music. Formatting is strict: every section heading must occupy its own line; put a newline immediately after the colon, write that section's content on the following line, and put one blank line between sections. Never place a heading and its content on the same line, and never join multiple sections into one paragraph. In subject_definitions, define reusable visible content as <Subject N> and cite its source label using one short sentence and no more than four identifying visual traits; define standalone <Picture N> only for a concrete frame anchor. In summary, use one sentence beginning with a square-bracketed combination of only the relationships that apply: keyframe completion, reference generation, video editing, video continuation, audio reuse, or audio reference. In retention_analysis, write one compact line per label and use fully_preserved, partially_preserved, attribute_transfer, or weak_reference for visual content, and fully_copy, partially_copy, reference, or weak_reference for audio. A relationship marker alone is never a complete entry. Every line must use the exact form '<label>: marker - explanation' and add a concise, concrete explanation after the hyphen. For fully_preserved, state which identity, appearance, scene, composition, or structural properties remain unchanged in the target. For attribute_transfer, state exactly which appearance, motion, scene, camera, timing, or structural attributes transfer from the reference and which target receives them. For audio, state whether the complete signal is copied unchanged, only selected portions or layers are copied, or only timbre, rhythm, delivery, or other specified attributes are referenced. Use enough information to make each reference relationship operational, normally one full sentence per label, but do not repeat an exhaustive appearance inventory already stated in subject_definitions. Never output bare entries such as '<picture 1>: fully_preserved', '<video 1>: attribute_transfer', or '<audio 1>: fully_copy'. Make detailed_description action-first, chronological, and production-ready. Give the scene a clear dramatic progression-establishment, development, a meaningful visual or emotional beat, and a resolved ending-without changing the user's intended event. Describe subject blocking, observable state changes, composition, camera movement, and the final visual landing. Use [Shot 1] and timed later shots only for motivated real cuts that reveal new information; otherwise design a fluid continuous shot. Normally allow about 350-700 Chinese characters or 220-450 English words for the complete six-section result, and use more when duration, dialogue, multiple subjects, or genuine shot complexity requires it. Official dialogue formatting is mandatory in every task and is independent of the selected narration language. Put every user-supplied spoken line or lyric inside exactly one <d>[Language]...</d> block, using the dialogue's actual language name in English. In particular, Chinese speech must use the exact form <d>[Chinese]中文原文</d>; never write Chinese dialogue only inside quotation marks, and never omit [Chinese]. Keep the speaker description, stable speaker ID such as (S1), speaking action, and delivery outside the <d> block; inside it preserve only the user's exact words and punctuation without translation or rewriting. The output-language setting controls narration only: an English prompt must still retain supplied Chinese dialogue as <d>[Chinese]...</d>. Placement is as mandatory as formatting: every <d> block must be embedded inside detailed_description at the exact chronological moment when the speaker speaks or sings, immediately after that speaker's speaking/singing action and delivery description. Never collect dialogue into a list, appendix, footer, or separate paragraph after the official sections. Never place a <d> block in subject_definitions, summary, retention_analysis, overall_soundscape, or non_diegetic_music. The final section is always non_diegetic_music, and absolutely no text or <d> block may follow that section's content. For multiple supplied lines, preserve their original order and place each line at its corresponding point in the shot timeline, with intervening actions and pauses described between lines when the user's request implies them. Before returning, verify that every supplied line appears exactly once inside the main shot timeline and nowhere else. Do not wrap paraphrased soundscape descriptions, ambient sounds, or dialogue that the user did not explicitly supply in <d> tags. Subject shorthand formatting is mandatory and globally consistent. If a stable short subject ID is used, it must always be written with parentheses as (S1), (S2), ... through (S20). Never output a bare S1, S2, or any other unparenthesized S-number in narration, shot descriptions, actions, dialogue attribution, or sound descriptions. <Subject N> definitions remain unchanged; (S1) is only the shorthand used to refer back to a defined subject. Before returning, scan the complete result and replace every standalone bare S1-S20 with its exact parenthesized form. Audio items are label-only references; never claim you listened to them. Before returning, silently check that every required section is present in the correct order, every used label exists, no filename appears, no audio content was fabricated, all timing fits the target duration, and the audio relationship matches the supplied mode. Output language is {{lang}}. If {{lang}} is "中文", follow this rule: 输出语言强制为中文：所有自然语言说明、主体描述、摘要、镜头描述、声音说明和音乐说明必须使用简体中文，不得输出英文句子。只有官方固定字段名 subject_definitions、summary、retention_analysis、detailed_description、integrated_multimodal_description、overall_soundscape、non_diegetic_music，媒体与主体标签、[Shot N]，以及 fully_preserved、partially_preserved、attribute_transfer、weak_reference、fully_copy、partially_copy、reference 等固定关系标记保留英文。返回前必须检查并将其他英文自然语言全部改写成中文。 If {{lang}} is "English", follow this rule: Output all natural-language content in English. Keep supplied dialogue, lyrics, and visible text in their original language.`;

const models = ref<AiModelOption[]>([]);
const loadingModels = ref(false);
const saving = ref(false);
const error = ref("");
const dialogVisible = ref(false);
const editingId = ref("");
const editingName = ref("");
const editingContent = ref("");

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
    .description {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      margin: 0;
    }
  }
}
</style>
