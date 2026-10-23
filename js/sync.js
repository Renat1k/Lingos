// LINGUA/OS · Supabase cloud sync and sync status
"use strict";

    let currentSyncState = "local";
    let supabaseClient = null;
    let supabaseClientPromise = null;
    let cloudUserId = null;
    let cloudTimer = null;
    let cloudPushInFlight = false;
    let cloudPushQueued = false;
    let cloudPullPromise = null;
    let cloudApplying = false;
    let cloudInitialized = false;
    let cloudDataColumn = "data";
    let cloudActivityDepth = 0;
    let cloudStatusTimer = null;
    let cloudPendingRefresh = null;
    let cloudDeferredArmed = false;
    let cloudLastPushFingerprint = "";
    try {
      cloudLastPushFingerprint = window.localStorage.getItem("lingua_cloud_last_push_fingerprint") || "";
    } catch (error) { /* storage can be unavailable */ }
    /* ---------- cloud sync / Supabase ---------- */
    function cloudConfigReady() {
      return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
    }

    function isCloudSchemaMissing(error) {
      const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
      const userColumn = text.includes("user_id") && (
        text.includes("column") ||
        text.includes("schema") ||
        text.includes("does not exist") ||
        text.includes("pgrst204") ||
        text.includes("42703")
      );
      const conflictTarget = text.includes("42p10") || text.includes("no unique or exclusion constraint");
      const policy = text.includes("row-level security") || text.includes("permission denied") || text.includes("42501");
      return userColumn || conflictTarget || policy;
    }

    function waitForSupabaseSdk() {
      if (window.supabase?.createClient) return Promise.resolve();
      if (document.readyState === "complete") return Promise.reject(new Error("Supabase SDK is unavailable."));
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (window.supabase?.createClient) resolve();
          else reject(new Error("Supabase SDK is unavailable."));
        };
        window.addEventListener("load", finish, { once: true });
        window.setTimeout(finish, 12000);
      });
    }

    async function ensureSupabaseClient() {
      if (supabaseClient) return supabaseClient;
      if (!cloudConfigReady()) throw new Error("Cloud config is missing.");
      if (supabaseClientPromise) return supabaseClientPromise;
      supabaseClientPromise = (async () => {
        await waitForSupabaseSdk();
        if (!window.supabase?.createClient) throw new Error("Supabase SDK is unavailable.");
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        });
        return supabaseClient;
      })();
      try {
        return await supabaseClientPromise;
      } finally {
        supabaseClientPromise = null;
      }
    }

    function setSyncStatus(nextState, detail) {
      const states = {
        local: { emoji: "⚪", label: t("sync_local") },
        saving: { emoji: "🟡", label: t("sync_saving") },
        synced: { emoji: "🟢", label: t("sync_synced") },
        blocked: { emoji: "🟠", label: t("cloud_not_ready") },
        error: { emoji: "🔴", label: t("sync_error") }
      };
      const stateConfig = states[nextState] || states.local;
      if (nextState !== "saving") {
        window.clearTimeout(cloudStatusTimer);
        cloudStatusTimer = null;
      }
      currentSyncState = nextState in states ? nextState : "local";
      if (syncStatus) {
        syncStatus.dataset.state = currentSyncState;
        const label = detail || stateConfig.label;
        syncStatus.setAttribute("aria-label", label);
        syncStatus.setAttribute("title", label);
        syncStatus.setAttribute("aria-busy", String(currentSyncState === "saving"));
      }
      const retryButton = document.getElementById("syncRetry");
      if (retryButton) retryButton.hidden = currentSyncState !== "error";
      if (syncEmoji) syncEmoji.textContent = stateConfig.emoji;
      if (syncLabel) syncLabel.textContent = stateConfig.label;
      if (profileSyncStatus) {
        profileSyncStatus.textContent = currentSyncState === "synced"
          ? t("cloud_synced")
          : currentSyncState === "saving"
            ? t("sync_saving")
            : currentSyncState === "blocked"
              ? t("cloud_not_ready")
              : currentSyncState === "error"
                ? t("sync_error")
                : t("local_only");
      }
      const profileNote = document.getElementById("profileSyncNote");
      if (profileNote) profileNote.textContent = t(currentSyncState === "error" ? "sync_error" : currentSyncState === "blocked" ? "cloud_not_ready_hint" : "profile_sync_hint");
    }

    function beginCloudActivity() {
      cloudActivityDepth += 1;
      window.clearTimeout(cloudStatusTimer);
      cloudStatusTimer = window.setTimeout(() => {
        cloudStatusTimer = null;
        if (cloudActivityDepth > 0) setSyncStatus("saving");
      }, 700);
    }

    function endCloudActivity(success) {
      cloudActivityDepth = Math.max(0, cloudActivityDepth - 1);
      if (cloudActivityDepth > 0) return;
      window.clearTimeout(cloudStatusTimer);
      cloudStatusTimer = null;
      if (success) setSyncStatus("synced");
    }

    function collectCloudPayload() {
      const values = {};
      try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (!key || !key.startsWith("lingua_") || SYNC_DEVICE_LOCAL_KEYS.has(key) || key.startsWith("lingua_speech_voice") || key === PROFILE_KEY || key === GEMINI_KEY_STORAGE || key === GEMINI_MODEL_STORAGE || key.startsWith(AI_CHATS_STORAGE_PREFIX) || key.startsWith(AI_PROVIDER_STORAGE_PREFIX) || key.startsWith("lingua_builder_draft_") || key.startsWith("lingua_cloud_")) continue;
          const raw = window.localStorage.getItem(key);
          if (raw == null) continue;
          try {
            let parsed = JSON.parse(raw);
            if (key === UI_SETTINGS_KEY && parsed && typeof parsed === "object") {
              parsed = { ...parsed };
              delete parsed.font;
            }
            values[key] = parsed;
          } catch (error) {
            values[key] = raw;
          }
        }
      } catch (error) {
        console.warn("Could not collect cloud payload.", error);
      }
      return { version: 1, updated_at: new Date().toISOString(), values };
    }

    function mergeTombstones(localItems, remoteItems) {
      const map = new Map();
      const add = (item) => {
        if (!item || typeof item !== "object" || !item.type) return;
        const next = {
          type: item.type,
          language: item.language ? String(item.language) : "",
          id: item.id == null ? null : Number(item.id),
          code: item.code ? String(item.code) : "",
          deleted_at: String(item.deleted_at || "")
        };
        if (!next.deleted_at) return;
        const identity = tombstoneIdentity(next);
        const current = map.get(identity);
        if (!current || timestampValue(next.deleted_at) > timestampValue(current.deleted_at)) map.set(identity, next);
      };
      (Array.isArray(localItems) ? localItems : []).forEach(add);
      (Array.isArray(remoteItems) ? remoteItems : []).forEach(add);
      return [...map.values()];
    }

    function collectionLanguage(key) {
      const match = /^lingua_(.+)_(vocab|imported_lessons|imported_stories)$/.exec(key);
      return match ? match[1] : "";
    }

    function collectionTombstone(key, item) {
      if (key === CUSTOM_LANGUAGES_KEY) {
        return findTombstone("language", { code: item.code });
      }
      if (key.endsWith("_vocab")) {
        return findTombstone("word", { language: collectionLanguage(key), id: item.id });
      }
      if (key.endsWith("_imported_lessons")) {
        return findTombstone("lesson", { language: collectionLanguage(key), id: item.id });
      }
      if (key.endsWith("_imported_stories")) {
        return findTombstone("story", { language: collectionLanguage(key), id: item.id });
      }
      return null;
    }

    function normalizeHiddenEntry(value, fallbackAt) {
      if (value === true) return { hidden: true, at: String(fallbackAt || "") };
      if (!value || typeof value !== "object") return null;
      return { hidden: Boolean(value.hidden), at: String(value.at || fallbackAt || "") };
    }

    function normalizeHiddenBucket(bucket, fallbackAt) {
      const normalized = {};
      if (!bucket || typeof bucket !== "object") return normalized;
      Object.entries(bucket).forEach(([id, value]) => {
        const entry = normalizeHiddenEntry(value, fallbackAt);
        if (entry) normalized[String(id)] = entry;
      });
      return normalized;
    }

    function mergeHiddenContent(localValue, remoteValue) {
      const local = localValue && typeof localValue === "object" ? localValue : {};
      const remote = remoteValue && typeof remoteValue === "object" ? remoteValue : {};
      const localAt = String(local.updated_at || "");
      const remoteAt = String(remote.updated_at || "");
      const mergeBucket = (name) => {
        const localBucket = normalizeHiddenBucket(local[name], localAt);
        const remoteBucket = normalizeHiddenBucket(remote[name], remoteAt);
        const result = {};
        new Set([...Object.keys(localBucket), ...Object.keys(remoteBucket)]).forEach((id) => {
          const left = localBucket[id];
          const right = remoteBucket[id];
          if (!left) result[id] = right;
          else if (!right) result[id] = left;
          else result[id] = timestampValue(right.at) > timestampValue(left.at) ? right : left;
        });
        return result;
      };
      return {
        lessons: mergeBucket("lessons"),
        stories: mergeBucket("stories"),
        updated_at: timestampValue(remoteAt) > timestampValue(localAt) ? remoteAt : localAt
      };
    }

    function mergeCloudCollection(key, localItems, remoteItems) {
      const map = new Map();
      const add = (item) => {
        if (!item || typeof item !== "object") return;
        const identity = key.endsWith("_vocab")
          ? (item.id ?? item.word ?? item.translation)
          : (item.id ?? item.title ?? item.slug ?? item.code);
        const mapKey = identity == null ? JSON.stringify(item) : String(identity);
        const tombstone = collectionTombstone(key, item);
        if (tombstone && tombstoneBlocks(tombstone, item)) return;
        const current = map.get(mapKey);
        if (!current || timestampValue(item.updated_at) > timestampValue(current.updated_at)) {
          map.set(mapKey, item);
        }
      };
      (Array.isArray(localItems) ? localItems : []).forEach(add);
      (Array.isArray(remoteItems) ? remoteItems : []).forEach(add);
      return [...map.values()];
    }

    function isProgressKey(key) {
      return /_(quiz_lesson_|writing_lesson_|story_read_|discovered_lesson_)/.test(key);
    }

    function progressTimestamp(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
      return Math.max(
        timestampValue(value.updated_at),
        timestampValue(value.updatedAt),
        timestampValue(value.savedAt),
        timestampValue(value.readAt)
      );
    }

    function mergeProgressValue(localValue, remoteValue) {
      if (Array.isArray(localValue) || Array.isArray(remoteValue)) {
        return [...new Set([...(Array.isArray(localValue) ? localValue : []), ...(Array.isArray(remoteValue) ? remoteValue : [])])];
      }
      if (localValue == null) return remoteValue;
      if (remoteValue == null) return localValue;
      if (typeof localValue === "object" && typeof remoteValue === "object") {
        return progressTimestamp(remoteValue) > progressTimestamp(localValue) ? remoteValue : localValue;
      }
      return remoteValue;
    }

    function mergeSettingsValue(localValue, remoteValue) {
      const local = localValue && typeof localValue === "object" ? localValue : {};
      const remote = remoteValue && typeof remoteValue === "object" ? remoteValue : {};
      const base = timestampValue(remote.updated_at) > timestampValue(local.updated_at) ? remote : local;
      return { ...base, font: local.font === "large" ? "large" : "normal" };
    }

    function applyCloudPayload(payload) {
      if (!payload || typeof payload !== "object" || !payload.values || typeof payload.values !== "object") {
        return { changed: false, keys: [] };
      }
      cloudApplying = true;
      const changedKeys = [];
      try {
        if (Array.isArray(payload.values[DELETED_KEY])) {
          const mergedDeleted = mergeTombstones(loadTombstones(), payload.values[DELETED_KEY]);
          try {
            const previous = window.localStorage.getItem(DELETED_KEY);
            const next = JSON.stringify(mergedDeleted);
            if (previous !== next) {
              window.localStorage.setItem(DELETED_KEY, next);
              changedKeys.push(DELETED_KEY);
            }
          } catch (error) {
            console.warn("Could not apply cloud tombstones.", error);
          }
        }
        Object.entries(payload.values).forEach(([key, value]) => {
          if (key === DELETED_KEY) return;
          if (!key.startsWith("lingua_") || SYNC_DEVICE_LOCAL_KEYS.has(key) || key.startsWith("lingua_speech_voice") || key.startsWith("lingua_cloud_") || key.startsWith("lingua_builder_draft_") || key === PROFILE_KEY || key === GEMINI_KEY_STORAGE || key === GEMINI_MODEL_STORAGE || key.startsWith(AI_CHATS_STORAGE_PREFIX) || key.startsWith(AI_PROVIDER_STORAGE_PREFIX)) return;
          let nextValue = value;
          if (key === UI_SETTINGS_KEY) {
            nextValue = mergeSettingsValue(readJSON(key, null), value);
          } else if (key === HIDDEN_CONTENT_KEY) {
            nextValue = mergeHiddenContent(readJSON(key, null), value);
          } else if (isProgressKey(key)) {
            nextValue = mergeProgressValue(readJSON(key, null), value);
          } else if (/_(vocab|imported_lessons|imported_stories)$/.test(key) || key === CUSTOM_LANGUAGES_KEY) {
            nextValue = mergeCloudCollection(key, readJSON(key, []), value);
          }
          try {
            const next = JSON.stringify(nextValue);
            if (next == null) return;
            const previous = window.localStorage.getItem(key);
            if (previous === next) return;
            window.localStorage.setItem(key, next);
            changedKeys.push(key);
          } catch (error) {
            console.warn(`Could not apply cloud key ${key}.`, error);
          }
        });
      } finally {
        cloudApplying = false;
      }
      return { changed: changedKeys.length > 0, keys: changedKeys };
    }

    function cloudUIBlocked() {
      const active = document.activeElement;
      const editingField = active && (
        active.tagName === "INPUT"
        || active.tagName === "TEXTAREA"
        || active.tagName === "SELECT"
        || active.isContentEditable
      );
      return Boolean(editingField || document.querySelector("dialog[open]"));
    }

    function armCloudDeferredRefresh() {
      if (cloudDeferredArmed) return;
      cloudDeferredArmed = true;
      let fired = false;
      const attempt = () => {
        if (fired) return;
        fired = true;
        document.removeEventListener("focusout", attempt, true);
        document.removeEventListener("click", attempt, true);
        document.removeEventListener("close", attempt, true);
        window.setTimeout(() => {
          cloudDeferredArmed = false;
          if (!cloudPendingRefresh) return;
          if (cloudUIBlocked()) armCloudDeferredRefresh();
          else flushCloudRefresh();
        }, 60);
      };
      document.addEventListener("focusout", attempt, true);
      document.addEventListener("click", attempt, true);
      document.addEventListener("close", attempt, true);
    }

    function flushCloudRefresh() {
      if (!cloudPendingRefresh) return;
      if (cloudUIBlocked()) {
        armCloudDeferredRefresh();
        return;
      }
      const pending = cloudPendingRefresh;
      cloudPendingRefresh = null;
      const previousScroll = window.scrollY;
      if (pending.languageLists) {
        renderLanguageLists();
        if (typeof syncLanguageUI === "function") syncLanguageUI();
      }
      if (pending.render === "dashboard" && state.view === "dashboard") renderDashboard();
      else if (pending.render === "stories" && state.view === "stories") renderStoriesHub();
      else if (pending.render === "vocabulary" && state.view === "vocabulary") renderVocabularyHub();
      else if (pending.render === "home" && state.view === "home") renderHome();
      else if (pending.render === "practice" && state.view === "practice") renderPracticeHub();
      else if (pending.render === "progress" && state.view === "progress") renderProgressHub();
      if (pending.render && state.view !== "lesson" && state.view !== "story") {
        window.requestAnimationFrame(() => window.scrollTo(0, previousScroll));
      }
    }

    function queueCloudRefresh(keys, options = {}) {
      const pending = cloudPendingRefresh || { keys: new Set(), render: null, languageLists: false };
      (keys || []).forEach((key) => pending.keys.add(key));
      if (options.render) pending.render = options.render;
      if (options.languageLists) pending.languageLists = true;
      cloudPendingRefresh = pending;
      if (cloudUIBlocked()) armCloudDeferredRefresh();
      else flushCloudRefresh();
    }

    function cloudLanguageDisplay(code) {
      if (!code) return "—";
      return state.languagePacks?.[code]?.label || LANGUAGE_META?.[code]?.label || String(code).toUpperCase();
    }

    function switchCloudLanguageIfMissing() {
      const active = activeLanguageCodes();
      if (state.language && active.includes(state.language)) return null;
      const previous = state.language;
      const next = active[0] || null;
      if (!next) {
        state.language = null;
        state.languagePack = null;
        state.data = null;
        state.lessons = [];
        state.stories = [];
        state.vocab = [];
        state.settings.language = null;
        applySettings();
        renderNoActiveCourses();
        return "none";
      }
      activateLanguageData(next);
      state.settings.language = next;
      applySettings();
      let render = "dashboard";
      if (state.view === "stories") render = "stories";
      else if (state.view === "vocabulary") render = "vocabulary";
      else if (state.view !== "dashboard") {
        state.view = "dashboard";
        state.lesson = null;
        state.lessonId = null;
        state.story = null;
        state.storyId = null;
        state.backTarget = "#dashboard";
      }
      const targetHash = render === "stories" ? "#stories" : render === "vocabulary" ? "#vocabulary" : "#dashboard";
      if (window.location.hash !== targetHash) window.history.replaceState(null, "", targetHash);
      if (previous && previous !== next) {
        showToast(t("sync_language_switched", {
          language: cloudLanguageDisplay(previous),
          next: cloudLanguageDisplay(next)
        }), "info");
      }
      return render;
    }

    function refreshAfterCloudApply(change) {
      const keys = Array.isArray(change?.keys) ? change.keys : [];
      if (!keys.length) return;
      const keySet = new Set(keys);
      const previousUILanguage = state.settings.uiLanguage;
      const previousLanguage = state.language;
      const languageTombstone = keySet.has(DELETED_KEY)
        && loadTombstones().some((item) => item.type === "language");
      let languageLists = keySet.has(CUSTOM_LANGUAGES_KEY) || languageTombstone;

      if (keySet.has(CUSTOM_LANGUAGES_KEY) || languageTombstone) {
        state.languagePacks = normalizeLanguagePacks(state.rootData);
        if (state.language && state.languagePacks[state.language]) {
          state.languagePack = state.languagePacks[state.language];
          state.data = { ...state.languagePack, meta: state.rootData?.meta || {} };
        }
      }

      if (keySet.has(UI_SETTINGS_KEY)) {
        loadSettings();
        if (previousLanguage && activeLanguageCodes().includes(previousLanguage)) {
          state.settings.language = previousLanguage;
        }
        applySettings();
      }
      if (state.settings.uiLanguage !== previousUILanguage) languageLists = true;
      const uiLanguageChanged = state.settings.uiLanguage !== previousUILanguage;

      const switchedRender = switchCloudLanguageIfMissing();
      if (switchedRender === "none") return;
      if (switchedRender) {
        queueCloudRefresh(keys, { render: switchedRender, languageLists: true });
        return;
      }

      const current = state.language;
      const vocabKey = current ? `lingua_${current}_vocab` : "";
      const importedLessonKey = current ? importedLessonsKey() : "";
      const importedStoryKey = current ? importedStoriesKey() : "";
      const deletedChanged = keySet.has(DELETED_KEY);
      const vocabChanged = Boolean(vocabKey && keySet.has(vocabKey)) || deletedChanged;
      const lessonsChanged = Boolean(importedLessonKey && keySet.has(importedLessonKey)) || deletedChanged;
      const storiesChanged = Boolean(importedStoryKey && keySet.has(importedStoryKey)) || deletedChanged;
      const hiddenChanged = keySet.has(HIDDEN_CONTENT_KEY);

      if (vocabChanged) {
        const search = state.vocabSearch;
        const tag = state.vocabTag;
        loadVocabulary(state.languagePack?.vocab || []);
        state.vocabSearch = search;
        state.vocabTag = tag;
      }
      if (lessonsChanged || storiesChanged) {
        loadImportedCollections();
        state.lessons = mergeById(state.languagePack?.lessons || [], state.importedLessons);
        state.stories = mergeById(state.languagePack?.stories || [], state.importedStories);
      }

      let render = null;
      if (state.view === "vocabulary" && vocabChanged) render = "vocabulary";
      else if (state.view === "stories" && (storiesChanged || hiddenChanged)) render = "stories";
      else if (state.view === "dashboard" && (lessonsChanged || hiddenChanged)) render = "dashboard";
      if (uiLanguageChanged && !render) {
        if (state.view === "dashboard") render = "dashboard";
        else if (state.view === "stories") render = "stories";
        else if (state.view === "vocabulary") render = "vocabulary";
      }

      if (languageLists || render) queueCloudRefresh(keys, { render, languageLists });
    }

    function extractCloudPayload(row) {
      if (!row || typeof row !== "object") return null;
      const keys = ["payload", "data", "state", "content", "sync_data", "user_data"];
      for (const key of keys) {
        let value = row[key];
        if (value == null) continue;
        if (typeof value === "string") {
          try { value = JSON.parse(value); } catch (error) { continue; }
        }
        if (value && typeof value === "object" && value.values && typeof value.values === "object") {
          cloudDataColumn = key;
          return value;
        }
      }
      for (const [key, value] of Object.entries(row)) {
        if (!value || typeof value !== "object" || !value.values) continue;
        cloudDataColumn = key;
        return value;
      }
      return null;
    }

    function stableSerialize(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }

    function payloadSignature(values) {
      return stableSerialize(values || {});
    }

    function payloadFingerprint(values) {
      const text = payloadSignature(values);
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    async function pushCloudData(options = {}) {
      const skipPull = Boolean(options.skipPull);
      if (!cloudConfigReady() || !cloudUserId || !navigator.onLine) {
        setSyncStatus("local");
        return false;
      }
      if (cloudPushInFlight) {
        cloudPushQueued = true;
        return false;
      }
      cloudPushInFlight = true;
      cloudPushQueued = false;
      try {
        if (!skipPull) {
          const pulled = await pullCloudData(false);
          if (!pulled) return false;
        }
        beginCloudActivity();
        try {
          const client = supabaseClient || await ensureSupabaseClient();
          const payload = collectCloudPayload();
          const columns = cloudDataColumn
            ? [cloudDataColumn, ...CLOUD_DATA_COLUMNS.filter((column) => column !== cloudDataColumn)]
            : [...CLOUD_DATA_COLUMNS];
          let lastError = null;
          let saved = false;
          for (const column of columns) {
            const row = { user_id: cloudUserId, [column]: payload };
            if (state.authUser?.email) row.user_email = state.authUser.email;
            const { error } = await client
              .from(CLOUD_TABLE)
              .upsert(row, { onConflict: "user_id" });
            if (!error) {
              cloudDataColumn = column;
              saved = true;
              break;
            }
            lastError = error;
          }
          if (!saved) throw lastError || new Error("Supabase upsert failed.");
          try {
            window.localStorage.setItem(CLOUD_META_KEY, new Date().toISOString());
          } catch (error) { /* storage can be unavailable */ }
          cloudLastPushFingerprint = payloadFingerprint(payload.values);
          try {
            window.localStorage.setItem("lingua_cloud_last_push_fingerprint", cloudLastPushFingerprint);
          } catch (error) { /* storage can be unavailable */ }
          endCloudActivity(true);
          return true;
        } catch (error) {
          endCloudActivity(false);
          console.warn("Cloud sync save failed.", error);
          if (isCloudSchemaMissing(error)) setSyncStatus("blocked", t("cloud_not_ready"));
          else setSyncStatus("error", t("sync_error"));
          return false;
        }
      } finally {
        cloudPushInFlight = false;
        if (cloudPushQueued) {
          cloudPushQueued = false;
          scheduleCloudSync();
        }
      }
    }

    function scheduleCloudSync() {
      if (cloudApplying) return;
      if (!cloudConfigReady() || !cloudUserId) {
        setSyncStatus("local");
        return;
      }
      if (!navigator.onLine) {
        setSyncStatus("local");
        return;
      }
      window.clearTimeout(cloudTimer);
      cloudTimer = window.setTimeout(() => {
        cloudTimer = null;
        void pushCloudData();
      }, 850);
    }

    async function pullCloudData(pushAfter = true) {
      if (!cloudConfigReady() || !cloudUserId) {
        setSyncStatus("local");
        return false;
      }
      if (cloudPullPromise) return cloudPullPromise;
      cloudPullPromise = (async () => {
        beginCloudActivity();
        try {
          const client = supabaseClient || await ensureSupabaseClient();
          const { data, error } = await client
            .from(CLOUD_TABLE)
            .select("*")
            .eq("user_id", cloudUserId)
            .maybeSingle();
          if (error) throw error;
          const payload = extractCloudPayload(data);
          const change = payload ? applyCloudPayload(payload) : { changed: false, keys: [] };
          const remoteFingerprint = payload ? payloadFingerprint(payload.values) : "";
          const isOwnPush = Boolean(remoteFingerprint && cloudLastPushFingerprint && remoteFingerprint === cloudLastPushFingerprint);
          if (change.changed && !isOwnPush) {
            showToast(t("sync_updated_remote"), "info");
            refreshAfterCloudApply(change);
          }
          let pushOK = true;
          if (pushAfter) pushOK = await pushCloudData({ skipPull: true });
          endCloudActivity(pushOK);
          return true;
        } catch (error) {
          endCloudActivity(false);
          console.warn("Cloud sync load failed.", error);
          if (isCloudSchemaMissing(error)) setSyncStatus("blocked", t("cloud_not_ready"));
          else setSyncStatus("error", t("sync_error"));
          return false;
        }
      })();
      try {
        return await cloudPullPromise;
      } finally {
        cloudPullPromise = null;
      }
    }

    async function startCloudSyncForProfile() {
      cloudUserId = state.authUser?.id ? String(state.authUser.id) : null;
      if (!cloudUserId || !cloudConfigReady()) {
        setSyncStatus("local");
        return;
      }
      try {
        await ensureSupabaseClient();
        await pullCloudData();
      } catch (error) {
        console.warn("Cloud sync start failed.", error);
        setSyncStatus("local");
      }
    }

    async function retryCloudSync() {
      const button = document.getElementById("syncRetry");
      if (button) button.disabled = true;
      try {
        if (!cloudUserId) await initCloudSync();
        if (!cloudUserId) return;
        const pulled = await pullCloudData();
        if (!pulled) return;
        await pushCloudData({ skipPull: true });
      } catch (error) {
        console.warn("Cloud sync retry failed.", error);
        setSyncStatus("error", t("sync_retry_failed"));
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function initCloudSync() {
      if (cloudInitialized) return;
      cloudInitialized = true;
      if (!cloudConfigReady()) {
        setSyncStatus("local");
        return;
      }
      try {
        const client = await ensureSupabaseClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        const session = data?.session || null;
        if (session?.user) {
          if (typeof hydrateAuthSession === "function") hydrateAuthSession(session);
          cloudUserId = String(session.user.id);
          await pullCloudData();
        } else {
          cloudUserId = null;
          setSyncStatus("local");
        }
      } catch (error) {
        console.warn("Supabase initialization failed.", error);
        setSyncStatus("local");
      }
    }

    function initCloudSyncWhenReady() {
      if (!cloudConfigReady()) {
        setSyncStatus("local");
        return;
      }
      if (window.supabase?.createClient) {
        void initCloudSync();
        return;
      }
      if (document.readyState === "complete") {
        void initCloudSync();
        return;
      }
      window.addEventListener("load", () => void initCloudSync(), { once: true });
    }
