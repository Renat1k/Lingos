// LINGUA/OS · Gemini API, AI explain and AI Studio
"use strict";

    const GEMINI_SYSTEM_PROMPT = `
You are the LINGUA/OS content generator. Return ONLY one valid JSON object.
Never wrap JSON in markdown, never add prose before or after it.

Allowed response shape:
{
  "vocab": [
    { "word": "string", "translation": "string", "description": "string", "tags": ["string"] }
  ],
  "lessons": [
    {
      "title": "string",
      "subtitle": "string",
      "level": "A1|A2|B1|B2",
      "duration": "string",
      "blocks": [
        { "type": "theory", "title": "string", "content": "string" },
        { "type": "reading_heavy", "title": "string", "text": "<p>story text</p>" },
        { "type": "dialogue", "title": "string", "participants": [{ "id": "a", "name": "A", "initials": "A" }], "messages": [{ "from": "a", "text": "string", "time": "10:00" }] },
        {
          "type": "quiz",
          "title": "string",
          "questions": [
            { "question": "string", "options": ["string", "string"], "correct": 0, "explanation": "string" }
          ]
        },
        { "type": "practice_write", "title": "string", "min_words": 30, "prompt": "string" }
      ]
    }
  ],
  "stories": [
    { "title": "string", "subtitle": "string", "level": "A1|A2|B1|B2", "read_time": "string", "text": "<p>story text</p>" }
  ]
}

Rules:
- Return exactly one of "lessons", "stories" or "vocab" at the root, matching the requested type.
- Every lesson has at least one valid block. Allowed block types: theory, reading_heavy, dialogue, quiz, practice_write.
- Quiz "correct" is a zero-based index into "options"; options must contain at least two strings.
- "reading_heavy" and story "text" use simple HTML paragraphs only.
- All learner-facing content must be in the requested learning language.
- Keep the material age-appropriate, accurate and self-contained.
- Do not use markdown fences.
`.trim();

    const AI_DIAGNOSTIC_QUESTIONS = [
      { id: "skill", label: "ai_diag_skill", options: ["ai_skill_grammar", "ai_skill_vocab", "ai_skill_reading", "ai_skill_writing"] },
      { id: "grammar", label: "ai_diag_grammar", options: ["ai_grammar_tenses", "ai_grammar_articles", "ai_grammar_prepositions", "ai_grammar_word_order"] },
      { id: "practice", label: "ai_diag_practice", options: ["ai_practice_reading", "ai_practice_writing", "ai_practice_quiz", "ai_practice_dialogue"] },
      { id: "level", label: "ai_diag_level", options: ["ai_level_a1", "ai_level_a2", "ai_level_b1", "ai_level_b2"] }
    ];

    let geminiModelCache = "";
    let aiSelectionState = null;
    let aiSelectionTimer = null;
    let aiGeneratedState = null;
    let aiStudioBusy = false;
    const aiAnalyzeButton = document.getElementById("aiAnalyzeBtn");

    /* ---------- Gemini transport ---------- */

    function getGeminiKey() {
      return String(state.geminiKey || "").trim();
    }

    function geminiError(code, status) {
      const error = new Error(code || "gemini_error");
      error.geminiCode = code || "gemini_error";
      if (status) error.geminiStatus = status;
      return error;
    }

    function geminiErrorMessage(error) {
      if (!error) return t("gemini_error_generic");
      if (error.geminiCode === "missing") return t("gemini_error_missing_key");
      if (error.geminiCode === "models") return t("gemini_error_models");
      if (error.geminiCode === "parse") return t("gemini_error_parse");
      if (error.geminiCode === "empty") return t("gemini_error_empty");
      if (error.geminiCode === "validation") return t("gemini_error_validation");
      if (error.geminiCode === "network") return t("gemini_error_network");
      if (error.geminiCode === "timeout" || error.name === "AbortError") return t("gemini_error_timeout");
      if (error.geminiStatus === 400) return t("gemini_error_400");
      if (error.geminiStatus === 403) return t("gemini_error_403");
      if (error.geminiStatus === 429) return t("gemini_error_429");
      if (error instanceof TypeError) return t("gemini_error_network");
      return t("gemini_error_generic");
    }

    function setGeminiStatus(kind, detail) {
      if (!geminiStatus) return;
      geminiStatus.dataset.state = kind || "";
      if (!kind) {
        geminiStatus.textContent = "";
        return;
      }
      if (kind === "ok") geminiStatus.textContent = `🟢 ${detail ? t("gemini_connected_model", { model: detail }) : t("connected")}`;
      else if (kind === "error") geminiStatus.textContent = `🔴 ${t("error")}${detail ? ` · ${detail}` : ""}`;
      else if (kind === "missing") geminiStatus.textContent = `⚪ ${t("missing")}`;
      else if (kind === "checking") geminiStatus.textContent = `⏳ ${t("gemini_checking")}`;
      else geminiStatus.textContent = detail || "";
    }

    function saveGeminiKey(value) {
      state.geminiKey = String(value || "").trim();
      try {
        if (state.geminiKey) window.localStorage.setItem(GEMINI_KEY_STORAGE, state.geminiKey);
        else window.localStorage.removeItem(GEMINI_KEY_STORAGE);
      } catch (error) { /* storage can be unavailable */ }
    }

    async function geminiRequest(path, options = {}) {
      const key = getGeminiKey();
      if (!key) throw geminiError("missing");
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), Number(options.timeout) || 22000);
      try {
        const response = await fetch(`${GEMINI_API_BASE}${path}`, {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            [GEMINI_KEY_HEADER]: key
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal
        });
        if (!response.ok) throw geminiError("http", response.status);
        return await response.json();
      } catch (error) {
        if (error.geminiCode) throw error;
        if (error.name === "AbortError") throw geminiError("timeout");
        throw geminiError("network");
      } finally {
        window.clearTimeout(timer);
      }
    }

    function flashModelScore(name) {
      const match = String(name).match(/gemini-(\d+)(?:\.(\d+))?/);
      let score = match ? Number(match[1]) * 100 + Number(match[2] || 0) : 0;
      if (name.includes("flash-latest")) score += 15;
      if (name.includes("preview")) score -= 1;
      if (name.includes("lite")) score -= 8;
      return score;
    }

    function selectFlashModel(models) {
      const candidates = (Array.isArray(models) ? models : [])
        .filter((model) => {
          const name = String(model?.name || "").toLowerCase();
          const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
          return name.includes("flash")
            && !name.includes("embedding")
            && !name.includes("image")
            && !name.includes("tts")
            && (!methods.length || methods.includes("generateContent"));
        })
        .map((model) => ({
          name: String(model.name || "").replace(/^models\//, ""),
          score: flashModelScore(String(model.name || ""))
        }))
        .filter((model) => model.name)
        .sort((a, b) => b.score - a.score || b.name.localeCompare(a.name));
      if (!candidates.length) throw geminiError("models");
      return candidates[0].name;
    }

    async function fetchGeminiModels(force = false) {
      if (geminiModelCache && !force) return geminiModelCache;
      if (force) geminiModelCache = "";
      const data = await geminiRequest("/models", { method: "GET", timeout: 12000 });
      const model = selectFlashModel(data?.models);
      geminiModelCache = model;
      state.geminiModel = model;
      return model;
    }

    async function ensureGeminiModel(force = false) {
      return fetchGeminiModels(force);
    }

    async function testGeminiKey() {
      const key = geminiKeyInput.value.trim();
      if (!key) {
        setGeminiStatus("missing");
        geminiKeyInput.focus();
        return;
      }
      saveGeminiKey(key);
      geminiTest.disabled = true;
      setGeminiStatus("checking");
      try {
        const model = await ensureGeminiModel(true);
        setGeminiStatus("ok", model);
        showToast(t("connected"), "success");
      } catch (error) {
        setGeminiStatus("error", geminiErrorMessage(error));
        showToast(geminiErrorMessage(error), "error");
      } finally {
        geminiTest.disabled = false;
      }
    }

    function geminiTextFromResponse(data) {
      const parts = data?.candidates?.[0]?.content?.parts;
      return Array.isArray(parts) ? parts.map((part) => String(part?.text || "")).join("").trim() : "";
    }

    async function generateGeminiText(prompt, options = {}) {
      const model = await ensureGeminiModel();
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: Number.isFinite(options.temperature) ? options.temperature : 0.6,
          maxOutputTokens: Number(options.maxOutputTokens) || 4096
        }
      };
      if (options.json) body.generationConfig.responseMimeType = "application/json";
      if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
      const data = await geminiRequest(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        body,
        timeout: 45000
      });
      const text = geminiTextFromResponse(data);
      if (!text) throw geminiError("empty");
      return text;
    }

    /* ---------- AI explain for selected text ---------- */

    function aiSelectableContainer(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest("[data-ai-selectable], .reading-prose, .story-prose, .chat-body") || null;
    }

    function hideAiSelectionButton() {
      if (aiAnalyzeButton) aiAnalyzeButton.hidden = true;
      aiSelectionState = null;
    }

    function positionAiSelectionButton(rect) {
      if (!aiAnalyzeButton) return;
      const width = aiAnalyzeButton.offsetWidth || 148;
      const left = Math.min(window.innerWidth - width - 10, Math.max(10, rect.left + rect.width / 2 - width / 2));
      const top = rect.top > 56 ? rect.top - 46 : rect.bottom + 10;
      aiAnalyzeButton.style.left = `${left}px`;
      aiAnalyzeButton.style.top = `${Math.max(8, top)}px`;
      aiAnalyzeButton.hidden = false;
    }

    function refreshAiSelectionButton() {
      if (!aiAnalyzeButton || document.getElementById("aiAnalysisModal")?.open) {
        hideAiSelectionButton();
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hideAiSelectionButton();
        return;
      }
      const text = selection.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2) {
        hideAiSelectionButton();
        return;
      }
      const range = selection.getRangeAt(0);
      const container = aiSelectableContainer(range.commonAncestorContainer);
      if (!container) {
        hideAiSelectionButton();
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) {
        hideAiSelectionButton();
        return;
      }
      aiSelectionState = {
        text: text.slice(0, 600),
        context: String(container.textContent || "").replace(/\s+/g, " ").trim().slice(0, 8000)
      };
      positionAiSelectionButton(rect);
    }

    function scheduleAiSelectionButton() {
      window.clearTimeout(aiSelectionTimer);
      aiSelectionTimer = window.setTimeout(refreshAiSelectionButton, 90);
    }

    function openAiAnalysisSheet() {
      const modal = document.getElementById("aiAnalysisModal");
      if (!modal) return;
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }

    function closeAiAnalysisSheet() {
      const modal = document.getElementById("aiAnalysisModal");
      if (!modal) return;
      if (modal.open && typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
    }

    function setAiAnalysisContent(text, isError = false) {
      const body = document.getElementById("aiAnalysisBody");
      if (!body) return;
      body.textContent = text;
      body.classList.toggle("is-error", isError);
    }

    async function analyzeSelectedText() {
      if (!aiSelectionState) return;
      const { text, context } = aiSelectionState;
      hideAiSelectionButton();
      openAiAnalysisSheet();
      if (!getGeminiKey()) {
        setAiAnalysisContent(t("ai_analysis_need_key"), true);
        return;
      }
      setAiAnalysisContent(t("ai_analysis_loading"));
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage]?.label || "Русский";
      const prompt = `Разобрать фразу '${text}' из контекста '${context}'. Дай пословный перевод, грамматический разбор и объяснение идиом. Отвечай строго на языке UI: '${uiLanguage}'.`;
      try {
        const answer = await generateGeminiText(prompt, { temperature: 0.25, maxOutputTokens: 1800 });
        setAiAnalysisContent(answer);
      } catch (error) {
        setAiAnalysisContent(geminiErrorMessage(error), true);
      }
    }

    /* ---------- AI Studio ---------- */

    function setAiStudioStatus(text, isError = false) {
      const node = document.getElementById("aiStudioStatus");
      if (!node) return;
      node.textContent = text || "";
      node.classList.toggle("is-error", isError);
    }

    function renderAiDiagnostics() {
      const host = document.getElementById("aiDiagnostics");
      if (!host) return;
      host.innerHTML = AI_DIAGNOSTIC_QUESTIONS.map((question, questionIndex) => `
        <fieldset class="ai-diagnostic" data-ai-question="${question.id}">
          <legend>${escapeHtml(t(question.label))}</legend>
          <div class="ai-diagnostic-options">
            ${question.options.map((optionKey) => `
              <label class="ai-diagnostic-option">
                <input type="radio" name="ai-diag-${question.id}" value="${escapeHtml(optionKey)}" />
                <span>${escapeHtml(t(optionKey))}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>
      `).join("");
    }

    function getAiDiagnostics() {
      const answers = {};
      for (const question of AI_DIAGNOSTIC_QUESTIONS) {
        const selected = document.querySelector(`input[name="ai-diag-${question.id}"]:checked`);
        if (!selected) return null;
        answers[question.id] = selected.value;
      }
      return answers;
    }

    function openAiStudio() {
      const modal = document.getElementById("aiStudioModal");
      if (!modal) return;
      aiGeneratedState = null;
      const keyMissing = document.getElementById("aiStudioKeyMissing");
      const main = document.getElementById("aiStudioMain");
      const preview = document.getElementById("aiStudioPreview");
      const form = document.getElementById("aiStudioForm");
      if (keyMissing) keyMissing.hidden = Boolean(getGeminiKey());
      if (main) main.hidden = !getGeminiKey();
      if (preview) preview.hidden = true;
      if (form) form.hidden = false;
      setAiStudioStatus("");
      renderAiDiagnostics();
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }

    function closeAiStudio() {
      const modal = document.getElementById("aiStudioModal");
      if (!modal) return;
      if (modal.open && typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
      setAiStudioStatus("");
    }

    function openAiKeySettings() {
      closeAiStudio();
      if (typeof openSettings === "function") openSettings();
      if (typeof setSettingsTab === "function") setSettingsTab("system");
    }

    function aiStudioPrompt(answers) {
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage]?.label || "Русский";
      const type = document.getElementById("aiContentType")?.value || "lessons";
      const topic = document.getElementById("aiTopic")?.value.trim() || t("ai_topic_general");
      const level = document.getElementById("aiLevel")?.value || "B1";
      const weakAreas = [answers.skill, answers.grammar, answers.practice]
        .map((key) => t(key))
        .join(", ");
      return [
        `Learning language: ${languageLabel(currentLanguage())} (${currentLanguage()}).`,
        `UI language: ${uiLanguage}.`,
        `Feature focus: ${weakAreas}.`,
        `Requested content type: ${type}.`,
        `Topic: ${topic}.`,
        `Target level: ${level}.`,
        `Return one JSON object with only the "${type}" array.`,
        "Use natural learner-facing text in the learning language."
      ].join("\n");
    }

    function validateLessonBlocks(lesson) {
      const allowed = Object.keys(TYPE_META);
      if (!Array.isArray(lesson.blocks) || !lesson.blocks.length) throw geminiError("validation");
      lesson.blocks.forEach((block) => {
        if (!block || !allowed.includes(block.type)) throw geminiError("validation");
        if (block.type === "quiz") {
          if (!Array.isArray(block.questions) || !block.questions.length) throw geminiError("validation");
          block.questions.forEach((question) => {
            if (!Array.isArray(question?.options) || question.options.length < 2) throw geminiError("validation");
            if (Number(question.correct) < 0 || Number(question.correct) >= question.options.length) throw geminiError("validation");
          });
        }
        if (block.type === "reading_heavy" && !String(block.text || "").trim()) throw geminiError("validation");
        if (block.type === "dialogue" && (!Array.isArray(block.messages) || !block.messages.length)) throw geminiError("validation");
        if (block.type === "theory" && !String(block.content || "").trim()) throw geminiError("validation");
        if (block.type === "practice_write" && !String(block.prompt || "").trim()) throw geminiError("validation");
      });
    }

    function stripGeneratedId(item) {
      const copy = { ...item };
      delete copy.id;
      return copy;
    }

    function validateGeneratedPayload(raw, type) {
      if (!raw || typeof raw !== "object") throw geminiError("validation");
      const key = type === "lessons" ? "lessons" : type === "stories" ? "stories" : "vocab";
      let items = raw[key];
      if (!Array.isArray(items) && Array.isArray(raw)) items = raw;
      if (!Array.isArray(items) || !items.length) throw geminiError("validation");
      const payload = {};
      if (type === "lessons") {
        const lessons = items.map((item, index) => normalizeImportedLesson(item, index + 1)).filter(Boolean);
        if (!lessons.length) throw geminiError("validation");
        lessons.forEach(validateLessonBlocks);
        payload.lessons = lessons.map(stripGeneratedId);
      } else if (type === "stories") {
        const stories = items.map((item, index) => normalizeImportedStory(item, index + 1)).filter(Boolean);
        if (!stories.length) throw geminiError("validation");
        payload.stories = stories.map(stripGeneratedId);
      } else {
        const vocab = normalizeVocabularyList(items);
        if (!vocab.length) throw geminiError("validation");
        payload.vocab = vocab.map(stripGeneratedId);
      }
      return payload;
    }

    function parseGeminiJson(text) {
      const cleaned = String(text || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const start = Math.min(
        ...["{", "["].map((marker) => {
          const index = cleaned.indexOf(marker);
          return index < 0 ? Number.POSITIVE_INFINITY : index;
        })
      );
      if (!Number.isFinite(start)) throw geminiError("parse");
      const opener = cleaned[start];
      const closer = opener === "{" ? "}" : "]";
      const end = cleaned.lastIndexOf(closer);
      if (end <= start) throw geminiError("parse");
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (error) {
        throw geminiError("parse");
      }
    }

    async function generateAiContent() {
      if (aiStudioBusy) return;
      if (!getGeminiKey()) {
        setAiStudioStatus(t("ai_need_key"), true);
        return;
      }
      const answers = getAiDiagnostics();
      if (!answers) {
        setAiStudioStatus(t("ai_diag_required"), true);
        return;
      }
      const type = document.getElementById("aiContentType")?.value || "lessons";
      const levelByDiagnostic = { ai_level_a1: "A1", ai_level_a2: "A2", ai_level_b1: "B1", ai_level_b2: "B2" };
      const levelSelect = document.getElementById("aiLevel");
      if (levelSelect && levelByDiagnostic[answers.level]) levelSelect.value = levelByDiagnostic[answers.level];
      const generateButton = document.getElementById("aiStudioGenerate");
      aiStudioBusy = true;
      if (generateButton) generateButton.disabled = true;
      setAiStudioStatus(t("ai_generating"));
      try {
        const text = await generateGeminiText(aiStudioPrompt(answers), {
          system: GEMINI_SYSTEM_PROMPT,
          json: true,
          temperature: 0.65,
          maxOutputTokens: 8192
        });
        const raw = parseGeminiJson(text);
        const payload = validateGeneratedPayload(raw, type);
        aiGeneratedState = { payload, type };
        const preview = document.getElementById("aiStudioPreview");
        const form = document.getElementById("aiStudioForm");
        const json = document.getElementById("aiPreviewJson");
        if (json) json.textContent = JSON.stringify(payload, null, 2);
        if (form) form.hidden = true;
        if (preview) preview.hidden = false;
        setAiStudioStatus(t("ai_generated"));
      } catch (error) {
        setAiStudioStatus(geminiErrorMessage(error), true);
      } finally {
        aiStudioBusy = false;
        if (generateButton) generateButton.disabled = false;
      }
    }

    function backToAiForm() {
      const preview = document.getElementById("aiStudioPreview");
      const form = document.getElementById("aiStudioForm");
      if (preview) preview.hidden = true;
      if (form) form.hidden = false;
      aiGeneratedState = null;
      setAiStudioStatus("");
    }

    function importAiPreview() {
      if (!aiGeneratedState) return;
      try {
        const result = importPayload(aiGeneratedState.payload);
        const message = t("ai_imported", {
          lessons: result.lessonsAdded + result.lessonsUpdated,
          stories: result.storiesAdded + result.storiesUpdated,
          vocab: result.vocabAdded + result.vocabUpdated
        });
        closeAiStudio();
        if (typeof rerenderCurrentView === "function") rerenderCurrentView();
        showToast(message, "success");
      } catch (error) {
        setAiStudioStatus(t("ai_invalid_schema"), true);
      }
    }

    /* ---------- listeners ---------- */

    document.addEventListener("selectionchange", scheduleAiSelectionButton);
    document.addEventListener("mouseup", scheduleAiSelectionButton);
    document.addEventListener("keyup", scheduleAiSelectionButton);
    window.addEventListener("scroll", hideAiSelectionButton, true);
    window.addEventListener("resize", hideAiSelectionButton);

    aiAnalyzeButton?.addEventListener("mousedown", (event) => event.preventDefault());
    aiAnalyzeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      analyzeSelectedText();
    });

    document.getElementById("aiAnalysisClose")?.addEventListener("click", closeAiAnalysisSheet);
    document.getElementById("aiAnalysisModal")?.addEventListener("click", (event) => {
      if (event.target.id === "aiAnalysisModal") closeAiAnalysisSheet();
    });

    document.getElementById("openAiStudio")?.addEventListener("click", openAiStudio);
    document.getElementById("aiStudioClose")?.addEventListener("click", closeAiStudio);
    document.getElementById("aiStudioModal")?.addEventListener("click", (event) => {
      if (event.target.id === "aiStudioModal") closeAiStudio();
    });
    document.getElementById("aiStudioOpenKey")?.addEventListener("click", openAiKeySettings);
    document.getElementById("aiStudioGenerate")?.addEventListener("click", generateAiContent);
    document.getElementById("aiPreviewBack")?.addEventListener("click", backToAiForm);
    document.getElementById("aiImportPreview")?.addEventListener("click", importAiPreview);
