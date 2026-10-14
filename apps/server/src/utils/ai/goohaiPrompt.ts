/**
 * Goohai MiniMax H3 提示词优化逻辑的 TypeScript 改写版。
 *
 * 原始来源：goohai/Goohai-MiniMax-H3_Integration 的 prompt_optimizer.py。
 * 改写原则：不改变原功能——system prompt 的六个任务分支、条件规则、
 * 后处理链与 Python 版逐行对应；仅把 Python 语法换成 TypeScript。
 *
 * 与 Toonflow 的衔接：
 * - 模型调用仍走 Toonflow 自己的 streamAi（用户在"设置→提示词优化"里配的文本模型），
 *   不照搬 Python 的本地 GGUF / RunningHub AI 应用等多路调用。
 * - 参考图走 Toonflow 的 readAiReferences 机制（二进制经 references 参数传给 streamAi），
 *   此处只生成 user 文本部分的图片占位说明。
 */

/** H3 提示词优化支持的六种任务模式。 */
export type H3Task = "T2VA" | "I2VA" | "L2VA" | "FL2VA" | "REF2VA" | "HYBRID";

/** 关键帧角色（对应 Python context["keyframes"] 里的 {label, role}）。 */
export interface H3Keyframe {
  label: string;
  /** exact_first_frame | exact_last_frame | keyframe | 其他（按视觉参考处理） */
  role: string;
}

/** 音频模式（对应 Python context["audio_mode"]，默认 "native"）。 */
export type H3AudioMode = "lock_source" | "reference_only" | "remix_source" | "native";

/** 参考素材（对应 Python media 列表里的 {label, kind}）。 */
export interface H3MediaItem {
  label: string;
  /** image | video | audio */
  kind: string;
}

export interface BuildSystemPromptArgs {
  task: H3Task;
  /** 目标视频时长（秒），用于时间锚点。 */
  duration: number;
  /** 可用媒体标签，如 ["<Picture 1>", "<Video 1>"]。 */
  labels: string[];
  /** "中文" 或 "English"。 */
  outputLanguage: string;
  keyframes?: H3Keyframe[];
  audioMode?: H3AudioMode | string;
  /** 用户原始提示词（用于检测唱歌/动作迁移关键词，动态追加专项规则）。 */
  userPrompt?: string;
}

/**
 * 构建 system prompt（对应 Python `_system_prompt()`）。
 *
 * 组装顺序与 Python 完全一致：
 * 基础写作规范 + Task/时长/标签 + label_rule + keyframe_rule + audio_rule
 * + structure + singing_rule? + transfer_rule? + dialogue_rule
 * + subject_shorthand_rule + 音频自查 + language_rule
 */
export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { task, duration, labels, outputLanguage, keyframes = [], audioMode = "native", userPrompt = "" } = args;
  const taskUpper = task.toUpperCase();
  // FL2VA 特殊：标签用裸小写 "picture 1/2"，不用尖括号。
  const fl2va = taskUpper === "FL2VA";
  // 完整参考模式输出六段式，其他任务输出三段式。
  const fullReference = taskUpper === "REF2VA" || taskUpper === "HYBRID";

  // --- 标签格式规则 ---
  const labelRule = fl2va
    ? "FL2VA picture labels must be bare lowercase: picture 1 and picture 2, never angle brackets. "
      + "This is a mandatory content requirement, not merely a label-format example: the final prompt must explicitly "
      + "contain both exact tokens 'picture 1' and 'picture 2'. The first line must state that picture 1 is the exact "
      + `opening-frame anchor at 0.00s and picture 2 is the exact ending-frame anchor at ${duration.toFixed(2)}s. Never omit, `
      + "rename, translate, capitalize, or replace either token, even when the requested output language is Chinese."
    : "All media labels must use angle brackets exactly, for example <picture 1>, <video 1>, <audio 1>.";

  // --- 章节结构规则 ---
  let structure: string;
  if (fullReference) {
    // 六段式：subject_definitions / summary / retention_analysis /
    //        detailed_description / overall_soundscape / non_diegetic_music
    structure = "Return exactly these six sections in this order, with each heading followed by a colon: "
      + "subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, "
      + "non_diegetic_music. Formatting is strict: every section heading must occupy its own line; put a newline "
      + "immediately after the colon, write that section's content on the following line, and put one blank line "
      + "between sections. Never place a heading and its content on the same line, and never join multiple sections "
      + "into one paragraph. In subject_definitions, define reusable visible content as <Subject N> and cite "
      + "its source label using one short sentence and no more than four identifying visual traits; define "
      + "standalone <Picture N> only for a concrete frame anchor. In summary, use one sentence beginning "
      + "with a square-bracketed combination of only the relationships that apply: keyframe completion, "
      + "reference generation, video editing, video continuation, audio reuse, or audio reference. In "
      + "retention_analysis, write one compact line per label and use fully_preserved, partially_preserved, "
      + "attribute_transfer, or weak_reference for visual content, and fully_copy, partially_copy, reference, "
      + "or weak_reference for audio. A relationship marker alone is never a complete entry. Every line must use "
      + "the exact form '<label>: marker - explanation' and add a concise, concrete explanation after the hyphen. "
      + "For fully_preserved, state which identity, appearance, scene, composition, or structural properties remain "
      + "unchanged in the target. For attribute_transfer, state exactly which appearance, motion, scene, camera, "
      + "timing, or structural attributes transfer from the reference and which target receives them. For audio, "
      + "state whether the complete signal is copied unchanged, only selected portions or layers are copied, or "
      + "only timbre, rhythm, delivery, or other specified attributes are referenced. Use enough information to "
      + "make each reference relationship operational, normally one full sentence per label, but do not repeat an "
      + "exhaustive appearance inventory already stated in subject_definitions. Never output bare entries such as "
      + "'<picture 1>: fully_preserved', '<video 1>: attribute_transfer', or '<audio 1>: fully_copy'. "
      + "Make detailed_description action-first, chronological, and production-ready. Give the scene a clear "
      + "dramatic progression—establishment, development, a meaningful visual or emotional beat, and a resolved "
      + "ending—without changing the user's intended event. Describe subject blocking, observable state changes, "
      + "composition, camera movement, and the final visual landing. Use [Shot 1] and timed later shots only for "
      + "motivated real cuts that reveal new information; otherwise design a fluid continuous shot. Normally allow "
      + "about 350-700 Chinese characters or 220-450 English words for the complete six-section result, and use "
      + "more when duration, dialogue, multiple subjects, or genuine shot complexity requires it.";
  } else {
    // 三段式：integrated_multimodal_description / overall_soundscape / non_diegetic_music
    structure = "Return exactly these three sections in order: integrated_multimodal_description, overall_soundscape, "
      + "non_diegetic_music. Formatting is strict: every section heading must occupy its own line; put a newline "
      + "immediately after the colon, write that section's content on the following line, and put one blank line "
      + "between sections. Never place a heading and its content on the same line. Build a complete audiovisual "
      + "progression rather than merely paraphrasing the user's sentence. Use [Shot 1] for the opening and "
      + "timestamps only for motivated real later cuts. For I2VA, "
      + "anchor the supplied picture at 0.00s and develop forward. For L2VA, infer a plausible opening and "
      + "converge exactly to the supplied picture at the end. For FL2VA, describe one continuous, observable "
      + "motion path from picture 1 at 0.00s to picture 2 at the target end time. Give the main description enough "
      + "detail to establish the opening composition, action onset, intermediate development, camera evolution, "
      + "and a visually resolved ending within the supplied duration. In FL2VA, mention picture 1 again when "
      + "establishing the opening state and picture 2 again when describing the final visual landing; both labels "
      + "are compulsory and must not be replaced by generic phrases such as 'the first image' or 'the last image'.";
  }

  // --- 关键帧角色规则 ---
  const keyframeLines: string[] = [];
  for (const item of keyframes) {
    if (!item || !item.label || !item.role) continue;
    const roleText = item.role === "exact_first_frame"
      ? "is the exact first-frame anchor at 0.00s"
      : item.role === "exact_last_frame"
        ? `is the exact last-frame anchor at ${duration.toFixed(2)}s`
        : item.role === "keyframe"
          ? "is a concrete visual keyframe anchor"
          : "is a visual reference";
    keyframeLines.push(`${item.label} ${roleText}`);
  }
  const keyframeRule = keyframeLines.length > 0
    ? "Keyframe roles supplied by the node: " + keyframeLines.join("; ") + ". Preserve these roles exactly."
    : "No concrete keyframe role was supplied by the node; do not invent one.";

  // --- 音频模式规则（四选一，默认 native） ---
  const audioRuleMap: Record<string, string> = {
    lock_source: "Audio mode is original-audio output. State only that the source video's original audio is preserved "
      + "unchanged as the complete target soundtrack and mark it fully_copy. Because the optimizer does not "
      + "receive or hear the audio binary, do not identify, describe, classify, or invent any dialogue, music, "
      + "ambience, sound effect, instrument, language, rhythm, or other audible content. In overall_soundscape, "
      + "write only the selected-language equivalent of 'Preserve the source video's original audio unchanged.' "
      + "Do not add any new sound, voice, animal vocalization, ambience, or music.",
    reference_only: "Audio mode is reference-only: treat supplied audio as audio reference; do not claim its waveform "
      + "is copied into the final soundtrack.",
    remix_source: "Audio mode is source-audio remix: describe only partial copying or remixing of the supplied audio, "
      + "never a 1:1 complete copy.",
    native: "Audio mode is automatic generation: do not claim any uploaded audio is copied into the final output.",
  };
  const audioRule = audioRuleMap[String(audioMode)]
    ?? "Describe the audio relationship conservatively and do not invent how it is used.";

  // --- 唱歌/对口型专项规则（仅当用户提示词含唱歌关键词时追加） ---
  let singingRule = "";
  if (/唱|歌曲|歌词|歌唱|演唱|口型|嘴型|对口型|lip\s*sync|sing(?:ing|s)?|lyrics?|vocal/i.test(userPrompt)) {
    singingRule = " The request involves singing or lip synchronization. Require accurate phoneme-level lip and jaw "
      + "synchronization throughout the vocals: mouth movement should follow syllable onset and release, clear "
      + "consonant closures, natural vowel shapes, pauses and breaths, and sustained notes; the mouth rests "
      + "naturally during non-vocal spans. Also require stable facial identity and continuous mouth motion without "
      + "generic loops, visible delay, frozen lips, or facial deformation. Do not reduce a singing performance "
      + "to lip movement while the rest of the body remains still. Unless the user explicitly requests restrained "
      + "or static performance, design evolving full-body or upper-body performance across the timeline: shifting "
      + "weight, torso and shoulder rhythm, head movement, gaze changes, expressive but natural hand and arm "
      + "phrasing, and transitions between distinct gestures. Make these movements non-repetitive and responsive "
      + "to musical phrases, accents, pauses, intensity changes, and vocal emotion without inventing exact unheard "
      + "beats. Coordinate purposeful camera motion and changing shot emphasis with the performance so the image "
      + "does not feel like a static portrait with moving lips. Keep lip-sync requirements compact, but give the "
      + "visible performance and camera progression enough concrete detail to guide a lively result. Because the audio binary is not "
      + "transmitted to the optimizer, never invent exact lyrics, notes, beats, or timestamps and never claim "
      + "to have analyzed or heard the file.";
  }

  // --- 主体替换/动作迁移专项规则（仅当用户提示词含替换/迁移关键词时追加） ---
  let transferRule = "";
  if (/替换|置换|换成|变成|动作迁移|模仿.*动作|复刻.*动作|跟随.*动作|replace|replacement|swap|motion\s*(?:transfer|reference)|imitate.*motion|copy.*motion/i.test(userPrompt)) {
    transferRule = " This is a subject-replacement or motion-transfer request. The following is a strict task-specific "
      + "exception that overrides the general instructions to describe actions, timing, performance, camera, "
      + "sound, and shot-by-shot events. Describe only the source-to-target relationship: which subject from "
      + "<Picture N> replaces which subject in <Video N>, while the source video's complete motion, timing, "
      + "scene, props, composition, camera movement, cuts, and temporal structure remain unchanged. Never name, "
      + "infer, enumerate, paraphrase, or timestamp any concrete source-video action, gesture, pose change, facial "
      + "expression, dialogue, object interaction, prop function, story event, sound, ambience, or music, even if "
      + "it appears visible or inferable in the sampled frames. Use the sampled frames only to distinguish the "
      + "subjects that must be replaced. Define replacement subjects only with official numbered labels such as "
      + "<Subject 1> and <Subject 2>, never semantic labels such as <cat> or a Chinese name. Give each subject only "
      + "the minimum clearly visible identity cues needed to avoid mismatch: subject type or gender, approximate "
      + "age when reliable, main clothing and color, hairstyle or fur pattern, hat, and glasses. Do not infer an "
      + "occupation or describe pose, expression, action, scene details, lighting, or unrelated appearance. Do not "
      + "define the original subjects being removed as target <Subject N> entries unless needed only to make an "
      + "unambiguous one-to-one replacement mapping. In detailed_description, keep a single [Shot 1] for the source "
      + "timeline, but write a complete operational paragraph rather than a bare one-sentence relationship. State "
      + "which source subject or scene is replaced by which referenced target, which target identity and major "
      + "appearance or environment attributes remain stable, and which source-video properties remain unchanged: "
      + "motion performance, facial-expression timing, blocking, screen direction, camera trajectory, framing, "
      + "cuts, pacing, and duration when applicable. Explain how replaced subjects remain spatially integrated with "
      + "preserved props and scene elements, but never invent or enumerate the source video's concrete actions, "
      + "dialogue, props, events, or sounds; do not expand the source timeline or reconstruct it from sampled frames. Treat the three sampled images from one <Video N> as observation "
      + "frames of that single reference video, never as separate target shots or evidence of cuts.";
  }

  // --- 输出语言规则 ---
  const languageRule = outputLanguage === "中文"
    ? "输出语言强制为中文：所有自然语言说明、主体描述、摘要、镜头描述、声音说明和音乐说明必须使用简体中文，"
      + "不得输出英文句子。只有官方固定字段名 subject_definitions、summary、retention_analysis、"
      + "detailed_description、integrated_multimodal_description、overall_soundscape、non_diegetic_music，"
      + "媒体与主体标签、[Shot N]，以及 fully_preserved、partially_preserved、attribute_transfer、"
      + "weak_reference、fully_copy、partially_copy、reference 等固定关系标记保留英文。返回前必须检查并将"
      + "其他英文自然语言全部改写成中文。"
    : "Output all natural-language content in English. Keep supplied dialogue, lyrics, and visible text in their "
      + "original language.";

  // --- 对白格式规则（所有任务强制，与旁白语言无关） ---
  const dialogueRule = "Official dialogue formatting is mandatory in every task and is independent of the selected narration "
    + "language. Put every user-supplied spoken line or lyric inside exactly one <d>[Language]...</d> block, using "
    + "the dialogue's actual language name in English. In particular, Chinese speech must use the exact form "
    + "<d>[Chinese]中文原文</d>; never write Chinese dialogue only inside quotation marks, and never omit [Chinese]. "
    + "Keep the speaker description, stable speaker ID such as (S1), speaking action, and delivery outside the <d> "
    + "block; inside it preserve only the user's exact words and punctuation without translation or rewriting. "
    + "The output-language setting controls narration only: an English prompt must still retain supplied Chinese "
    + "dialogue as <d>[Chinese]...</d>. Placement is as mandatory as formatting: every <d> block must be embedded "
    + "inside integrated_multimodal_description or detailed_description at the exact chronological moment when the "
    + "speaker speaks or sings, immediately after that speaker's speaking/singing action and delivery description. "
    + "Never collect dialogue into a list, appendix, footer, or separate paragraph after the official sections. "
    + "Never place a <d> block in subject_definitions, summary, retention_analysis, overall_soundscape, or "
    + "non_diegetic_music. The final section is always non_diegetic_music, and absolutely no text or <d> block may "
    + "follow that section's content. For multiple supplied lines, preserve their original order and place each line "
    + "at its corresponding point in the shot timeline, with intervening actions and pauses described between lines "
    + "when the user's request implies them. Before returning, verify that every supplied line appears exactly once "
    + "inside the main shot timeline and nowhere else. Do not wrap paraphrased soundscape descriptions, ambient "
    + "sounds, or dialogue that the user did not explicitly supply in <d> tags.";

  // --- 主体缩写规则 ---
  const subjectShorthandRule = "Subject shorthand formatting is mandatory and globally consistent. If a stable short subject ID is used, "
    + "it must always be written with parentheses as (S1), (S2), ... through (S20). Never output a bare S1, S2, "
    + "or any other unparenthesized S-number in narration, shot descriptions, actions, dialogue attribution, or "
    + "sound descriptions. <Subject N> definitions remain unchanged; (S1) is only the shorthand used to refer back "
    + "to a defined subject. Before returning, scan the complete result and replace every standalone bare S1-S20 "
    + "with its exact parenthesized form.";

  // --- 最终组装（拼接顺序与 Python 的 f-string 完全一致） ---
  return "You are a professional prompt writer for the open-source MiniMax H3 audiovisual model. Return only the "
    + "final production-ready prompt without explanations, markdown fences, filenames, or invented media. "
    + "Preserve the user's intent and every supplied dialogue, lyric, and visible-text word verbatim; do not "
    + "invent dialogue or lyrics that were not provided. This is a video-generation prompt, not image captioning "
    + "or visual reverse-prompting. Reference images are already passed into model conditioning, so identify each "
    + "visual subject only with the minimum distinctive cues needed to disambiguate it: usually gender or subject "
    + "type, main clothing, main hairstyle, and scene. Do not describe facial features, lighting, pose, background "
    + "objects, or composition exhaustively unless they are essential to the requested motion or must change over "
    + "time. Spend most words on what happens after the reference frame: causally connected actions, reactions, "
    + "story progression, timing, performance, camera behavior, and audio-visual synchronization. Develop the "
    + "user's idea into concrete visible beats that fit the duration: establish the situation, let the central "
    + "action evolve through meaningful intermediate changes, add a restrained climax or reveal when appropriate, "
    + "and finish on a clear visual result rather than an abrupt stop. Do not introduce unrelated characters, props, "
    + "locations, conflicts, or plot twists. Avoid repeating the same static trait across sections, avoid decorative "
    + "adjectives, and never turn quality requirements into a long negative-prompt checklist. Use professional but "
    + "executable cinematography with dynamic video direction by default. Unless the user explicitly requests a static pose, locked-off camera, "
    + "minimal movement, or a specific fixed composition, do not let the subject remain nearly motionless after the "
    + "opening frame. Build visible motion in successive phases with clear variation and continuity: changes in body "
    + "weight, posture, orientation, gesture, interaction, expression, spatial position, or object state. Avoid one "
    + "gesture repeated mechanically throughout the clip. For music, singing, dance, performance, fashion, or other "
    + "rhythmic scenes, let the body express phrase changes through varied natural gestures and coordinated torso, "
    + "shoulder, head, hand, and footwork where framing permits; align movement energy and camera emphasis with broad "
    + "musical progression without fabricating unheard exact beats. Treat the reference image as a starting anchor, "
    + "not the main subject of the description: spend only enough text to identify it, then prioritize motion design, "
    + "performance evolution, kinetic atmosphere, and a visually active ending. For each shot, integrate the useful framing or shot scale, subject blocking, "
    + "and camera path into the action. When motion benefits the scene, choose a motivated Push In, Pull Out, Pan, Tilt, "
    + "Truck, Pedestal, Arc Shot, Tracking Shot, or controlled Zoom, and specify subtle/large amplitude and slow/fast "
    + "speed only when meaningful. Let camera movement reveal information, follow motion, emphasize a transformation, "
    + "or land on the final state; do not stack random camera terms or use constant movement without purpose. Vary "
    + "composition and visual emphasis over time so the video feels directed rather than static, while preserving "
    + "spatial continuity, screen direction, subject identity, and reference constraints. Expand into continuous "
    + "actions, camera choreography, synchronized audible events, ambience, and music with enough detail to guide "
    + "generation effectively. Prefer a well-designed continuous shot when it can express the event clearly, but "
    + "allow a small number of motivated cuts when they materially improve narrative clarity or reveal new visual "
    + "information. Do not create labels outside the supplied label list, renumber labels, "
    + "or replace labels with filenames. "
    + `Task=${task}; duration=${duration.toFixed(2)}s; available labels=${labels.join(", ") || "none"}. `
    + `${labelRule} ${keyframeRule} ${audioRule} ${structure}${singingRule}${transferRule} ${dialogueRule} `
    + `${subjectShorthandRule} `
    + "Audio items are label-only references; never claim you listened to them. Before returning, silently check "
    + "that every required section is present in the correct order, every used label exists, no filename appears, "
    + "no audio content was fabricated, all timing fits the target duration, and the audio relationship matches "
    + `the supplied mode. ${languageRule}`;
}

/**
 * 构建 user 文本（对应 Python `_user_parts()` 的文本部分）。
 *
 * Python 版把图片以 image_url part 直接嵌在消息里；Toonflow 里图片二进制
 * 走 readAiReferences → streamAi 的 references 参数，此处只生成每张图的
 * 占位说明文字，保持与 Python 相同的 wording。
 */
export function buildUserText(prompt: string, media: H3MediaItem[], readMedia: boolean): string {
  const parts: string[] = [`User prompt:\n${prompt}`];
  for (const item of media) {
    const label = item.label || "";
    const kind = item.kind || "";
    if (kind === "audio") {
      // 音频不传输二进制，只用文字声明。
      parts.push(`${label} is an uploaded audio reference (content not transmitted).`);
    } else if (readMedia) {
      // 图片二进制经 Toonflow 的 references 通道发送，这里只留占位行
      // （Python 版此处还会追加 {type:"image_url"} part）。
      parts.push(`${label} visual 1.`);
    } else {
      parts.push(`${label} is an uploaded ${kind} reference.`);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// 后处理函数（与 Python 版一一对应，调用顺序见 postProcessPrompt）
// ---------------------------------------------------------------------------

/** 后处理1：删除模型输出里残留的文件名（对应 Python `_strip_filenames`）。 */
export function stripFilenames(text: string): string {
  return text
    .replace(/(?<![\w/\\])[\w .()\-\u4e00-\u9fff]+\.(?:png|jpe?g|webp|bmp|gif|mp4|mov|webm|mkv|avi|mp3|wav|flac|m4a|ogg|aac)(?!\w)/gi, "")
    .trim();
}

/** 后处理2：强制官方章节标题独占一行（对应 Python `_format_prompt_sections`，只调格式不改写内容）。 */
export function formatPromptSections(text: string): string {
  const headings = [
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "integrated_multimodal_description",
    "overall_soundscape",
    "non_diegetic_music",
  ];
  const pattern = new RegExp(`\\s*(${headings.join("|")})\\s*:\\s*`, "gi");
  return text.replace(pattern, (_m, h: string) => `\n\n${h.toLowerCase()}:\n`).trim();
}

/** 后处理3：把裸写的 S1/S2…S20 统一改成 (S1)/(S2)（对应 Python `_normalize_subject_shorthand`）。 */
export function normalizeSubjectShorthand(text: string): string {
  return text.replace(
    /(?<![A-Za-z0-9_(<（])S([1-9]|1\d|20)(?![A-Za-z0-9_)>）])/gi,
    (_m, n: string) => `(S${n})`,
  );
}

/**
 * 从用户原始提示词里抽出显式对白（对应 Python `_extract_explicit_dialogues`）。
 * 只抽引号/书名号包裹、或"说/喊/问"等引导的句子，返回 [原文, 语言]。
 */
export function extractExplicitDialogues(prompt: string): [string, string][] {
  const source = String(prompt || "");
  const candidates: [string, string][] = [];
  const speechMarker = "(?:说|说道|说着|喊|喊道|问|问道|回答|答道|台词|对白|says?|speaks?|shouts?|asks?|replies?)";
  const patterns = [
    new RegExp(`${speechMarker}[^\\n“”‘’"']{0,20}[：:]?\\s*[“"]([^”"\\n]+)[”"]`, "gi"),
    new RegExp(`${speechMarker}[^\\n“”‘’"']{0,20}[：:]?\\s*[‘']([^’'\\n]+)[’']`, "gi"),
    new RegExp(`${speechMarker}\\s*[：:]\\s*([^\\n；;]+)`, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1].trim().replace(/^[“”‘’"']+|[“”‘’"']+$/g, "").trim();
      const existing = new Set(candidates.map(item => item[0]));
      if (!value || existing.has(value) || [...existing].some(item => value.includes(item) || item.includes(value))) continue;
      const language = /[\u3400-\u9fff]/.test(value) ? "Chinese" : "English";
      candidates.push([value, language]);
    }
  }
  return candidates;
}

/**
 * 后处理4：确保用户给的每一句对白都出现且仅出现一次、位于主时间线内
 * （对应 Python `_ensure_supplied_dialogues`）。
 */
export function ensureSuppliedDialogues(text: string, userPrompt: string, outputLanguage: string): string {
  let result = String(text);
  const dialoguesToInsert: [number, string][] = [];

  const findTimeline = (src: string): [number, number] => {
    const mainHeading = /(?:integrated_multimodal_description|detailed_description)\s*:\s*/i.exec(src);
    const mainStart = mainHeading ? mainHeading.index + mainHeading[0].length : 0;
    const mainEndMatch = /(?:overall_soundscape|non_diegetic_music)\s*:\s*/i.exec(src.slice(mainStart));
    const mainEnd = mainEndMatch ? mainStart + mainEndMatch.index : src.length;
    return [mainStart, mainEnd];
  };

  const dialogues = extractExplicitDialogues(userPrompt);
  dialogues.forEach(([dialogue, language], idx) => {
    const index = idx + 1;
    const tag = `<d>[${language}]${dialogue}</d>`;
    let [mainStart, mainEnd] = findTimeline(result);
    let timeline = result.slice(mainStart, mainEnd);
    if (timeline.includes(tag)) {
      // 时间线内已有合法出现：删掉时间线外的重复，保留这一次。
      const prefix = result.slice(0, mainStart).split(tag).join("");
      const suffix = result.slice(mainEnd).split(tag).join("");
      result = prefix + timeline + suffix;
      return;
    }
    // 标签在时间线外属于结构错误：先删掉，重新定位。
    result = result.split(tag).join("");
    [mainStart, mainEnd] = findTimeline(result);
    timeline = result.slice(mainStart, mainEnd);
    if (timeline.includes(dialogue)) {
      // 对白原文在时间线内但没套标签：把引号包裹或裸原文替换成标准标签。
      let replaced = false;
      for (const quoted of [`“${dialogue}”`, `‘${dialogue}’`, `"${dialogue}"`, `'${dialogue}'`]) {
        if (timeline.includes(quoted)) {
          timeline = timeline.replace(quoted, tag);
          replaced = true;
          break;
        }
      }
      if (!replaced) timeline = timeline.replace(dialogue, tag);
      result = result.slice(0, mainStart) + timeline + result.slice(mainEnd);
      return;
    }
    dialoguesToInsert.push([index, tag]);
  });

  if (dialoguesToInsert.length > 0) {
    const [mainStart, mainEnd] = findTimeline(result);
    let timeline = result.slice(mainStart, mainEnd);
    // 找说话动作 cue，插在其后第一个句号之后；找不到则插在 [Shot 1] 后。
    const cue = /(?:开口说话|开始说话|随后说|继续说|说话|演唱|唱着|begins? speaking|starts? speaking|speaks?|says?|sings?)/i.exec(timeline);
    let insertAt: number;
    if (cue) {
      const boundary = /[。！？.!?](?:\s|$)/.exec(timeline.slice(cue.index + cue[0].length));
      insertAt = boundary ? cue.index + cue[0].length + boundary.index + boundary[0].length : cue.index + cue[0].length;
    } else {
      const shot = /\[Shot 1\]\s*/i.exec(timeline);
      insertAt = shot ? shot.index + shot[0].length : 0;
    }
    const sentences = dialoguesToInsert.map(([index, tag], order) => {
      if (["中文", "chinese", "zh", "zh-cn"].includes(outputLanguage.toLowerCase())) {
        const action = order === 0 ? "说" : "随后继续说";
        return `画面中的说话者 (S${index}) ${action}：${tag}`;
      }
      const action = order === 0 ? "says" : "then continues";
      return `The on-screen speaker (S${index}) ${action}: ${tag}`;
    });
    const insertion = " " + sentences.join(" ") + " ";
    timeline = timeline.slice(0, insertAt) + insertion + timeline.slice(insertAt);
    result = result.slice(0, mainStart) + timeline + result.slice(mainEnd);
  }
  return result.replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * 后处理5（仅 FL2VA）：确保输出含有裸小写 picture 1 / picture 2 标签
 * （对应 Python `_ensure_fl2va_picture_labels`）。
 */
export function ensureFl2vaPictureLabels(text: string, task: string, duration: number, outputLanguage: string): string {
  if (String(task).toUpperCase() !== "FL2VA") return text;
  const lowered = String(text).toLowerCase();
  if (lowered.includes("picture 1") && lowered.includes("picture 2")) return text;
  const alignment = ["中文", "chinese", "zh", "zh-cn"].includes(outputLanguage.toLowerCase())
    ? `参考图像与目标视频对齐关系：picture 1 对齐目标视频的 0.00 秒首帧；picture 2 对齐目标视频的 ${duration.toFixed(2)} 秒尾帧。`
    : `Reference-picture alignment: picture 1 is the target video's exact opening frame at 0.00s; picture 2 is its exact ending frame at ${duration.toFixed(2)}s.`;
  return `${alignment}\n\n${text}`.trim();
}

/**
 * 后处理链（对应 Python `_run_prompt_optimization` 里拿到模型文本之后的部分）。
 * 顺序与 Python 完全一致：
 * 去文件名 → 章节格式化 → FL2VA补标签 → 补对白 → 缩写规范化
 */
export function postProcessPrompt(
  rawText: string,
  task: string,
  duration: number,
  userPrompt: string,
  outputLanguage: string,
): string {
  let formatted = formatPromptSections(stripFilenames(rawText));
  formatted = ensureFl2vaPictureLabels(formatted, task, duration, outputLanguage);
  formatted = ensureSuppliedDialogues(formatted, userPrompt, outputLanguage);
  return normalizeSubjectShorthand(formatted);
}
