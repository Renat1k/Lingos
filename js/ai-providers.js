// LINGUA/OS · multi-provider AI routing, retries and provider settings
"use strict";

    const AI_PROVIDER_PRESETS = {
      gemini: {
        labelKey: "provider_gemini",
        kind: "gemini",
        baseUrl: GEMINI_API_BASE,
        defaultModel: ""
      },
      openai: {
        labelKey: "provider_openai",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: ""
      },
      openrouter: {
        labelKey: "provider_openrouter",
        kind: "openai",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: ""
      },
      groq: {
        labelKey: "provider_groq",
        kind: "openai",
        baseUrl: "https://api.groq.com/openai/v1",
        defaultModel: ""
      },
      mistral: {
        labelKey: "provider_mistral",
        kind: "openai",
        baseUrl: "https://api.mistral.ai/v1",
        defaultModel: ""
      },
      deepseek: {
        labelKey: "provider_deepseek",
        kind: "openai",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: ""
      },
      anthropic: {
        labelKey: "provider_anthropic",
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: ""
      },
      custom: {
        labelKey: "provider_custom",
        kind: "openai",
        baseUrl: "",
        defaultModel: ""
      }
    };

    const AI_PROVIDER_ORDER = ["gemini", "openai", "openrouter", "groq", "mistral", "deepseek", "anthropic", "custom"];
    const AI_COOLING_MS = 4 * 60 * 1000;
    const AI_RETRY_MAX_ATTEMPTS = 3;
    const AI_MAX_MODELS = 3;
    const aiProviderCooling = new Map();
    let aiProviderSettingsReady = false;

    function aiProviderPreset(id) {
      return AI_PROVIDER_PRESETS[id] || null;
    }

    function aiProviderLabel(id) {
      if (id === "none") return t("ai_provider_none");
      const preset = aiProviderPreset(id);
      return preset ? t(preset.labelKey) : String(id || "");
    }

    function aiProviderKind(id) {
      return aiProviderPreset(id)?.kind || "";
    }

    function aiProviderConfigKey(id) {
      return `${AI_PROVIDER_CONFIG_PREFIX}${id}`;
    }

    function readAiProviderId(key, fallback = "gemini") {
      try {
        const value = String(window.localStorage.getItem(key) || "").trim();
        if (value === "none") return "none";
        return aiProviderPreset(value) ? value : fallback;
      } catch (error) {
        return fallback;
      }
    }

    function getPrimaryProviderId() {
      return readAiProviderId(AI_PROVIDER_PRIMARY_KEY, "gemini");
    }

    function getBackupProviderId() {
      return readAiProviderId(AI_PROVIDER_BACKUP_KEY, "none");
    }

    function saveProviderSlot(slot, id) {
      const key = slot === "backup" ? AI_PROVIDER_BACKUP_KEY : AI_PROVIDER_PRIMARY_KEY;
      const value = id === "none" ? "none" : (aiProviderPreset(id) ? id : "gemini");
      try { window.localStorage.setItem(key, value); } catch (error) { /* storage can be unavailable */ }
    }

    function readAiProviderConfig(id) {
      const preset = aiProviderPreset(id);
      if (!preset) return null;
      if (id === "gemini") {
        return {
          provider: id,
          key: typeof getGeminiKey === "function" ? getGeminiKey() : "",
          model: typeof savedGeminiModel === "function" ? savedGeminiModel() : "",
          baseUrl: GEMINI_API_BASE
        };
      }
      let parsed = {};
      try {
        const raw = window.localStorage.getItem(aiProviderConfigKey(id));
        parsed = raw ? JSON.parse(raw) : {};
      } catch (error) {
        parsed = {};
      }
      return {
        provider: id,
        key: String(parsed.key || "").trim(),
        model: String(parsed.model || preset.defaultModel || "").trim(),
        baseUrl: String(parsed.baseUrl || preset.baseUrl || "").trim()
      };
    }

    function saveAiProviderConfig(id, patch = {}) {
      const preset = aiProviderPreset(id);
      if (!preset) return;
      if (id === "gemini") {
        if (Object.prototype.hasOwnProperty.call(patch, "key") && typeof saveGeminiKey === "function") {
          saveGeminiKey(patch.key);
          const input = document.getElementById("geminiKeyInput");
          if (input) input.value = String(patch.key || "");
        }
        if (Object.prototype.hasOwnProperty.call(patch, "model") && typeof saveGeminiModelPreference === "function") {
          saveGeminiModelPreference(patch.model);
          if (typeof renderGeminiModelPicker === "function") renderGeminiModelPicker();
        }
        return;
      }
      const current = readAiProviderConfig(id) || { key: "", model: "", baseUrl: preset.baseUrl };
      const next = {
        key: Object.prototype.hasOwnProperty.call(patch, "key") ? String(patch.key || "").trim() : current.key,
        model: Object.prototype.hasOwnProperty.call(patch, "model") ? String(patch.model || "").trim() : current.model,
        baseUrl: Object.prototype.hasOwnProperty.call(patch, "baseUrl") ? String(patch.baseUrl || "").trim() : current.baseUrl
      };
      try { window.localStorage.setItem(aiProviderConfigKey(id), JSON.stringify(next)); } catch (error) { /* storage can be unavailable */ }
    }

    function aiProviderHasModel(config) {
      return Boolean(config?.model || aiProviderKind(config?.provider) === "gemini");
    }

    function aiProviderHasKey(config) {
      return Boolean(config?.key);
    }

    function hasConfiguredAiProvider() {
      return [getPrimaryProviderId(), getBackupProviderId()]
        .filter((id) => id && id !== "none")
        .some((id) => {
          const config = readAiProviderConfig(id);
          return aiProviderHasKey(config) && aiProviderHasModel(config);
        });
    }

    function makeAiProviderError(code, provider, model, details = {}) {
      const error = new Error(details.message || code);
      error.name = details.name || "AiProviderError";
      error.aiCode = code;
      error.aiProvider = provider || "";
      error.aiModel = model || "";
      error.aiStatus = Number(details.status) || 0;
      error.aiApiMessage = String(details.apiMessage || "");
      error.aiRetryAfter = Number(details.retryAfter) || 0;
      error.aiRetryable = Boolean(details.retryable);
      error.aiDaily = Boolean(details.daily);
      error.aiTechnical = String(details.technical || "");
      return error;
    }

    function sanitiseAiTechnical(value) {
      return String(value || "")
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
        .replace(/sk-[0-9A-Za-z_-]{16,}/g, "[redacted]")
        .replace(/gsk_[0-9A-Za-z_-]{16,}/g, "[redacted]")
        .replace(/Bearer\s+[0-9A-Za-z._-]{12,}/gi, "Bearer [redacted]")
        .replace(/([?&](?:key|api_key|api-key)=)[^&\s]+/gi, "$1[redacted]")
        .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
        .slice(0, 600);
    }

    function aiErrorTechnical(error) {
      if (!error) return "";
      const parts = [];
      if (error.aiProvider) parts.push(aiProviderLabel(error.aiProvider));
      if (error.aiModel) parts.push(error.aiModel);
      if (error.aiStatus) parts.push(`HTTP ${error.aiStatus}`);
      if (error.aiApiMessage) parts.push(sanitiseAiTechnical(error.aiApiMessage));
      if (error.aiRetryAfter) parts.push(`retry ${error.aiRetryAfter}s`);
      if (error.aiTechnical) parts.push(sanitiseAiTechnical(error.aiTechnical));
      return parts.filter(Boolean).join(" · ");
    }

    function aiErrorMessage(error) {
      if (!error) return t("ai_error_generic");
      const code = String(error.aiCode || "");
      if (code === "missing_key") return t("ai_error_missing_key");
      if (code === "auth") return t("ai_error_auth");
      if (code === "permission") return t("ai_error_permission");
      if (code === "balance") return t("ai_error_balance");
      if (code === "rate_limit") return t("ai_error_rate");
      if (code === "overload") return t("ai_error_overload");
      if (code === "timeout") return t("ai_error_timeout");
      if (code === "network") return t("ai_error_network");
      if (code === "cors") return t("ai_error_cors");
      if (code === "model") return t("ai_error_model");
      if (code === "bad_request") return t("ai_error_bad_request");
      if (code === "aborted") return t("ai_error_aborted");
      if (code === "empty") return t("gemini_error_empty");
      return t("ai_error_generic");
    }

    function aiErrorDisplay(error) {
      const localized = aiErrorMessage(error);
      const technical = aiErrorTechnical(error);
      return technical ? `${localized} · ${technical}` : localized;
    }

    function parseRetryAfter(value) {
      if (!value) return 0;
      const text = String(value).trim();
      const numeric = Number(text);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
      const suffixed = text.match(/^(\d+(?:\.\d+)?)s$/i);
      if (suffixed) return Number(suffixed[1]);
      const date = Date.parse(text);
      if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
      return 0;
    }

    function providerRetryFromBody(body) {
      const details = Array.isArray(body?.error?.details) ? body.error.details : [];
      for (const item of details) {
        if (item?.retryDelay) return parseRetryAfter(item.retryDelay);
        if (item?.retry_after) return parseRetryAfter(item.retry_after);
      }
      return parseRetryAfter(body?.error?.retry_after || body?.retry_after || body?.retryDelay);
    }

    function isDailyQuota(body, status) {
      const text = JSON.stringify(body || {}).toLowerCase();
      return status === 429 && /insufficient_quota|quota_exceeded|billing|per\s*day|daily|quota.*day|out of quota/.test(text);
    }

    function statusToAiCode(status, body) {
      const text = JSON.stringify(body || {}).toLowerCase();
      if (status === 401) return "auth";
      if (status === 402) return "balance";
      if (status === 403) return /insufficient|quota|billing|balance/.test(text) ? "balance" : "permission";
      if (status === 404) return "model";
      if (status === 408) return "timeout";
      if (status === 429) return isDailyQuota(body, status) ? "balance" : "rate_limit";
      if (status >= 500) return "overload";
      if (status === 400) return "bad_request";
      return "generic";
    }

    function makeHttpProviderError(status, body, provider, model, headers = null) {
      const code = statusToAiCode(status, body);
      const message = String(body?.error?.message || body?.message || body?.error || "");
      const retryAfter = providerRetryFromBody(body)
        || parseRetryAfter(headers?.get?.("retry-after"))
        || parseRetryAfter(headers?.get?.("x-ratelimit-reset-requests"));
      const daily = isDailyQuota(body, status);
      const retryable = code === "overload"
        || code === "rate_limit"
        || code === "timeout"
        || code === "network";
      return makeAiProviderError(code, provider, model, {
        status,
        apiMessage: message,
        retryAfter,
        daily,
        retryable: retryable && !daily && !(code === "rate_limit" && retryAfter > 30),
        technical: ""
      });
    }

    function normalizeProviderError(error, provider, model) {
      if (error?.aiCode) {
        if (!error.aiProvider) error.aiProvider = provider;
        if (!error.aiModel) error.aiModel = model;
        return error;
      }
      if (error?.geminiStatus) {
        const body = {
          error: {
            message: error.geminiApiMessage || "",
            status: error.geminiApiStatus || ""
          }
        };
        const mapped = makeHttpProviderError(Number(error.geminiStatus), body, provider || "gemini", model || error.geminiModel || "", null);
        mapped.geminiStatus = error.geminiStatus;
        mapped.aiRetryAfter = parseRetryAfter(error.geminiRetryDelay);
        if (error.geminiQuotaScope === "daily") {
          mapped.aiCode = "balance";
          mapped.aiDaily = true;
          mapped.aiRetryable = false;
        } else if (mapped.aiCode === "rate_limit" && mapped.aiRetryAfter > 30) {
          mapped.aiRetryable = false;
        }
        return mapped;
      }
      if (error?.geminiCode === "models") return makeAiProviderError("model", provider, model, { retryable: false });
      if (error?.geminiCode === "max_tokens" || error?.geminiCode === "empty") {
        return makeAiProviderError("empty", provider, model, { retryable: false });
      }
      if (error?.geminiCode === "timeout" || error?.name === "AbortError") {
        return makeAiProviderError("timeout", provider, model, { name: "AbortError", retryable: true });
      }
      if (error?.geminiCode === "network" || error instanceof TypeError) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        return makeAiProviderError(offline ? "network" : "cors", provider, model, {
          name: error?.name || "TypeError",
          retryable: true,
          technical: offline ? "offline" : "browser fetch failed (network or CORS)"
        });
      }
      if (error?.geminiCode === "missing") return makeAiProviderError("missing_key", provider, model, { retryable: false });
      return makeAiProviderError("generic", provider, model, { message: error?.message || "", technical: "unexpected" });
    }

    async function readProviderErrorBody(response) {
      const text = await response.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch (error) { return { error: { message: text.slice(0, 500) } }; }
    }

    function createAbortError() {
      return makeAiProviderError("aborted", "", "", { name: "AbortError" });
    }

    function throwIfAborted(signal) {
      if (signal?.aborted) throw createAbortError();
    }

    function providerFetch(url, options, provider, model) {
      if (options.signal?.aborted) return Promise.reject(createAbortError());
      const controller = new AbortController();
      let externallyAborted = false;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Number(options.timeout) || 60000);
      const external = () => {
        externallyAborted = true;
        controller.abort();
      };
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener("abort", external, { once: true });
      }
      return fetch(url, { ...options, signal: controller.signal })
        .catch((error) => {
          if (externallyAborted) throw createAbortError();
          if (timedOut) throw makeAiProviderError("timeout", provider, model, { name: "AbortError", retryable: true });
          throw normalizeProviderError(error, provider, model);
        })
        .finally(() => {
          window.clearTimeout(timer);
          options.signal?.removeEventListener("abort", external);
        });
    }

    async function listOpenAiModels(config) {
      const base = String(config.baseUrl || "").replace(/\/+$/, "");
      if (!base) throw makeAiProviderError("bad_request", config.provider, "", {});
      const response = await providerFetch(`${base}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        signal: null
      }, config.provider, "");
      if (response.status === 404 || response.status === 405) return [];
      if (!response.ok) {
        throw makeHttpProviderError(response.status, await readProviderErrorBody(response), config.provider, "");
      }
      const data = await response.json();
      return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
        .map((item) => String(item?.id || item?.name || "").replace(/^models\//, "").trim())
        .filter(Boolean);
    }

    async function listAnthropicModels(config) {
      const base = String(config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      const modelsUrl = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
      const response = await providerFetch(modelsUrl, {
        method: "GET",
        headers: {
          "x-api-key": config.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        signal: null
      }, "anthropic", "");
      if (response.status === 404 || response.status === 405) return [];
      if (!response.ok) {
        throw makeHttpProviderError(response.status, await readProviderErrorBody(response), "anthropic", "");
      }
      const data = await response.json();
      return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
        .map((item) => String(item?.id || item?.name || "").trim())
        .filter(Boolean);
    }

    async function listProviderModels(id, config = readAiProviderConfig(id)) {
      const kind = aiProviderKind(id);
      if (kind === "gemini") {
        if (typeof fetchGeminiModels !== "function") throw makeAiProviderError("generic", id, "");
        const models = await fetchGeminiModels(true);
        return models.map((model) => model.name);
      }
      if (kind === "openai") return listOpenAiModels(config);
      if (kind === "anthropic") return listAnthropicModels(config);
      return [];
    }

    function aiProviderBase(config) {
      return String(config?.baseUrl || "").replace(/\/+$/, "");
    }

    function openAiEndpoint(config, suffix) {
      const base = aiProviderBase(config);
      return base.endsWith(suffix) ? base : `${base}${suffix}`;
    }

    async function callOpenAiProvider(config, model, prompt, options) {
      if (!config.key) throw makeAiProviderError("missing_key", config.provider, model);
      if (!model) throw makeAiProviderError("model", config.provider, model);
      const body = {
        model,
        messages: [
          ...(options.system ? [{ role: "system", content: options.system }] : []),
          { role: "user", content: prompt }
        ],
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.6,
        max_tokens: Number(options.maxOutputTokens) || 4096
      };
      if (options.json) body.response_format = { type: "json_object" };
      let adjustments = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await providerFetch(openAiEndpoint(config, "/chat/completions"), {
          method: "POST",
          headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: options.signal,
          timeout: options.timeout
        }, config.provider, model);
        if (response.ok) {
          const data = await response.json();
          const choice = data?.choices?.[0];
          const text = String(choice?.message?.content || "").trim();
          if (!text) throw makeAiProviderError("empty", config.provider, model, { retryable: false });
          return { text, finishReason: String(choice?.finish_reason || ""), provider: config.provider, model };
        }
        const errorBody = await readProviderErrorBody(response);
        const message = String(errorBody?.error?.message || "").toLowerCase();
        if (response.status === 400 && adjustments < 2) {
          if (/max_completion_tokens|max_tokens|unsupported.*parameter/.test(message)) {
            if (body.max_tokens !== undefined) {
              body.max_completion_tokens = body.max_tokens;
              delete body.max_tokens;
              adjustments += 1;
              continue;
            }
          }
          if (body.response_format && /response_format|json mode|unsupported.*parameter/.test(message)) {
            delete body.response_format;
            adjustments += 1;
            continue;
          }
        }
        throw makeHttpProviderError(response.status, errorBody, config.provider, model, response.headers);
      }
      throw makeAiProviderError("bad_request", config.provider, model);
    }

    async function callAnthropicProvider(config, model, prompt, options) {
      if (!config.key) throw makeAiProviderError("missing_key", config.provider, model);
      if (!model) throw makeAiProviderError("model", config.provider, model);
      const base = aiProviderBase(config) || "https://api.anthropic.com";
      const url = base.endsWith("/v1/messages") ? base : base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
      const body = {
        model,
        max_tokens: Number(options.maxOutputTokens) || 4096,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.6,
        messages: [{ role: "user", content: prompt }]
      };
      if (options.system) body.system = options.system;
      const response = await providerFetch(url, {
        method: "POST",
        headers: {
          "x-api-key": config.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: options.signal,
        timeout: options.timeout
      }, "anthropic", model);
      if (!response.ok) {
        throw makeHttpProviderError(response.status, await readProviderErrorBody(response), "anthropic", model, response.headers);
      }
      const data = await response.json();
      const text = (Array.isArray(data?.content) ? data.content : [])
        .filter((part) => part?.type === "text")
        .map((part) => String(part.text || ""))
        .join("")
        .trim();
      if (!text) throw makeAiProviderError("empty", "anthropic", model, { retryable: false });
      return { text, finishReason: String(data?.stop_reason || ""), provider: "anthropic", model };
    }

    async function callGeminiProvider(config, model, prompt, options) {
      if (!config.key) throw makeAiProviderError("missing_key", "gemini", model);
      if (typeof generateGeminiOnce !== "function") throw makeAiProviderError("generic", "gemini", model);
      const result = await generateGeminiOnce(prompt, {
        ...options,
        model,
        key: config.key,
        baseUrl: config.baseUrl,
        signal: options.signal
      });
      return { ...result, provider: "gemini", model: result.model || model };
    }

    async function callProviderOnce(config, model, prompt, options) {
      const kind = aiProviderKind(config.provider);
      if (kind === "gemini") return callGeminiProvider(config, model, prompt, options);
      if (kind === "openai") return callOpenAiProvider(config, model, prompt, options);
      if (kind === "anthropic") return callAnthropicProvider(config, model, prompt, options);
      throw makeAiProviderError("bad_request", config.provider, model);
    }

    function providerModelCandidates(config) {
      const kind = aiProviderKind(config.provider);
      if (kind === "gemini" && typeof geminiCandidateModels === "function") {
        return geminiCandidateModels(config.model, AI_MAX_MODELS * 3)
          .map((model) => typeof model === "string" ? model : model?.name)
          .filter(Boolean);
      }
      return [config.model].filter(Boolean);
    }

    function coolingKey(provider, model) {
      return `${provider}:${model}`;
    }

    function isModelCooling(provider, model) {
      const until = aiProviderCooling.get(coolingKey(provider, model)) || 0;
      if (until <= Date.now()) {
        if (until) aiProviderCooling.delete(coolingKey(provider, model));
        return false;
      }
      return true;
    }

    function markModelCooling(provider, model) {
      if (model) aiProviderCooling.set(coolingKey(provider, model), Date.now() + AI_COOLING_MS);
    }

    function retryDelayMs(error, attempt) {
      const serverMs = Number(error?.aiRetryAfter) > 0 ? Number(error.aiRetryAfter) * 1000 : 0;
      const base = 1200 * (2 ** Math.max(0, attempt - 1));
      const jitter = Math.floor(Math.random() * 350);
      return Math.max(base, serverMs) + jitter;
    }

    function waitForRetry(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(createAbortError());
          return;
        }
        const timer = window.setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          window.clearTimeout(timer);
          reject(createAbortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }

    function providerRetryReason(error) {
      if (error?.aiCode === "rate_limit" || error?.aiCode === "balance") return "ai_retry_rate";
      if (error?.aiCode === "network" || error?.aiCode === "cors") return "ai_retry_network";
      if (error?.aiCode === "timeout") return "ai_retry_timeout";
      return "ai_retry_overload";
    }

    async function runProvider(config, prompt, options = {}) {
      if (!config) throw makeAiProviderError("missing_key", "", "");
      if (!config.key) throw makeAiProviderError("missing_key", config.provider, config.model || "");
      let candidates = providerModelCandidates(config);
      if (!candidates.length) throw makeAiProviderError("model", config.provider, config.model || "");
      const coolingSkipped = candidates.filter((model) => isModelCooling(config.provider, model));
      candidates = candidates.filter((model) => !isModelCooling(config.provider, model)).slice(0, AI_MAX_MODELS);
      if (!candidates.length) {
        const error = makeAiProviderError("overload", config.provider, "", {
          retryable: false,
          technical: coolingSkipped.length ? "all candidate models are cooling down" : "no models"
        });
        throw error;
      }
      let lastError = null;
      for (const model of candidates) {
        throwIfAborted(options.signal);
        for (let attempt = 1; attempt <= AI_RETRY_MAX_ATTEMPTS; attempt += 1) {
          throwIfAborted(options.signal);
          options.onStatus?.({ stage: "provider", provider: config.provider, model, attempt });
          try {
            const result = await callProviderOnce(config, model, prompt, options);
            return { ...result, requestedModel: candidates[0] };
          } catch (rawError) {
            const error = normalizeProviderError(rawError, config.provider, model);
            if (error.aiCode === "aborted") throw error;
            lastError = error;
            const canRetry = error.aiRetryable && attempt < AI_RETRY_MAX_ATTEMPTS;
            if (canRetry) {
              const delayMs = retryDelayMs(error, attempt);
              options.onRetry?.({
                attempt,
                max: AI_RETRY_MAX_ATTEMPTS,
                delayMs,
                provider: config.provider,
                model,
                reason: providerRetryReason(error),
                error
              });
              await waitForRetry(delayMs, options.signal);
              continue;
            }
            if (["auth", "permission", "balance", "missing_key", "cors"].includes(error.aiCode)) {
              throw error;
            }
            if (["overload", "rate_limit"].includes(error.aiCode) || Number(error.aiStatus) >= 500) {
              markModelCooling(config.provider, model);
            }
            break;
          }
        }
      }
      if (lastError) {
        lastError.aiTechnical = [lastError.aiTechnical, `tried ${candidates.join(", ")}`].filter(Boolean).join(" · ");
        throw lastError;
      }
      throw makeAiProviderError("overload", config.provider, "", { retryable: false });
    }

    async function ensureProviderModels(config) {
      if (aiProviderKind(config.provider) === "gemini" && typeof ensureGeminiModels === "function") {
        await ensureGeminiModels();
      }
    }

    async function generateAiText(prompt, options = {}) {
      const primaryId = getPrimaryProviderId();
      const backupId = getBackupProviderId();
      const route = [];
      const primaryConfig = primaryId !== "none" ? readAiProviderConfig(primaryId) : null;
      const backupConfig = backupId !== "none" && backupId !== primaryId ? readAiProviderConfig(backupId) : null;
      if (primaryConfig) route.push(primaryId);
      if (backupConfig) route.push(backupId);
      if (!route.length) throw makeAiProviderError("missing_key", "", "");
      let lastError = null;
      for (const id of route) {
        const config = id === primaryId ? primaryConfig : backupConfig;
        if (!config) continue;
        try {
          await ensureProviderModels(config);
          const result = await runProvider(config, prompt, options);
          const fallback = id !== primaryId || result.model !== result.requestedModel;
          const final = {
            ...result,
            providerLabel: aiProviderLabel(result.provider),
            route,
            fallback: fallback ? {
              fromProvider: primaryId,
              fromModel: id === primaryId
                ? (result.requestedModel || primaryConfig?.model || "")
                : (primaryConfig?.model || ""),
              provider: result.provider,
              model: result.model
            } : null
          };
          if (fallback) options.onFallback?.(final);
          return final;
        } catch (error) {
          if (error.aiCode === "aborted") throw error;
          lastError = error;
          if (id === primaryId && backupConfig) {
            options.onProviderFallback?.({
              fromProvider: primaryId,
              toProvider: backupId,
              error
            });
          }
        }
      }
      throw lastError || makeAiProviderError("generic", "", "");
    }

    async function testProviderSlot(slot) {
      const id = slot === "backup" ? getBackupProviderId() : getPrimaryProviderId();
      if (id === "none") return { ok: false, error: makeAiProviderError("missing_key", "", "") };
      const config = readAiProviderConfig(id);
      if (!aiProviderHasKey(config)) return { ok: false, error: makeAiProviderError("missing_key", id, config.model) };
      try {
        await ensureProviderModels(config);
        const result = await runProvider(config, "Reply with the single word OK.", {
          temperature: 0,
          maxOutputTokens: 64,
          system: "Reply briefly."
        });
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function makeProviderResultPrimary(provider, model) {
      if (!provider || !aiProviderPreset(provider)) return;
      saveProviderSlot("primary", provider);
      if (model) saveAiProviderConfig(provider, { model });
      renderAiProviderSettings();
      showToast(t("ai_provider_primary_saved", { provider: aiProviderLabel(provider), model: model || "" }), "success");
    }

    function makeProviderResult(result) {
      if (!result) return;
      makeProviderResultPrimary(result.provider, result.model);
    }

    /* ---------- provider settings UI ---------- */

    function providerSlotId(slot) {
      return slot === "backup" ? getBackupProviderId() : getPrimaryProviderId();
    }

    function setProviderSlotStatus(slot, text, isError = false) {
      const card = document.querySelector(`.ai-provider-card[data-ai-provider-slot="${slot}"]`);
      const node = card?.querySelector("[data-provider-status]");
      if (!node) return;
      node.textContent = text || "";
      node.classList.toggle("is-error", Boolean(isError));
    }

    function providerMenu(slot, selectedId) {
      const menu = document.createElement("div");
      menu.className = "ai-provider-menu";
      menu.hidden = true;
      const ids = slot === "backup" ? ["none", ...AI_PROVIDER_ORDER] : [...AI_PROVIDER_ORDER];
      ids.forEach((id) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ai-provider-option${id === selectedId ? " is-selected" : ""}`;
        button.dataset.aiProviderChoice = id;
        button.dataset.aiProviderSlot = slot;
        button.textContent = aiProviderLabel(id);
        menu.appendChild(button);
      });
      return menu;
    }

    function buildProviderCard(slot) {
      const selectedId = providerSlotId(slot);
      const card = document.createElement("article");
      card.className = "ai-provider-card";
      card.dataset.aiProviderSlot = slot;
      const head = document.createElement("div");
      head.className = "ai-provider-card-head";
      const title = document.createElement("strong");
      title.textContent = slot === "backup" ? t("ai_provider_backup") : t("ai_provider_primary");
      head.appendChild(title);
      if (slot === "backup" && selectedId !== "none") {
        const make = document.createElement("button");
        make.type = "button";
        make.className = "ai-provider-link";
        make.dataset.aiProviderMakePrimary = "backup";
        make.textContent = t("ai_provider_make_primary");
        head.appendChild(make);
      }
      card.appendChild(head);

      const select = document.createElement("div");
      select.className = "ai-provider-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ai-provider-trigger";
      trigger.dataset.aiProviderToggle = slot;
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.textContent = aiProviderLabel(selectedId);
      const chevron = document.createElement("span");
      chevron.textContent = "⌄";
      trigger.appendChild(chevron);
      const menu = providerMenu(slot, selectedId);
      select.append(trigger, menu);
      card.appendChild(select);

      if (selectedId === "none") {
        const note = document.createElement("p");
        note.className = "ai-provider-note";
        note.textContent = t("ai_provider_none");
        card.appendChild(note);
        return card;
      }

      const config = readAiProviderConfig(selectedId) || { key: "", model: "", baseUrl: "" };
      const fields = document.createElement("div");
      fields.className = "ai-provider-fields";

      const keyLabel = document.createElement("label");
      keyLabel.className = "ai-provider-field";
      const keyText = document.createElement("span");
      keyText.textContent = t("ai_provider_key");
      const keyRow = document.createElement("div");
      keyRow.className = "ai-provider-key-row";
      const keyInput = document.createElement("input");
      keyInput.type = "password";
      keyInput.spellcheck = false;
      keyInput.autocomplete = "off";
      keyInput.value = config.key || "";
      keyInput.placeholder = t("ai_provider_key_placeholder");
      keyInput.dataset.aiProviderKey = slot;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ai-provider-toggle";
      toggle.dataset.aiProviderToggleKey = slot;
      toggle.textContent = "👁";
      toggle.setAttribute("aria-label", t("show"));
      keyRow.append(keyInput, toggle);
      keyLabel.append(keyText, keyRow);
      fields.appendChild(keyLabel);

      const modelLabel = document.createElement("label");
      modelLabel.className = "ai-provider-field";
      const modelText = document.createElement("span");
      modelText.textContent = t("ai_provider_model");
      const modelRow = document.createElement("div");
      modelRow.className = "ai-provider-model-row";
      const modelInput = document.createElement("input");
      modelInput.type = "text";
      modelInput.spellcheck = false;
      modelInput.autocomplete = "off";
      modelInput.value = config.model || "";
      modelInput.placeholder = t("ai_provider_model_placeholder");
      modelInput.dataset.aiProviderModel = slot;
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "ai-provider-small-btn";
      refresh.dataset.aiProviderRefresh = slot;
      refresh.textContent = t("ai_provider_refresh_models");
      modelRow.append(modelInput, refresh);
      modelLabel.append(modelText, modelRow);
      fields.appendChild(modelLabel);

      if (aiProviderKind(selectedId) !== "gemini") {
        const baseLabel = document.createElement("label");
        baseLabel.className = "ai-provider-field";
        const baseText = document.createElement("span");
        baseText.textContent = t("ai_provider_base_url");
        const baseInput = document.createElement("input");
        baseInput.type = "url";
        baseInput.spellcheck = false;
        baseInput.value = config.baseUrl || "";
        baseInput.placeholder = "https://…";
        baseInput.dataset.aiProviderBase = slot;
        baseLabel.append(baseText, baseInput);
        fields.appendChild(baseLabel);
      } else {
        const fixed = document.createElement("p");
        fixed.className = "ai-provider-note";
        fixed.textContent = `${t("ai_provider_base_url")}: ${GEMINI_API_BASE}`;
        fields.appendChild(fixed);
      }

      const actions = document.createElement("div");
      actions.className = "ai-provider-actions";
      const test = document.createElement("button");
      test.type = "button";
      test.className = "btn btn-quiet";
      test.dataset.aiProviderTest = slot;
      test.textContent = t("ai_provider_test");
      const hint = document.createElement("span");
      hint.className = "ai-provider-note";
      hint.textContent = t("ai_provider_manual_model");
      actions.append(test, hint);
      fields.appendChild(actions);

      const list = document.createElement("div");
      list.className = "ai-provider-model-list";
      list.dataset.aiProviderModelList = slot;
      fields.appendChild(list);

      const status = document.createElement("p");
      status.className = "ai-provider-status";
      status.dataset.providerStatus = "";
      status.setAttribute("aria-live", "polite");
      fields.appendChild(status);
      card.appendChild(fields);
      return card;
    }

    function renderAiProviderSettings() {
      const host = document.getElementById("aiProviderCards");
      if (!host) return;
      host.textContent = "";
      host.append(buildProviderCard("primary"), buildProviderCard("backup"));
      const primary = readAiProviderConfig(getPrimaryProviderId());
      const backup = readAiProviderConfig(getBackupProviderId());
      const route = [
        primary ? `${aiProviderLabel(primary.provider)}${primary.model ? ` · ${primary.model}` : ""}` : null,
        backup ? `${aiProviderLabel(backup.provider)}${backup.model ? ` · ${backup.model}` : ""}` : null
      ].filter(Boolean).join(" → ");
      const global = document.getElementById("aiProviderGlobalStatus");
      if (global) global.textContent = route ? t("ai_provider_route", { route }) : "";
    }

    function renderProviderModelList(slot, models) {
      const card = document.querySelector(`.ai-provider-card[data-ai-provider-slot="${slot}"]`);
      const list = card?.querySelector("[data-ai-provider-model-list]");
      if (!list) return;
      list.textContent = "";
      models.slice(0, 40).forEach((model) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-provider-model-option";
        button.dataset.aiProviderModelChoice = model;
        button.dataset.aiProviderSlot = slot;
        button.textContent = model;
        list.appendChild(button);
      });
    }

    async function refreshProviderModelsForSlot(slot) {
      const id = providerSlotId(slot);
      if (id === "none") return;
      const config = readAiProviderConfig(id);
      if (!aiProviderHasKey(config)) {
        setProviderSlotStatus(slot, t("ai_provider_missing_key"), true);
        return;
      }
      setProviderSlotStatus(slot, t("gemini_model_loading"));
      try {
        const models = await listProviderModels(id, config);
        renderProviderModelList(slot, models);
        setProviderSlotStatus(slot, models.length ? t("ai_provider_models_loaded", { count: models.length }) : t("ai_provider_models_unsupported"));
      } catch (error) {
        setProviderSlotStatus(slot, aiErrorDisplay(error), true);
      }
    }

    async function testProviderForSlot(slot) {
      const id = providerSlotId(slot);
      setProviderSlotStatus(slot, t("ai_provider_testing"));
      const result = await testProviderSlot(slot);
      if (result.ok) {
        setProviderSlotStatus(slot, t("ai_provider_works", { model: result.result.model || "" }));
      } else {
        setProviderSlotStatus(slot, aiErrorDisplay(result.error), true);
      }
    }

    function saveFieldFromTarget(target) {
      const slot = target.dataset.aiProviderKey || target.dataset.aiProviderModel || target.dataset.aiProviderBase;
      if (!slot) return;
      const id = providerSlotId(slot);
      if (target.dataset.aiProviderKey) saveAiProviderConfig(id, { key: target.value });
      else if (target.dataset.aiProviderModel) saveAiProviderConfig(id, { model: target.value });
      else if (target.dataset.aiProviderBase) saveAiProviderConfig(id, { baseUrl: target.value });
    }

    function closeProviderMenus() {
      document.querySelectorAll(".ai-provider-menu").forEach((menu) => { menu.hidden = true; });
      document.querySelectorAll(".ai-provider-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    }

    function initAiProviderSettings() {
      if (aiProviderSettingsReady) {
        renderAiProviderSettings();
        return;
      }
      aiProviderSettingsReady = true;
      const host = document.getElementById("aiProviderCards");
      if (!host) return;
      renderAiProviderSettings();

      host.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-ai-provider-toggle]");
        if (toggle) {
          const menu = toggle.parentElement?.querySelector(".ai-provider-menu");
          const open = menu?.hidden;
          closeProviderMenus();
          if (menu) menu.hidden = !open;
          toggle.setAttribute("aria-expanded", String(Boolean(open)));
          return;
        }
        const choice = event.target.closest("[data-ai-provider-choice]");
        if (choice) {
          saveProviderSlot(choice.dataset.aiProviderSlot, choice.dataset.aiProviderChoice);
          closeProviderMenus();
          renderAiProviderSettings();
          return;
        }
        const keyToggle = event.target.closest("[data-ai-provider-toggle-key]");
        if (keyToggle) {
          const input = keyToggle.parentElement?.querySelector("input");
          if (input) {
            input.type = input.type === "password" ? "text" : "password";
            keyToggle.setAttribute("aria-label", input.type === "password" ? t("show") : t("hide"));
          }
          return;
        }
        const refresh = event.target.closest("[data-ai-provider-refresh]");
        if (refresh) {
          void refreshProviderModelsForSlot(refresh.dataset.aiProviderRefresh);
          return;
        }
        const test = event.target.closest("[data-ai-provider-test]");
        if (test) {
          void testProviderForSlot(test.dataset.aiProviderTest);
          return;
        }
        const modelChoice = event.target.closest("[data-ai-provider-model-choice]");
        if (modelChoice) {
          const card = modelChoice.closest(".ai-provider-card");
          const input = card?.querySelector(`[data-ai-provider-model="${modelChoice.dataset.aiProviderSlot}"]`);
          if (input) {
            input.value = modelChoice.dataset.aiProviderModelChoice;
            saveAiProviderConfig(providerSlotId(modelChoice.dataset.aiProviderSlot), { model: input.value });
          }
          return;
        }
        const make = event.target.closest("[data-ai-provider-make-primary]");
        if (make) {
          const id = providerSlotId("backup");
          if (id !== "none") {
            saveProviderSlot("primary", id);
            renderAiProviderSettings();
            showToast(t("ai_provider_saved"), "success");
          }
        }
      });

      host.addEventListener("input", (event) => {
        if (event.target.matches("[data-ai-provider-key], [data-ai-provider-model], [data-ai-provider-base]")) {
          saveFieldFromTarget(event.target);
        }
      });
      host.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeProviderMenus();
        }
      });
      document.addEventListener("click", (event) => {
        if (!event.target.closest(".ai-provider-select")) closeProviderMenus();
      });
      document.addEventListener("click", (event) => {
        if (!event.target.closest("#settingsButton") && !event.target.closest('[data-ui-language]') && !event.target.closest('.settings-tab[data-settings-tab="system"]')) return;
        window.setTimeout(() => {
          if (aiProviderSettingsReady) renderAiProviderSettings();
        }, 80);
      });
    }
