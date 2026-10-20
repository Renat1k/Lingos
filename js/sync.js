// LINGUA/OS · Supabase cloud sync and sync status
"use strict";

    let currentSyncState = "local";
    let supabaseClient = null;
    let cloudEmail = null;
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

    function setSyncStatus(nextState, detail) {
      const states = {
        local: { emoji: "⚪", label: t("sync_local") },
        saving: { emoji: "🟡", label: t("sync_saving") },
        synced: { emoji: "🟢", label: t("sync_synced") }
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
            : t("local_only");
      }
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
          if (/_(vocab|imported_lessons|imported_stories)$/.test(key) || key === CUSTOM_LANGUAGES_KEY) {
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

    function normalizeCloudEmail(value) {
      return String(value || "").trim().toLowerCase();
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

    async function pushCloudData() {
      if (!cloudConfigReady() || !supabaseClient || !cloudEmail || !navigator.onLine) {
        setSyncStatus("local");
        return;
      }
      if (cloudPushInFlight) {
        cloudPushQueued = true;
        return;
      }
      cloudPushInFlight = true;
      cloudPushQueued = false;
      setSyncStatus("saving");
      try {
        const payload = collectCloudPayload();
        const columns = cloudDataColumn
          ? [cloudDataColumn, ...CLOUD_DATA_COLUMNS.filter((column) => column !== cloudDataColumn)]
          : [...CLOUD_DATA_COLUMNS];
        let lastError = null;
        let saved = false;
        for (const column of columns) {
          const { error } = await supabaseClient
            .from(CLOUD_TABLE)
            .upsert({ user_email: cloudEmail, [column]: payload }, { onConflict: "user_email" });
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
      } catch (error) {
        console.warn("Cloud sync save failed.", error);
        setSyncStatus("local");
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
      if (!cloudConfigReady() || !supabaseClient || !cloudEmail) {
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
        pushCloudData();
      }, 850);
    }

    async function pullCloudData() {
      if (!cloudConfigReady() || !supabaseClient || !cloudEmail) {
        setSyncStatus("local");
        return;
      }
      setSyncStatus("saving");
      try {
        const { data, error } = await supabaseClient
          .from(CLOUD_TABLE)
          .select("*")
          .eq("user_email", cloudEmail)
          .maybeSingle();
        if (error) throw error;
        const payload = extractCloudPayload(data);
        const applied = payload ? applyCloudPayload(payload) : false;
        if (applied) refreshAfterCloudApply();
        await pushCloudData();
      } catch (error) {
        console.warn("Cloud sync load failed.", error);
        setSyncStatus("local");
      }
    }

    function startCloudSyncForProfile() {
      const email = normalizeCloudEmail(state.profile?.email);
      cloudEmail = email || null;
      if (!cloudEmail || !cloudConfigReady()) {
        setSyncStatus("local");
        return;
      }
      if (!supabaseClient) {
        initCloudSyncWhenReady();
        return;
      }
      setSyncStatus("saving");
      void pullCloudData();
    }

    async function initCloudSync() {
      if (cloudInitialized) return;
      cloudInitialized = true;
      if (!cloudConfigReady()) {
        setSyncStatus("local");
        return;
      }
      if (!window.supabase?.createClient) {
        console.warn("Supabase SDK is unavailable; using local mode.");
        setSyncStatus("local");
        return;
      }
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        });
        const email = normalizeCloudEmail(state.profile?.email);
        if (email) {
          cloudEmail = email;
          setSyncStatus("saving");
          await pullCloudData();
        } else {
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
