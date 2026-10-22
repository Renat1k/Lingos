// LINGUA/OS · visual lesson builder, drafts and JSON export
"use strict";

    /* ---------- builder state ---------- */

    const BUILDER_BLOCK_TYPES = ["theory", "reading_heavy", "dialogue", "quiz", "practice_write"];
    const BUILDER_LABEL_KEYS = {
      theory: "ai_block_theory",
      reading_heavy: "ai_block_reading",
      dialogue: "ai_block_dialogue",
      quiz: "ai_block_quiz",
      practice_write: "ai_block_writing"
    };
    const BUILDER_MAX_HISTORY = 20;

    let builderState = null;
    let builderHistory = [];
    let builderRedo = [];
    let builderErrors = {};
    let builderDraftTimer = null;
    let builderPendingDraft = null;
    let builderPromptDismissed = false;
    let builderDirty = false;
    let builderAi = null;

    function builderAiNewState() {
      return {
        open: false,
        selectedBlock: null,
        messages: [],
        pending: null,
        busy: false,
        status: "",
        statusKind: "",
        controller: null,
        lastRequest: null,
        lastError: null
      };
    }

    function builderClone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function builderBlockLabel(type) {
      return t(BUILDER_LABEL_KEYS[type] || "builder_blocks");
    }

    function builderCreateLesson() {
      return {
        title: "",
        subtitle: "",
        level: "B1",
        module: "",
        duration: "",
        badge: "",
        blocks: []
      };
    }

    function builderCreateBlock(type) {
      const meta = TYPE_META[type] || { tag: "BLOCK" };
      const common = {
        type,
        title: "",
        nav_label: builderBlockLabel(type),
        eyebrow: `${meta.tag} // 01`
      };
      if (type === "theory") {
        return {
          ...common,
          content: "",
          terminal_label: "grammar.rule",
          rule_lines: [],
          formulas: [],
          mistakes: [],
          key_phrases: [],
          fun_fact: "",
          tip: ""
        };
      }
      if (type === "reading_heavy") {
        return {
          ...common,
          intro: "",
          word_count_label: "",
          glossary_hint: "",
          glossary: [],
          text: ""
        };
      }
      if (type === "dialogue") {
        return {
          ...common,
          intro: "",
          setting: "",
          date_label: "",
          viewer: "",
          participants: [],
          messages: [],
          grammar_notes: []
        };
      }
      if (type === "quiz") {
        return {
          ...common,
          intro: "",
          questions: [{ question: "", options: ["", ""], correct: 0, explanation: "" }]
        };
      }
      return {
        ...common,
        prompt: "",
        brief: "",
        min_words: 60,
        max_words: 120,
        constraints: [],
        suggestions: [],
        checklist: [],
        placeholder: "",
        save_label: "",
        restore_hint: ""
      };
    }

    function builderParticipantName(index) {
      return `${t("builder_participants")} ${index + 1}`;
    }

    function builderCreateParticipant(index) {
      const name = builderParticipantName(index);
      return {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        initials: name.charAt(0).toUpperCase(),
        status: "online",
        tone: index % 2 ? "emerald" : "cyan"
      };
    }

    function builderCreateMessage(block) {
      const participants = Array.isArray(block.participants) ? block.participants : [];
      return {
        from: participants[0]?.id || "",
        side: "left",
        text: "",
        time: ""
      };
    }

    function builderHydrateLesson(raw) {
      const lesson = raw && typeof raw === "object" ? builderClone(raw) : builderCreateLesson();
      lesson.title = String(lesson.title || "");
      lesson.subtitle = String(lesson.subtitle || "");
      lesson.level = String(lesson.level || "B1");
      lesson.module = String(lesson.module || "");
      lesson.duration = String(lesson.duration || "");
      lesson.badge = String(lesson.badge || "");
      lesson.blocks = Array.isArray(lesson.blocks) ? lesson.blocks : [];
      lesson.blocks.forEach((block) => {
        if (!block || typeof block !== "object") return;
        block.type = BUILDER_BLOCK_TYPES.includes(block.type) ? block.type : "theory";
        block.title = String(block.title || "");
        block.nav_label = String(block.nav_label || builderBlockLabel(block.type));
        block.eyebrow = String(block.eyebrow || `${(TYPE_META[block.type] || {}).tag || "BLOCK"} // 01`);
        if (block.type === "theory") {
          block.content = String(block.content || "");
          block.terminal_label = String(block.terminal_label || "grammar.rule");
          block.rule_lines = Array.isArray(block.rule_lines) ? block.rule_lines : [];
          block.formulas = Array.isArray(block.formulas) ? block.formulas : [];
          block.mistakes = Array.isArray(block.mistakes) ? block.mistakes : [];
          block.key_phrases = (Array.isArray(block.key_phrases) ? block.key_phrases : []).map((item) => ({
            original: String(item?.original || ""),
            translation: String(item?.translation || ""),
            note: String(item?.note || "")
          }));
          block.fun_fact = String(block.fun_fact || "");
          block.tip = String(block.tip || "");
        }
        if (block.type === "reading_heavy") {
          block.intro = String(block.intro || "");
          block.text = String(block.text || "");
          block.word_count_label = String(block.word_count_label || "");
          block.glossary_hint = String(block.glossary_hint || "");
          block.glossary = (Array.isArray(block.glossary) ? block.glossary : []).map((item) => ({
            word: String(item?.word || ""),
            translation: String(item?.translation || ""),
            explanation: String(item?.explanation || "")
          }));
        }
        if (block.type === "dialogue") {
          block.intro = String(block.intro || "");
          block.setting = String(block.setting || "");
          block.date_label = String(block.date_label || "");
          block.participants = (Array.isArray(block.participants) ? block.participants : []).map((participant, index) => ({
            ...participant,
            id: String(participant.id || `p_${index + 1}_${Math.random().toString(36).slice(2, 7)}`),
            name: String(participant.name || builderParticipantName(index)),
            initials: String(participant.initials || String(participant.name || "?").charAt(0).toUpperCase()),
            status: String(participant.status || "online"),
            tone: participant.tone === "emerald" ? "emerald" : "cyan"
          }));
          block.viewer = String(block.viewer || block.participants[0]?.id || "");
          block.messages = (Array.isArray(block.messages) ? block.messages : []).map((message) => ({
            ...message,
            from: String(message.from || block.participants[0]?.id || ""),
            side: message.side === "right" || message.side === "left"
              ? message.side
              : (message.from === block.viewer ? "right" : "left"),
            text: String(message.text || ""),
            time: String(message.time || "")
          }));
          block.grammar_notes = Array.isArray(block.grammar_notes) ? block.grammar_notes : [];
        }
        if (block.type === "quiz") {
          block.intro = String(block.intro || "");
          block.questions = (Array.isArray(block.questions) ? block.questions : []).map((question) => ({
            ...question,
            question: String(question.question || ""),
            options: Array.isArray(question.options) ? question.options.map((option) => String(option || "")) : ["", ""],
            correct: Math.max(0, Number(question.correct) || 0),
            explanation: String(question.explanation || "")
          }));
        }
        if (block.type === "practice_write") {
          block.prompt = String(block.prompt || "");
          block.brief = String(block.brief || "");
          block.min_words = Math.max(1, Number(block.min_words) || 60);
          block.max_words = Math.max(block.min_words, Number(block.max_words) || 120);
          block.constraints = Array.isArray(block.constraints) ? block.constraints.map(String) : [];
          block.suggestions = Array.isArray(block.suggestions) ? block.suggestions.map(String) : [];
          block.checklist = Array.isArray(block.checklist) ? block.checklist.map(String) : [];
          block.placeholder = String(block.placeholder || "");
          block.save_label = String(block.save_label || "");
          block.restore_hint = String(block.restore_hint || "");
        }
      });
      return lesson;
    }

    function builderDraftTime(iso) {
      const locales = { ru: "ru-RU", en: "en-US", da: "da-DK", tr: "tr-TR" };
      const date = new Date(iso || Date.now());
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat(locales[state.settings.uiLanguage] || "en-US", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
      }).format(date);
    }

    function builderDraftKey(language = state.language) {
      return `lingua_builder_draft_${language || "en"}`;
    }

    function builderLoadDraft(language = state.language) {
      try {
        const raw = window.localStorage.getItem(builderDraftKey(language));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !parsed.lesson) return null;
        return {
          ...parsed,
          lesson: builderHydrateLesson(parsed.lesson)
        };
      } catch (error) {
        return null;
      }
    }

    function builderDraftStatus(text) {
      const status = document.getElementById("builderDraftState");
      if (status) status.textContent = text || "";
    }

    function builderSaveDraftNow() {
      if (!builderState) return;
      const payload = {
        version: 1,
        language: state.language,
        editingId: builderState.editingId,
        originalHidden: Boolean(builderState.originalHidden),
        lesson: builderState.lesson,
        updated_at: new Date().toISOString()
      };
      try {
        window.localStorage.setItem(builderDraftKey(), JSON.stringify(payload));
        builderDraftStatus(t("builder_draft_saved"));
      } catch (error) {
        /* storage can be unavailable */
      }
    }

    function builderScheduleDraft() {
      builderDirty = true;
      builderDraftStatus(t("builder_draft_saving"));
      window.clearTimeout(builderDraftTimer);
      builderDraftTimer = window.setTimeout(builderSaveDraftNow, 260);
    }

    function builderClearDraft(language = state.language) {
      window.clearTimeout(builderDraftTimer);
      builderDraftTimer = null;
      try {
        window.localStorage.removeItem(builderDraftKey(language));
      } catch (error) {
        /* ignore */
      }
    }

    /* ---------- history ---------- */

    function builderHistorySnapshot() {
      return builderState ? JSON.stringify(builderState.lesson) : "";
    }

    function builderPushHistory() {
      if (!builderState) return;
      builderDirty = true;
      const snapshot = builderHistorySnapshot();
      if (builderHistory[builderHistory.length - 1] === snapshot) return;
      builderHistory.push(snapshot);
      if (builderHistory.length > BUILDER_MAX_HISTORY) builderHistory.shift();
      builderRedo = [];
      builderUpdateHistoryButtons();
    }

    function builderUpdateHistoryButtons() {
      const undo = document.querySelector("[data-builder-undo]");
      const redo = document.querySelector("[data-builder-redo]");
      if (undo) undo.disabled = !builderHistory.length;
      if (redo) redo.disabled = !builderRedo.length;
    }

    function builderUndo() {
      if (!builderState || !builderHistory.length) return;
      builderRedo.push(builderHistorySnapshot());
      builderState.lesson = JSON.parse(builderHistory.pop());
      builderScheduleDraft();
      renderBuilder(true);
    }

    function builderRedoLast() {
      if (!builderState || !builderRedo.length) return;
      builderHistory.push(builderHistorySnapshot());
      builderState.lesson = JSON.parse(builderRedo.pop());
      builderScheduleDraft();
      renderBuilder(true);
    }

    /* ---------- extension points for the future AI co-author ---------- */

    function getBuilderLessonJson() {
      return builderState ? builderClone(builderState.lesson) : null;
    }

    function getBuilderBlockJson(index) {
      if (!builderState) return null;
      const block = builderState.lesson.blocks[Number(index)];
      return block ? builderClone(block) : null;
    }

    function applyBuilderBlockPatch(index, blockJson) {
      if (!builderState || !blockJson || typeof blockJson !== "object") return false;
      const blockIndex = Number(index);
      if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= builderState.lesson.blocks.length) return false;
      builderPushHistory();
      const mergedBlock = { ...builderState.lesson.blocks[blockIndex], ...builderClone(blockJson) };
      builderState.lesson.blocks[blockIndex] = builderHydrateLesson({ blocks: [mergedBlock] }).blocks[0];
      builderScheduleDraft();
      renderBuilder(true);
      return true;
    }

    function applyBuilderLessonPatch(lessonJson) {
      if (!builderState || !lessonJson || typeof lessonJson !== "object") return false;
      builderPushHistory();
      const next = builderHydrateLesson({ ...builderClone(builderState.lesson), ...builderClone(lessonJson) });
      next.id = builderState.lesson.id;
      next.is_hidden = builderState.lesson.is_hidden;
      builderState.lesson = next;
      builderScheduleDraft();
      renderBuilder(true);
      return true;
    }

    /* ---------- values and validation ---------- */

    function builderGetPath(path) {
      return String(path || "").split(".").reduce((value, key) => value == null ? undefined : value[key], builderState?.lesson);
    }

    function builderSetPath(path, value) {
      if (!builderState) return;
      const parts = String(path || "").split(".");
      let target = builderState.lesson;
      parts.slice(0, -1).forEach((key) => {
        if (target[key] == null) target[key] = {};
        target = target[key];
      });
      target[parts[parts.length - 1]] = value;
    }

    function builderParseLines(value) {
      return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
    }

    function builderParseRules(value) {
      return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        const tone = ["cyan", "emerald", "red", "muted"].includes(parts[2]) ? parts[2] : "cyan";
        return { tone, prompt: parts[0] || "", text: parts[1] || parts[0] };
      });
    }

    function builderRulesValue(block) {
      return (Array.isArray(block.rule_lines) ? block.rule_lines : []).map((line) => [line.prompt || "", line.text || "", line.tone || "cyan"].join(" | ")).join("\n");
    }

    function builderParseObjects(value, keys) {
      return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const parts = line.split("|").map((part) => part.trim());
        return Object.fromEntries(keys.map((key, index) => [key, parts[index] || ""]));
      });
    }

    function builderObjectsValue(items, keys) {
      return (Array.isArray(items) ? items : []).map((item) => keys.map((key) => item?.[key] || "").join(" | ")).join("\n");
    }

    function builderPlainText(html) {
      try {
        const node = document.createElement("div");
        node.innerHTML = sanitizeRichText(String(html || ""));
        return String(node.textContent || "").replace(/\s+/g, " ").trim();
      } catch (error) {
        return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }

    function builderValidate(lessonOverride = null) {
      const errors = {};
      const setError = (key, message) => {
        if (!errors[key]) errors[key] = message;
      };
      const lesson = lessonOverride || builderState?.lesson;
      if (!lesson) return { errors: { lesson: t("builder_error_lesson_title") }, summary: t("builder_validation") };
      if (!String(lesson.title || "").trim()) setError("title", t("builder_error_lesson_title"));
      if (!Array.isArray(lesson.blocks) || !lesson.blocks.length) setError("blocks", t("builder_error_blocks"));
      (lesson.blocks || []).forEach((block, index) => {
        const prefix = `blocks.${index}`;
        if (!String(block.title || "").trim()) setError(`${prefix}.title`, t("builder_error_block_title"));
        if (block.type === "theory" && !String(block.content || "").trim()) setError(`${prefix}.content`, t("builder_error_content"));
        if (block.type === "reading_heavy" && !builderPlainText(block.text)) setError(`${prefix}.text`, t("builder_error_reading"));
        if (block.type === "dialogue") {
          const participants = Array.isArray(block.participants) ? block.participants : [];
          const participantIds = new Set(participants.map((participant) => participant.id));
          if (!participants.length) setError(`${prefix}.participants`, t("builder_error_participants"));
          participants.forEach((participant, participantIndex) => {
            if (!String(participant.name || "").trim()) setError(`${prefix}.participants.${participantIndex}.name`, t("builder_error_participants"));
          });
          const messages = Array.isArray(block.messages) ? block.messages : [];
          if (!messages.length) setError(`${prefix}.messages`, t("builder_error_messages"));
          messages.forEach((message, messageIndex) => {
            if (!participantIds.has(message.from)) setError(`${prefix}.messages.${messageIndex}.from`, t("builder_error_message_from"));
            if (!String(message.text || "").trim()) setError(`${prefix}.messages.${messageIndex}.text`, t("builder_error_message_text"));
          });
        }
        if (block.type === "quiz") {
          const questions = Array.isArray(block.questions) ? block.questions : [];
          if (!questions.length) setError(`${prefix}.questions`, t("builder_error_quiz_question"));
          questions.forEach((question, questionIndex) => {
            if (!String(question.question || "").trim()) setError(`${prefix}.questions.${questionIndex}.question`, t("builder_error_quiz_question"));
            const options = Array.isArray(question.options) ? question.options.filter((option) => String(option || "").trim()) : [];
            if (options.length < 2) setError(`${prefix}.questions.${questionIndex}.options`, t("builder_error_quiz_options"));
            const correct = Number(question.correct);
            if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
              setError(`${prefix}.questions.${questionIndex}.correct`, t("builder_error_quiz_correct"));
            }
          });
        }
        if (block.type === "practice_write" && !String(block.prompt || "").trim()) setError(`${prefix}.prompt`, t("builder_error_prompt"));
      });
      return { errors, summary: Object.keys(errors).length ? t("builder_validation") : "" };
    }

    /* ---------- save ---------- */

    function builderPrepareLesson() {
      const lesson = builderClone(builderState.lesson);
      lesson.title = String(lesson.title || "").trim();
      lesson.subtitle = String(lesson.subtitle || "").trim();
      lesson.level = String(lesson.level || "B1").trim();
      lesson.module = String(lesson.module || "").trim();
      lesson.duration = String(lesson.duration || "").trim();
      lesson.badge = String(lesson.badge || "").trim();
      lesson.blocks = (lesson.blocks || []).map((block, index) => {
        const meta = TYPE_META[block.type] || { tag: "BLOCK" };
        block.title = String(block.title || "").trim();
        block.nav_label = String(block.nav_label || builderBlockLabel(block.type)).trim();
        block.eyebrow = String(block.eyebrow || `${meta.tag} // ${pad(index + 1)}`).trim();
        if (block.type === "theory") {
          block.content = String(block.content || "").trim();
          block.rule_lines = (block.rule_lines || []).filter((line) => String(line.text || "").trim());
          block.key_phrases = (block.key_phrases || []).map((item) => ({
            original: String(item.original || "").trim(),
            translation: String(item.translation || "").trim(),
            note: String(item.note || "").trim()
          })).filter((item) => item.original || item.translation).slice(0, 8);
          block.fun_fact = String(block.fun_fact || "").trim();
        }
        if (block.type === "reading_heavy") {
          block.text = sanitizeRichText(block.text);
          block.glossary = (block.glossary || []).map((item) => ({
            word: String(item.word || "").trim(),
            translation: String(item.translation || "").trim(),
            explanation: String(item.explanation || "").trim()
          })).filter((item) => item.word).slice(0, 8);
        }
        if (block.type === "dialogue") {
          block.participants = (block.participants || []).filter((participant) => String(participant.name || "").trim()).map((participant, index) => ({
            ...participant,
            id: String(participant.id || `p_${index + 1}`),
            name: String(participant.name || "").trim(),
            initials: String(participant.initials || String(participant.name || "?").charAt(0).toUpperCase()),
            status: String(participant.status || "online"),
            tone: participant.tone === "emerald" ? "emerald" : "cyan"
          }));
          const ids = new Set(block.participants.map((participant) => participant.id));
          block.viewer = ids.has(block.viewer) ? block.viewer : (block.participants[0]?.id || "");
          block.messages = (block.messages || []).filter((message) => ids.has(message.from) && String(message.text || "").trim()).map((message, index) => ({
            ...message,
            from: String(message.from || ""),
            side: message.side === "right" ? "right" : "left",
            text: String(message.text || "").trim(),
            time: String(message.time || "").trim()
          }));
        }
        if (block.type === "quiz") {
          block.questions = (block.questions || []).map((question) => {
            const options = (question.options || []).map((option) => String(option || "").trim()).filter(Boolean);
            return {
              ...question,
              question: String(question.question || "").trim(),
              options,
              correct: Math.max(0, Math.min(options.length - 1, Number(question.correct) || 0)),
              explanation: String(question.explanation || "").trim()
            };
          }).filter((question) => question.question);
        }
        if (block.type === "practice_write") {
          block.prompt = String(block.prompt || "").trim();
          block.brief = String(block.brief || "").trim();
          block.min_words = Math.max(1, Number(block.min_words) || 60);
          block.max_words = Math.max(block.min_words, Number(block.max_words) || 120);
          block.constraints = (block.constraints || []).map(String).filter(Boolean);
          block.suggestions = (block.suggestions || []).map(String).filter(Boolean);
          block.checklist = (block.checklist || []).map(String).filter(Boolean);
          block.placeholder = String(block.placeholder || "").trim();
        }
        return block;
      });
      return lesson;
    }

    function builderSave() {
      if (!builderState) return;
      const validation = builderValidate();
      builderErrors = validation.errors;
      if (Object.keys(builderErrors).length) {
        renderBuilder(true);
        window.setTimeout(() => document.querySelector('[aria-invalid="true"]')?.focus(), 30);
        showToast(validation.summary || t("builder_validation"), "error");
        return;
      }
      const wasEditing = Boolean(builderState.editingId);
      const prepared = builderPrepareLesson();
      const targetId = builderState.editingId || nextLessonId();
      prepared.id = targetId;
      if (builderState.originalHidden) prepared.is_hidden = true;
      try {
        const result = importPayload({ lessons: [prepared] });
        if (!result.lessonsAdded && !result.lessonsUpdated) throw new Error(t("builder_validation"));
        builderClearDraft();
        builderAi?.controller?.abort();
        builderState = null;
        builderAi = null;
        builderDirty = false;
        document.body.classList.remove("builder-open", "builder-ai-open");
        if (window.location.hash !== "#dashboard") window.history.replaceState(null, "", "#dashboard");
        state.view = "dashboard";
        renderDashboard();
        showToast(t(wasEditing ? "builder_lesson_updated" : "builder_lesson_saved"), "success");
      } catch (error) {
        showToast(error?.message || t("builder_validation"), "error");
      }
    }

    /* ---------- markup ---------- */

    function builderErrorMarkup(key) {
      const message = builderErrors[key];
      return message ? `<em class="builder-field-error">${escapeHtml(message)}</em>` : "";
    }

    function builderField(path, label, value, options = {}) {
      const error = Boolean(builderErrors[path]);
      return `
        <label class="builder-field${error ? " has-error" : ""}">
          <span>${escapeHtml(label)}${options.required ? ` <i aria-hidden="true">*</i>` : ""}</span>
          <input
            type="${options.type || "text"}"
            value="${escapeHtml(value == null ? "" : value)}"
            data-builder-path="${path}"
            ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""}
            ${options.list ? `list="${options.list}"` : ""}
            ${options.required ? 'aria-required="true"' : ""}
            aria-invalid="${error}"
            autocomplete="off"
          />
          ${builderErrorMarkup(path)}
        </label>
      `;
    }

    function builderTextarea(path, label, value, options = {}) {
      const error = Boolean(builderErrors[path]);
      return `
        <label class="builder-field builder-field-wide${error ? " has-error" : ""}">
          <span>${escapeHtml(label)}${options.required ? ` <i aria-hidden="true">*</i>` : ""}</span>
          <textarea
            rows="${options.rows || 3}"
            data-builder-path="${path}"
            ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""}
            ${options.required ? 'aria-required="true"' : ""}
            aria-invalid="${error}"
          >${escapeHtml(value == null ? "" : value)}</textarea>
          ${options.hint ? `<small class="builder-hint">${escapeHtml(options.hint)}</small>` : ""}
          ${builderErrorMarkup(path)}
        </label>
      `;
    }

    function builderSelect(path, label, value, choices, options = {}) {
      const error = Boolean(builderErrors[path]);
      return `
        <label class="builder-field${error ? " has-error" : ""}">
          <span>${escapeHtml(label)}</span>
          <select data-builder-path="${path}" aria-invalid="${error}">
            ${choices.map((choice) => `<option value="${escapeHtml(choice.value)}"${String(choice.value) === String(value) ? " selected" : ""}>${escapeHtml(choice.label)}</option>`).join("")}
          </select>
          ${builderErrorMarkup(path)}
        </label>
      `;
    }

    function renderBuilderParticipants(block, blockIndex) {
      const participants = Array.isArray(block.participants) ? block.participants : [];
      return `
        <div class="builder-subsection">
          <div class="builder-subhead">
            <h3>${escapeHtml(t("builder_participants"))}</h3>
            <button class="btn btn-quiet" type="button" data-builder-action="add-participant" data-index="${blockIndex}">+ ${escapeHtml(t("builder_add_participant"))}</button>
          </div>
          ${builderErrorMarkup(`blocks.${blockIndex}.participants`)}
          ${participants.length ? participants.map((participant, participantIndex) => `
            <div class="builder-participant-row">
              <label class="builder-field">
                <span>${escapeHtml(t("builder_participant_name"))}</span>
                <input type="text" value="${escapeHtml(participant.name || "")}" data-builder-path="blocks.${blockIndex}.participants.${participantIndex}.name" aria-label="${escapeHtml(t("builder_participant_name"))}" />
                ${builderErrorMarkup(`blocks.${blockIndex}.participants.${participantIndex}.name`)}
              </label>
              ${builderSelect(`blocks.${blockIndex}.participants.${participantIndex}.tone`, t("builder_tone"), participant.tone || "cyan", [
                { value: "cyan", label: "Cyan" },
                { value: "emerald", label: "Emerald" }
              ])}
              <button class="btn btn-quiet builder-row-delete" type="button" data-builder-action="remove-participant" data-index="${blockIndex}" data-subindex="${participantIndex}" data-i18n-aria="delete_item" aria-label="${escapeHtml(t("delete_item"))}">✕</button>
            </div>
          `).join("") : `<p class="builder-hint">${escapeHtml(t("builder_no_participants"))}</p>`}
        </div>
      `;
    }

    function renderBuilderMessages(block, blockIndex) {
      const participants = Array.isArray(block.participants) ? block.participants : [];
      const messages = Array.isArray(block.messages) ? block.messages : [];
      const choices = participants.map((participant) => ({ value: participant.id, label: participant.name }));
      return `
        <div class="builder-subsection">
          <div class="builder-subhead">
            <h3>${escapeHtml(t("builder_messages"))}</h3>
            <button class="btn btn-quiet" type="button" data-builder-action="add-message" data-index="${blockIndex}"${participants.length ? "" : " disabled"}>+ ${escapeHtml(t("builder_add_message"))}</button>
          </div>
          ${builderErrorMarkup(`blocks.${blockIndex}.messages`)}
          <div class="builder-messages">
            ${messages.length ? messages.map((message, messageIndex) => `
              <div class="builder-message-row">
                <div class="builder-message-main">
                  ${builderSelect(`blocks.${blockIndex}.messages.${messageIndex}.from`, t("builder_message_from"), message.from, choices)}
                  ${builderSelect(`blocks.${blockIndex}.messages.${messageIndex}.side`, t("builder_message_side"), message.side || "left", [
                    { value: "left", label: t("builder_side_left") },
                    { value: "right", label: t("builder_side_right") }
                  ])}
                  ${builderField(`blocks.${blockIndex}.messages.${messageIndex}.text`, t("builder_message_text"), message.text, { required: true })}
                  ${builderField(`blocks.${blockIndex}.messages.${messageIndex}.time`, t("builder_message_time"), message.time)}
                </div>
                <div class="builder-row-actions">
                  <button class="icon-btn" type="button" data-builder-action="message-up" data-index="${blockIndex}" data-subindex="${messageIndex}" aria-label="${escapeHtml(t("builder_move_up"))}" ${messageIndex === 0 ? "disabled" : ""}>↑</button>
                  <button class="icon-btn" type="button" data-builder-action="message-down" data-index="${blockIndex}" data-subindex="${messageIndex}" aria-label="${escapeHtml(t("builder_move_down"))}" ${messageIndex === messages.length - 1 ? "disabled" : ""}>↓</button>
                  <button class="icon-btn" type="button" data-builder-action="remove-message" data-index="${blockIndex}" data-subindex="${messageIndex}" aria-label="${escapeHtml(t("delete_item"))}">✕</button>
                </div>
                ${builderErrorMarkup(`blocks.${blockIndex}.messages.${messageIndex}.from`)}
                ${builderErrorMarkup(`blocks.${blockIndex}.messages.${messageIndex}.text`)}
              </div>
            `).join("") : `<p class="builder-hint">${escapeHtml(t("builder_error_messages"))}</p>`}
          </div>
        </div>
      `;
    }

    function renderBuilderQuestions(block, blockIndex) {
      const questions = Array.isArray(block.questions) ? block.questions : [];
      return `
        <div class="builder-subsection">
          <div class="builder-subhead">
            <h3>${escapeHtml(t("builder_quiz_questions"))}</h3>
            <button class="btn btn-quiet" type="button" data-builder-action="add-question" data-index="${blockIndex}">+ ${escapeHtml(t("builder_add_question"))}</button>
          </div>
          ${questions.map((question, questionIndex) => {
            const options = Array.isArray(question.options) ? question.options : [];
            const choices = options.map((option, index) => ({ value: index, label: `${String.fromCharCode(65 + index)} — ${option || `#${index + 1}`}` }));
            return `
              <article class="builder-question">
                <div class="builder-question-head">
                  <span>${pad(questionIndex + 1)}</span>
                  <div class="builder-row-actions">
                    <button class="icon-btn" type="button" data-builder-action="question-up" data-index="${blockIndex}" data-subindex="${questionIndex}" aria-label="${escapeHtml(t("builder_move_up"))}" ${questionIndex === 0 ? "disabled" : ""}>↑</button>
                    <button class="icon-btn" type="button" data-builder-action="question-down" data-index="${blockIndex}" data-subindex="${questionIndex}" aria-label="${escapeHtml(t("builder_move_down"))}" ${questionIndex === questions.length - 1 ? "disabled" : ""}>↓</button>
                    <button class="icon-btn" type="button" data-builder-action="remove-question" data-index="${blockIndex}" data-subindex="${questionIndex}" aria-label="${escapeHtml(t("delete_item"))}">✕</button>
                  </div>
                </div>
                ${builderTextarea(`blocks.${blockIndex}.questions.${questionIndex}.question`, t("builder_question"), question.question, { required: true, rows: 2 })}
                ${builderTextarea(`blocks.${blockIndex}.questions.${questionIndex}._options`, t("builder_options"), options.join("\n"), { hint: t("builder_options_hint"), rows: 3 })}
                ${builderSelect(`blocks.${blockIndex}.questions.${questionIndex}.correct`, t("builder_correct"), question.correct, choices.length >= 2 ? choices : [
                  { value: 0, label: "A" },
                  { value: 1, label: "B" }
                ])}
                ${builderTextarea(`blocks.${blockIndex}.questions.${questionIndex}.explanation`, t("builder_explanation"), question.explanation, { rows: 2 })}
                ${builderErrorMarkup(`blocks.${blockIndex}.questions.${questionIndex}.question`)}
                ${builderErrorMarkup(`blocks.${blockIndex}.questions.${questionIndex}.options`)}
                ${builderErrorMarkup(`blocks.${blockIndex}.questions.${questionIndex}.correct`)}
              </article>
            `;
          }).join("")}
        </div>
      `;
    }

    function renderBuilderBlockFields(block, index) {
      const prefix = `blocks.${index}`;
      if (block.type === "theory") {
        return `
          ${builderTextarea(`${prefix}.content`, t("builder_theory_content"), block.content, { required: true, rows: 4 })}
          ${builderTextarea(`${prefix}._rules`, t("builder_rule_lines"), builderRulesValue(block), { hint: t("builder_rule_hint"), rows: 3 })}
          ${builderTextarea(`${prefix}._formulas`, t("builder_formulas"), builderObjectsValue(block.formulas, ["label", "structure", "example", "note"]), { hint: t("builder_formulas_hint"), rows: 2 })}
          ${builderTextarea(`${prefix}._mistakes`, t("builder_mistakes"), builderObjectsValue(block.mistakes, ["bad", "good", "why"]), { hint: t("builder_mistakes_hint"), rows: 2 })}
          ${builderTextarea(`${prefix}._key_phrases`, t("builder_key_phrases"), builderObjectsValue(block.key_phrases, ["original", "translation", "note"]), { hint: t("builder_key_phrases_hint"), rows: 2 })}
          ${builderTextarea(`${prefix}.fun_fact`, t("builder_fun_fact"), block.fun_fact, { rows: 2 })}
          ${builderField(`${prefix}.terminal_label`, t("builder_terminal_label"), block.terminal_label)}
          ${builderTextarea(`${prefix}.tip`, t("builder_tip"), block.tip, { rows: 2 })}
        `;
      }
      if (block.type === "reading_heavy") {
        return `
          ${builderTextarea(`${prefix}.intro`, t("builder_intro"), block.intro, { rows: 2 })}
          ${builderTextarea(`${prefix}.text`, t("builder_reading_text"), block.text, { required: true, rows: 7, hint: t("builder_reading_hint") })}
          ${builderField(`${prefix}.word_count_label`, t("builder_word_count"), block.word_count_label)}
          ${builderField(`${prefix}.glossary_hint`, t("builder_glossary_hint"), block.glossary_hint)}
          ${builderTextarea(`${prefix}._glossary`, t("builder_glossary"), builderObjectsValue(block.glossary, ["word", "translation", "explanation"]), { hint: t("builder_glossary_hint_form"), rows: 3 })}
        `;
      }
      if (block.type === "dialogue") {
        return `
          ${builderTextarea(`${prefix}.intro`, t("builder_intro"), block.intro, { rows: 2 })}
          ${builderField(`${prefix}.setting`, t("builder_dialogue_setting"), block.setting)}
          ${builderField(`${prefix}.date_label`, t("builder_dialogue_date"), block.date_label)}
          ${renderBuilderParticipants(block, index)}
          ${renderBuilderMessages(block, index)}
          ${builderTextarea(`${prefix}._notes`, t("builder_grammar_notes"), builderObjectsValue(block.grammar_notes, ["phrase", "explanation"]), { hint: t("builder_notes_hint"), rows: 2 })}
        `;
      }
      if (block.type === "quiz") {
        return `
          ${builderTextarea(`${prefix}.intro`, t("builder_intro"), block.intro, { rows: 2 })}
          ${builderErrorMarkup(`${prefix}.questions`)}
          ${renderBuilderQuestions(block, index)}
        `;
      }
      return `
        ${builderTextarea(`${prefix}.prompt`, t("builder_practice_prompt"), block.prompt, { required: true, rows: 3 })}
        ${builderTextarea(`${prefix}.brief`, t("builder_practice_brief"), block.brief, { rows: 2 })}
        <div class="builder-two-columns">
          ${builderField(`${prefix}.min_words`, t("builder_min_words"), block.min_words, { type: "number" })}
          ${builderField(`${prefix}.max_words`, t("builder_max_words"), block.max_words, { type: "number" })}
        </div>
        ${builderTextarea(`${prefix}._constraints`, t("builder_constraints"), (block.constraints || []).join("\n"), { hint: t("builder_lines_hint"), rows: 2 })}
        ${builderTextarea(`${prefix}._suggestions`, t("builder_suggestions"), (block.suggestions || []).join("\n"), { hint: t("builder_lines_hint"), rows: 2 })}
        ${builderTextarea(`${prefix}._checklist`, t("builder_checklist"), (block.checklist || []).join("\n"), { hint: t("builder_lines_hint"), rows: 2 })}
        ${builderField(`${prefix}.placeholder`, t("builder_placeholder"), block.placeholder)}
      `;
    }

    function renderBuilderBlock(block, index) {
      const meta = TYPE_META[block.type] || { tag: "BLOCK" };
      const selected = Number(builderAi?.selectedBlock) === index;
      return `
        <article class="builder-block-card${selected ? " is-ai-selected" : ""}" data-builder-block="${index}">
          <header class="builder-block-head">
            <div>
              <span class="builder-block-index">${pad(index + 1)} · ${escapeHtml(meta.tag)}</span>
              <h2>${escapeHtml(block.title || builderBlockLabel(block.type))}</h2>
            </div>
            <div class="builder-block-actions">
              <button class="btn btn-quiet builder-ai-select${selected ? " is-active" : ""}" type="button" data-builder-ai-select="${index}" aria-pressed="${selected}">✨ ${escapeHtml(t("builder_ai_select"))}</button>
              <button class="icon-btn" type="button" data-builder-action="block-up" data-index="${index}" aria-label="${escapeHtml(t("builder_move_up"))}" ${index === 0 ? "disabled" : ""}>↑</button>
              <button class="icon-btn" type="button" data-builder-action="block-down" data-index="${index}" aria-label="${escapeHtml(t("builder_move_down"))}" ${index === (builderState.lesson.blocks.length - 1) ? "disabled" : ""}>↓</button>
              <button class="icon-btn" type="button" data-builder-action="duplicate-block" data-index="${index}" aria-label="${escapeHtml(t("builder_duplicate"))}">⧉</button>
              <button class="icon-btn builder-danger" type="button" data-builder-action="delete-block" data-index="${index}" aria-label="${escapeHtml(t("builder_delete_block"))}">✕</button>
            </div>
          </header>
          <div class="builder-block-body">
            ${builderField(`blocks.${index}.title`, t("builder_block_title"), block.title, { required: true })}
            ${renderBuilderBlockFields(block, index)}
          </div>
        </article>
      `;
    }

    function renderBuilder(preserveScroll = false) {
      if (!builderState) return;
      const previousScroll = window.scrollY;
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      if (typeof closeTranslation === "function") closeTranslation();
      builderState.lesson = builderHydrateLesson(builderState.lesson);
      state.view = "builder";
      if (typeof backToLessons !== "undefined") backToLessons.hidden = true;
      document.body.classList.add("builder-open");
      document.body.classList.toggle("builder-ai-open", Boolean(builderAi?.open));
      const lesson = builderState.lesson;
      const blocks = Array.isArray(lesson.blocks) ? lesson.blocks : [];
      const heading = builderState.editingId ? t("builder_edit_lesson") : t("builder_create_title");
      app.innerHTML = `
        <section class="builder-view" aria-labelledby="builderTitle">
          <header class="builder-topbar">
            <button class="icon-btn builder-back" type="button" data-builder-back aria-label="${escapeHtml(t("builder_back"))}">←</button>
            <div class="builder-title-wrap">
              <span class="settings-kicker"><i aria-hidden="true"></i> LESSON_BUILDER / ${escapeHtml(currentLanguage().toUpperCase())}</span>
              <h1 id="builderTitle">${escapeHtml(heading)}</h1>
            </div>
            <div class="builder-top-actions">
              <span class="builder-draft-state" id="builderDraftState" aria-live="polite"></span>
              <button class="btn btn-quiet builder-ai-toggle${builderAi?.open ? " is-active" : ""}" type="button" data-builder-ai-toggle aria-expanded="${Boolean(builderAi?.open)}">✨ ${escapeHtml(t("builder_ai_open"))}</button>
              <button class="icon-btn" type="button" data-builder-undo aria-label="${escapeHtml(t("builder_undo"))}" disabled>↶</button>
              <button class="icon-btn" type="button" data-builder-redo aria-label="${escapeHtml(t("builder_redo"))}" disabled>↷</button>
              <button class="btn btn-primary builder-save" type="button" data-builder-save>${escapeHtml(t("builder_save"))}</button>
            </div>
          </header>
          <main class="builder-main">
            ${Object.keys(builderErrors).length ? `<div class="builder-error-banner" role="alert">${escapeHtml(t("builder_validation"))}</div>` : ""}
            <section class="builder-meta" aria-labelledby="builderMetaTitle">
              <div class="builder-section-head">
                <div>
                  <span class="modules-kicker">LESSON_META</span>
                  <h2 id="builderMetaTitle">${escapeHtml(t("builder_lesson_title"))}</h2>
                </div>
              </div>
              <div class="builder-meta-grid">
                ${builderField("title", t("builder_lesson_title"), lesson.title, { required: true })}
                ${builderField("level", t("builder_level"), lesson.level, { list: "builderLevels" })}
                ${builderField("subtitle", t("builder_subtitle"), lesson.subtitle)}
                ${builderField("module", t("builder_module"), lesson.module)}
                ${builderField("duration", t("builder_duration"), lesson.duration)}
                ${builderField("badge", t("builder_badge"), lesson.badge)}
              </div>
              <datalist id="builderLevels"><option value="A1"></option><option value="A2"></option><option value="B1"></option><option value="B2"></option><option value="C1"></option><option value="C2"></option></datalist>
            </section>
            <section class="builder-blocks-section" aria-labelledby="builderBlocksTitle">
              <div class="builder-section-head">
                <div>
                  <span class="modules-kicker">BLOCKS / ${pad(blocks.length)}</span>
                  <h2 id="builderBlocksTitle">${escapeHtml(t("builder_blocks"))}</h2>
                </div>
                <div class="builder-add-block">
                  <button class="btn btn-quiet builder-ai-whole" type="button" data-builder-ai-whole>✨ ${escapeHtml(t("builder_ai_whole"))}</button>
                  <select id="builderAddType" aria-label="${escapeHtml(t("builder_add_block"))}">
                    ${BUILDER_BLOCK_TYPES.map((type) => `<option value="${type}">${escapeHtml(builderBlockLabel(type))}</option>`).join("")}
                  </select>
                  <button class="btn btn-secondary" type="button" data-builder-add>${icon("plus")} ${escapeHtml(t("builder_add_block"))}</button>
                </div>
              </div>
              ${builderErrorMarkup("blocks")}
              <div class="builder-blocks">${blocks.length ? blocks.map(renderBuilderBlock).join("") : `<div class="builder-empty"><strong>${escapeHtml(t("builder_no_blocks"))}</strong></div>`}</div>
            </section>
          </main>
          ${renderBuilderAiPanelMarkup()}
        </section>
      `;
      topbarContext.textContent = `builder / ${currentLanguage()}`;
      progressValue.textContent = pad(blocks.length);
      topProgressBar.style.width = `${Math.min(100, blocks.length * 10)}%`;
      document.title = `LINGUA/OS — ${heading}`;
      builderUpdateHistoryButtons();
      builderAiScrollLog();
      if (preserveScroll) {
        window.requestAnimationFrame(() => window.scrollTo(0, previousScroll));
      } else {
        window.scrollTo(0, 0);
      }
    }

    /* ---------- AI co-author panel ---------- */

    const BUILDER_AI_LANGUAGE_NAMES = {
      en: "English", tr: "Turkish", da: "Danish", ru: "Russian", de: "German",
      es: "Spanish", fr: "French", it: "Italian", pt: "Portuguese", nl: "Dutch",
      pl: "Polish", sv: "Swedish", no: "Norwegian", fi: "Finnish", ja: "Japanese",
      ko: "Korean", zh: "Chinese", ar: "Arabic", uk: "Ukrainian", cs: "Czech"
    };

    function builderAiContentLanguageName() {
      return BUILDER_AI_LANGUAGE_NAMES[state.language] || languageLabel(state.language) || state.language;
    }

    function builderAiUiLanguageName() {
      return BUILDER_AI_LANGUAGE_NAMES[state.settings.uiLanguage] || BUILDER_AI_LANGUAGE_NAMES.en;
    }

    function builderAiSelectedBlock() {
      if (!builderState || !builderAi || builderAi.selectedBlock == null) return null;
      return builderState.lesson.blocks[builderAi.selectedBlock] || null;
    }

    function builderAiAddMessage(role, text, kind = "text") {
      if (!builderAi) return;
      builderAi.messages.push({
        id: `bai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role,
        text: String(text || ""),
        kind
      });
    }

    function builderAiBlockSchema(type) {
      const schemas = {
        theory: '{"type":"theory","title":"...","nav_label":"...","eyebrow":"...","content":"...","terminal_label":"grammar.rule","rule_lines":[{"tone":"cyan|emerald|red|muted","prompt":"...","text":"..."}],"formulas":[{"label":"...","structure":"...","example":"...","note":"..."}],"mistakes":[{"bad":"...","good":"...","why":"..."}],"tip":"..."}',
        reading_heavy: '{"type":"reading_heavy","title":"...","nav_label":"...","eyebrow":"...","intro":"...","word_count_label":"...","glossary_hint":"...","text":"<p>...</p>"}',
        dialogue: '{"type":"dialogue","title":"...","nav_label":"...","eyebrow":"...","intro":"...","setting":"...","date_label":"...","viewer":"participant_id","participants":[{"id":"participant_id","name":"...","initials":"...","status":"online","tone":"cyan|emerald"}],"messages":[{"from":"participant_id","side":"left|right","text":"...","time":"..."}],"grammar_notes":[{"phrase":"...","explanation":"..."}]}',
        quiz: '{"type":"quiz","title":"...","nav_label":"...","eyebrow":"...","intro":"...","questions":[{"question":"...","options":["...","..."],"correct":0,"explanation":"..."}]}',
        practice_write: '{"type":"practice_write","title":"...","nav_label":"...","eyebrow":"...","prompt":"...","brief":"...","min_words":60,"max_words":120,"constraints":["..."],"suggestions":["..."],"checklist":["..."],"placeholder":"...","save_label":"...","restore_hint":"..."}'
      };
      return schemas[type] || schemas.theory;
    }

    function builderAiSystemPrompt(mode, type, retry = false) {
      const contentLanguage = builderAiContentLanguageName();
      const uiLanguage = builderAiUiLanguageName();
      const schema = mode === "block"
        ? `{"block": ${builderAiBlockSchema(type)}}`
        : '{"lesson": {"title":"...","level":"A1","subtitle":"...","blocks":[...]},"changes":["short change description in the UI language"]}';
      return APP_PROMPTS.BUILDER_COAUTHOR_PROMPT
        .replaceAll("{{contentLanguage}}", contentLanguage)
        .replaceAll("{{code}}", state.language)
        .replaceAll("{{uiLanguage}}", uiLanguage)
        .replaceAll("{{schema}}", schema)
        .replaceAll("{{retry}}", retry ? "Previous answer was invalid: return valid JSON matching the schema." : "");
    }

    function builderAiBlockPrompt(block, task, retry = false) {
      const context = {
        lessonTitle: builderState.lesson.title || "",
        level: builderState.lesson.level || "B1",
        targetLanguage: state.language,
        targetLanguageName: builderAiContentLanguageName(),
        uiLanguage: state.settings.uiLanguage,
        uiLanguageName: builderAiUiLanguageName(),
        blockTypes: builderState.lesson.blocks.map((item) => item.type),
        selectedBlockIndex: builderAi.selectedBlock,
        selectedBlockType: block.type
      };
      return [
        `Task: ${task}`,
        "Context JSON:",
        JSON.stringify(context, null, 2),
        "Selected block JSON — edit only this block:",
        JSON.stringify(block, null, 2),
        retry ? "Your previous answer was invalid. Return the block JSON again, valid and complete." : ""
      ].filter(Boolean).join("\n");
    }

    function builderAiLessonPrompt(task, retry = false) {
      return [
        `Task: ${task}`,
        "Context JSON:",
        JSON.stringify({
          targetLanguage: state.language,
          targetLanguageName: builderAiContentLanguageName(),
          uiLanguage: state.settings.uiLanguage,
          uiLanguageName: builderAiUiLanguageName()
        }, null, 2),
        "Full lesson JSON — improve it without changing title, id, locked, updated_at or created_at:",
        JSON.stringify(getBuilderLessonJson(), null, 2),
        retry ? "Your previous answer was invalid. Return the lesson JSON again, valid and complete." : ""
      ].filter(Boolean).join("\n");
    }

    function builderAiBlockMetrics(block) {
      const plain = builderPlainText(block.type === "reading_heavy" ? block.text : "");
      const metrics = [];
      if (block.type === "theory") {
        metrics.push({ label: t("builder_ai_rules"), value: (block.rule_lines || []).length });
        metrics.push({ label: t("builder_ai_formulas"), value: (block.formulas || []).length });
        metrics.push({ label: t("builder_ai_mistakes"), value: (block.mistakes || []).length });
        metrics.push({ label: t("builder_ai_characters"), value: String(block.content || "").length });
      } else if (block.type === "reading_heavy") {
        metrics.push({ label: t("builder_ai_words"), value: builderPlainText(block.text).split(/\s+/).filter(Boolean).length });
        metrics.push({ label: t("builder_ai_characters"), value: plain.length });
      } else if (block.type === "dialogue") {
        metrics.push({ label: t("builder_ai_participants"), value: (block.participants || []).length });
        metrics.push({ label: t("builder_ai_messages"), value: (block.messages || []).length });
      } else if (block.type === "quiz") {
        const questions = block.questions || [];
        metrics.push({ label: t("builder_ai_questions"), value: questions.length });
        metrics.push({ label: t("builder_ai_options"), value: questions.reduce((sum, question) => sum + (question.options || []).length, 0) });
      } else {
        metrics.push({ label: t("builder_ai_constraints"), value: (block.constraints || []).length });
        metrics.push({ label: t("builder_ai_suggestions"), value: (block.suggestions || []).length });
        metrics.push({ label: t("builder_ai_checklist"), value: (block.checklist || []).length });
        metrics.push({ label: t("builder_ai_characters"), value: String(block.prompt || "").length });
      }
      return metrics;
    }

    function builderAiStatsMarkup(block, isAfter = false) {
      return builderAiBlockMetrics(block).map((metric) => `
        <span><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(String(metric.value))}</strong></span>
      `).join("");
    }

    function builderAiStatusMarkup() {
      if (!builderAi) return "";
      const parts = [];
      if (builderAi.status) parts.push(`<p class="builder-ai-status-text">${escapeHtml(builderAi.status)}</p>`);
      if (builderAi.pending) {
        const pending = builderAi.pending;
        const before = pending.before;
        const after = pending.after;
        const changes = Array.isArray(pending.changes) ? pending.changes : [];
        return `
          <div class="builder-ai-preview">
            <div class="builder-ai-preview-head">
              <strong>${escapeHtml(t("builder_ai_preview"))}</strong>
              <span>${escapeHtml(pending.mode === "block" ? builderBlockLabel(after.type) : t("builder_ai_whole_lesson"))}</span>
            </div>
            ${pending.mode === "block" ? `
              <div class="builder-ai-compare">
                <div><span class="builder-ai-compare-label">${escapeHtml(t("builder_before"))}</span>${builderAiStatsMarkup(before)}</div>
                <div><span class="builder-ai-compare-label">${escapeHtml(t("builder_after"))}</span>${builderAiStatsMarkup(after, true)}</div>
              </div>
            ` : `
              <div class="builder-ai-compare">
                <div><span class="builder-ai-compare-label">${escapeHtml(t("builder_before"))}</span><span><small>${escapeHtml(t("builder_ai_blocks"))}</small><strong>${(before.blocks || []).length}</strong></span></div>
                <div><span class="builder-ai-compare-label">${escapeHtml(t("builder_after"))}</span><span><small>${escapeHtml(t("builder_ai_blocks"))}</small><strong>${(after.blocks || []).length}</strong></span></div>
              </div>
            `}
            ${changes.length ? `<ul class="builder-ai-changes">${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : `<p class="builder-ai-empty">${escapeHtml(t("builder_ai_no_changes"))}</p>`}
            <div class="builder-ai-preview-actions">
              <button class="btn btn-primary" type="button" data-builder-ai-apply>${escapeHtml(t("builder_ai_apply"))}</button>
              <button class="btn btn-quiet" type="button" data-builder-ai-reject>${escapeHtml(t("builder_ai_reject"))}</button>
              <button class="btn btn-secondary" type="button" data-builder-ai-repeat>${escapeHtml(t("builder_ai_repeat"))}</button>
            </div>
          </div>
        `;
      }
      if (builderAi.lastError) {
        const message = builderAi.lastError.builderAiMessage || (typeof geminiErrorDisplay === "function"
          ? geminiErrorDisplay(builderAi.lastError)
          : builderAi.lastError.message || t("builder_ai_error"));
        parts.push(`<p class="builder-ai-error" role="alert">${escapeHtml(message)}</p>`);
        parts.push(`
          <div class="builder-ai-error-actions">
            <button class="btn btn-secondary" type="button" data-builder-ai-retry>${escapeHtml(t("builder_ai_retry"))}</button>
            <button class="btn btn-quiet" type="button" data-builder-ai-provider>${escapeHtml(t("builder_ai_change_provider"))}</button>
          </div>
        `);
      }
      if (builderAi.busy) {
        parts.push(`<button class="btn btn-quiet builder-ai-cancel" type="button" data-builder-ai-cancel>${escapeHtml(t("builder_ai_cancel"))}</button>`);
      }
      return parts.join("");
    }

    function renderBuilderAiPanelMarkup() {
      if (!builderAi) return "";
      const selected = builderAiSelectedBlock();
      const messages = builderAi.messages.length
        ? builderAi.messages.map((message) => `
            <div class="builder-ai-message is-${message.role === "user" ? "user" : "assistant"}${message.kind === "error" ? " is-error" : ""}">
              <span>${escapeHtml(message.role === "user" ? t("builder_ai_you") : t("builder_ai_assistant"))}</span>
              <p>${escapeHtml(message.text)}</p>
            </div>
          `).join("")
        : `<p class="builder-ai-empty">${escapeHtml(t("builder_ai_private"))}</p>`;
      return `
        <aside class="builder-ai-panel${builderAi.open ? " is-open" : ""}" id="builderAiPanel" aria-labelledby="builderAiTitle">
          <header class="builder-ai-head">
            <div>
              <span class="settings-kicker"><i aria-hidden="true"></i> AI / CO-AUTHOR</span>
              <h2 id="builderAiTitle">${escapeHtml(t("builder_ai_title"))}</h2>
            </div>
            <button class="icon-btn" type="button" data-builder-ai-close aria-label="${escapeHtml(t("builder_ai_close"))}">✕</button>
          </header>
          <div class="builder-ai-context">
            <strong>${escapeHtml(t("builder_ai_context"))}</strong>
            <span>${selected ? escapeHtml(t("builder_ai_selected", { type: builderBlockLabel(selected.type) })) : escapeHtml(t("builder_ai_no_selection"))}</span>
          </div>
          <div class="builder-ai-log" id="builderAiLog" aria-live="polite">
            ${messages}
            ${builderAiStatusMarkup()}
          </div>
          <div class="builder-ai-compose">
            <label class="builder-field">
              <span>${escapeHtml(t("builder_ai_task"))}</span>
              <textarea id="builderAiTask" rows="3" placeholder="${escapeHtml(t("builder_ai_placeholder"))}" ${builderAi.busy || builderAi.pending ? "disabled" : ""}></textarea>
            </label>
            ${selected ? "" : `<p class="builder-ai-select-hint">${escapeHtml(t("builder_ai_no_selection"))}</p>`}
            <div class="builder-ai-compose-actions">
              <button class="btn btn-quiet" type="button" data-builder-ai-whole ${builderAi.busy || builderAi.pending ? "disabled" : ""}>✨ ${escapeHtml(t("builder_ai_whole"))}</button>
              <button class="btn btn-primary" type="button" data-builder-ai-send ${builderAi.busy || builderAi.pending ? "disabled" : ""}>${escapeHtml(t("builder_ai_send"))}</button>
            </div>
            <p class="builder-hint">${escapeHtml(t("builder_ai_private"))}</p>
          </div>
        </aside>
      `;
    }

    function builderAiScrollLog() {
      const log = document.getElementById("builderAiLog");
      if (log) log.scrollTop = log.scrollHeight;
    }

    function builderAiUpdatePanel() {
      const panel = document.getElementById("builderAiPanel");
      if (!panel || !builderAi) return;
      panel.outerHTML = renderBuilderAiPanelMarkup();
      document.body.classList.toggle("builder-ai-open", Boolean(builderAi.open));
      const toggle = document.querySelector("[data-builder-ai-toggle]");
      if (toggle) {
        toggle.classList.toggle("is-active", Boolean(builderAi.open));
        toggle.setAttribute("aria-expanded", String(Boolean(builderAi.open)));
      }
      document.querySelectorAll("[data-builder-ai-whole]").forEach((button) => {
        button.disabled = Boolean(builderAi.busy || builderAi.pending);
      });
      builderAiScrollLog();
    }

    function builderAiSetOpen(open) {
      if (!builderAi) return;
      builderAi.open = Boolean(open);
      builderAiUpdatePanel();
    }

    function builderAiError(code, message) {
      const error = new Error(message || code);
      error.builderAiCode = code;
      error.builderAiMessage = message;
      return error;
    }

    function builderAiValidationText(errors) {
      return Object.entries(errors).map(([key, message]) => `${key}: ${message}`).join("; ").slice(0, 600);
    }

    function builderAiNormalizeBlock(rawBlock, expectedType) {
      if (!rawBlock || typeof rawBlock !== "object" || rawBlock.type !== expectedType) {
        throw builderAiError("block_mismatch", t("builder_ai_block_mismatch"));
      }
      const candidate = normalizeImportedLesson({
        title: builderState.lesson.title || "AI block",
        level: builderState.lesson.level || "B1",
        blocks: [rawBlock]
      }, 1);
      if (!candidate || !candidate.blocks?.length) throw builderAiError("schema", t("builder_ai_invalid_schema"));
      const base = builderHydrateLesson({
        ...builderState.lesson,
        title: builderState.lesson.title || "AI block",
        blocks: [candidate.blocks[0]]
      });
      const block = base.blocks[0];
      if (block.type !== expectedType) throw builderAiError("block_mismatch", t("builder_ai_block_mismatch"));
      const validation = builderValidate(base);
      if (Object.keys(validation.errors).length) {
        throw builderAiError("validation", t("builder_ai_validation_detail", { details: builderAiValidationText(validation.errors) }));
      }
      try {
        if (typeof validateLessonBlocks === "function") validateLessonBlocks(base);
      } catch (error) {
        throw builderAiError("schema", t("builder_ai_invalid_schema"));
      }
      return block;
    }

    function builderAiNormalizeLesson(rawLesson) {
      if (!rawLesson || typeof rawLesson !== "object") throw builderAiError("schema", t("builder_ai_invalid_schema"));
      const current = builderState.lesson;
      const merged = {
        ...rawLesson,
        id: current.id,
        title: current.title,
        level: rawLesson.level || current.level,
        locked: current.locked,
        is_hidden: current.is_hidden,
        created_at: current.created_at,
        updated_at: current.updated_at
      };
      const normalized = normalizeImportedLesson(merged, current.id || 1);
      if (!normalized) throw builderAiError("schema", t("builder_ai_invalid_schema"));
      const hydrated = builderHydrateLesson(normalized);
      const validation = builderValidate(hydrated);
      if (Object.keys(validation.errors).length) {
        throw builderAiError("validation", t("builder_ai_validation_detail", { details: builderAiValidationText(validation.errors) }));
      }
      try {
        if (typeof validateLessonBlocks === "function") validateLessonBlocks(hydrated);
      } catch (error) {
        throw builderAiError("schema", t("builder_ai_invalid_schema"));
      }
      return hydrated;
    }

    function builderAiParseBlock(raw, expectedType) {
      const candidate = raw && typeof raw === "object" && raw.block && typeof raw.block === "object" ? raw.block : raw;
      return builderAiNormalizeBlock(candidate, expectedType);
    }

    function builderAiParseLesson(raw) {
      const source = raw && typeof raw === "object" && raw.lesson && typeof raw.lesson === "object" ? raw.lesson : raw;
      const candidate = source && typeof source === "object" ? { ...source } : source;
      if (candidate && typeof candidate === "object") delete candidate.changes;
      const lesson = builderAiNormalizeLesson(candidate);
      const changes = Array.isArray(raw?.changes)
        ? raw.changes.map((change) => String(change || "").trim()).filter(Boolean)
        : [];
      return { lesson, changes };
    }

    async function builderAiRunRequest(request) {
      if (!builderAi || !builderState || builderAi.busy) return;
      const mode = request.mode === "lesson" ? "lesson" : "block";
      const index = mode === "block" ? Number(request.index) : null;
      const block = mode === "block" ? builderState.lesson.blocks[index] : null;
      if (mode === "block" && !block) {
        builderAi.lastError = builderAiError("no_block", t("builder_ai_no_block"));
        builderAiUpdatePanel();
        return;
      }
      if (mode === "lesson" && !String(builderState.lesson.title || "").trim()) {
        builderAi.lastError = builderAiError("title", t("builder_error_lesson_title"));
        builderAiUpdatePanel();
        return;
      }
      const task = String(request.task || "").trim();
      const beforeBlock = block ? builderClone(block) : null;
      const beforeLesson = mode === "lesson" ? getBuilderLessonJson() : null;
      builderAi.lastRequest = { mode, index, task };
      builderAi.pending = null;
      builderAi.lastError = null;
      builderAi.busy = true;
      builderAi.statusKind = "generating";
      builderAi.status = t("builder_ai_status_generating");
      builderAiAddMessage("user", task, "task");
      const controller = new AbortController();
      builderAi.controller = controller;
      builderAiUpdatePanel();

      const run = async (retry) => {
        const prompt = mode === "lesson" ? builderAiLessonPrompt(task, retry) : builderAiBlockPrompt(block, task, retry);
        return generateAiText(prompt, {
          system: builderAiSystemPrompt(mode, block?.type, retry),
          json: true,
          temperature: mode === "lesson" ? 0.2 : 0.35,
          maxOutputTokens: mode === "lesson" ? 16000 : 6000,
          signal: controller.signal,
          onStatus: ({ provider, model }) => {
            if (!builderAi) return;
            builderAi.statusKind = "provider";
            builderAi.status = t("ai_chat_status_provider", {
              provider: typeof aiProviderLabel === "function" ? aiProviderLabel(provider) : provider,
              model: model || ""
            });
            builderAiUpdatePanel();
          },
          onRetry: (payload) => {
            if (!builderAi) return;
            builderAi.statusKind = "retry";
            builderAi.status = typeof formatAiRetryText === "function" ? formatAiRetryText(payload) : t("gemini_retry");
            builderAiUpdatePanel();
          }
        });
      };

      try {
        let parsed = null;
        let result = null;
        let lastFailure = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          builderAi.statusKind = "generating";
          builderAi.status = t("builder_ai_status_generating");
          builderAiUpdatePanel();
          result = await run(attempt > 0);
          if (!builderAi || !builderState) return;
          builderAi.statusKind = "checking";
          builderAi.status = t("builder_ai_status_checking");
          builderAiUpdatePanel();
          if (!result?.text) {
            lastFailure = builderAiError("empty", t("builder_ai_empty"));
          } else if (result.finishReason === "length" || result.finishReason === "max_tokens" || result.finishReason === "MAX_TOKENS") {
            console.warn("[builder-ai] response truncated", {
              finishReason: result.finishReason,
              length: result.text.length,
              provider: result.provider,
              model: result.model,
              maxOutputTokens: mode === "lesson" ? 16000 : 6000,
              text: result.text
            });
            lastFailure = builderAiError("truncated", t("builder_ai_truncated", { n: result.text.length }));
          } else {
            let raw = null;
            try {
              raw = parseGeminiJson(result.text);
            } catch (parseError) {
              console.warn("[builder-ai] invalid JSON", {
                finishReason: result.finishReason,
                length: result.text.length,
                provider: result.provider,
                model: result.model,
                maxOutputTokens: mode === "lesson" ? 16000 : 6000,
                text: result.text
              });
              lastFailure = builderAiError("parse", t("builder_ai_invalid_json"));
            }
            if (raw) {
              try {
                parsed = mode === "lesson" ? builderAiParseLesson(raw) : builderAiParseBlock(raw, block.type);
              } catch (schemaError) {
                console.warn("[builder-ai] invalid schema", {
                  finishReason: result.finishReason,
                  length: result.text.length,
                  provider: result.provider,
                  model: result.model,
                  maxOutputTokens: mode === "lesson" ? 16000 : 6000,
                  message: schemaError?.builderAiMessage || schemaError?.message || "",
                  text: result.text
                });
                lastFailure = schemaError;
              }
            }
          }
          if (parsed) break;
          if (attempt === 0) {
            builderAi.statusKind = "retry";
            builderAi.status = t("builder_ai_status_retry_invalid");
            builderAiUpdatePanel();
            continue;
          }
        }
        if (!builderAi || !builderState) return;
        if (!parsed) throw lastFailure || builderAiError("parse", t("builder_ai_invalid_json"));
        builderAi.busy = false;
        builderAi.controller = null;
        builderAi.statusKind = "ready";
        builderAi.status = t("builder_ai_status_ready");
        builderAi.pending = mode === "lesson"
          ? { mode, request: builderAi.lastRequest, before: beforeLesson, after: parsed.lesson, changes: parsed.changes }
          : { mode, request: builderAi.lastRequest, before: beforeBlock, after: parsed, changes: builderAiBlockChangeList(beforeBlock, parsed) };
        builderAi.lastError = null;
        builderAiAddMessage("assistant", t("builder_ai_preview_ready"), "status");
        builderAiUpdatePanel();
      } catch (error) {
        if (!builderAi) return;
        builderAi.busy = false;
        builderAi.controller = null;
        const aborted = error?.name === "AbortError" || error?.aiCode === "aborted";
        if (aborted) {
          builderAi.statusKind = "cancelled";
          builderAi.status = t("builder_ai_status_cancelled");
          builderAi.lastError = null;
          builderAiAddMessage("assistant", t("builder_ai_cancelled"), "status");
        } else {
          builderAi.statusKind = "error";
          builderAi.status = "";
          builderAi.lastError = error;
          builderAiAddMessage("assistant", error?.builderAiMessage || (typeof geminiErrorDisplay === "function" ? geminiErrorDisplay(error) : t("builder_ai_error")), "error");
        }
        builderAiUpdatePanel();
      }
    }

    function builderAiBlockChangeList(before, after) {
      const oldMetrics = new Map(builderAiBlockMetrics(before).map((metric) => [metric.label, metric.value]));
      return builderAiBlockMetrics(after)
        .filter((metric) => Number(oldMetrics.get(metric.label)) !== Number(metric.value) || String(oldMetrics.get(metric.label)) !== String(metric.value))
        .map((metric) => `${metric.label}: ${oldMetrics.get(metric.label) ?? 0} → ${metric.value}`);
    }

    function builderAiApplyPending() {
      if (!builderAi?.pending) return;
      const pending = builderAi.pending;
      const ok = pending.mode === "lesson"
        ? applyBuilderLessonPatch({
            ...pending.after,
            id: builderState.lesson.id,
            title: builderState.lesson.title,
            locked: builderState.lesson.locked,
            is_hidden: builderState.lesson.is_hidden,
            created_at: builderState.lesson.created_at,
            updated_at: builderState.lesson.updated_at
          })
        : applyBuilderBlockPatch(pending.request.index, pending.after);
      if (!ok) {
        builderAi.lastError = builderAiError("apply", t("builder_ai_error"));
        builderAiUpdatePanel();
        return;
      }
      builderAi.pending = null;
      builderAi.lastError = null;
      builderAi.statusKind = "applied";
      builderAi.status = t("builder_ai_applied");
      builderAiAddMessage("assistant", t("builder_ai_applied"), "status");
      builderAiUpdatePanel();
    }

    function builderAiRejectPending() {
      if (!builderAi?.pending) return;
      builderAi.pending = null;
      builderAi.lastError = null;
      builderAi.statusKind = "rejected";
      builderAi.status = t("builder_ai_rejected");
      builderAiAddMessage("assistant", t("builder_ai_rejected"), "status");
      builderAiUpdatePanel();
    }

    function builderAiRepeatPending() {
      const request = builderAi?.pending?.request || builderAi?.lastRequest;
      if (!request) return;
      builderAi.pending = null;
      void builderAiRunRequest(request);
    }

    function builderAiRetryLast() {
      if (!builderAi?.lastRequest || builderAi.busy) return;
      builderAi.lastError = null;
      void builderAiRunRequest(builderAi.lastRequest);
    }

    function builderAiCancel() {
      if (!builderAi?.busy) return;
      builderAi.controller?.abort();
      builderAi.status = t("builder_ai_status_cancelling");
      builderAiUpdatePanel();
    }

    function builderAiOpenProviderSettings() {
      if (typeof openAiStudioSettings === "function") openAiStudioSettings();
      else if (typeof openSettings === "function") {
        openSettings();
        if (typeof setSettingsTab === "function") setSettingsTab("system");
      }
    }

    /* ---------- builder actions ---------- */

    function builderActionIndex(button, key = "index") {
      return Number(button.dataset[key]);
    }

    function builderAddParticipant(block) {
      block.participants = Array.isArray(block.participants) ? block.participants : [];
      const participant = builderCreateParticipant(block.participants.length);
      block.participants.push(participant);
      if (!block.viewer) block.viewer = participant.id;
    }

    function builderRemoveParticipant(block, participantIndex) {
      const participant = block.participants[participantIndex];
      if (!participant) return;
      block.participants.splice(participantIndex, 1);
      block.messages = (block.messages || []).filter((message) => message.from !== participant.id);
      if (block.viewer === participant.id) block.viewer = block.participants[0]?.id || "";
    }

    function builderHandleAction(action, button) {
      if (!builderState) return;
      const blockIndex = builderActionIndex(button);
      const subIndex = builderActionIndex(button, "subindex");
      const lesson = builderState.lesson;
      const block = lesson.blocks[blockIndex];
      if (action === "block-up" || action === "block-down") {
        const target = action === "block-up" ? blockIndex - 1 : blockIndex + 1;
        if (target < 0 || target >= lesson.blocks.length) return;
        builderPushHistory();
        if (builderAi && builderAi.selectedBlock === blockIndex) builderAi.selectedBlock = target;
        else if (builderAi && builderAi.selectedBlock === target) builderAi.selectedBlock = blockIndex;
        if (builderAi?.pending?.request?.index === blockIndex) builderAi.pending.request.index = target;
        else if (builderAi?.pending?.request?.index === target) builderAi.pending.request.index = blockIndex;
        [lesson.blocks[blockIndex], lesson.blocks[target]] = [lesson.blocks[target], lesson.blocks[blockIndex]];
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "duplicate-block") {
        builderPushHistory();
        lesson.blocks.splice(blockIndex + 1, 0, builderClone(block));
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "delete-block") {
        requestConfirmation({
          title: t("builder_delete_block_title"),
          message: t("builder_delete_block_message"),
          confirmLabel: t("delete_item")
        }).then((confirmed) => {
          if (!confirmed || !builderState) return;
          if (builderAi) {
            if (builderAi.selectedBlock === blockIndex) builderAi.selectedBlock = builderState.lesson.blocks.length > 1 ? Math.min(blockIndex, builderState.lesson.blocks.length - 2) : null;
            else if (builderAi.selectedBlock > blockIndex) builderAi.selectedBlock -= 1;
            if (builderAi.pending?.request?.index === blockIndex) builderAi.pending = null;
            else if (builderAi.pending?.request?.index > blockIndex) builderAi.pending.request.index -= 1;
          }
          builderPushHistory();
          builderState.lesson.blocks.splice(blockIndex, 1);
          builderScheduleDraft();
          renderBuilder(true);
        });
        return;
      }
      if (!block) return;
      if (action === "add-participant") {
        builderPushHistory();
        builderAddParticipant(block);
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "remove-participant") {
        const participant = block.participants?.[subIndex];
        if (!participant) return;
        requestConfirmation({
          title: t("builder_delete_participant_title"),
          message: t("builder_delete_participant_message"),
          confirmLabel: t("delete_item")
        }).then((confirmed) => {
          if (!confirmed || !builderState) return;
          builderPushHistory();
          builderRemoveParticipant(block, subIndex);
          builderScheduleDraft();
          renderBuilder(true);
        });
        return;
      }
      if (action === "add-message") {
        if (!block.participants?.length) return;
        builderPushHistory();
        block.messages = Array.isArray(block.messages) ? block.messages : [];
        block.messages.push(builderCreateMessage(block));
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "remove-message") {
        builderPushHistory();
        block.messages.splice(subIndex, 1);
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "message-up" || action === "message-down") {
        const target = action === "message-up" ? subIndex - 1 : subIndex + 1;
        if (target < 0 || target >= block.messages.length) return;
        builderPushHistory();
        [block.messages[subIndex], block.messages[target]] = [block.messages[target], block.messages[subIndex]];
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "add-question") {
        builderPushHistory();
        block.questions = Array.isArray(block.questions) ? block.questions : [];
        block.questions.push({ question: "", options: ["", ""], correct: 0, explanation: "" });
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "remove-question") {
        builderPushHistory();
        block.questions.splice(subIndex, 1);
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (action === "question-up" || action === "question-down") {
        const target = action === "question-up" ? subIndex - 1 : subIndex + 1;
        if (target < 0 || target >= block.questions.length) return;
        builderPushHistory();
        [block.questions[subIndex], block.questions[target]] = [block.questions[target], block.questions[subIndex]];
        builderScheduleDraft();
        renderBuilder(true);
      }
    }

    /* ---------- input binding ---------- */

    function builderReadValue(input) {
      return input.type === "number" ? Number(input.value) : input.value;
    }

    function builderSetField(path, value) {
      if (!builderState) return;
      if (path.endsWith("._rules")) {
        const blockPath = path.slice(0, -7);
        const block = builderGetPath(blockPath);
        if (block) block.rule_lines = builderParseRules(value);
        return;
      }
      if (path.endsWith("._options")) {
        const parent = builderGetPath(path.slice(0, -9));
        if (parent) parent.options = builderParseLines(value);
        return;
      }
      if (path.endsWith("._constraints") || path.endsWith("._suggestions") || path.endsWith("._checklist")) {
        const suffix = path.slice(path.lastIndexOf("._") + 2);
        const parent = builderGetPath(path.slice(0, path.lastIndexOf("._")));
        if (parent) parent[suffix] = builderParseLines(value);
        return;
      }
      if (path.endsWith("._formulas")) {
        const block = builderGetPath(path.slice(0, -10));
        if (block) block.formulas = builderParseObjects(value, ["label", "structure", "example", "note"]);
        return;
      }
      if (path.endsWith("._mistakes")) {
        const block = builderGetPath(path.slice(0, -10));
        if (block) block.mistakes = builderParseObjects(value, ["bad", "good", "why"]);
        return;
      }
      if (path.endsWith("._key_phrases")) {
        const block = builderGetPath(path.slice(0, -13));
        if (block) block.key_phrases = builderParseObjects(value, ["original", "translation", "note"]);
        return;
      }
      if (path.endsWith("._glossary")) {
        const block = builderGetPath(path.slice(0, -10));
        if (block) block.glossary = builderParseObjects(value, ["word", "translation", "explanation"]);
        return;
      }
      if (path.endsWith("._notes")) {
        const block = builderGetPath(path.slice(0, -7));
        if (block) block.grammar_notes = builderParseObjects(value, ["phrase", "explanation"]);
        return;
      }
      builderSetPath(path, value);
      if (path.endsWith(".name")) {
        const participant = builderGetPath(path.slice(0, -5));
        if (participant && typeof participant === "object") participant.initials = String(participant.name || "?").charAt(0).toUpperCase();
      }
      if (path.endsWith(".correct") || path.endsWith(".min_words") || path.endsWith(".max_words")) {
        builderSetPath(path, Number(value) || 0);
      }
    }

    function builderCurrentFieldValue(path) {
      if (path.endsWith("._rules")) return builderRulesValue(builderGetPath(path.slice(0, -7)) || {});
      if (path.endsWith("._options")) return (builderGetPath(path.slice(0, -9))?.options || []).join("\n");
      if (path.endsWith("._constraints") || path.endsWith("._suggestions") || path.endsWith("._checklist")) {
        const suffix = path.slice(path.lastIndexOf("._") + 2);
        return (builderGetPath(path.slice(0, path.lastIndexOf("._")))?.[suffix] || []).join("\n");
      }
      if (path.endsWith("._formulas")) return builderObjectsValue(builderGetPath(path.slice(0, -10))?.formulas, ["label", "structure", "example", "note"]);
      if (path.endsWith("._mistakes")) return builderObjectsValue(builderGetPath(path.slice(0, -10))?.mistakes, ["bad", "good", "why"]);
      if (path.endsWith("._key_phrases")) return builderObjectsValue(builderGetPath(path.slice(0, -13))?.key_phrases, ["original", "translation", "note"]);
      if (path.endsWith("._glossary")) return builderObjectsValue(builderGetPath(path.slice(0, -10))?.glossary, ["word", "translation", "explanation"]);
      if (path.endsWith("._notes")) return builderObjectsValue(builderGetPath(path.slice(0, -7))?.grammar_notes, ["phrase", "explanation"]);
      return builderGetPath(path);
    }

    function builderInputChanged(input) {
      if (!builderState) return;
      const path = input.dataset.builderPath;
      if (!path) return;
      const value = builderReadValue(input);
      const current = builderCurrentFieldValue(path);
      if (String(current == null ? "" : current) === String(value == null ? "" : value)) return;
      builderPushHistory();
      builderSetField(path, value);
      delete builderErrors[path];
      input.setAttribute("aria-invalid", "false");
      input.closest(".builder-field")?.classList.remove("has-error");
      input.closest(".builder-field")?.querySelector(".builder-field-error")?.remove();
      builderScheduleDraft();
      builderUpdateHistoryButtons();
    }

    /* ---------- draft prompt and open/close ---------- */

    function builderShowDraftPrompt(draft, intent = "manual") {
      builderPendingDraft = { draft, intent };
      const modal = document.getElementById("builderDraftModal");
      const summary = document.getElementById("builderDraftSummary");
      if (!modal) return;
      if (summary) {
        const title = String(draft?.lesson?.title || "").trim();
        const time = draft?.updated_at ? builderDraftTime(draft.updated_at) : "";
        summary.textContent = `${title ? `${title} · ` : ""}${t("builder_draft_summary", { time })}`;
      }
      if (!modal.open) {
        if (typeof modal.showModal === "function") modal.showModal();
        else modal.setAttribute("open", "");
      }
    }

    function builderHideDraftPrompt() {
      const modal = document.getElementById("builderDraftModal");
      if (modal) {
        if (modal.open && typeof modal.close === "function") modal.close();
        else modal.removeAttribute("open");
      }
      builderPendingDraft = null;
    }

    function openLessonBuilder(options = {}) {
      let lesson;
      let editingId = null;
      let originalHidden = false;
      if (options.draft) {
        lesson = builderHydrateLesson(options.draft.lesson);
        editingId = options.draft.editingId ? Number(options.draft.editingId) : null;
        originalHidden = Boolean(options.draft.originalHidden);
      } else if (options.lessonId != null) {
        const existing = state.lessons.find((item) => Number(item.id) === Number(options.lessonId));
        if (!existing) return;
        lesson = builderHydrateLesson(existing);
        editingId = Number(existing.id);
        originalHidden = Boolean(existing.is_hidden);
      } else {
        lesson = builderCreateLesson();
        lesson.blocks.push(builderCreateBlock("theory"));
      }
      builderState = { lesson, editingId, originalHidden };
      builderHistory = [];
      builderRedo = [];
      builderErrors = {};
      builderAi = builderAiNewState();
      builderAi.selectedBlock = lesson.blocks.length ? 0 : null;
      builderDirty = false;
      builderPromptDismissed = true;
      builderHideDraftPrompt();
      renderBuilder();
    }

    function closeBuilderView() {
      if (!builderState) return;
      if (builderDirty) builderSaveDraftNow();
      builderAi?.controller?.abort();
      builderState = null;
      builderAi = null;
      document.body.classList.remove("builder-open", "builder-ai-open");
      if (window.location.hash !== "#dashboard") window.history.replaceState(null, "", "#dashboard");
      state.view = "dashboard";
      renderDashboard();
    }

    function builderManualStart() {
      builderHideDraftPrompt();
      const draft = builderLoadDraft();
      if (draft) {
        builderShowDraftPrompt(draft, "manual");
        return;
      }
      openLessonBuilder();
    }

    function builderMaybePromptDraft() {
      if (builderPromptDismissed || builderState) return;
      const draft = builderLoadDraft();
      if (!draft) return;
      builderShowDraftPrompt(draft, "auto");
    }

    /* ---------- lesson JSON export/copy and edit ---------- */

    function lessonJsonForCopy(lesson) {
      const copy = builderClone(lesson || {});
      delete copy.id;
      delete copy.is_hidden;
      delete copy.created_at;
      delete copy.updated_at;
      delete copy.builder;
      return copy;
    }

    async function copyLessonJson(lesson) {
      try {
        const text = JSON.stringify(lessonJsonForCopy(lesson), null, 2);
        if (typeof copyTextToClipboard === "function") await copyTextToClipboard(text);
        else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else throw new Error("Clipboard unavailable.");
        showToast(t("builder_json_copied"), "success");
      } catch (error) {
        showToast(t("builder_json_copy_failed"), "error");
      }
    }

    function requestEditLesson(lessonId) {
      const lesson = state.lessons.find((item) => Number(item.id) === Number(lessonId));
      if (!lesson) return;
      requestConfirmation({
        title: t("builder_edit_confirm_title"),
        message: t("builder_edit_confirm_message"),
        confirmLabel: t("builder_edit_lesson")
      }).then((confirmed) => {
        if (confirmed) openLessonBuilder({ lessonId });
      });
    }

    /* ---------- create menu ---------- */

    function openLessonCreateModal() {
      const modal = document.getElementById("lessonCreateModal");
      if (!modal) return;
      if (!modal.open) {
        if (typeof modal.showModal === "function") modal.showModal();
        else modal.setAttribute("open", "");
      }
    }

    function closeLessonCreateModal() {
      const modal = document.getElementById("lessonCreateModal");
      if (!modal) return;
      if (modal.open && typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
    }

    function createLessonWithAi() {
      closeLessonCreateModal();
      if (typeof openAiStudio !== "function") return;
      openAiStudio();
      if (typeof switchAiStudioCourse === "function" && activeLanguageCodes().includes(state.language)) {
        switchAiStudioCourse(state.language);
      }
      if (typeof startAiType === "function") startAiType("lessons");
    }

    /* ---------- event listeners ---------- */

    document.addEventListener("click", (event) => {
      const create = event.target.closest("[data-create-lesson]");
      if (create) {
        event.preventDefault();
        openLessonCreateModal();
        return;
      }
      if (event.target.closest("[data-create-with-ai]")) {
        event.preventDefault();
        createLessonWithAi();
        return;
      }
      if (event.target.closest("[data-create-manual]")) {
        event.preventDefault();
        closeLessonCreateModal();
        builderManualStart();
        return;
      }
      if (event.target.closest("[data-create-import]")) {
        event.preventDefault();
        closeLessonCreateModal();
        if (typeof openImportModal === "function") openImportModal();
        return;
      }
      if (event.target.closest("#lessonCreateClose, #lessonCreateCancel")) {
        event.preventDefault();
        closeLessonCreateModal();
        return;
      }
      if (event.target.closest("#builderDraftContinue")) {
        event.preventDefault();
        const draft = builderPendingDraft?.draft || builderLoadDraft();
        if (draft) openLessonBuilder({ draft });
        return;
      }
      if (event.target.closest("#builderDraftRestart")) {
        event.preventDefault();
        builderClearDraft();
        builderHideDraftPrompt();
        openLessonBuilder();
        return;
      }
      if (event.target.closest("#builderDraftCancel")) {
        event.preventDefault();
        builderPromptDismissed = true;
        builderHideDraftPrompt();
        return;
      }
      if (event.target.closest("[data-builder-back]")) {
        event.preventDefault();
        closeBuilderView();
        return;
      }
      if (event.target.closest("[data-builder-save]")) {
        event.preventDefault();
        builderSave();
        return;
      }
      if (event.target.closest("[data-builder-undo]")) {
        event.preventDefault();
        builderUndo();
        return;
      }
      if (event.target.closest("[data-builder-redo]")) {
        event.preventDefault();
        builderRedoLast();
        return;
      }
      if (event.target.closest("[data-builder-add]")) {
        event.preventDefault();
        if (!builderState) return;
        const select = document.getElementById("builderAddType");
        const type = BUILDER_BLOCK_TYPES.includes(select?.value) ? select.value : "theory";
        builderPushHistory();
        builderState.lesson.blocks.push(builderCreateBlock(type));
        builderScheduleDraft();
        renderBuilder(true);
        return;
      }
      if (event.target.closest("[data-builder-ai-toggle]")) {
        event.preventDefault();
        builderAiSetOpen(!builderAi?.open);
        return;
      }
      if (event.target.closest("[data-builder-ai-close]")) {
        event.preventDefault();
        builderAiSetOpen(false);
        return;
      }
      const aiSelect = event.target.closest("[data-builder-ai-select]");
      if (aiSelect) {
        event.preventDefault();
        if (!builderAi || builderAi.busy || builderAi.pending) return;
        builderAi.selectedBlock = Number(aiSelect.dataset.builderAiSelect);
        builderAi.open = true;
        renderBuilder(true);
        return;
      }
      if (event.target.closest("[data-builder-ai-send]")) {
        event.preventDefault();
        if (!builderAi || builderAi.busy || builderAi.pending) return;
        const task = String(document.getElementById("builderAiTask")?.value || "").trim();
        if (!task) {
          builderAi.status = t("builder_ai_task_required");
          builderAiUpdatePanel();
          return;
        }
        void builderAiRunRequest({ mode: "block", index: builderAi.selectedBlock, task });
        return;
      }
      if (event.target.closest("[data-builder-ai-whole]")) {
        event.preventDefault();
        if (!builderAi || builderAi.busy || builderAi.pending) return;
        const task = String(document.getElementById("builderAiTask")?.value || "").trim() || t("builder_ai_whole_task");
        builderAi.open = true;
        void builderAiRunRequest({ mode: "lesson", task });
        return;
      }
      if (event.target.closest("[data-builder-ai-cancel]")) {
        event.preventDefault();
        builderAiCancel();
        return;
      }
      if (event.target.closest("[data-builder-ai-apply]")) {
        event.preventDefault();
        builderAiApplyPending();
        return;
      }
      if (event.target.closest("[data-builder-ai-reject]")) {
        event.preventDefault();
        builderAiRejectPending();
        return;
      }
      if (event.target.closest("[data-builder-ai-repeat]")) {
        event.preventDefault();
        builderAiRepeatPending();
        return;
      }
      if (event.target.closest("[data-builder-ai-retry]")) {
        event.preventDefault();
        builderAiRetryLast();
        return;
      }
      if (event.target.closest("[data-builder-ai-provider]")) {
        event.preventDefault();
        builderAiOpenProviderSettings();
        return;
      }
      const action = event.target.closest("[data-builder-action]");
      if (action) {
        event.preventDefault();
        builderHandleAction(action.dataset.builderAction, action);
        return;
      }
      const copy = event.target.closest("[data-copy-lesson-json]");
      if (copy) {
        event.preventDefault();
        const lesson = state.view === "lesson" ? state.lesson : null;
        if (lesson) void copyLessonJson(lesson);
        return;
      }
      const edit = event.target.closest("[data-edit-lesson]");
      if (edit) {
        event.preventDefault();
        requestEditLesson(edit.dataset.editLesson);
      }
    });

    document.addEventListener("input", (event) => {
      const input = event.target.closest("[data-builder-path]");
      if (input) builderInputChanged(input);
    });

    document.addEventListener("change", (event) => {
      const input = event.target.closest("[data-builder-path]");
      if (input) builderInputChanged(input);
    });

    document.addEventListener("keydown", (event) => {
      if (!builderState) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        builderUndo();
      } else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
        event.preventDefault();
        builderRedoLast();
      }
    });

    window.addEventListener("hashchange", () => {
      if (!builderState) return;
      if (builderDirty) builderSaveDraftNow();
      builderAi?.controller?.abort();
      builderState = null;
      builderAi = null;
      builderDirty = false;
      document.body.classList.remove("builder-open", "builder-ai-open");
    });

    document.getElementById("lessonCreateModal")?.addEventListener("click", (event) => {
      if (event.target.id === "lessonCreateModal") closeLessonCreateModal();
    });

    document.getElementById("builderDraftModal")?.addEventListener("click", (event) => {
      if (event.target.id === "builderDraftModal") {
        builderPromptDismissed = true;
        builderHideDraftPrompt();
      }
    });
    document.getElementById("builderDraftModal")?.addEventListener("close", () => {
      builderPendingDraft = null;
      builderPromptDismissed = true;
    });

    window.setTimeout(builderMaybePromptDraft, 700);
