// LINGUA/OS · application state, persistence, language pack loading
"use strict";

    const state = {
      data: null,
      rootData: null,
      languagePacks: {},
      language: "en",
      languagePack: null,
      lessons: [],
      stories: [],
      vocab: [],
      importedLessons: [],
      importedStories: [],
      lesson: null,
      lessonId: null,
      story: null,
      storyId: null,
      profile: null,
      authUser: null,
      authMode: "login",
      authBusy: false,
      avatarEmojiDraft: "",
      view: "dashboard",
      backTarget: "#dashboard",
      source: "fetch",
      discovered: new Set(),
      activeBlock: 0,
      toastTimer: null,
      scrollCleanup: null,
      settings: { font: "normal", language: "en", theme: "glass", uiLanguage: "ru", updated_at: "" },
      geminiKey: "",
      languageFilter: "active",
      courseFlagDraft: null,
      importTab: "vocab",
      importDrafts: {},
      editingWordId: null,
      vocabSearch: "",
      vocabTag: "all",
      lastFocus: null
    };

    function readJSON(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (error) {
        return fallback;
      }
    }

    function writeJSON(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        if (key.startsWith("lingua_") && !key.startsWith("lingua_cloud_")) scheduleCloudSync();
        return true;
      } catch (error) {
        return false;
      }
    }

    function removeStored(key) {
      try {
        window.localStorage.removeItem(key);
        if (key.startsWith("lingua_") && !key.startsWith("lingua_cloud_")) scheduleCloudSync();
      } catch (error) { /* storage unavailable */ }
    }

    function activeLanguageCodes() {
      return (Array.isArray(LANGUAGE_CODES) ? LANGUAGE_CODES : []).filter((code) => {
        const pack = state.languagePacks?.[code];
        return pack && !pack.is_archived;
      });
    }

    function currentLanguage() {
      const active = activeLanguageCodes();
      if (active.includes(state.language)) return state.language;
      return active[0] || null;
    }

    function languageKey(suffix) {
      return `lingua_${currentLanguage()}_${suffix}`;
    }

    function getWritingKey(lessonId, blockIndex) {
      return languageKey(`writing_lesson_${lessonId}_block_${blockIndex}`);
    }

    function getQuizKey(lessonId, blockIndex) {
      return languageKey(`quiz_lesson_${lessonId}_block_${blockIndex}`);
    }

    function loadTombstones() {
      const stored = readJSON(DELETED_KEY, []);
      if (!Array.isArray(stored)) return [];
      return stored
        .filter((item) => item && typeof item === "object" && ["word", "language", "lesson", "story"].includes(item.type))
        .map((item) => ({
          type: item.type,
          language: item.language ? String(item.language) : "",
          id: item.id == null ? null : Number(item.id),
          code: item.code ? String(item.code) : "",
          deleted_at: String(item.deleted_at || "")
        }))
        .filter((item) => item.deleted_at);
    }

    function saveTombstones(items) {
      writeJSON(DELETED_KEY, Array.isArray(items) ? items : []);
    }

    function tombstoneIdentity(item) {
      return [item.type, item.language || "", item.id == null ? "" : item.id, item.code || ""].join("|");
    }

    function addTombstone(type, data) {
      const now = new Date().toISOString();
      const next = {
        type,
        language: data?.language ? String(data.language) : "",
        id: data?.id == null ? null : Number(data.id),
        code: data?.code ? String(data.code) : "",
        deleted_at: now
      };
      const items = loadTombstones();
      const identity = tombstoneIdentity(next);
      const existing = items.find((item) => tombstoneIdentity(item) === identity);
      if (existing && Date.parse(existing.deleted_at) >= Date.parse(now)) return existing;
      saveTombstones([...items.filter((item) => tombstoneIdentity(item) !== identity), next]);
      return next;
    }

    function findTombstone(type, data) {
      const identity = tombstoneIdentity({
        type,
        language: data?.language || "",
        id: data?.id == null ? null : Number(data.id),
        code: data?.code || ""
      });
      return loadTombstones().find((item) => tombstoneIdentity(item) === identity) || null;
    }

    function timestampValue(value) {
      const parsed = Date.parse(String(value || ""));
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function tombstoneBlocks(item, data) {
      if (!item) return false;
      return timestampValue(item.deleted_at) >= timestampValue(data?.updated_at);
    }

    function isWordDeleted(language, id, updatedAt) {
      return tombstoneBlocks(findTombstone("word", { language, id }), { updated_at: updatedAt });
    }

    function isLanguageDeleted(code, updatedAt) {
      return tombstoneBlocks(findTombstone("language", { code }), { updated_at: updatedAt });
    }

    function vocabStorageKey() {
      return languageKey("vocab");
    }

    function importedLessonsKey() {
      return languageKey("imported_lessons");
    }

    function importedStoriesKey() {
      return languageKey("imported_stories");
    }

    function loadSettings() {
      const stored = readJSON(UI_SETTINGS_KEY, null);
      const active = activeLanguageCodes();
      state.settings = {
        font: stored && stored.font === "large" ? "large" : "normal",
        language: stored && active.includes(stored.language) ? stored.language : (active[0] || "en"),
        theme: stored && THEME_IDS.includes(stored.theme) ? stored.theme : "glass",
        uiLanguage: stored && UI_LANGUAGES[stored.uiLanguage] ? stored.uiLanguage : "ru",
        updated_at: String(stored?.updated_at || "")
      };
      try {
        state.geminiKey = window.localStorage.getItem(GEMINI_KEY_STORAGE) || "";
      } catch (error) {
        state.geminiKey = "";
      }
    }

    function persistSettings() {
      state.settings.updated_at = new Date().toISOString();
      writeJSON(UI_SETTINGS_KEY, state.settings);
    }

    function decodeEmbeddedLesson() {
      if (!EMBEDDED_LESSONS_B64 || EMBEDDED_LESSONS_B64.indexOf("__") === 0) return null;
      try {
        const binary = window.atob(EMBEDDED_LESSONS_B64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return JSON.parse(new TextDecoder("utf-8").decode(bytes));
      } catch (error) {
        console.warn("Embedded lesson fallback could not be decoded.", error);
        return null;
      }
    }

    async function loadLessonData() {
      if (window.location.protocol === "file:") {
        const fallback = decodeEmbeddedLesson();
        if (fallback) return { data: fallback, source: "embedded" };
      }
      try {
        const response = await fetch("./lessons.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`lessons.json responded with HTTP ${response.status}`);
        const data = await response.json();
        if (!data || (!data.languages && !Array.isArray(data.lessons))) {
          throw new Error("lessons.json has no languages{} or lessons[] data.");
        }
        return { data, source: "fetch" };
      } catch (error) {
        const fallback = decodeEmbeddedLesson();
        if (!fallback) throw error;
        console.warn("Using embedded lesson snapshot because fetch failed:", error);
        return { data: fallback, source: "embedded" };
      }
    }

    function normalizeLessonShape(lesson) {
      if (!lesson || typeof lesson !== "object") return null;
      const blocks = Array.isArray(lesson.blocks)
        ? lesson.blocks
        : Array.isArray(lesson.content_blocks)
          ? lesson.content_blocks
          : [];
      if (!blocks.length) return null;
      return { ...lesson, blocks };
    }

    function loadCustomLanguages() {
      const stored = readJSON(CUSTOM_LANGUAGES_KEY, []);
      return (Array.isArray(stored) ? stored : [])
        .filter((item) => item && typeof item.code === "string" && item.code.trim())
        .map((item) => ({
          code: String(item.code).trim(),
          label: String(item.label || item.name || item.code).trim(),
          native: String(item.native || item.label || item.name || item.code).trim(),
          flag: String(item.flag || "🌐").trim(),
          flagCode: String(item.flagCode || "").trim().toUpperCase(),
          flagCustom: Boolean(item.flagCustom),
          is_archived: Boolean(item.is_archived),
          updated_at: String(item.updated_at || "")
        }))
        .filter((item) => !isLanguageDeleted(item.code, item.updated_at));
    }

    function normalizeLanguagePacks(rootData) {
      const packs = {};
      const customLanguages = loadCustomLanguages();
      const rootLanguages = rootData?.languages && typeof rootData.languages === "object" ? rootData.languages : {};
      const codes = [...new Set(["en", "tr", "da", ...Object.keys(rootLanguages), ...customLanguages.map((item) => item.code)])];

      codes.forEach((code) => {
        const custom = customLanguages.find((item) => item.code === code);
        const source = rootLanguages[code] || {};
        const fallbackMeta = LANGUAGE_META[code] || {
          label: custom?.label || code.toUpperCase(),
          native: custom?.native || custom?.label || code.toUpperCase(),
          flag: custom?.flag || "🌐",
          flagCode: custom?.flagCode || ""
        };
        const label = source.label || custom?.label || fallbackMeta.label || code.toUpperCase();
        const native = source.native || custom?.native || fallbackMeta.native || label;
        const flag = source.flag || custom?.flag || fallbackMeta.flag || "🌐";
        const flagCode = String(source.flagCode || custom?.flagCode || fallbackMeta.flagCode || "").toUpperCase();
        LANGUAGE_META[code] = { label, native, flag, flagCode };
        packs[code] = {
          ...source,
          code,
          label,
          native,
          flag,
          flagCode,
          flagCustom: Boolean(custom?.flagCustom),
          is_archived: Boolean(custom?.is_archived),
          updated_at: String(custom?.updated_at || source.updated_at || ""),
          lessons: (Array.isArray(source.lessons) ? source.lessons : []).map(normalizeLessonShape).filter(Boolean),
          stories: (Array.isArray(source.stories) ? source.stories : []).filter((story) => story && story.text),
          vocab: Array.isArray(source.vocab) ? source.vocab : []
        };
      });
      LANGUAGE_CODES = codes;
      return packs;
    }

    function activateLanguageData(code) {
      const active = activeLanguageCodes();
      const language = active.includes(code) ? code : (active[0] || null);
      if (!language) {
        state.language = null;
        state.languagePack = null;
        state.data = null;
        state.lessons = [];
        state.stories = [];
        state.vocab = [];
        return;
      }
      state.language = language;
      state.settings.language = language;
      state.languagePack = state.languagePacks[language] || {
        code: language,
        label: LANGUAGE_META[language].label,
        native: LANGUAGE_META[language].native,
        lessons: [],
        stories: [],
        vocab: []
      };
      state.data = { ...state.languagePack, meta: state.rootData?.meta || {} };
      loadImportedCollections();
      state.lessons = mergeById(state.languagePack.lessons || [], state.importedLessons);
      state.stories = mergeById(state.languagePack.stories || [], state.importedStories);
      loadVocabulary(state.languagePack.vocab || []);
      state.vocabSearch = "";
      state.vocabTag = "all";
    }

    function mergeById(baseItems, extraItems) {
      const map = new Map();
      (Array.isArray(baseItems) ? baseItems : []).forEach((item) => {
        if (item && Number.isFinite(Number(item.id))) map.set(Number(item.id), item);
      });
      (Array.isArray(extraItems) ? extraItems : []).forEach((item) => {
        if (item && Number.isFinite(Number(item.id))) map.set(Number(item.id), item);
      });
      return [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
    }

    function loadImportedCollections() {
      const importedLessons = readJSON(importedLessonsKey(), []);
      const importedStories = readJSON(importedStoriesKey(), []);
      const deleted = typeof isContentDeleted === "function" ? isContentDeleted : () => false;
      state.importedLessons = Array.isArray(importedLessons)
        ? importedLessons.filter((lesson) => lesson && getLessonBlocks(lesson).length && !deleted("lesson", lesson.id, lesson.updated_at))
        : [];
      state.importedStories = Array.isArray(importedStories)
        ? importedStories.filter((story) => story && story.text && !deleted("story", story.id, story.updated_at))
        : [];
    }
