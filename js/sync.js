// LINGUA/OS · Supabase cloud sync and sync status
"use strict";

    let currentSyncState = "local";
    let supabaseClient = null;
    let supabaseClientPromise = null;
    let cloudUserId = null;
    let cloudTimer = null;
    let cloudPushInFlight = false;
    let cloudPushQueued = false;
    let cloudApplying = false;
    let cloudInitialized = false;
    let cloudDataColumn = "data";
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
        blocked: { emoji: "🟠", label: t("cloud_not_ready") }
      };
      const stateConfig = states[nextState] || states.local;
      currentSyncState = nextState in states ? nextState : "local";
      if (syncStatus) {
        syncStatus.dataset.state = currentSyncState;
        const label = detail || stateConfig.label;
        syncStatus.setAttribute("aria-label", label);
        syncStatus.setAttribute("title", label);
      }
      if (syncEmoji) syncEmoji.textContent = stateConfig.emoji;
      if (syncLabel) syncLabel.textContent = stateConfig.label;
      if (profileSyncStatus) {
        profileSyncStatus.textContent = currentSyncState === "synced"
          ? t("cloud_synced")
          : currentSyncState === "saving"
            ? t("sync_saving")
            : currentSyncState === "blocked"
              ? t("cloud_not_ready")
              : t("local_only");
      }
      const profileNote = document.getElementById("profileSyncNote");
      if (profileNote) profileNote.textContent = t(currentSyncState === "blocked" ? "cloud_not_ready_hint" : "profile_sync_hint");
    }

    function collectCloudPayload() {
      const values = {};
      try {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (!key || !key.startsWith("lingua_") || key === PROFILE_KEY || key === GEMINI_KEY_STORAGE || key.startsWith("lingua_cloud_")) continue;
          const raw = window.localStorage.getItem(key);
          if (raw == null) continue;
          try {
            values[key] = JSON.parse(raw);
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
      const match = /^lingua_(.+)_vocab$/.exec(key);
      return match ? match[1] : "";
    }

    function collectionTombstone(key, item) {
      if (key === CUSTOM_LANGUAGES_KEY) {
        return findTombstone("language", { code: item.code });
      }
      if (key.endsWith("_vocab")) {
        return findTombstone("word", { language: collectionLanguage(key), id: item.id });
      }
      return null;
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
      if (!localValue || typeof localValue !== "object") return remoteValue;
      if (!remoteValue || typeof remoteValue !== "object") return localValue;
      return timestampValue(remoteValue.updated_at) > timestampValue(localValue.updated_at) ? remoteValue : localValue;
    }

    function applyCloudPayload(payload) {
      if (!payload || typeof payload !== "object" || !payload.values || typeof payload.values !== "object") return false;
      cloudApplying = true;
      let changed = false;
      try {
        if (Array.isArray(payload.values[DELETED_KEY])) {
          const mergedDeleted = mergeTombstones(loadTombstones(), payload.values[DELETED_KEY]);
          try {
            window.localStorage.setItem(DELETED_KEY, JSON.stringify(mergedDeleted));
            changed = true;
          } catch (error) {
            console.warn("Could not apply cloud tombstones.", error);
          }
        }
        Object.entries(payload.values).forEach(([key, value]) => {
          if (key === DELETED_KEY) return;
          if (!key.startsWith("lingua_") || key.startsWith("lingua_cloud_") || key === PROFILE_KEY || key === GEMINI_KEY_STORAGE) return;
          let nextValue = value;
          if (key === UI_SETTINGS_KEY) {
            nextValue = mergeSettingsValue(readJSON(key, null), value);
          } else if (isProgressKey(key)) {
            nextValue = mergeProgressValue(readJSON(key, null), value);
          } else if (/_(vocab|imported_lessons|imported_stories)$/.test(key) || key === CUSTOM_LANGUAGES_KEY) {
            nextValue = mergeCloudCollection(key, readJSON(key, []), value);
          }
          try {
            window.localStorage.setItem(key, JSON.stringify(nextValue));
            changed = true;
          } catch (error) {
            console.warn(`Could not apply cloud key ${key}.`, error);
          }
        });
      } finally {
        cloudApplying = false;
      }
      return changed;
    }

    function refreshAfterCloudApply() {
      state.languagePacks = normalizeLanguagePacks(state.rootData);
      renderLanguageLists();
      loadSettings();
      const active = activeLanguageCodes();
      if (!active.length) {
        state.language = null;
        state.languagePack = null;
        state.lessons = [];
        state.stories = [];
        state.vocab = [];
        state.settings.language = null;
        closeProfileModal();
        applySettings();
        renderNoActiveCourses();
        return;
      }
      const language = active.includes(state.settings.language) ? state.settings.language : active[0];
      activateLanguageData(language);
      applySettings();
      closeProfileModal();
      if (window.location.hash === "#dashboard" || !window.location.hash) renderDashboard();
      else window.location.hash = "#dashboard";
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
      if (!skipPull) {
        const pulled = await pullCloudData(false);
        if (!pulled) return false;
      }
      cloudPushInFlight = true;
      cloudPushQueued = false;
      setSyncStatus("saving");
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
        setSyncStatus("synced");
        return true;
      } catch (error) {
        console.warn("Cloud sync save failed.", error);
        if (isCloudSchemaMissing(error)) setSyncStatus("blocked", t("cloud_not_ready"));
        else setSyncStatus("local");
        return false;
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
      setSyncStatus("saving");
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
      setSyncStatus("saving");
      try {
        const client = supabaseClient || await ensureSupabaseClient();
        const { data, error } = await client
          .from(CLOUD_TABLE)
          .select("*")
          .eq("user_id", cloudUserId)
          .maybeSingle();
        if (error) throw error;
        const payload = extractCloudPayload(data);
        const applied = payload ? applyCloudPayload(payload) : false;
        if (applied) refreshAfterCloudApply();
        if (pushAfter) await pushCloudData({ skipPull: true });
        return true;
      } catch (error) {
        console.warn("Cloud sync load failed.", error);
        if (isCloudSchemaMissing(error)) setSyncStatus("blocked", t("cloud_not_ready"));
        else setSyncStatus("local");
        return false;
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
        setSyncStatus("saving");
        await pullCloudData();
      } catch (error) {
        console.warn("Cloud sync start failed.", error);
        setSyncStatus("local");
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
          setSyncStatus("saving");
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
