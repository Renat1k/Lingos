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

    let geminiModelsCache = [];
    let geminiModelsPromise = null;
    let geminiLastActualModel = "";
    let geminiLastFallback = null;
    let geminiPickerToken = 0;
    let aiSelectionState = null;
    let aiSelectionTimer = null;
    let aiLastAnalysis = null;
    let aiAnalysisAbort = null;
    let aiAnalysisLastResult = null;
    const aiAnalyzeButton = document.getElementById("aiAnalyzeBtn");

    /* ---------- Gemini transport, models and errors ---------- */

    function getGeminiKey() {
      return String(state.geminiKey || "").trim();
    }

    function geminiError(code, status, detail = {}) {
      const error = new Error(code || "gemini_error");
      error.geminiCode = code || "gemini_error";
      if (status) error.geminiStatus = status;
      Object.assign(error, detail);
      return error;
    }

    function geminiApiMessage(error) {
      const message = String(error?.geminiApiMessage || "").trim().slice(0, 220);
      const key = getGeminiKey();
      return key && message.includes(key) ? message.replaceAll(key, "[redacted]") : message;
    }

    function geminiErrorTechnical(error) {
      if (!error) return "";
      if (error.aiCode && typeof aiErrorTechnical === "function") return aiErrorTechnical(error);
      const parts = [];
      if (error.geminiModel) parts.push(error.geminiModel);
      if (error.geminiFallbackFrom) parts.push(`${error.geminiFallbackFrom} → ${error.geminiModel || ""}`);
      if (error.geminiStatus) parts.push(`HTTP ${error.geminiStatus}`);
      if (error.geminiApiStatus) parts.push(String(error.geminiApiStatus));
      if (error.geminiApiMessage) parts.push(geminiApiMessage(error));
      if (error.geminiRetryDelay) parts.push(`retry ${error.geminiRetryDelay}`);
      return parts.join(" · ");
    }

    function geminiErrorMessage(error) {
      if (!error) return t("gemini_error_generic");
      if (error.aiCode && typeof aiErrorMessage === "function") return aiErrorMessage(error);
      const message = String(geminiApiMessage(error)).toLowerCase();
      if (error.geminiCode === "missing") return t("gemini_error_missing_key");
      if (error.geminiCode === "models") return t("gemini_error_models");
      if (error.geminiCode === "parse") return t("gemini_error_parse");
      if (error.geminiCode === "empty") return t("gemini_error_empty");
      if (error.geminiCode === "validation") return t("gemini_error_validation");
      if (error.geminiCode === "network") return t("gemini_error_network");
      if (error.geminiCode === "timeout" || error.name === "AbortError") return t("gemini_error_timeout");
      if (error.geminiCode === "blocked") return t("gemini_error_blocked", { reason: error.geminiReason || "unknown" });
      if (error.geminiCode === "safety") return t("gemini_error_safety");
      if (error.geminiCode === "recitation") return t("gemini_error_recitation");
      if (error.geminiCode === "max_tokens") return t("gemini_error_max_tokens");
      if (error.geminiCode === "finish") return t("gemini_error_finish", { reason: error.geminiReason || "unknown" });
      if (error.geminiStatus === 400) {
        if (/api key not valid|invalid api key|api_key_invalid|api key invalid|key invalid/.test(message)) {
          return t("gemini_error_400_key");
        }
        if (/region|location|not available|unsupported/.test(message)) return t("gemini_error_region");
        return t("gemini_error_400_request");
      }
      if (error.geminiStatus === 401) return t("gemini_error_401");
      if (error.geminiStatus === 403) return t("gemini_error_403");
      if (error.geminiStatus === 404) return t("gemini_error_404");
      if (error.geminiStatus === 429) {
        const retry = error.geminiRetryDelay ? ` (${error.geminiRetryDelay})` : "";
        if (error.geminiQuotaScope === "daily") return t("gemini_error_429_daily", { retry });
        if (error.geminiQuotaScope === "minute") return t("gemini_error_429_minute", { retry });
        return t("gemini_error_429", { retry });
      }
      if (error.geminiStatus >= 500) return t("gemini_error_5xx");
      if (error instanceof TypeError) return t("gemini_error_network");
      return t("gemini_error_generic");
    }

    function geminiErrorDisplay(error) {
      const localized = geminiErrorMessage(error);
      const technical = geminiErrorTechnical(error);
      return technical ? `${localized} · ${technical}` : localized;
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

    function savedGeminiModel() {
      try {
        return String(window.localStorage.getItem(GEMINI_MODEL_STORAGE) || state.geminiModel || "").trim();
      } catch (error) {
        return String(state.geminiModel || "").trim();
      }
    }

    function saveGeminiModelPreference(name) {
      const value = String(name || "").replace(/^models\//, "").trim();
      if (!value) return;
      state.geminiModel = value;
      try { window.localStorage.setItem(GEMINI_MODEL_STORAGE, value); } catch (error) { /* storage can be unavailable */ }
    }

    async function geminiRequest(path, options = {}) {
      const key = options.key || getGeminiKey();
      if (!key) throw geminiError("missing");
      const base = options.baseUrl || GEMINI_API_BASE;
      const controller = new AbortController();
      let timedOut = false;
      let externallyAborted = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Number(options.timeout) || 30000);
      const externalAbort = () => {
        externallyAborted = true;
        controller.abort();
      };
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener("abort", externalAbort, { once: true });
      }
      try {
        const response = await fetch(`${base}${path}`, {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            [GEMINI_KEY_HEADER]: key
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal
        });
        if (!response.ok) {
          let apiError = {};
          try {
            const parsed = JSON.parse(await response.text());
            apiError = parsed?.error && typeof parsed.error === "object" ? parsed.error : {};
          } catch (error) { /* non-JSON error body */ }
          const details = Array.isArray(apiError.details) ? apiError.details : [];
          const retryInfo = details.find((item) => String(item?.["@type"] || "").includes("RetryInfo"));
          const quotaFailure = details.find((item) => String(item?.["@type"] || "").includes("QuotaFailure"));
          const quotaText = JSON.stringify(quotaFailure || {});
          const quotaScope = /perday|daily/i.test(quotaText)
            ? "daily"
            : /perminute|minute/i.test(quotaText) ? "minute" : "";
          throw geminiError("http", response.status, {
            geminiModel: options.model || "",
            geminiApiStatus: String(apiError.status || ""),
            geminiApiMessage: String(apiError.message || ""),
            geminiDetails: details,
            geminiRetryDelay: String(retryInfo?.retryDelay || ""),
            geminiQuotaScope: quotaScope
          });
        }
        try {
          return await response.json();
        } catch (error) {
          throw geminiError("parse");
        }
      } catch (error) {
        if (externallyAborted) {
          const aborted = new Error("aborted");
          aborted.name = "AbortError";
          aborted.aiCode = "aborted";
          throw aborted;
        }
        if (error.geminiCode) throw error;
        if (error.name === "AbortError") {
          if (timedOut) throw geminiError("timeout", null, { geminiModel: options.model || "" });
          const aborted = new Error("aborted");
          aborted.name = "AbortError";
          aborted.aiCode = "aborted";
          throw aborted;
        }
        throw geminiError("network", null, { geminiModel: options.model || "" });
      } finally {
        window.clearTimeout(timer);
        options.signal?.removeEventListener("abort", externalAbort);
      }
    }

    async function generateGeminiOnce(prompt, options = {}) {
      const model = String(options.model || "").replace(/^models\//, "").trim();
      if (!model) throw geminiError("models");
      const cap = modelOutputCap(model);
      const requestedMax = Math.max(1, Number(options.maxOutputTokens) || 4096);
      const maxOutputTokens = Math.min(requestedMax, cap || requestedMax);
      const body = {
        contents: [{ role: "user", parts: [{ text: String(prompt || "") }] }],
        generationConfig: {
          temperature: Number.isFinite(options.temperature) ? options.temperature : 0.6,
          maxOutputTokens
        }
      };
      if (options.json) body.generationConfig.responseMimeType = "application/json";
      if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
      const data = await geminiRequest(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        body,
        model,
        key: options.key,
        baseUrl: options.baseUrl,
        signal: options.signal,
        timeout: options.timeout || 60000
      });
      const info = responseInfo(data);
      if (!info.text) throw emptyResponseError(info, model, maxOutputTokens);
      return { text: info.text, finishReason: info.finishReason, model };
    }

    function modelInfo(raw) {
      const name = String(raw?.name || "").replace(/^models\//, "").trim();
      if (!name) return null;
      const lower = name.toLowerCase();
      const methods = Array.isArray(raw?.supportedGenerationMethods) ? raw.supportedGenerationMethods : [];
      if (!methods.includes("generateContent")) return null;
      const version = (() => {
        const match = lower.match(/gemini-(\d+)(?:\.(\d+))?/);
        return match ? Number(match[1]) * 100 + Number(match[2] || 0) : 0;
      })();
      return {
        name,
        displayName: String(raw?.displayName || name),
        version,
        flash: lower.includes("flash"),
        lite: lower.includes("lite"),
        stable: !/(preview|experimental|alpha|beta|(^|[-_.])exp([-_.]|$))/i.test(lower),
        outputTokenLimit: Number(raw?.outputTokenLimit) || 0,
        inputTokenLimit: Number(raw?.inputTokenLimit) || 0
      };
    }

    function modelDisplayName(model) {
      return model?.displayName || model?.name || "";
    }

    function modelVersionScore(model) {
      return model?.version || 0;
    }

    function modelSort(a, b, recommendedName = "") {
      if (a.name === recommendedName) return -1;
      if (b.name === recommendedName) return 1;
      if (a.stable !== b.stable) return Number(b.stable) - Number(a.stable);
      if (modelVersionScore(a) !== modelVersionScore(b)) return modelVersionScore(b) - modelVersionScore(a);
      if (a.lite !== b.lite) return Number(a.lite) - Number(b.lite);
      return a.name.localeCompare(b.name);
    }

    function recommendGeminiModel(models) {
      if (!Array.isArray(models) || !models.length) return null;
      const stableFlash = models.filter((model) => model.stable && model.flash)
        .sort((a, b) => modelVersionScore(b) - modelVersionScore(a) || Number(a.lite) - Number(b.lite));
      if (stableFlash.length) return stableFlash[0];
      const stable = models.filter((model) => model.stable)
        .sort((a, b) => modelVersionScore(b) - modelVersionScore(a));
      if (stable.length) return stable[0];
      const flash = models.filter((model) => model.flash)
        .sort((a, b) => modelVersionScore(b) - modelVersionScore(a));
      return flash[0] || models[0];
    }

    function sortedGeminiModels() {
      const recommendation = recommendGeminiModel(geminiModelsCache);
      return [...geminiModelsCache].sort((a, b) => modelSort(a, b, recommendation?.name || ""));
    }

    function selectedGeminiModel() {
      const saved = savedGeminiModel();
      const savedModel = geminiModelsCache.find((model) => model.name === saved);
      if (savedModel) return savedModel;
      return recommendGeminiModel(geminiModelsCache);
    }

    function fallbackGeminiModel(requestedName) {
      const ordered = sortedGeminiModels();
      const index = ordered.findIndex((model) => model.name === requestedName);
      const after = index >= 0 ? ordered.slice(index + 1) : ordered;
      return after.find((model) => model.name !== requestedName) || null;
    }

    function geminiCandidateModels(preferredName, limit = 3) {
      const models = Array.isArray(geminiModelsCache) ? geminiModelsCache : [];
      if (!models.length) return [];
      const requested = models.find((model) => model.name === preferredName)
        || models.find((model) => model.name === savedGeminiModel())
        || selectedGeminiModel()
        || models[0];
      if (!requested) return [];
      const used = new Set();
      const stable = models.filter((model) => model.stable && model.name !== requested.name);
      const previousVersion = stable
        .filter((model) => model.version && requested.version && model.version < requested.version)
        .reduce((max, model) => Math.max(max, model.version), 0);
      const previousGeneration = stable
        .filter((model) => model.version === previousVersion && !model.lite)
        .sort((a, b) => Number(b.flash) - Number(a.flash) || a.name.localeCompare(b.name));
      const lite = models
        .filter((model) => model.lite && model.name !== requested.name)
        .sort((a, b) => Number(b.stable) - Number(a.stable) || modelVersionScore(b) - modelVersionScore(a));
      const rest = sortedGeminiModels()
        .filter((model) => model.name !== requested.name && !previousGeneration.some((item) => item.name === model.name) && !lite.some((item) => item.name === model.name));
      const ordered = [requested, ...previousGeneration, ...lite, ...rest];
      return ordered.filter((model) => {
        if (used.has(model.name)) return false;
        used.add(model.name);
        return true;
      }).slice(0, Math.max(1, limit));
    }

    function modelBadge(labelKey, className) {
      return `<span class="gemini-model-badge ${className || ""}">${escapeHtml(t(labelKey))}</span>`;
    }

    function modelBadges(model, recommendedName) {
      const badges = [];
      if (model.name === recommendedName) badges.push(modelBadge("gemini_model_recommended", "is-recommended"));
      badges.push(modelBadge(model.stable ? "gemini_model_stable" : "gemini_model_preview", model.stable ? "is-stable" : "is-preview"));
      if (model.lite) badges.push(modelBadge("gemini_model_lite", "is-lite"));
      return badges.join("");
    }

    function toggleGeminiModelMenu(show) {
      const menu = document.getElementById("geminiModelMenu");
      const trigger = document.getElementById("geminiModelTrigger");
      if (!menu || !trigger) return;
      const open = show === undefined ? menu.hidden : Boolean(show);
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    }

    function renderGeminiModelPicker() {
      const trigger = document.getElementById("geminiModelTrigger");
      const current = document.getElementById("geminiModelCurrent");
      const menu = document.getElementById("geminiModelMenu");
      if (!trigger || !current || !menu) return;
      const selected = selectedGeminiModel();
      if (!selected) {
        current.textContent = "—";
        menu.innerHTML = `<p class="gemini-model-empty">${escapeHtml(t("gemini_model_empty"))}</p>`;
        return;
      }
      current.textContent = selected.name;
      const recommendation = recommendGeminiModel(geminiModelsCache);
      menu.innerHTML = sortedGeminiModels().map((model) => `
        <button class="gemini-model-option${model.name === selected.name ? " is-selected" : ""}" type="button" role="option" aria-selected="${model.name === selected.name}" data-gemini-model="${escapeHtml(model.name)}">
          <span class="gemini-model-option-copy">
            <strong>${escapeHtml(model.name)}</strong>
            <small>${escapeHtml(modelDisplayName(model))}</small>
          </span>
          <span class="gemini-model-badges">${modelBadges(model, recommendation?.name || "")}</span>
        </button>
      `).join("");
    }

    function setGeminiModelStatus(text, isError = false) {
      const node = document.getElementById("geminiModelStatus");
      if (!node) return;
      node.textContent = text || "";
      node.classList.toggle("is-error", isError);
    }

    async function fetchGeminiModels(force = false) {
      if (geminiModelsCache.length && !force) return geminiModelsCache;
      if (geminiModelsPromise && !force) return geminiModelsPromise;
      if (force) geminiModelsCache = [];
      geminiModelsPromise = (async () => {
        const data = await geminiRequest("/models", { method: "GET", timeout: 16000 });
        const models = (Array.isArray(data?.models) ? data.models : []).map(modelInfo).filter(Boolean);
        if (!models.length) throw geminiError("models");
        geminiModelsCache = models;
        return models;
      })();
      try {
        return await geminiModelsPromise;
      } finally {
        geminiModelsPromise = null;
      }
    }

    async function refreshGeminiModelPicker(force = false) {
      const button = document.getElementById("geminiModelRefresh");
      const token = ++geminiPickerToken;
      if (!getGeminiKey()) {
        geminiModelsCache = [];
        renderGeminiModelPicker();
        setGeminiModelStatus(t("gemini_error_missing_key"), true);
        return;
      }
      if (button) button.disabled = true;
      setGeminiModelStatus(t("gemini_model_loading"));
      try {
        await fetchGeminiModels(force);
        if (token !== geminiPickerToken) return;
        renderGeminiModelPicker();
        const selected = selectedGeminiModel();
        const saved = savedGeminiModel();
        if (saved && !geminiModelsCache.some((model) => model.name === saved)) {
          setGeminiModelStatus(t("gemini_model_not_found"), true);
        } else {
          setGeminiModelStatus(selected ? t("gemini_model_current", { model: selected.name }) : t("gemini_model_empty"));
        }
        if (force) showToast(t("gemini_model_refreshed"), "success");
      } catch (error) {
        if (token !== geminiPickerToken) return;
        geminiModelsCache = [];
        renderGeminiModelPicker();
        setGeminiModelStatus(geminiErrorDisplay(error), true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    function ensureGeminiModels() {
      return geminiModelsCache.length ? Promise.resolve(geminiModelsCache) : fetchGeminiModels(false);
    }

    function ensureGeminiModel(force = false) {
      return fetchGeminiModels(force).then(() => selectedGeminiModel()?.name || "");
    }

    function setGeminiFallbackNotice(requested, actual) {
      if (!requested || !actual || requested === actual) return;
      geminiLastFallback = { requested, actual };
      const notice = document.getElementById("geminiFallbackNotice");
      const text = document.getElementById("geminiFallbackText");
      if (text) text.textContent = t("gemini_fallback_used", { requested, actual });
      if (notice) notice.hidden = false;
      showToast(t("gemini_fallback_used", { requested, actual }), "info");
    }

    function modelOutputCap(modelName) {
      const model = geminiModelsCache.find((item) => item.name === modelName);
      if (model?.outputTokenLimit) return model.outputTokenLimit;
      return 16384;
    }

    function responseInfo(data) {
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts;
      return {
        text: Array.isArray(parts) ? parts.filter((part) => !part?.thought).map((part) => String(part?.text || "")).join("").trim() : "",
        blockReason: String(data?.promptFeedback?.blockReason || ""),
        finishReason: String(candidate?.finishReason || "")
      };
    }

    function emptyResponseError(info, model, maxOutputTokens) {
      if (info.blockReason) {
        return geminiError("blocked", null, { geminiReason: info.blockReason, geminiModel: model });
      }
      if (info.finishReason === "SAFETY") return geminiError("safety", null, { geminiModel: model });
      if (info.finishReason === "RECITATION") return geminiError("recitation", null, { geminiModel: model });
      if (info.finishReason === "MAX_TOKENS") {
        return geminiError("max_tokens", null, { geminiModel: model, geminiMaxOutputTokens: maxOutputTokens });
      }
      if (info.finishReason) {
        return geminiError("finish", null, { geminiReason: info.finishReason, geminiModel: model });
      }
      return geminiError("empty", null, { geminiModel: model });
    }

    async function requestGeneration(model, body, timeout = 60000) {
      const data = await geminiRequest(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        body,
        model,
        timeout
      });
      const info = responseInfo(data);
      if (!info.text) throw emptyResponseError(info, model, body.generationConfig.maxOutputTokens);
      return { ...info, model };
    }

    async function requestGenerationWithFallback(requested, body) {
      try {
        return await requestGeneration(requested, body);
      } catch (error) {
        if (![429, 404, 503].includes(Number(error.geminiStatus))) throw error;
        const fallback = fallbackGeminiModel(requested);
        if (!fallback || fallback.name === requested) throw error;
        try {
          const result = await requestGeneration(fallback.name, body);
          result.fallback = { requested, actual: fallback.name };
          setGeminiFallbackNotice(requested, fallback.name);
          return result;
        } catch (fallbackError) {
          fallbackError.geminiFallbackFrom = requested;
          throw fallbackError;
        }
      }
    }

    async function generateGeminiText(prompt, options = {}) {
      await ensureGeminiModels();
      const requested = selectedGeminiModel();
      if (!requested) throw geminiError("models");
      const cap = modelOutputCap(requested.name);
      const requestedMax = Math.max(1, Number(options.maxOutputTokens) || 4096);
      const maxOutputTokens = Math.min(requestedMax, cap);
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: Number.isFinite(options.temperature) ? options.temperature : 0.6,
          maxOutputTokens
        }
      };
      if (options.json) body.generationConfig.responseMimeType = "application/json";
      if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
      let result;
      try {
        result = await requestGenerationWithFallback(requested.name, body);
      } catch (error) {
        if (error.geminiCode === "max_tokens" && maxOutputTokens < cap) {
          const retryMax = Math.min(cap, maxOutputTokens * 2);
          if (retryMax > maxOutputTokens) {
            body.generationConfig.maxOutputTokens = retryMax;
            result = await requestGenerationWithFallback(requested.name, body);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      geminiLastActualModel = result.model;
      geminiLastFallback = result.fallback || null;
      return result.text;
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
      geminiPickerToken += 1;
      setGeminiStatus("checking");
      setGeminiModelStatus(t("gemini_model_testing"));
      try {
        await fetchGeminiModels(true);
        renderGeminiModelPicker();
        const selected = selectedGeminiModel();
        if (!selected) throw geminiError("models");
        await generateGeminiText("Reply with the single word OK.", {
          temperature: 0,
          maxOutputTokens: 512
        });
        const actual = geminiLastActualModel || selected.name;
        setGeminiStatus("ok", actual);
        setGeminiModelStatus(t("gemini_model_works", { model: actual }));
        if (!geminiLastFallback) {
          const notice = document.getElementById("geminiFallbackNotice");
          if (notice) notice.hidden = true;
        }
        showToast(t("gemini_model_works", { model: actual }), "success");
      } catch (error) {
        const detail = geminiErrorDisplay(error);
        setGeminiStatus("error", detail);
        setGeminiModelStatus(detail, true);
        showToast(geminiErrorMessage(error), "error");
      } finally {
        geminiTest.disabled = false;
      }
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

    function setAiAnalysisContent(text, isError = false, showRetry = false) {
      const body = document.getElementById("aiAnalysisBody");
      if (!body) return;
      body.textContent = text;
      body.classList.toggle("is-error", isError);
      const retry = document.getElementById("aiAnalysisRetry");
      if (retry) retry.hidden = !showRetry;
    }

    function setAiAnalysisMeta(text, showMakePrimary = false) {
      const meta = document.getElementById("aiAnalysisMeta");
      const make = document.getElementById("aiAnalysisMakePrimary");
      if (meta) {
        meta.textContent = text || "";
        meta.hidden = !text;
      }
      if (make) make.hidden = !showMakePrimary;
    }

    function setAiAnalysisBusy(busy) {
      const cancel = document.getElementById("aiAnalysisCancel");
      if (cancel) cancel.hidden = !busy;
      const retry = document.getElementById("aiAnalysisRetry");
      if (retry && busy) retry.hidden = true;
    }

    function formatAiRetryText(payload) {
      return t("ai_retry_message", {
        provider: aiProviderLabel(payload.provider),
        model: payload.model || "",
        reason: t(payload.reason || "ai_retry_overload"),
        attempt: payload.attempt,
        max: payload.max,
        seconds: Math.max(1, Math.ceil(Number(payload.delayMs || 0) / 1000))
      });
    }

    async function runAiAnalysis(text, context) {
      openAiAnalysisSheet();
      if (!hasConfiguredAiProvider()) {
        setAiAnalysisContent(t("ai_error_missing_key"), true, false);
        setAiAnalysisMeta("", false);
        return;
      }
      setAiAnalysisContent(t("ai_analysis_loading"));
      setAiAnalysisMeta("", false);
      setAiAnalysisBusy(true);
      const controller = new AbortController();
      aiAnalysisAbort = controller;
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage]?.label || "Русский";
      const prompt = `Разобрать фразу '${text}' из контекста '${context}'. Дай пословный перевод, грамматический разбор и объяснение идиом. Отвечай строго на языке UI: '${uiLanguage}'.`;
      try {
        const result = await generateAiText(prompt, {
          temperature: 0.25,
          maxOutputTokens: 4096,
          signal: controller.signal,
          onRetry: (payload) => {
            setAiAnalysisContent(formatAiRetryText(payload));
          }
        });
        aiAnalysisLastResult = result;
        setAiAnalysisContent(result.text);
        setAiAnalysisMeta(t("ai_analysis_meta", {
          provider: aiProviderLabel(result.provider),
          model: result.model
        }), Boolean(result.fallback));
      } catch (error) {
        if (error?.aiCode === "aborted" || error?.name === "AbortError") {
          setAiAnalysisContent(t("ai_analysis_cancelled"));
          setAiAnalysisMeta("", false);
        } else {
          setAiAnalysisContent(geminiErrorDisplay(error), true, true);
          setAiAnalysisMeta(t("ai_analysis_provider", {
            provider: aiProviderLabel(error.aiProvider),
            model: error.aiModel || ""
          }), false);
        }
      } finally {
        if (aiAnalysisAbort === controller) aiAnalysisAbort = null;
        setAiAnalysisBusy(false);
      }
    }

    async function analyzeSelectedText() {
      if (!aiSelectionState) return;
      const { text, context } = aiSelectionState;
      aiLastAnalysis = { text, context };
      hideAiSelectionButton();
      await runAiAnalysis(text, context);
    }

    /* ---------- AI Studio chat ---------- */

    const AI_BLOCK_OPTIONS = [
      { type: "theory", label: "ai_block_theory", mark: "◈" },
      { type: "reading_heavy", label: "ai_block_reading", mark: "▤" },
      { type: "dialogue", label: "ai_block_dialogue", mark: "◌" },
      { type: "quiz", label: "ai_block_quiz", mark: "◇" },
      { type: "practice_write", label: "ai_block_writing", mark: "✎" }
    ];

    let aiChatState = null;
    let aiChatAbort = null;
    let aiChatLastResult = null;
    let aiStudioCourse = null;
    let aiChatStore = null;
    let aiChatRenamingId = null;
    let aiChatPanelOpen = false;
    let aiChatStorageWarned = false;

    function createAiChatState() {
      return {
        chatId: null,
        course: null,
        mode: null,
        type: null,
        question: null,
        answers: {},
        blocks: [],
        diagnostics: null,
        diagIndex: 0,
        diagAnswers: {},
        busy: false,
        lastPrompt: "",
        lastType: null,
        generated: null,
        refining: false,
        customPrompt: "",
        imported: false
      };
    }

    function aiCourseLabel(code) {
      return languageLabel(code);
    }

    function aiCourseFlag(code) {
      return renderFlag(code);
    }

    function ensureAiStudioCourse(notify = true) {
      const active = activeLanguageCodes();
      if (!active.length) {
        aiStudioCourse = null;
        return false;
      }
      if (!aiStudioCourse || !active.includes(aiStudioCourse)) {
        const previous = aiStudioCourse;
        const fallback = active.includes(currentLanguage()) ? currentLanguage() : active[0];
        aiStudioCourse = fallback;
        if (previous && notify) showToast(t("ai_course_missing", { course: aiCourseLabel(previous) }), "info");
      }
      return true;
    }

    function closeAiCourseMenu() {
      const menu = document.getElementById("aiCourseMenu");
      const trigger = document.getElementById("aiCourseTrigger");
      if (menu) menu.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    }

    function renderAiCourseSelector() {
      const trigger = document.getElementById("aiCourseTrigger");
      const name = document.getElementById("aiCourseName");
      const flag = document.getElementById("aiCourseFlag");
      const menu = document.getElementById("aiCourseMenu");
      if (!trigger || !name || !flag || !menu) return;
      const active = activeLanguageCodes();
      menu.textContent = "";
      if (!aiStudioCourse || !active.includes(aiStudioCourse)) {
        name.textContent = t("ai_course_no_active");
        flag.textContent = "";
        trigger.disabled = true;
        closeAiCourseMenu();
        return;
      }
      trigger.disabled = false;
      name.textContent = aiCourseLabel(aiStudioCourse);
      flag.innerHTML = aiCourseFlag(aiStudioCourse);
      active.forEach((code) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `ai-course-option${code === aiStudioCourse ? " is-selected" : ""}`;
        option.dataset.aiCourse = code;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(code === aiStudioCourse));
        const optionFlag = document.createElement("span");
        optionFlag.className = "ai-course-option-flag";
        optionFlag.setAttribute("aria-hidden", "true");
        optionFlag.innerHTML = aiCourseFlag(code);
        const optionName = document.createElement("span");
        optionName.textContent = aiCourseLabel(code);
        const optionCode = document.createElement("span");
        optionCode.className = "ai-course-option-code";
        optionCode.textContent = String(code).toUpperCase();
        option.append(optionFlag, optionName, optionCode);
        menu.appendChild(option);
      });
    }

    function aiChatStorageKey(course) {
      return `${AI_CHATS_STORAGE_PREFIX}${course}`;
    }

    function warnAiChatStorage() {
      if (aiChatStorageWarned) return;
      aiChatStorageWarned = true;
      showToast(t("ai_chat_storage_error"), "error");
    }

    function normalizeStoredAiChat(raw, course) {
      if (!raw || typeof raw !== "object" || !raw.id) return null;
      const messages = (Array.isArray(raw.messages) ? raw.messages : [])
        .filter((message) => message && (message.role === "user" || message.role === "assistant"))
        .map((message) => ({
          role: message.role,
          text: typeof message.text === "string" ? message.text.slice(0, 8000) : "",
          kind: typeof message.kind === "string" ? message.kind : "",
          preview: message.preview && typeof message.preview === "object" ? message.preview : null,
          at: message.at || raw.updatedAt || new Date().toISOString()
        }))
        .slice(-AI_CHAT_MAX_MESSAGES);
      return {
        id: String(raw.id),
        title: typeof raw.title === "string" ? raw.title.slice(0, 80) : "",
        course,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        messages
      };
    }

    function loadAiChatStore(course) {
      const empty = { version: 1, activeId: null, chats: [] };
      if (!course) return empty;
      try {
        const raw = window.localStorage.getItem(aiChatStorageKey(course));
        if (!raw) return empty;
        const parsed = JSON.parse(raw);
        const chats = (Array.isArray(parsed?.chats) ? parsed.chats : [])
          .map((chat) => normalizeStoredAiChat(chat, course))
          .filter(Boolean)
          .slice(0, AI_CHAT_MAX_PER_COURSE);
        return {
          version: 1,
          activeId: chats.some((chat) => chat.id === parsed?.activeId) ? parsed.activeId : (chats[0]?.id || null),
          chats
        };
      } catch (error) {
        warnAiChatStorage();
        return empty;
      }
    }

    function saveAiChatStore() {
      if (!aiChatStore || !aiStudioCourse) return false;
      try {
        window.localStorage.setItem(aiChatStorageKey(aiStudioCourse), JSON.stringify(aiChatStore));
        return true;
      } catch (error) {
        warnAiChatStorage();
        return false;
      }
    }

    function currentAiChatRecord() {
      if (!aiChatStore || !aiChatState?.chatId) return null;
      return aiChatStore.chats.find((chat) => chat.id === aiChatState.chatId) || null;
    }

    function makeAiChatTitle(text) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (!clean) return t("ai_chat_untitled");
      return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
    }

    function createAiChatRecord() {
      if (!aiChatStore || !aiStudioCourse) return null;
      if (aiChatStore.chats.length >= AI_CHAT_MAX_PER_COURSE) {
        showToast(t("ai_chat_chat_limit"), "info");
        return null;
      }
      const now = new Date().toISOString();
      const chat = {
        id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: "",
        course: aiStudioCourse,
        createdAt: now,
        updatedAt: now,
        messages: []
      };
      aiChatStore.chats.unshift(chat);
      aiChatStore.activeId = chat.id;
      saveAiChatStore();
      return chat;
    }

    function recordAiChatMessage(role, text, options = {}) {
      if (!aiChatState) return false;
      if (options.kind === "status" || options.persist === false) return true;
      let chat = currentAiChatRecord();
      if (!chat) {
        if (role !== "user") return true;
        chat = createAiChatRecord();
        if (!chat) return false;
        aiChatState.chatId = chat.id;
      }
      const cleanText = String(text || "").slice(0, 8000);
      if (role === "user" && !chat.title) chat.title = makeAiChatTitle(cleanText);
      const message = {
        role,
        text: cleanText,
        kind: options.kind || "",
        at: new Date().toISOString()
      };
      if (options.preview) message.preview = options.preview;
      if (chat.messages.length >= AI_CHAT_MAX_MESSAGES) {
        chat.messages.shift();
        if (!chat.limitWarned) {
          chat.limitWarned = true;
          showToast(t("ai_chat_message_limit"), "info");
        }
      }
      chat.messages.push(message);
      chat.updatedAt = message.at;
      if (chat.messages.length >= AI_CHAT_MAX_MESSAGES && !chat.limitWarned) {
        chat.limitWarned = true;
        showToast(t("ai_chat_message_limit"), "info");
      }
      saveAiChatStore();
      renderAiChatList();
      return true;
    }

    function renderAiChatList() {
      const list = document.getElementById("aiChatList");
      if (!list) return;
      list.textContent = "";
      if (!aiChatStore || !aiChatStore.chats.length) {
        const empty = document.createElement("p");
        empty.className = "ai-chat-list-empty";
        empty.textContent = t("ai_chats_empty");
        list.appendChild(empty);
        return;
      }
      aiChatStore.chats.forEach((chat) => {
        const item = document.createElement("div");
        item.className = `ai-chat-list-item${chat.id === aiChatState?.chatId ? " is-active" : ""}`;
        item.dataset.aiChatId = chat.id;
        if (aiChatRenamingId === chat.id) {
          const input = document.createElement("input");
          input.className = "ai-chat-rename-input";
          input.type = "text";
          input.maxLength = 60;
          input.value = chat.title || "";
          input.placeholder = t("ai_chat_rename_placeholder");
          input.dataset.aiChatRenameInput = chat.id;
          const actions = document.createElement("div");
          actions.className = "ai-chat-rename-actions";
          const save = document.createElement("button");
          save.type = "button";
          save.className = "ai-chat-mini-btn";
          save.dataset.aiChatRenameSave = chat.id;
          save.textContent = "✓";
          save.setAttribute("aria-label", t("ai_chat_save"));
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "ai-chat-mini-btn";
          cancel.dataset.aiChatRenameCancel = chat.id;
          cancel.textContent = "✕";
          cancel.setAttribute("aria-label", t("ai_chat_cancel"));
          actions.append(save, cancel);
          item.append(input, actions);
        } else {
          const open = document.createElement("button");
          open.type = "button";
          open.className = "ai-chat-list-open";
          open.dataset.aiChatOpen = chat.id;
          const title = document.createElement("span");
          title.className = "ai-chat-list-title";
          title.textContent = chat.title || t("ai_chat_untitled");
          const meta = document.createElement("span");
          meta.className = "ai-chat-list-meta";
          const date = new Date(chat.updatedAt);
          const dateText = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(state.settings.uiLanguage || "ru");
          meta.textContent = [aiCourseLabel(chat.course), dateText].filter(Boolean).join(" · ");
          open.append(title, meta);
          const actions = document.createElement("div");
          actions.className = "ai-chat-list-actions";
          const rename = document.createElement("button");
          rename.type = "button";
          rename.className = "ai-chat-mini-btn";
          rename.dataset.aiChatRename = chat.id;
          rename.textContent = "✎";
          rename.setAttribute("aria-label", t("ai_chat_rename"));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "ai-chat-mini-btn";
          remove.dataset.aiChatDelete = chat.id;
          remove.textContent = "×";
          remove.setAttribute("aria-label", t("ai_chat_delete"));
          actions.append(rename, remove);
          item.append(open, actions);
        }
        list.appendChild(item);
      });
    }

    function renderAiChatWelcome() {
      appendAiChatMessage("assistant", t("ai_chat_welcome"), {
        persist: false,
        chips: [
          { label: t("ai_chat_lesson"), action: "type", value: "lessons" },
          { label: t("ai_chat_story"), action: "type", value: "stories" },
          { label: t("ai_chat_vocab"), action: "type", value: "vocab" },
          { label: t("ai_chat_auto"), action: "auto" },
          { label: t("ai_chat_custom"), action: "custom" },
          { label: t("ai_chat_json"), action: "json" }
        ]
      });
      appendAiChatMessage("assistant", t("ai_chat_welcome_hint"), {
        persist: false,
        chips: [{ label: t("ai_chat_diagnose"), action: "diagnose" }]
      });
    }

    function appendStoredAiPreview(message) {
      const preview = message.preview || {};
      const text = `${t("ai_chat_preview")} · ${preview.title || t("ai_chat_untitled")}`;
      appendAiChatMessage("assistant", text, { persist: false, kind: "preview-summary" });
    }

    function openAiChatRecord(chat) {
      if (!chat) {
        resetAiChat();
        renderAiChatList();
        return;
      }
      if (aiChatStore) {
        aiChatStore.activeId = chat.id;
        saveAiChatStore();
      }
      aiChatState = createAiChatState();
      aiChatState.chatId = chat.id;
      aiChatState.course = chat.course || aiStudioCourse;
      const log = aiChatLogElement();
      if (log) log.textContent = "";
      if (!chat.messages.length) {
        renderAiChatWelcome();
      } else {
        chat.messages.forEach((message) => {
          if (message.kind === "preview") {
            appendStoredAiPreview(message);
          } else {
            appendAiChatMessage(message.role, message.text, {
              persist: false,
              kind: message.kind || undefined
            });
          }
        });
      }
      setChatBusy(false);
      setAiChatHint("ai_chat_hint");
      renderAiChatList();
    }

    function loadAiStudioChats() {
      if (!ensureAiStudioCourse(false)) {
        aiChatStore = { version: 1, activeId: null, chats: [] };
        resetAiChat();
        renderAiChatList();
        renderAiCourseSelector();
        return;
      }
      aiChatStore = loadAiChatStore(aiStudioCourse);
      const active = aiChatStore.chats.find((chat) => chat.id === aiChatStore.activeId) || aiChatStore.chats[0] || null;
      if (active) {
        openAiChatRecord(active);
      } else {
        resetAiChat();
      }
      renderAiChatList();
      renderAiCourseSelector();
    }

    function switchAiStudioCourse(code) {
      if (!code || code === aiStudioCourse || aiChatState?.busy) return;
      const active = activeLanguageCodes();
      if (!active.includes(code)) {
        showToast(t("ai_course_missing", { course: aiCourseLabel(code) }), "info");
        renderAiCourseSelector();
        return;
      }
      if (aiChatStore && aiChatState?.chatId) aiChatStore.activeId = aiChatState.chatId;
      saveAiChatStore();
      aiStudioCourse = code;
      closeAiCourseMenu();
      loadAiStudioChats();
      aiChatPanelOpen = false;
      const sidebar = document.getElementById("aiChatSidebar");
      if (sidebar) sidebar.classList.remove("is-open");
    }

    function startNewAiChat() {
      if (aiChatState?.busy) return;
      if (!ensureAiStudioCourse(false)) {
        showToast(t("ai_course_no_active"), "info");
        return;
      }
      if (!aiChatStore || aiChatStore.chats.length >= AI_CHAT_MAX_PER_COURSE) {
        showToast(t("ai_chat_chat_limit"), "info");
        return;
      }
      const chat = createAiChatRecord();
      if (!chat) return;
      openAiChatRecord(chat);
      aiChatPanelOpen = false;
      document.getElementById("aiChatSidebar")?.classList.remove("is-open");
    }

    function saveAiChatTitle(id, value) {
      if (!aiChatStore) return;
      const chat = aiChatStore.chats.find((item) => item.id === id);
      if (!chat) return;
      const title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (title) chat.title = title;
      chat.updatedAt = new Date().toISOString();
      aiChatRenamingId = null;
      saveAiChatStore();
      renderAiChatList();
    }

    function deleteAiChat(id) {
      if (!aiChatStore || aiChatState?.busy) return;
      const index = aiChatStore.chats.findIndex((chat) => chat.id === id);
      if (index < 0) return;
      const chat = aiChatStore.chats[index];
      const finish = () => {
        aiChatStore.chats.splice(index, 1);
        if (aiChatStore.activeId === id) {
          const next = aiChatStore.chats[Math.min(index, aiChatStore.chats.length - 1)] || aiChatStore.chats[index - 1] || null;
          aiChatStore.activeId = next?.id || null;
          if (next) openAiChatRecord(next);
          else resetAiChat();
        }
        saveAiChatStore();
        renderAiChatList();
      };
      if (typeof requestConfirmation === "function") {
        void requestConfirmation({
          title: t("ai_chat_delete_title"),
          message: t("ai_chat_delete_message", { title: chat.title || t("ai_chat_untitled") }),
          confirmLabel: t("ai_chat_delete")
        }).then((confirmed) => { if (confirmed) finish(); });
      }
    }

    function deleteAllAiChats() {
      if (!aiChatStore || !aiStudioCourse || aiChatState?.busy) return;
      const finish = () => {
        aiChatStore.chats = [];
        aiChatStore.activeId = null;
        saveAiChatStore();
        resetAiChat();
        renderAiChatList();
      };
      if (typeof requestConfirmation === "function") {
        void requestConfirmation({
          title: t("ai_chats_delete_all_title"),
          message: t("ai_chats_delete_all_message", { course: aiCourseLabel(aiStudioCourse) }),
          confirmLabel: t("ai_chats_delete_all")
        }).then((confirmed) => { if (confirmed) finish(); });
      }
    }

    function toggleAiChatPanel() {
      aiChatPanelOpen = !aiChatPanelOpen;
      document.getElementById("aiChatSidebar")?.classList.toggle("is-open", aiChatPanelOpen);
    }

    function aiChatLogElement() {
      return document.getElementById("aiChatLog");
    }

    function scrollAiChat() {
      const log = aiChatLogElement();
      if (log) log.scrollTop = log.scrollHeight;
    }

    function aiChatChip(label, action, value = "", options = {}) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ai-chat-chip${options.active ? " is-active" : ""}${options.danger ? " is-danger" : ""}`;
      button.textContent = label;
      button.dataset.aiAction = action;
      if (value) button.dataset.aiValue = value;
      if (options.selected) button.classList.add("is-selected");
      return button;
    }

    function appendAiChatActions(container, actions) {
      if (!Array.isArray(actions) || !actions.length) return;
      const row = document.createElement("div");
      row.className = "ai-chat-chips ai-chat-actions";
      actions.forEach((item) => row.appendChild(aiChatChip(item.label, item.action, item.value || "", item)));
      container.appendChild(row);
    }

    function appendAiChatMessage(role, text, options = {}) {
      const log = aiChatLogElement();
      if (!log) return null;
      const row = document.createElement("div");
      row.className = `ai-chat-message ${role === "user" ? "is-user" : "is-assistant"}${options.kind ? ` is-${options.kind}` : ""}`;
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble";
      if (text) bubble.textContent = text;
      row.appendChild(bubble);
      if (options.node) bubble.appendChild(options.node);
      if (options.chips) {
        const chips = document.createElement("div");
        chips.className = "ai-chat-chips";
        options.chips.forEach((item) => chips.appendChild(aiChatChip(item.label, item.action, item.value || "", item)));
        bubble.appendChild(chips);
      }
      if (options.actions) appendAiChatActions(bubble, options.actions);
      log.appendChild(row);
      scrollAiChat();
      const recorded = recordAiChatMessage(role, text, options);
      if (role === "user" && options.persist !== false && !recorded) return null;
      return { row, bubble };
    }

    function appendAiChatStatus(text) {
      const message = appendAiChatMessage("assistant", text, { kind: "status" });
      if (!message) return { set() {}, done() {}, fail() {} };
      return {
        set(next, isError = false) {
          message.bubble.textContent = next;
          message.row.classList.toggle("is-error", isError);
          scrollAiChat();
        },
        done(next) {
          message.row.classList.add("is-done");
          message.bubble.textContent = next || message.bubble.textContent;
          scrollAiChat();
        },
        fail(next) {
          message.row.classList.add("is-error");
          message.bubble.textContent = next;
          scrollAiChat();
        }
      };
    }

    function setAiChatHint(key, vars) {
      const hint = document.getElementById("aiChatHint");
      if (hint) hint.textContent = t(key, vars);
    }

    function setChatBusy(busy) {
      if (!aiChatState) return;
      aiChatState.busy = Boolean(busy);
      const input = document.getElementById("aiChatInput");
      const send = document.getElementById("aiChatSend");
      const newChat = document.getElementById("aiChatNew");
      if (input) input.disabled = Boolean(busy);
      if (send) send.disabled = Boolean(busy);
      if (newChat) newChat.disabled = Boolean(busy);
      const shell = document.querySelector(".ai-chat-main");
      if (shell) shell.classList.toggle("is-busy", Boolean(busy));
    }

    function autoGrowChatInput() {
      const input = document.getElementById("aiChatInput");
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${Math.min(150, Math.max(42, input.scrollHeight))}px`;
    }

    function syncAiChatViewport() {
      const modal = document.getElementById("aiStudioModal");
      const panel = document.querySelector(".ai-studio-panel");
      const shell = document.querySelector(".ai-chat-main");
      if (!modal?.open || !panel || !shell) return;
      const viewport = window.visualViewport;
      if (viewport) {
        const panelHeight = Math.min(680, Math.max(340, Math.round(viewport.height - 20)));
        const headerHeight = document.querySelector(".ai-studio-head")?.offsetHeight || 82;
        panel.style.maxHeight = `${panelHeight}px`;
        shell.style.height = `${Math.max(240, panelHeight - headerHeight - 2)}px`;
      }
      scrollAiChat();
    }

    function aiTypeLabel(type) {
      if (type === "stories") return t("ai_chat_story");
      if (type === "vocab") return t("ai_chat_vocab");
      return t("ai_chat_lesson");
    }

    function inferAiType(text) {
      const value = String(text || "").toLowerCase();
      if (/словар|слов|vocab|words|wortschatz|ordforråd|kelime/.test(value)) return "vocab";
      if (/истор|story|stories|historie|hikâye|hikaye/.test(value)) return "stories";
      return "lessons";
    }

    function detectPayloadType(payload) {
      if (!payload || typeof payload !== "object") return null;
      if (Array.isArray(payload.lessons) && payload.lessons.length) return "lessons";
      if (Array.isArray(payload.stories) && payload.stories.length) return "stories";
      if (Array.isArray(payload.vocab) && payload.vocab.length) return "vocab";
      return null;
    }

    function resetAiChat() {
      if (aiChatState?.busy) return;
      aiChatState = createAiChatState();
      aiChatState.course = aiStudioCourse;
      const log = aiChatLogElement();
      if (log) log.textContent = "";
      setChatBusy(false);
      setAiChatHint("ai_chat_hint");
      const input = document.getElementById("aiChatInput");
      if (input) {
        input.value = "";
        input.disabled = false;
        input.focus();
      }
      autoGrowChatInput();
      renderAiChatWelcome();
      renderAiChatList();
    }

    function startAiType(type) {
      if (!aiChatState || aiChatState.busy) return;
      if (!appendAiChatMessage("user", aiTypeLabel(type))) return;
      aiChatState.mode = type;
      aiChatState.type = type;
      aiChatState.answers = {};
      aiChatState.blocks = [];
      aiChatState.blocksDecided = false;
      aiChatState.question = "topic";
      aiChatState.diagnostics = aiChatState.diagnostics || null;
      appendAiChatMessage("assistant", t("ai_chat_topic_question"), {
        chips: [{ label: t("ai_skip"), action: "skip" }]
      });
      setAiChatHint("ai_chat_topic_question");
      document.getElementById("aiChatInput")?.focus();
    }

    function askAiLevel() {
      if (!aiChatState) return;
      aiChatState.question = "level";
      const message = appendAiChatMessage("assistant", t("ai_chat_level_question"), { kind: "question" });
      if (!message) return;
      const wrap = document.createElement("div");
      wrap.className = "ai-chat-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ai-chat-select-trigger";
      trigger.dataset.aiSelectToggle = "level";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.textContent = t("ai_studio_level");
      const chevron = document.createElement("span");
      chevron.className = "ai-chat-select-chevron";
      chevron.textContent = "⌄";
      trigger.appendChild(chevron);
      const menu = document.createElement("div");
      menu.className = "ai-chat-select-menu";
      menu.setAttribute("role", "listbox");
      menu.hidden = true;
      [["A1", "ai_level_a1"], ["A2", "ai_level_a2"], ["B1", "ai_level_b1"], ["B2", "ai_level_b2"]].forEach(([value, key]) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "ai-chat-select-option";
        option.setAttribute("role", "option");
        option.dataset.aiLevel = value;
        option.textContent = t(key);
        menu.appendChild(option);
      });
      wrap.append(trigger, menu);
      message.bubble.appendChild(wrap);
      const chips = document.createElement("div");
      chips.className = "ai-chat-chips";
      chips.appendChild(aiChatChip(t("ai_skip"), "skip"));
      message.bubble.appendChild(chips);
      setAiChatHint("ai_chat_level_question");
    }

    function askAiCount() {
      if (!aiChatState) return;
      aiChatState.question = "count";
      appendAiChatMessage("assistant", t("ai_chat_count_question"), {
        chips: [
          { label: t("ai_count_ten"), action: "count", value: "10" },
          { label: t("ai_count_twenty"), action: "count", value: "20" },
          { label: t("ai_count_thirty"), action: "count", value: "30" },
          { label: t("ai_skip"), action: "skip" }
        ]
      });
      setAiChatHint("ai_chat_count_question");
    }

    function askAiLength() {
      if (!aiChatState) return;
      aiChatState.question = "length";
      appendAiChatMessage("assistant", t("ai_chat_length_question"), {
        chips: [
          { label: t("ai_length_short"), action: "length", value: "short" },
          { label: t("ai_length_medium"), action: "length", value: "medium" },
          { label: t("ai_length_long"), action: "length", value: "long" },
          { label: t("ai_skip"), action: "skip" }
        ]
      });
      setAiChatHint("ai_chat_length_question");
    }

    function askAiBlocks() {
      if (!aiChatState) return;
      aiChatState.question = "blocks";
      aiChatState.blocks = [];
      const message = appendAiChatMessage("assistant", t("ai_chat_blocks_question"), { kind: "question" });
      if (!message) return;
      const chips = document.createElement("div");
      chips.className = "ai-chat-chips ai-block-picker";
      AI_BLOCK_OPTIONS.forEach((block) => {
        chips.appendChild(aiChatChip(`${block.mark} ${t(block.label)}`, "block", block.type));
      });
      message.bubble.appendChild(chips);
      const controls = document.createElement("div");
      controls.className = "ai-chat-chips";
      controls.appendChild(aiChatChip(t("ai_chat_blocks_all"), "all-blocks"));
      controls.appendChild(aiChatChip(t("ai_chat_blocks_ai"), "ai-blocks"));
      controls.appendChild(aiChatChip(t("ai_chat_blocks_apply"), "apply-blocks"));
      controls.appendChild(aiChatChip(t("ai_skip"), "skip"));
      message.bubble.appendChild(controls);
      setAiChatHint("ai_chat_blocks_question");
    }

    function nextAiQuestion() {
      if (!aiChatState) return;
      if (!aiChatState.answers.topic) {
        aiChatState.question = "topic";
        appendAiChatMessage("assistant", t("ai_chat_topic_question"), { chips: [{ label: t("ai_skip"), action: "skip" }] });
        setAiChatHint("ai_chat_topic_question");
        return;
      }
      if (aiChatState.mode === "vocab") {
        if (!aiChatState.answers.count) return askAiCount();
        if (!aiChatState.answers.level) return askAiLevel();
      } else if (aiChatState.mode === "stories") {
        if (!aiChatState.answers.length) return askAiLength();
        if (!aiChatState.answers.level) return askAiLevel();
      } else {
        if (!aiChatState.answers.level) return askAiLevel();
        if (!aiChatState.blocks.length && !aiChatState.blocksDecided) return askAiBlocks();
      }
      void beginAiGeneration();
    }

    function applyAiTopic(value) {
      if (!aiChatState) return;
      aiChatState.answers.topic = String(value || "").trim() || t("ai_topic_general");
      nextAiQuestion();
    }

    function applyAiLevel(value) {
      if (!aiChatState) return;
      aiChatState.answers.level = String(value || "B1");
      appendAiChatMessage("user", aiChatState.answers.level);
      nextAiQuestion();
    }

    function applyAiCount(value) {
      if (!aiChatState) return;
      aiChatState.answers.count = Number(value) || 20;
      appendAiChatMessage("user", String(aiChatState.answers.count));
      nextAiQuestion();
    }

    function applyAiLength(value) {
      if (!aiChatState) return;
      aiChatState.answers.length = value || "medium";
      appendAiChatMessage("user", t(value === "short" ? "ai_length_short" : value === "long" ? "ai_length_long" : "ai_length_medium"));
      nextAiQuestion();
    }

    function finishAiBlocks() {
      if (!aiChatState) return;
      aiChatState.blocksDecided = true;
      aiChatState.question = null;
      void beginAiGeneration();
    }

    function startAiDiagnostics() {
      if (!aiChatState || aiChatState.busy) return;
      aiChatState.mode = "diagnostics";
      aiChatState.diagIndex = 0;
      aiChatState.diagAnswers = {};
      aiChatState.diagnostics = null;
      appendAiChatMessage("assistant", t("ai_chat_diag_intro"), {
        chips: [{ label: t("ai_chat_diag_skip"), action: "diag-skip" }]
      });
      askAiDiagnostic();
    }

    function askAiDiagnostic() {
      if (!aiChatState) return;
      const question = AI_DIAGNOSTIC_QUESTIONS[aiChatState.diagIndex];
      if (!question) {
        aiChatState.diagnostics = { ...aiChatState.diagAnswers };
        aiChatState.mode = null;
        appendAiChatMessage("assistant", t("ai_chat_diag_done"), {
          chips: [
            { label: t("ai_chat_lesson"), action: "type", value: "lessons" },
            { label: t("ai_chat_story"), action: "type", value: "stories" },
            { label: t("ai_chat_vocab"), action: "type", value: "vocab" },
            { label: t("ai_chat_auto"), action: "auto" }
          ]
        });
        return;
      }
      appendAiChatMessage("assistant", t(question.label), {
        chips: [
          ...question.options.map((key) => ({ label: t(key), action: "diag", value: key })),
          { label: t("ai_chat_diag_skip"), action: "diag-skip" }
        ]
      });
      setAiChatHint("ai_chat_diag_intro");
    }

    function answerAiDiagnostic(value) {
      if (!aiChatState) return;
      const question = AI_DIAGNOSTIC_QUESTIONS[aiChatState.diagIndex];
      if (!question) return;
      aiChatState.diagAnswers[question.id] = value;
      appendAiChatMessage("user", t(value));
      aiChatState.diagIndex += 1;
      askAiDiagnostic();
    }

    function skipAiDiagnostics() {
      if (!aiChatState) return;
      aiChatState.diagnostics = null;
      aiChatState.mode = null;
      appendAiChatMessage("assistant", t("ai_chat_diag_cancelled"), {
        chips: [
          { label: t("ai_chat_lesson"), action: "type", value: "lessons" },
          { label: t("ai_chat_story"), action: "type", value: "stories" },
          { label: t("ai_chat_vocab"), action: "type", value: "vocab" },
          { label: t("ai_chat_auto"), action: "auto" }
        ]
      });
    }

    function startAiCustom(text) {
      if (!aiChatState || aiChatState.busy) return;
      aiChatState.mode = "custom";
      aiChatState.type = inferAiType(text);
      aiChatState.customPrompt = text;
      aiChatState.answers = {};
      aiChatState.blocks = [];
      aiChatState.question = null;
      aiChatState.refining = false;
      appendAiChatMessage("assistant", t("ai_chat_custom_received"));
      void beginAiGeneration({ prompt: text, type: aiChatState.type });
    }

    function startAiJson(text) {
      if (!aiChatState || aiChatState.busy) return;
      try {
        const raw = parseGeminiJson(text);
        const type = detectPayloadType(raw) || inferAiType(text);
        const payload = validateGeneratedPayload(raw, type);
        aiChatState.type = type;
        aiChatState.lastPrompt = "";
        aiChatState.lastType = type;
        aiChatState.generated = { payload, type, imported: false };
        appendAiChatStatus(t("ai_chat_validating"));
        const status = appendAiChatStatus(t("ai_chat_done"));
        status.done(t("ai_chat_done"));
        appendAiPreviewCard(payload, type);
      } catch (error) {
        appendAiChatMessage("assistant", `${geminiErrorMessage(error)} · ${geminiErrorTechnical(error)}`, {
          actions: [
            { label: t("ai_chat_action_refine"), action: "refine" },
            { label: t("ai_chat_action_key"), action: "key" }
          ]
        });
      }
    }

    function startAiJsonMode() {
      if (!aiChatState) return;
      aiChatState.mode = "json";
      aiChatState.question = "json";
      appendAiChatMessage("assistant", t("ai_chat_json_prompt"));
      setAiChatHint("ai_chat_json_prompt");
      document.getElementById("aiChatInput")?.focus();
    }

    function startAiPromptMode() {
      if (!aiChatState) return;
      aiChatState.mode = "custom";
      aiChatState.question = "custom";
      appendAiChatMessage("assistant", t("ai_chat_custom_prompt"));
      setAiChatHint("ai_chat_custom_prompt");
      document.getElementById("aiChatInput")?.focus();
    }

    function aiCourseSystemPrompt() {
      const course = aiChatState?.course || aiStudioCourse;
      const label = course ? aiCourseLabel(course) : "English";
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage]?.label || "Русский";
      return `${GEMINI_SYSTEM_PROMPT}\nTarget learning language: ${label} (${course || "en"}).\nUI language for explanations: ${uiLanguage}.`;
    }

    function buildAiPrompt(options = {}) {
      if (!aiChatState) return "";
      if (options.custom) return String(options.custom);
      const type = options.type || aiChatState.type || "lessons";
      const answers = aiChatState.answers;
      const course = aiChatState.course || aiStudioCourse;
      const courseLabel = aiCourseLabel(course);
      const blocks = aiChatState.blocks.length ? aiChatState.blocks.join(", ") : "AI decides";
      const weak = aiChatState.diagnostics
        ? Object.values(aiChatState.diagnostics).map((key) => t(key)).join(", ")
        : "";
      const lines = [
        `Create ${type} for the target learning language.`,
        `Learning language: ${courseLabel} (${course || "en"}).`,
        `UI language for explanations: ${UI_LANGUAGES[state.settings.uiLanguage]?.label || "Русский"}.`,
        `Topic: ${answers.topic || t("ai_topic_general")}.`,
        `Target level: ${answers.level || "B1"}.`
      ];
      if (answers.count) lines.push(`Vocabulary words: ${answers.count}.`);
      if (answers.length) lines.push(`Story length: ${answers.length}.`);
      if (type === "lessons") lines.push(`Blocks: ${blocks}.`);
      if (weak) lines.push(`Learner weak areas: ${weak}.`);
      lines.push(`Return one JSON object with only the "${type}" array.`);
      if (options.previous) lines.push(`Previous result JSON: ${JSON.stringify(options.previous).slice(0, 12000)}`);
      if (options.refinement) lines.push(`User refinement: ${options.refinement}`);
      return lines.join("\n");
    }

    async function beginAiGeneration(options = {}) {
      if (!aiChatState || aiChatState.busy) return;
      if (!ensureAiStudioCourse(false)) {
        appendAiChatMessage("assistant", t("ai_course_no_active"));
        return;
      }
      if (aiChatState.course && !activeLanguageCodes().includes(aiChatState.course)) {
        renderAiCourseSelector();
        appendAiChatMessage("assistant", t("ai_course_missing", { course: aiCourseLabel(aiChatState.course) }), {
          actions: [{ label: t("ai_chat_action_refine"), action: "course" }]
        });
        return;
      }
      if (aiChatState.course !== aiStudioCourse) aiChatState.course = aiStudioCourse;
      if (!hasConfiguredAiProvider()) {
        appendAiChatMessage("assistant", t("ai_error_missing_key"), {
          actions: [
            { label: t("ai_chat_action_key"), action: "key" },
            { label: t("ai_chat_action_change_model"), action: "change-model" }
          ]
        });
        return;
      }
      const prompt = options.prompt || buildAiPrompt(options);
      if (!prompt) return;
      const type = options.type || aiChatState.type || inferAiType(prompt);
      aiChatState.lastPrompt = prompt;
      aiChatState.lastType = type;
      aiChatState.refining = false;
      setChatBusy(true);
      setAiChatHint("ai_chat_generating");
      const status = appendAiChatStatus(t("ai_chat_status_key"));
      const controller = new AbortController();
      aiChatAbort = controller;
      let retryMessage = null;
      const setRetryText = (payload) => {
        const text = formatAiRetryText(payload);
        if (!retryMessage) {
          retryMessage = appendAiChatMessage("assistant", text, { kind: "status", persist: false });
          if (retryMessage) {
            appendAiChatActions(retryMessage.bubble, [{ label: t("ai_retry_cancel"), action: "cancel" }]);
          }
        } else {
          retryMessage.bubble.textContent = text;
          appendAiChatActions(retryMessage.bubble, [{ label: t("ai_retry_cancel"), action: "cancel" }]);
        }
        scrollAiChat();
      };
      try {
        const result = await generateAiText(prompt, {
          system: aiCourseSystemPrompt(),
          json: true,
          temperature: 0.65,
          maxOutputTokens: 16384,
          signal: controller.signal,
          onStatus: ({ provider, model }) => {
            if (provider && model) status.set(t("ai_chat_status_provider", { provider: aiProviderLabel(provider), model }));
          },
          onRetry: setRetryText
        });
        aiChatLastResult = result;
        retryMessage?.bubble.querySelector(".ai-chat-actions")?.remove();
        if (result.provider === "gemini") {
          geminiLastActualModel = result.model;
          geminiLastFallback = result.fallback ? { requested: result.fallback.fromModel, actual: result.model } : null;
        }
        status.set(t("ai_chat_status_provider", { provider: aiProviderLabel(result.provider), model: result.model }));
        appendAiChatStatus(t("ai_chat_validating"));
        const raw = parseGeminiJson(result.text);
        const actualType = detectPayloadType(raw) || type;
        const payload = validateGeneratedPayload(raw, actualType);
        aiChatState.type = actualType;
        aiChatState.generated = { payload, type: actualType, imported: false };
        if (result.fallback) {
          const fallbackText = result.fallback.fromProvider === result.provider
            ? t("ai_provider_answered", { provider: aiProviderLabel(result.provider), model: result.model })
            : t("ai_provider_fallback", { provider: aiProviderLabel(result.provider), model: result.model });
          appendAiChatMessage("assistant", fallbackText, {
            actions: [{ label: t("ai_provider_make_primary"), action: "make-primary" }]
          });
        }
        const done = appendAiChatStatus(t("ai_chat_done"));
        done.done(t("ai_chat_done"));
        appendAiPreviewCard(payload, actualType);
      } catch (error) {
        retryMessage?.bubble.querySelector(".ai-chat-actions")?.remove();
        if (error?.aiCode === "aborted" || error?.name === "AbortError") {
          status.fail(t("ai_chat_cancelled"));
          appendAiChatMessage("assistant", t("ai_chat_cancelled"));
        } else {
          const failedText = `${t("ai_chat_error")} · ${geminiErrorMessage(error)}`;
          const failed = appendAiChatStatus(failedText);
          failed.fail(failedText);
          appendAiChatMessage("assistant", geminiErrorDisplay(error), {
            actions: [
              { label: t("ai_chat_action_retry"), action: "retry" },
              { label: t("ai_chat_action_simplify"), action: "simplify" },
              { label: t("ai_chat_action_change_model"), action: "change-model" },
              { label: t("ai_chat_action_key"), action: "key" }
            ]
          });
        }
      } finally {
        if (aiChatAbort === controller) aiChatAbort = null;
        setChatBusy(false);
        setAiChatHint("ai_chat_hint");
      }
    }

    function appendAiPreviewCard(payload, type) {
      const log = aiChatLogElement();
      if (!log) return;
      const row = document.createElement("div");
      row.className = "ai-chat-message is-assistant is-preview";
      const bubble = document.createElement("div");
      bubble.className = "ai-chat-bubble ai-preview-card";
      bubble.dataset.aiPreview = "1";
      const header = document.createElement("div");
      header.className = "ai-preview-head";
      const titleWrap = document.createElement("div");
      const kicker = document.createElement("span");
      kicker.className = "ai-preview-kicker";
      kicker.textContent = t("ai_chat_preview");
      const title = document.createElement("strong");
      const items = payload[type] || [];
      const first = items[0] || {};
      title.textContent = first.title || first.word || t("ai_chat_preview");
      titleWrap.append(kicker, title);
      header.appendChild(titleWrap);
      if (first.level) {
        const level = document.createElement("span");
        level.className = "ai-preview-level";
        level.textContent = first.level;
        header.appendChild(level);
      }
      bubble.appendChild(header);
      if (type === "vocab") {
        buildVocabPreview(bubble, items);
      } else {
        buildContentPreview(bubble, first, type, items.length);
      }
      const details = document.createElement("details");
      details.className = "ai-preview-json";
      const summary = document.createElement("summary");
      summary.textContent = t("ai_chat_show_json");
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(payload, null, 2);
      details.append(summary, pre);
      bubble.appendChild(details);
      const actions = document.createElement("div");
      actions.className = "ai-chat-chips ai-chat-actions ai-preview-actions";
      const actionList = [
        { label: t("ai_chat_action_add"), action: "add" },
        { label: t("ai_chat_action_refine"), action: "refine" }
      ];
      if (aiChatState?.lastPrompt) actionList.splice(1, 0, { label: t("ai_chat_action_regenerate"), action: "regenerate" });
      actionList.forEach((item) => actions.appendChild(aiChatChip(item.label, item.action)));
      bubble.appendChild(actions);
      row.appendChild(bubble);
      log.appendChild(row);
      const previewBlocks = type === "lessons" ? (Array.isArray(first.blocks) ? first.blocks.length : 0) : 0;
      const previewQuestions = type === "lessons"
        ? (Array.isArray(first.blocks) ? first.blocks : []).filter((block) => block.type === "quiz").reduce((sum, block) => sum + (Array.isArray(block.questions) ? block.questions.length : 0), 0)
        : 0;
      recordAiChatMessage("assistant", t("ai_chat_preview"), {
        kind: "preview",
        preview: {
          type,
          title: first.title || first.word || t("ai_chat_preview"),
          level: first.level || "",
          items: items.length,
          blocks: previewBlocks,
          questions: previewQuestions
        }
      });
      scrollAiChat();
    }

    function buildContentPreview(bubble, item, type, count) {
      const info = document.createElement("div");
      info.className = "ai-preview-meta";
      const typeLabel = document.createElement("span");
      typeLabel.textContent = type === "stories" ? t("ai_chat_story") : t("ai_chat_lesson");
      info.appendChild(typeLabel);
      if (item.subtitle) {
        const subtitle = document.createElement("span");
        subtitle.textContent = item.subtitle;
        info.appendChild(subtitle);
      }
      bubble.appendChild(info);
      if (type === "stories") {
        const text = document.createElement("p");
        text.className = "ai-preview-excerpt";
        text.textContent = String(item.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
        bubble.appendChild(text);
        const words = String(item.text || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
        const meta = document.createElement("p");
        meta.className = "ai-preview-count";
        meta.textContent = t("ai_chat_preview_words", { n: words });
        bubble.appendChild(meta);
        return;
      }
      const blocks = Array.isArray(item.blocks) ? item.blocks : [];
      const blockTitle = document.createElement("p");
      blockTitle.className = "ai-preview-count";
      blockTitle.textContent = `${t("ai_chat_preview_blocks")}: ${blocks.length}`;
      bubble.appendChild(blockTitle);
      const list = document.createElement("div");
      list.className = "ai-preview-block-list";
      blocks.forEach((block) => {
        const option = AI_BLOCK_OPTIONS.find((entry) => entry.type === block.type);
        const line = document.createElement("div");
        line.className = "ai-preview-block";
        const mark = document.createElement("span");
        mark.textContent = option?.mark || "•";
        const copy = document.createElement("span");
        const blockName = option ? t(option.label) : String(block.type || "");
        const detail = block.title || block.nav_label || block.text || block.prompt || "";
        copy.textContent = `${blockName}${detail ? ` · ${String(detail).replace(/<[^>]+>/g, "").slice(0, 90)}` : ""}`;
        line.append(mark, copy);
        list.appendChild(line);
      });
      bubble.appendChild(list);
      const questions = blocks
        .filter((block) => block.type === "quiz")
        .reduce((sum, block) => sum + (Array.isArray(block.questions) ? block.questions.length : 0), 0);
      if (questions) {
        const meta = document.createElement("p");
        meta.className = "ai-preview-count";
        meta.textContent = t("ai_chat_preview_questions", { n: questions });
        bubble.appendChild(meta);
      }
      if (count > 1) {
        const more = document.createElement("p");
        more.className = "ai-preview-count";
        more.textContent = `+${count - 1}`;
        bubble.appendChild(more);
      }
    }

    function buildVocabPreview(bubble, items) {
      const table = document.createElement("table");
      table.className = "ai-preview-vocab";
      const body = document.createElement("tbody");
      items.slice(0, 40).forEach((word) => {
        const row = document.createElement("tr");
        const source = document.createElement("td");
        source.textContent = String(word.word || "");
        const target = document.createElement("td");
        target.textContent = String(word.translation || "");
        row.append(source, target);
        body.appendChild(row);
      });
      table.appendChild(body);
      bubble.appendChild(table);
      const meta = document.createElement("p");
      meta.className = "ai-preview-count";
      meta.textContent = t("ai_chat_preview_words", { n: items.length });
      bubble.appendChild(meta);
    }

    function startAiRefine() {
      if (!aiChatState || !aiChatState.generated) return;
      aiChatState.refining = true;
      aiChatState.question = "refine";
      setAiChatHint("ai_chat_refine_hint");
      const input = document.getElementById("aiChatInput");
      if (input) {
        input.disabled = false;
        input.focus();
      }
    }

    async function refineAiResult(text) {
      if (!aiChatState) return;
      if (!aiChatState.generated) {
        if (!aiChatState.lastPrompt) return;
        const prompt = `${aiChatState.lastPrompt}\nUser refinement: ${text}`;
        await beginAiGeneration({ prompt, type: aiChatState.lastType });
        return;
      }
      const previous = aiChatState.generated.payload;
      const prompt = buildAiPrompt({
        type: aiChatState.generated.type,
        previous,
        refinement: text
      });
      await beginAiGeneration({ prompt, type: aiChatState.generated.type });
    }

    function retryAiGeneration() {
      if (!aiChatState?.lastPrompt) return;
      void beginAiGeneration({ prompt: aiChatState.lastPrompt, type: aiChatState.lastType });
    }

    function regenerateAi() {
      if (!aiChatState?.lastPrompt) return;
      void beginAiGeneration({ prompt: aiChatState.lastPrompt, type: aiChatState.lastType });
    }

    function importAiPreview() {
      if (!aiChatState?.generated || aiChatState.generated.imported) return;
      const targetCourse = aiChatState.course || aiStudioCourse;
      if (!targetCourse || !activeLanguageCodes().includes(targetCourse)) {
        renderAiCourseSelector();
        appendAiChatMessage("assistant", t("ai_course_missing", { course: aiCourseLabel(targetCourse) }), {
          actions: [{ label: t("ai_chat_action_refine"), action: "course" }]
        });
        return;
      }
      const originalLanguage = state.language;
      const originalSettingsLanguage = state.settings.language;
      const originalSearch = state.vocabSearch;
      const originalTag = state.vocabTag;
      let switched = false;
      try {
        if (targetCourse !== originalLanguage) {
          activateLanguageData(targetCourse);
          state.settings.language = targetCourse;
          switched = true;
        }
        const result = importPayload(aiChatState.generated.payload);
        aiChatState.generated.imported = true;
        const message = t("ai_imported", {
          lessons: result.lessonsAdded + result.lessonsUpdated,
          stories: result.storiesAdded + result.storiesUpdated,
          vocab: result.vocabAdded + result.vocabUpdated
        });
        appendAiChatMessage("assistant", `${message} · ${t("ai_chat_imported_course", { course: aiCourseLabel(targetCourse) })}`);
        if (targetCourse === originalLanguage && typeof rerenderCurrentView === "function") rerenderCurrentView();
        showToast(t("ai_chat_imported_course", { course: aiCourseLabel(targetCourse) }), "success");
      } catch (error) {
        appendAiChatMessage("assistant", geminiErrorDisplay(error), {
          actions: [{ label: t("ai_chat_action_refine"), action: "refine" }]
        });
      } finally {
        if (switched || state.language !== originalLanguage) {
          activateLanguageData(originalLanguage);
          state.settings.language = originalSettingsLanguage;
          state.vocabSearch = originalSearch;
          state.vocabTag = originalTag;
        }
      }
    }

    function openAiStudioSettings() {
      closeAiStudio();
      if (typeof openSettings === "function") openSettings();
      if (typeof setSettingsTab === "function") setSettingsTab("system");
    }

    function handleAiChatAction(action, value) {
      if (!aiChatState) return;
      if (action === "cancel") {
        aiChatAbort?.abort();
        return;
      }
      if (action === "make-primary") {
        if (aiChatLastResult) {
          makeProviderResult(aiChatLastResult);
          appendAiChatMessage("assistant", t("ai_make_primary_done", {
            provider: aiProviderLabel(aiChatLastResult.provider),
            model: aiChatLastResult.model
          }));
        }
        return;
      }
      if (action === "type") return startAiType(value);
      if (action === "auto") {
        aiChatState.mode = "lessons";
        aiChatState.type = "lessons";
        aiChatState.answers = { topic: t("ai_chat_auto"), level: "B1" };
        if (!appendAiChatMessage("user", t("ai_chat_auto"))) return;
        void beginAiGeneration();
        return;
      }
      if (action === "custom") return startAiPromptMode();
      if (action === "json") return startAiJsonMode();
      if (action === "diagnose") return startAiDiagnostics();
      if (action === "diag-skip") return skipAiDiagnostics();
      if (action === "diag") return answerAiDiagnostic(value);
      if (action === "count") return applyAiCount(value);
      if (action === "length") return applyAiLength(value);
      if (action === "block") {
        if (!aiChatState.blocks.includes(value)) aiChatState.blocks.push(value);
        else aiChatState.blocks = aiChatState.blocks.filter((item) => item !== value);
        document.querySelectorAll(`.ai-block-picker [data-ai-value="${value}"]`).forEach((button) => {
          button.classList.toggle("is-selected", aiChatState.blocks.includes(value));
        });
        return;
      }
      if (action === "all-blocks") {
        aiChatState.blocks = AI_BLOCK_OPTIONS.map((block) => block.type);
        finishAiBlocks();
        return;
      }
      if (action === "ai-blocks" || action === "apply-blocks") {
        if (action === "ai-blocks") aiChatState.blocks = [];
        return finishAiBlocks();
      }
      if (action === "skip") {
        if (aiChatState.question === "topic") applyAiTopic(t("ai_topic_general"));
        else if (aiChatState.question === "count") applyAiCount("20");
        else if (aiChatState.question === "length") applyAiLength("medium");
        else if (aiChatState.question === "level") applyAiLevel("B1");
        else if (aiChatState.question === "blocks") {
          aiChatState.blocks = [];
          finishAiBlocks();
        }
        else if (aiChatState.mode === "diagnostics") skipAiDiagnostics();
        return;
      }
      if (action === "retry") return retryAiGeneration();
      if (action === "regenerate") return regenerateAi();
      if (action === "refine") return aiChatState.generated ? startAiRefine() : startAiJsonMode();
      if (action === "add") return importAiPreview();
      if (action === "change-model" || action === "key") return openAiStudioSettings();
      if (action === "course") {
        const trigger = document.getElementById("aiCourseTrigger");
        const menu = document.getElementById("aiCourseMenu");
        if (menu && trigger) {
          menu.hidden = false;
          trigger.setAttribute("aria-expanded", "true");
          menu.querySelector("[data-ai-course]")?.focus();
        }
        return;
      }
      if (action === "simplify") {
        const text = t("ai_chat_action_simplify");
        appendAiChatMessage("user", text);
        void refineAiResult(text);
      }
    }

    function handleAiChatSend() {
      if (!aiChatState || aiChatState.busy) return;
      if (!ensureAiStudioCourse(false)) {
        appendAiChatMessage("assistant", t("ai_course_no_active"), { persist: false });
        return;
      }
      const input = document.getElementById("aiChatInput");
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      autoGrowChatInput();
      if (!appendAiChatMessage("user", text)) return;
      if (aiChatState.mode === "json" || aiChatState.question === "json") return startAiJson(text);
      if (aiChatState.refining || aiChatState.question === "refine") return void refineAiResult(text);
      const looksLikePrompt = text.length > 90 || /(сделай|создай|сгенерируй|напиши|make|create|generate)/i.test(text);
      if (!aiChatState.mode || aiChatState.question === "custom" || looksLikePrompt) return startAiCustom(text);
      if (aiChatState.mode === "diagnostics") return startAiCustom(text);
      if (aiChatState.question === "topic") return applyAiTopic(text);
      if (aiChatState.question === "level") return applyAiLevel(text.toUpperCase().match(/A1|A2|B1|B2/)?.[0] || "B1");
      if (aiChatState.question === "count") return applyAiCount(text.match(/\d+/)?.[0] || "20");
      if (aiChatState.question === "length") return applyAiLength(text.toLowerCase().includes("short") ? "short" : text.toLowerCase().includes("long") ? "long" : "medium");
      if (aiChatState.question === "blocks") return finishAiBlocks();
      startAiCustom(text);
    }

    function openAiStudio() {
      const modal = document.getElementById("aiStudioModal");
      if (!modal) return;
      ensureAiStudioCourse(true);
      if (!aiChatState || aiChatState.course !== aiStudioCourse) loadAiStudioChats();
      else {
        renderAiCourseSelector();
        renderAiChatList();
      }
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
      syncAiChatViewport();
      document.getElementById("aiChatInput")?.focus();
    }

    function closeAiStudio() {
      const modal = document.getElementById("aiStudioModal");
      if (!modal) return;
      if (modal.open && typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
    }

    /* ---------- AI Studio validation/import ---------- */

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
    document.getElementById("aiAnalysisRetry")?.addEventListener("click", () => {
      if (aiLastAnalysis) void runAiAnalysis(aiLastAnalysis.text, aiLastAnalysis.context);
    });
    document.getElementById("aiAnalysisCancel")?.addEventListener("click", () => aiAnalysisAbort?.abort());
    document.getElementById("aiAnalysisMakePrimary")?.addEventListener("click", () => {
      if (aiAnalysisLastResult) {
        makeProviderResult(aiAnalysisLastResult);
        setAiAnalysisMeta(t("ai_make_primary_done", {
          provider: aiProviderLabel(aiAnalysisLastResult.provider),
          model: aiAnalysisLastResult.model
        }), false);
      }
    });
    document.getElementById("aiAnalysisModal")?.addEventListener("click", (event) => {
      if (event.target.id === "aiAnalysisModal") closeAiAnalysisSheet();
    });

    document.getElementById("geminiModelTrigger")?.addEventListener("click", async (event) => {
      event.preventDefault();
      if (!geminiModelsCache.length && getGeminiKey()) await refreshGeminiModelPicker(false);
      toggleGeminiModelMenu();
    });
    document.getElementById("geminiModelRefresh")?.addEventListener("click", () => {
      void refreshGeminiModelPicker(true);
    });
    document.getElementById("geminiModelMenu")?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-gemini-model]");
      if (!option) return;
      event.preventDefault();
      saveGeminiModelPreference(option.dataset.geminiModel);
      renderGeminiModelPicker();
      setGeminiModelStatus(t("gemini_model_saved", { model: state.geminiModel }));
      geminiLastFallback = null;
      const notice = document.getElementById("geminiFallbackNotice");
      if (notice) notice.hidden = true;
      toggleGeminiModelMenu(false);
    });
    document.getElementById("geminiMakePrimary")?.addEventListener("click", () => {
      if (!geminiLastFallback?.actual) return;
      saveGeminiModelPreference(geminiLastFallback.actual);
      renderGeminiModelPicker();
      setGeminiModelStatus(t("gemini_primary_saved", { model: state.geminiModel }));
      geminiLastFallback = null;
      const notice = document.getElementById("geminiFallbackNotice");
      if (notice) notice.hidden = true;
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".gemini-model-select")) toggleGeminiModelMenu(false);
      if (event.target.closest("#settingsButton") || event.target.closest('[data-settings-tab="system"]')) {
        window.setTimeout(() => { if (getGeminiKey()) void refreshGeminiModelPicker(false); }, 80);
      }
    });
    geminiKeyInput?.addEventListener("change", () => {
      if (getGeminiKey()) void refreshGeminiModelPicker(true);
      else setGeminiModelStatus(t("gemini_error_missing_key"), true);
    });

    document.getElementById("openAiStudio")?.addEventListener("click", openAiStudio);
    document.getElementById("aiStudioClose")?.addEventListener("click", closeAiStudio);
    document.getElementById("aiStudioModal")?.addEventListener("click", (event) => {
      if (event.target.id === "aiStudioModal") closeAiStudio();
    });
    document.getElementById("aiChatNew")?.addEventListener("click", startNewAiChat);
    document.getElementById("aiChatSidebarNew")?.addEventListener("click", startNewAiChat);
    document.getElementById("aiChatPanelToggle")?.addEventListener("click", toggleAiChatPanel);
    document.getElementById("aiChatDeleteAll")?.addEventListener("click", deleteAllAiChats);
    document.getElementById("aiCourseTrigger")?.addEventListener("click", (event) => {
      event.preventDefault();
      const menu = document.getElementById("aiCourseMenu");
      const trigger = event.currentTarget;
      if (!menu || trigger.disabled) return;
      const open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("[data-ai-course]")?.focus();
    });
    document.getElementById("aiCourseMenu")?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-ai-course]");
      if (!option) return;
      event.preventDefault();
      switchAiStudioCourse(option.dataset.aiCourse);
    });
    document.getElementById("aiCourseMenu")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAiCourseMenu();
        document.getElementById("aiCourseTrigger")?.focus();
      }
    });
    document.getElementById("aiChatList")?.addEventListener("click", (event) => {
      const open = event.target.closest("[data-ai-chat-open]");
      if (open) {
        if (aiChatState?.busy) return;
        const chat = aiChatStore?.chats.find((item) => item.id === open.dataset.aiChatOpen);
        if (chat) {
          openAiChatRecord(chat);
          aiChatPanelOpen = false;
          document.getElementById("aiChatSidebar")?.classList.remove("is-open");
        }
        return;
      }
      const rename = event.target.closest("[data-ai-chat-rename]");
      if (rename) {
        aiChatRenamingId = rename.dataset.aiChatRename;
        renderAiChatList();
        document.querySelector(`[data-ai-chat-rename-input="${CSS.escape(aiChatRenamingId)}"]`)?.focus();
        return;
      }
      const save = event.target.closest("[data-ai-chat-rename-save]");
      if (save) {
        const input = document.querySelector(`[data-ai-chat-rename-input="${CSS.escape(save.dataset.aiChatRenameSave)}"]`);
        saveAiChatTitle(save.dataset.aiChatRenameSave, input?.value || "");
        return;
      }
      const cancel = event.target.closest("[data-ai-chat-rename-cancel]");
      if (cancel) {
        aiChatRenamingId = null;
        renderAiChatList();
        return;
      }
      const remove = event.target.closest("[data-ai-chat-delete]");
      if (remove) deleteAiChat(remove.dataset.aiChatDelete);
    });
    document.getElementById("aiChatList")?.addEventListener("keydown", (event) => {
      const input = event.target.closest("[data-ai-chat-rename-input]");
      if (!input) return;
      if (event.key === "Enter") {
        event.preventDefault();
        saveAiChatTitle(input.dataset.aiChatRenameInput, input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        aiChatRenamingId = null;
        renderAiChatList();
      }
    });
    document.getElementById("aiChatSend")?.addEventListener("click", handleAiChatSend);
    document.getElementById("aiChatInput")?.addEventListener("input", autoGrowChatInput);
    document.getElementById("aiChatInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleAiChatSend();
      }
    });
    document.getElementById("aiChatLog")?.addEventListener("click", (event) => {
      if (!aiChatState) return;
      const earlyAction = event.target.closest("[data-ai-action]");
      if (earlyAction?.dataset.aiAction === "cancel") {
        event.preventDefault();
        aiChatAbort?.abort();
        return;
      }
      if (aiChatState.busy) return;
      const levelOption = event.target.closest("[data-ai-level]");
      if (levelOption) {
        event.preventDefault();
        const menu = levelOption.closest(".ai-chat-select-menu");
        const trigger = menu?.parentElement?.querySelector("[data-ai-select-toggle]");
        if (menu) menu.hidden = true;
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        applyAiLevel(levelOption.dataset.aiLevel);
        return;
      }
      const selectTrigger = event.target.closest("[data-ai-select-toggle]");
      if (selectTrigger) {
        event.preventDefault();
        const menu = selectTrigger.parentElement?.querySelector(".ai-chat-select-menu");
        const open = Boolean(menu?.hidden);
        document.querySelectorAll(".ai-chat-select-menu").forEach((node) => { node.hidden = true; });
        document.querySelectorAll("[data-ai-select-toggle]").forEach((node) => node.setAttribute("aria-expanded", "false"));
        if (menu) menu.hidden = !open;
        selectTrigger.setAttribute("aria-expanded", String(Boolean(menu) && !menu.hidden));
        return;
      }
      const action = event.target.closest("[data-ai-action]");
      if (!action) return;
      event.preventDefault();
      handleAiChatAction(action.dataset.aiAction, action.dataset.aiValue || "");
    });
    document.getElementById("aiChatLog")?.addEventListener("keydown", (event) => {
      const trigger = event.target.closest("[data-ai-select-toggle]");
      const option = event.target.closest("[data-ai-level]");
      const menu = trigger?.parentElement?.querySelector(".ai-chat-select-menu") || option?.closest(".ai-chat-select-menu");
      if (option && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const options = [...menu.querySelectorAll("[data-ai-level]")];
        const index = options.indexOf(option);
        const next = event.key === "ArrowDown" ? options[index + 1] : options[index - 1];
        next?.focus();
      } else if (trigger && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) {
        event.preventDefault();
        if (menu) menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        menu?.querySelector(".ai-chat-select-option")?.focus();
      } else if (event.key === "Escape") {
        const openMenus = [...document.querySelectorAll(".ai-chat-select-menu")].some((node) => !node.hidden);
        if (openMenus) event.preventDefault();
        document.querySelectorAll(".ai-chat-select-menu").forEach((node) => { node.hidden = true; });
        document.querySelectorAll("[data-ai-select-toggle]").forEach((node) => node.setAttribute("aria-expanded", "false"));
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".ai-chat-select")) {
        document.querySelectorAll(".ai-chat-select-menu").forEach((node) => { node.hidden = true; });
        document.querySelectorAll("[data-ai-select-toggle]").forEach((node) => node.setAttribute("aria-expanded", "false"));
      }
      if (!event.target.closest(".ai-course-select")) closeAiCourseMenu();
      if (aiChatPanelOpen && !event.target.closest("#aiChatSidebar") && !event.target.closest("#aiChatPanelToggle")) {
        aiChatPanelOpen = false;
        document.getElementById("aiChatSidebar")?.classList.remove("is-open");
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !document.getElementById("aiCourseMenu")?.hidden) {
        event.preventDefault();
        closeAiCourseMenu();
      }
    });
    window.visualViewport?.addEventListener("resize", syncAiChatViewport);
    window.addEventListener("resize", syncAiChatViewport);

    if (!getGeminiKey()) setGeminiModelStatus(t("gemini_error_missing_key"), true);
    if (typeof initAiProviderSettings === "function") initAiProviderSettings();
