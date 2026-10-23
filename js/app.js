// LINGUA/OS · navigation, language/course UI, routing, events, boot
"use strict";

    let onboardingStep = 1;
    let onboardingLanguage = "en";
    let onboardingLevel = "";

    function syncLanguageUI() {
      const active = activeLanguageCodes();
      const language = active.includes(state.language) ? state.language : (active[0] || null);
      document.querySelectorAll("[data-learning-language]").forEach((button) => {
        const isActive = button.dataset.learningLanguage === language;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
      document.querySelectorAll("[data-app-language]").forEach((button) => {
        const isActive = button.dataset.appLanguage === language;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
      if (topbarLanguageCode) {
        if (language) topbarLanguageCode.innerHTML = renderFlag(language);
        else topbarLanguageCode.textContent = "—";
      }
      if (topbarLanguageLabel) {
        topbarLanguageLabel.textContent = language ? languageLabel(language) : t("no_active_courses");
      }
      if (topbarLevel) topbarLevel.setAttribute("aria-label", language ? `${t("language")}: ${languageLabel(language)}` : t("no_active_courses"));
      if (topbarLevel) topbarLevel.setAttribute("aria-expanded", languageModal?.open ? "true" : "false");
      if (profileLanguage) profileLanguage.textContent = language ? languageLabel(language) : t("no_active_courses");
    }

    const SIDEBAR_COLLAPSED_KEY = "lingos_sidebar_collapsed";

    function readSidebarCollapsed() {
      try {
        return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
      } catch (error) {
        return false;
      }
    }

    function setSidebarCollapsed(collapsed, options = {}) {
      const isCollapsed = Boolean(collapsed);
      const persist = options.persist !== false;
      document.body.classList.toggle("sidebar-collapsed", isCollapsed);
      if (persist) {
        try {
          window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
        } catch (error) { /* localStorage may be unavailable */ }
      }
      const toggle = document.getElementById("sidebarToggle");
      if (toggle) {
        toggle.setAttribute("aria-expanded", String(!isCollapsed));
        toggle.setAttribute("aria-label", t(isCollapsed ? "sidebar_expand" : "sidebar_collapse"));
      }
    }

    function setActiveAppSection(section) {
      document.body.classList.toggle("focus-mode", state.view === "lesson");
      document.querySelectorAll("[data-app-section]").forEach((button) => {
        const active = button.dataset.appSection === section;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
    }

    setSidebarCollapsed(readSidebarCollapsed(), { persist: false });

    document.getElementById("sidebarToggle")?.addEventListener("click", () => {
      setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });

    function goAppSection(section) {
      const targets = {
        home: "#home",
        lessons: "#dashboard",
        practice: "#practice",
        vocabulary: "#vocabulary",
        progress: "#progress"
      };
      const target = targets[section] || "#home";
      if (window.location.hash === target) {
        if (section === "home") renderHome();
        else if (section === "lessons") renderDashboard();
        else if (section === "practice") renderPracticeHub();
        else if (section === "vocabulary") renderVocabularyHub();
        else renderProgressHub();
      } else {
        window.location.hash = target;
      }
    }

    function renderGlobalSearch(query) {
      const input = document.getElementById("globalSearch");
      const results = document.getElementById("globalSearchResults");
      if (!input || !results) return;
      const term = String(query || "").trim().toLocaleLowerCase();
      if (!term) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      const lessons = (typeof getVisibleLessons === "function" ? getVisibleLessons() : [])
        .filter((lesson) => `${lesson.title} ${lesson.subtitle || ""}`.toLocaleLowerCase().includes(term))
        .slice(0, 5);
      const stories = (typeof getVisibleStories === "function" ? getVisibleStories() : [])
        .filter((story) => `${story.title} ${story.subtitle || ""}`.toLocaleLowerCase().includes(term))
        .slice(0, 4);
      const words = state.vocab
        .filter((word) => `${word.word} ${word.translation}`.toLocaleLowerCase().includes(term))
        .slice(0, 5);
      const items = [
        ...lessons.map((lesson) => `<button type="button" class="search-result" data-search-kind="lesson" data-search-id="${Number(lesson.id)}"><span aria-hidden="true">📚</span><span><strong>${escapeHtml(lesson.title || "")}</strong><small>${escapeHtml(t("search_lessons"))}</small></span></button>`),
        ...stories.map((story) => `<button type="button" class="search-result" data-search-kind="story" data-search-id="${Number(story.id)}"><span aria-hidden="true">📖</span><span><strong>${escapeHtml(story.title || "")}</strong><small>${escapeHtml(t("nav_stories"))}</small></span></button>`),
        ...words.map((word) => `<button type="button" class="search-result" data-search-kind="word" data-search-id="${escapeHtml(word.word)}"><span aria-hidden="true">🔤</span><span><strong>${escapeHtml(word.word || "")}</strong><small>${escapeHtml(word.translation || "")}</small></span></button>`)
      ];
      results.innerHTML = items.length ? items.join("") : `<div class="search-empty">${escapeHtml(t("search_no_results"))}</div>`;
      results.hidden = false;
    }

    function updateSectionUI(section) {
      const activeSection = section === "stories"
        ? "stories"
        : section === "vocabulary"
          ? "vocabulary"
          : "course";
      document.querySelectorAll("[data-section-link]").forEach((button) => {
        const active = button.dataset.sectionLink === activeSection;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (storiesSwitchCount) storiesSwitchCount.textContent = String(typeof getVisibleStories === "function" ? getVisibleStories().length : state.stories.length);
      if (vocabSwitchCount) vocabSwitchCount.textContent = String(state.vocab.length);
    }

    function refreshSectionCounts() {
      const counts = {
        course: typeof getVisibleLessons === "function" ? getVisibleLessons().length : state.lessons.length,
        stories: typeof getVisibleStories === "function" ? getVisibleStories().length : state.stories.length,
        vocabulary: state.vocab.length
      };
      Object.entries(counts).forEach(([key, count]) => {
        const counter = document.querySelector(`[data-section-link="${key}"] .section-tab-count`);
        if (counter) counter.textContent = String(count);
      });
      if (storiesSwitchCount) storiesSwitchCount.textContent = String(counts.stories);
      if (vocabSwitchCount) vocabSwitchCount.textContent = String(counts.vocabulary);
    }

    function renderSectionTabs(active) {
      const tabs = [
        { key: "course", icon: "book", label: t("nav_course"), count: typeof getVisibleLessons === "function" ? getVisibleLessons().length : state.lessons.length },
        { key: "stories", icon: "spark", label: t("nav_stories"), count: typeof getVisibleStories === "function" ? getVisibleStories().length : state.stories.length },
        { key: "vocabulary", icon: "vault", label: t("nav_vocabulary"), count: state.vocab.length }
      ];
      return `
        <div class="section-tabs" role="group" aria-label="${escapeHtml(t("learning_language"))}">
          ${tabs.map((tab) => `
            <button class="section-tab${tab.key === active ? " is-active" : ""}" type="button" data-section-link="${tab.key}" aria-pressed="${tab.key === active ? "true" : "false"}">
              ${icon(tab.icon)} ${tab.label} <span class="section-tab-count">${tab.count}</span>
            </button>
          `).join("")}
        </div>
      `;
    }

    function courseContentHidden(type, id, code, builtin = false) {
      const content = readJSON(HIDDEN_CONTENT_KEY, null);
      const bucket = content && typeof content === "object"
        ? (type === "story" ? content.stories : content.lessons) || {}
        : {};
      const scopedKey = `${code}:${String(id)}`;
      const scoped = bucket[scopedKey];
      if (scoped !== undefined) return Boolean(scoped && typeof scoped === "object" ? scoped.hidden : scoped);
      if (!builtin) return false;
      const legacy = bucket[String(id)];
      return legacy === true || Boolean(legacy && typeof legacy === "object" && legacy.hidden);
    }

    function courseContentDeleted(type, id, code, updatedAt) {
      const tombstone = findTombstone(type, { language: code, id: String(id) });
      return tombstoneBlocks(tombstone, { updated_at: updatedAt });
    }

    function courseVisibleItems(type, code, baseItems, importedItems) {
      const map = new Map();
      const collect = (items, builtin) => (Array.isArray(items) ? items : []).forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const id = item.id == null ? `__${index}` : String(item.id);
        map.set(id, { item, builtin });
      });
      collect(baseItems, true);
      collect(importedItems, false);
      return [...map.entries()].filter(([id, entry]) => {
        const item = entry.item;
        if (item.is_hidden) return false;
        if (courseContentHidden(type, id, code, entry.builtin)) return false;
        if (courseContentDeleted(type, id, code, item.updated_at)) return false;
        return true;
      });
    }

    function getCourseDisplayStats(code) {
      const pack = state.languagePacks?.[code] || {};
      const importedLessons = readJSON(`lingua_${code}_imported_lessons`, []);
      const importedStories = readJSON(`lingua_${code}_imported_stories`, []);
      const lessons = courseVisibleItems("lesson", code, pack.lessons, importedLessons).length;
      const stories = courseVisibleItems("story", code, pack.stories, importedStories).length;
      return { code, lessons, stories };
    }

    function languageCounts(code) {
      const stats = getCourseDisplayStats(code);
      return `${stats.lessons} ${t("nav_course").toLowerCase()} · ${stats.stories} ${t("nav_stories").toLowerCase()}`;
    }

    function isBuiltinLanguage(code) {
      return BUILTIN_LANGUAGE_CODES.includes(code);
    }

    function renderLanguageFilterTabs() {
      const codes = allLanguageCodes();
      const active = activeLanguageCodes().length;
      const archived = codes.length - active;
      const tabs = [
        { key: "active", label: t("filter_active"), count: active },
        { key: "archived", label: t("filter_archived"), count: archived },
        { key: "all", label: t("filter_all"), count: codes.length }
      ];
      return `
        <div class="language-filter-row" role="tablist" aria-label="${escapeHtml(t("language"))}">
          ${tabs.map((tab) => `
            <button class="language-filter${state.languageFilter === tab.key ? " is-active" : ""}" type="button" role="tab" data-language-filter="${tab.key}" aria-selected="${state.languageFilter === tab.key ? "true" : "false"}">
              ${escapeHtml(tab.label)} <span>${tab.count}</span>
            </button>
          `).join("")}
        </div>
      `;
    }

    function createCourseButtonMarkup(className) {
      return `
        <button class="${className}" type="button" data-create-course>
          <span class="lang-code">+</span>
          <span class="lang-copy"><strong>${escapeHtml(t("new_course"))}</strong><small>${escapeHtml(t("create_course"))}</small></span>
          <span class="coming-soon">+</span>
        </button>
      `;
    }

    function renderLanguageLists() {
      const settingsList = document.getElementById("settingsLanguageList");
      const modalList = document.getElementById("languageModalList");
      const current = currentLanguage();
      const activeCodes = activeLanguageCodes();
      const allCodes = allLanguageCodes();
      const customRecords = loadCustomLanguages();
      const archivedCodes = allCodes.filter((code) => {
        const pack = state.languagePacks[code];
        const record = customRecords.find((item) => item.code === code);
        return pack ? pack.is_archived : Boolean(record?.is_archived);
      });
      const filter = state.languageFilter || "active";
      const visibleCodes = filter === "archived" ? archivedCodes : filter === "all" ? allCodes : activeCodes;
      const optionMarkup = (code) => {
        const pack = state.languagePacks[code] || {};
        const record = customRecords.find((item) => item.code === code);
        const archived = Boolean(pack.is_archived ?? record?.is_archived);
        const builtin = isBuiltinLanguage(code);
        const deleteTitle = builtin ? t("builtin_archive_only") : t("delete_course");
        return `
          <div class="language-row" data-language-row="${escapeHtml(code)}">
            <button class="language-option${current === code ? " is-active" : ""}" type="button" data-learning-language="${escapeHtml(code)}" data-app-language="${escapeHtml(code)}" aria-pressed="${current === code ? "true" : "false"}">
              <span class="lang-code">${renderFlag(code)}</span>
              <span class="lang-copy"><strong>${escapeHtml(languageLabel(code))}</strong><small>${escapeHtml(languageCounts(code))}${archived ? ` · ${escapeHtml(t("filter_archived"))}` : ""}</small></span>
              <span class="lang-check" aria-hidden="true">✓</span>
            </button>
            <div class="language-option-actions">
              <button class="lang-action" type="button" data-archive-language="${escapeHtml(code)}" aria-label="${escapeHtml(archived ? t("show_course") : t("hide_course"))}: ${escapeHtml(languageLabel(code))}" title="${escapeHtml(archived ? t("show_course") : t("hide_course"))}">
                ${icon("archive")}<span>${escapeHtml(archived ? t("show_course") : t("hide_course"))}</span>
              </button>
              <button class="lang-action is-danger" type="button" data-delete-language="${escapeHtml(code)}" aria-label="${escapeHtml(deleteTitle)}: ${escapeHtml(languageLabel(code))}" title="${escapeHtml(deleteTitle)}"${builtin ? ' disabled aria-disabled="true"' : ""}>
                ${icon("trash")}<span>${escapeHtml(t("delete_course"))}</span>
              </button>
            </div>
          </div>
        `;
      };
      const rows = visibleCodes.map(optionMarkup).join("");
      const empty = !rows && filter === "active"
        ? `<div class="language-empty-filter"><strong>${escapeHtml(t("no_active_courses"))}</strong><span>${escapeHtml(t("no_active_hint"))}</span></div>`
        : "";
      const create = filter === "archived" ? "" : createCourseButtonMarkup("language-option language-create");
      const markup = renderLanguageFilterTabs() + rows + empty + create;
      const scrollSnapshot = captureScrollState();
      if (settingsList) settingsList.innerHTML = markup;
      if (modalList) modalList.innerHTML = markup;
      restoreScrollState(scrollSnapshot);
      const hint = document.querySelector('[aria-labelledby="languageSettingLabel"] .settings-hint');
      if (hint) hint.textContent = t("active_courses_count", { n: activeCodes.length });
    }

    function renderLanguageSwitch() {
      const language = currentLanguage();
      return `
        <div class="language-switch" role="group" aria-label="${escapeHtml(t("learning_language"))}">
          <span class="language-switch-label">${escapeHtml(t("language").toUpperCase())}</span>
          ${activeLanguageCodes().map((code) => `
            <button class="language-choice${language === code ? " is-active" : ""}" type="button" data-learning-language="${escapeHtml(code)}" aria-pressed="${language === code ? "true" : "false"}">
              <span class="lang-flag">${renderFlag(code)}</span> ${escapeHtml(languageLabel(code))}
            </button>
          `).join("")}
          <button class="language-choice language-create" type="button" data-create-course>
            <span>+</span> ${escapeHtml(t("new_course"))}
          </button>
        </div>
      `;
    }

    function setAppBusy(busy) {
      const loading = document.getElementById("appLoading");
      if (loading) {
        loading.hidden = !busy;
        loading.setAttribute("aria-busy", String(busy));
      }
      app.setAttribute("aria-busy", String(busy));
      document.querySelectorAll("[data-learning-language], [data-create-course]").forEach((button) => {
        button.disabled = Boolean(busy);
      });
    }

    function setLearningLanguage(language, navigate) {
      if (!activeLanguageCodes().includes(language)) return;
      const loading = document.getElementById("appLoading");
      if (loading && !loading.hidden) return;
      setAppBusy(true);
      const changed = currentLanguage() !== language;
      state.settings.language = language;
      if (changed) activateLanguageData(language);
      persistSettings();
      applySettings();
      renderLanguageLists();
      if (languageModal?.open) closeLanguageModal();

      if (navigate) {
        const onDashboardView = state.view === "dashboard" || !window.location.hash || window.location.hash === "#dashboard";
        if (onDashboardView) {
          if (window.location.hash !== "#dashboard") {
            window.history.replaceState(null, "", "#dashboard");
          }
          renderDashboard();
        } else {
          window.location.hash = "#dashboard";
        }
      }
      if (changed) showToast(`${t("language")}: ${languageLabel(language)}`, "info");
      window.setTimeout(() => setAppBusy(false), 220);
    }

    function setUILanguage(language) {
      if (!UI_LANGUAGES[language]) return;
      state.settings.uiLanguage = language;
      persistSettings();
      applySettings();
      renderLanguageLists();
      setSyncStatus(currentSyncState);
      rerenderCurrentView();
    }

    function openLanguageModal() {
      state.lastFocus = document.activeElement;
      syncLanguageUI();
      if (!languageModal.open) {
        if (typeof languageModal.showModal === "function") languageModal.showModal();
        else languageModal.setAttribute("open", "");
      }
      topbarLevel.setAttribute("aria-expanded", "true");
    }

    function closeLanguageModal() {
      if (languageModal.open && typeof languageModal.close === "function") languageModal.close();
      else languageModal.removeAttribute("open");
      topbarLevel.setAttribute("aria-expanded", "false");
    }

    function syncCourseFlagSelection() {
      if (!courseFlagGrid) return;
      const selected = state.courseFlagDraft?.countryCode || "";
      courseFlagGrid.querySelectorAll("[data-course-flag-code]").forEach((button) => {
        const active = button.dataset.courseFlagCode === selected;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
    }

    function renderCourseFlagOptions(query) {
      if (!courseFlagGrid) return;
      const search = String(query || "").trim().toLocaleLowerCase();
      const options = FLAG_OPTIONS.filter((option) => {
        if (!search) return true;
        const haystack = `${option.code} ${option.lang} ${flagDisplayName(option)} ${flagNativeName(option)} ${flagEmoji(option.code)}`.toLocaleLowerCase();
        return haystack.includes(search);
      });
      courseFlagGrid.innerHTML = options.map((option) => {
        const label = flagDisplayName(option);
        return `
          <button class="course-flag" type="button" role="option" data-course-flag-code="${option.code}" aria-selected="false" title="${escapeHtml(label)}">
            ${renderFlag({ flagCode: option.code, flag: flagEmoji(option.code), label })}
            <span class="course-flag-label">${escapeHtml(label)}</span>
          </button>
        `;
      }).join("");
      if (courseFlagEmpty) courseFlagEmpty.hidden = options.length > 0;
      syncCourseFlagSelection();
    }

    function selectCourseFlag(countryCode) {
      const option = FLAG_OPTIONS.find((item) => item.code === countryCode);
      if (!option) return;
      state.courseFlagDraft = {
        countryCode: option.code,
        lang: option.lang,
        flag: flagEmoji(option.code),
        label: flagDisplayName(option),
        custom: false
      };
      courseCustomFlag.value = "";
      syncCourseFlagSelection();
    }

    function applyCustomCourseFlag() {
      const value = courseCustomFlag.value.trim();
      const length = [...value].length;
      if (!value || length > 3) {
        showToast(t("flag_custom_invalid"), "error");
        courseCustomFlag.focus({ preventScroll: true });
        return;
      }
      state.courseFlagDraft = {
        countryCode: "",
        lang: "",
        flag: value,
        label: value,
        custom: true
      };
      courseFlagSearch.value = "";
      renderCourseFlagOptions("");
      showToast(`${t("custom_flag")}: ${value}`, "info");
    }

    function openCourseModal() {
      state.lastFocus = document.activeElement;
      closeLanguageModal();
      if (typeof settingsModal.close === "function" && settingsModal.open) closeSettings();
      courseForm.reset();
      courseName.value = "";
      courseFlagSearch.value = "";
      courseCustomFlag.value = "";
      state.courseFlagDraft = {
        countryCode: "ES",
        lang: "es",
        flag: flagEmoji("ES"),
        label: flagDisplayName(FLAG_OPTIONS[0]),
        custom: false
      };
      renderCourseFlagOptions("");
      if (!courseModal.open) {
        if (typeof courseModal.showModal === "function") courseModal.showModal();
        else courseModal.setAttribute("open", "");
      }
      window.setTimeout(() => courseName.focus({ preventScroll: true }), 80);
    }

    function closeCourseModal() {
      if (courseModal.open && typeof courseModal.close === "function") courseModal.close();
      else courseModal.removeAttribute("open");
    }

    function makeCourseCode(label) {
      const ascii = String(label || "")
        .normalize("NFKD")
        .replace(/[^\x00-\x7F]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      let code = `course-${ascii || Date.now().toString(36)}`;
      let suffix = 2;
      while (LANGUAGE_CODES.includes(code) || state.languagePacks[code]) {
        code = `course-${ascii || Date.now().toString(36)}-${suffix++}`;
      }
      return code;
    }

    function createCourseFromForm(event) {
      event.preventDefault();
      const label = courseName.value.trim();
      if (!label) {
        courseName.focus({ preventScroll: true });
        return;
      }
      const customFlag = courseCustomFlag.value.trim();
      if (customFlag) {
        if ([...customFlag].length > 3) {
          showToast(t("flag_custom_invalid"), "error");
          courseCustomFlag.focus({ preventScroll: true });
          return;
        }
        state.courseFlagDraft = { countryCode: "", lang: "", flag: customFlag, label: customFlag, custom: true };
      }
      const draft = state.courseFlagDraft || {};
      const flagCode = String(draft.countryCode || "").toUpperCase();
      const flag = String(draft.flag || flagCode || "🌐").trim();
      const now = new Date().toISOString();
      const code = makeCourseCode(label);
      const customLanguages = loadCustomLanguages();
      customLanguages.push({
        code,
        label,
        native: label,
        flag,
        flagCode,
        flagCustom: Boolean(draft.custom),
        is_archived: false,
        updated_at: now
      });
      writeJSON(CUSTOM_LANGUAGES_KEY, customLanguages);
      writeJSON(`lingua_${code}_vocab`, []);
      writeJSON(`lingua_${code}_imported_lessons`, []);
      writeJSON(`lingua_${code}_imported_stories`, []);

      LANGUAGE_META[code] = { label, native: label, flag, flagCode };
      if (!LANGUAGE_CODES.includes(code)) LANGUAGE_CODES.push(code);
      state.languagePacks[code] = {
        code,
        label,
        native: label,
        flag,
        flagCode,
        flagCustom: Boolean(draft.custom),
        is_archived: false,
        updated_at: now,
        level: "A1",
        lessons: [],
        stories: [],
        vocab: []
      };
      state.languageFilter = "active";
      renderLanguageLists();
      closeCourseModal();
      setLearningLanguage(code, true);
      showToast(`${t("course_created")}: ${label}`, "success");
    }

    function upsertLanguageRecord(code, patch) {
      const list = loadCustomLanguages();
      const pack = state.languagePacks[code] || {};
      const meta = LANGUAGE_META[code] || {};
      const existing = list.find((item) => item.code === code);
      const next = {
        code,
        label: existing?.label || pack.label || meta.label || code.toUpperCase(),
        native: existing?.native || pack.native || meta.native || code.toUpperCase(),
        flag: existing?.flag || pack.flag || meta.flag || "🌐",
        flagCode: existing?.flagCode || pack.flagCode || meta.flagCode || "",
        flagCustom: Boolean(existing?.flagCustom || pack.flagCustom),
        is_archived: Boolean(existing?.is_archived),
        updated_at: existing?.updated_at || "",
        ...patch
      };
      writeJSON(CUSTOM_LANGUAGES_KEY, [...list.filter((item) => item.code !== code), next]);
    }

    function ensureActiveLanguage() {
      const active = activeLanguageCodes();
      if (!active.length) {
        state.language = null;
        state.languagePack = null;
        state.lessons = [];
        state.stories = [];
        state.vocab = [];
        state.settings.language = null;
        persistSettings();
        return null;
      }
      if (!active.includes(state.language)) {
        state.settings.language = active[0];
        activateLanguageData(active[0]);
        persistSettings();
      }
      return currentLanguage();
    }

    function renderNoActiveCourses() {
      state.view = "dashboard";
      state.lesson = null;
      state.lessonId = null;
      state.story = null;
      state.storyId = null;
      state.backTarget = "#dashboard";
      state.lessons = [];
      state.stories = [];
      state.vocab = [];
      app.innerHTML = `
        <section class="dashboard no-active-course" aria-labelledby="noActiveTitle">
          <div class="dashboard-topline">${renderLanguageSwitch()}</div>
          <div class="no-active-course-card">
            <span class="dashboard-kicker">COURSE / EMPTY</span>
            <h1 class="dashboard-title" id="noActiveTitle">${escapeHtml(t("no_active_courses"))}</h1>
            <p class="dashboard-subtitle">${escapeHtml(t("no_active_hint"))}</p>
            <div class="dashboard-actions">
              <button class="btn btn-primary" type="button" data-create-course>${icon("plus")} ${escapeHtml(t("create_first_course"))}</button>
            </div>
          </div>
        </section>
      `;
      if (typeof setActiveAppSection === "function") setActiveAppSection("home");
      topbarContext.textContent = t("no_active_courses").toLowerCase();
      progressValue.textContent = "";
      topProgressBar.style.width = "0%";
      backToLessons.hidden = true;
      updateSectionUI("course");
      syncLanguageUI();
      document.title = `LINGUA/OS — ${t("no_active_courses")}`;
      scrollToTopInstant();
    }

    function archiveLanguage(code) {
      let pack = state.languagePacks[code];
      if (!pack) {
        const record = loadCustomLanguages().find((item) => item.code === code);
        if (!record) return;
        pack = { ...record, lessons: [], stories: [], vocab: [] };
        state.languagePacks[code] = pack;
        if (!LANGUAGE_CODES.includes(code)) LANGUAGE_CODES.push(code);
      }
      if (code === currentLanguage()) {
        showToast(t("cannot_hide_current"), "info");
        return;
      }
      if (activeLanguageCodes().length <= 1) {
        showToast(t("cannot_hide_last"), "info");
        return;
      }
      const now = new Date().toISOString();
      pack.is_archived = true;
      pack.updated_at = now;
      upsertLanguageRecord(code, { is_archived: true, updated_at: now });
      if (state.language === code) {
        ensureActiveLanguage();
        if (state.language) setLearningLanguage(state.language, true);
        else {
          renderLanguageLists();
          renderNoActiveCourses();
        }
      } else {
        renderLanguageLists();
        applySettings();
      }
      showToast(`${t("course_archived")}: ${languageLabel(code)}`, "info");
    }

    function unarchiveLanguage(code) {
      let pack = state.languagePacks[code];
      if (!pack) {
        const record = loadCustomLanguages().find((item) => item.code === code);
        if (!record) return;
        pack = { ...record, lessons: [], stories: [], vocab: [] };
        state.languagePacks[code] = pack;
        if (!LANGUAGE_CODES.includes(code)) LANGUAGE_CODES.push(code);
      }
      const now = new Date().toISOString();
      pack.is_archived = false;
      pack.updated_at = now;
      upsertLanguageRecord(code, { is_archived: false, updated_at: now });
      if (!activeLanguageCodes().length) {
        state.settings.language = code;
        activateLanguageData(code);
        persistSettings();
      }
      renderLanguageLists();
      applySettings();
      if (state.language === code) setLearningLanguage(code, true);
      else rerenderCurrentView();
      showToast(`${t("course_unarchived")}: ${languageLabel(code)}`, "success");
    }

    function removeLanguageStorage(code) {
      const prefix = `lingua_${code}_`;
      try {
        const keys = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key && key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach((key) => window.localStorage.removeItem(key));
      } catch (error) {
        console.warn("Could not remove language storage.", error);
      }
    }

    function deleteLanguage(code) {
      const pack = state.languagePacks[code];
      if (!pack) return;
      if (isBuiltinLanguage(code)) {
        showToast(t("builtin_archive_only"), "info");
        return;
      }
      requestConfirmation({
        title: t("delete_course"),
        message: t("delete_course_message", { name: languageLabel(code) }),
        confirmLabel: t("delete_confirm")
      }).then((confirmed) => {
        if (!confirmed) return;
        const wasCurrent = state.language === code;
        const list = loadCustomLanguages().filter((item) => item.code !== code);
        writeJSON(CUSTOM_LANGUAGES_KEY, list);
        removeLanguageStorage(code);
        addTombstone("language", { code });
        delete state.languagePacks[code];
        delete LANGUAGE_META[code];
        LANGUAGE_CODES = LANGUAGE_CODES.filter((item) => item !== code);
        if (wasCurrent) {
          ensureActiveLanguage();
          if (state.language) setLearningLanguage(state.language, true);
          else {
            renderLanguageLists();
            renderNoActiveCourses();
          }
        } else {
          renderLanguageLists();
          applySettings();
          rerenderCurrentView();
        }
        showToast(`${t("course_deleted")}: ${pack.label}`, "success");
      });
    }

    function rerenderCurrentView() {
      if (!activeLanguageCodes().length) {
        renderNoActiveCourses();
        return;
      }
      if (state.view === "home") renderHome();
      else if (state.view === "practice") renderPracticeHub();
      else if (state.view === "progress") renderProgressHub();
      else if (state.view === "dashboard") renderDashboard();
      else if (state.view === "stories") renderStoriesHub();
      else if (state.view === "vocabulary") renderVocabularyHub();
      else if (state.view === "lesson" && state.lessonId) {
        const lesson = state.lessons.find((item) => Number(item.id) === Number(state.lessonId));
        if (lesson) renderLesson(lesson);
        else renderDashboard();
      } else if (state.view === "story" && state.storyId) {
        const story = state.stories.find((item) => Number(item.id) === Number(state.storyId));
        if (story) renderStory(story);
        else renderStoriesHub();
      } else {
        renderDashboard();
      }
    }

    /* ---------- routing ---------- */
    function route(force) {
      if (!state.languagePacks || !Object.keys(state.languagePacks).length) return;
      if (!activeLanguageCodes().length) {
        renderNoActiveCourses();
        return;
      }
      const hash = window.location.hash || "";

      // In-page anchors inside an open lesson should not remount the view.
      if (!force && state.view === "lesson" && hash.startsWith("#block-")) return;

      const storyMatch = /^#story-(\d+)$/.exec(hash);
      if (storyMatch) {
        const storyId = Number(storyMatch[1]);
        const story = state.stories.find((item) => Number(item.id) === storyId);
        if (story) {
          if (!force && state.view === "story" && state.storyId === storyId) return;
          renderStory(story);
          return;
        }
      }

      if (hash === "#stories") {
        if (!force && state.view === "stories") return;
        renderStoriesHub();
        return;
      }

      if (hash === "#vocabulary") {
        if (!force && state.view === "vocabulary") return;
        renderVocabularyHub();
        return;
      }

      if (hash === "#practice") {
        if (!force && state.view === "practice") return;
        renderPracticeHub();
        return;
      }

      if (hash === "#progress") {
        if (!force && state.view === "progress") return;
        renderProgressHub();
        return;
      }

      if (hash === "#home" || hash === "") {
        if (!force && state.view === "home") return;
        renderHome();
        return;
      }

      const lessonMatch = /^#lesson-(\d+)$/.exec(hash);
      if (lessonMatch) {
        const lessonId = Number(lessonMatch[1]);
        const lesson = state.lessons.find((item) => Number(item.id) === lessonId);
        if (lesson) {
          if (!force && state.view === "lesson" && state.lessonId === lessonId) return;
          renderLesson(lesson);
          return;
        }
      }

      if (hash === "#dashboard") {
        if (!force && state.view === "dashboard") return;
        renderDashboard();
        return;
      }
      if (!force && state.view === "home") return;
      renderHome();
    }

    /* ---------- onboarding / simple mode ---------- */
    const ONBOARDING_KEY = "lingua_onboarding_done";

    function onboardingCompleted() {
      return Boolean(readJSON(ONBOARDING_KEY, false));
    }

    function finishOnboarding() {
      writeJSON(ONBOARDING_KEY, true);
      const modal = document.getElementById("onboardingModal");
      if (modal?.open) modal.close();
      state.lastFocus?.focus?.({ preventScroll: true });
    }

    function renderOnboardingLanguages() {
      const host = document.getElementById("onboardingLanguages");
      if (!host) return;
      host.innerHTML = activeLanguageCodes().map((code) => `
        <button class="choice-card${code === currentLanguage() ? " is-active" : ""}" type="button" data-onboarding-language="${escapeHtml(code)}" aria-pressed="${code === currentLanguage() ? "true" : "false"}">
          <span aria-hidden="true">${renderFlag(code)}</span> ${escapeHtml(languageLabel(code))}
        </button>`).join("");
    }

    function setOnboardingStep(stepIndex) {
      onboardingStep = Math.max(1, Math.min(4, Number(stepIndex) || 1));
      document.querySelectorAll("[data-onboarding-step]").forEach((step) => {
        step.hidden = Number(step.dataset.onboardingStep) !== onboardingStep;
      });
      const next = document.querySelector('[data-onboarding-action="next"]');
      if (next) next.textContent = onboardingStep === 4 ? t("onboarding_finish") : t("onboarding_next");
      const back = document.querySelector('[data-onboarding-action="back"]');
      if (back) back.hidden = onboardingStep === 1;
      const demo = document.querySelector('[data-onboarding-action="demo"]');
      if (demo) demo.hidden = onboardingStep !== 4;
      const login = document.querySelector('[data-onboarding-action="login"]');
      if (login) login.hidden = onboardingStep !== 4;
    }

    function openOnboarding() {
      const modal = document.getElementById("onboardingModal");
      if (!modal) return;
      state.lastFocus = document.activeElement;
      onboardingStep = 1;
      onboardingLanguage = currentLanguage() || "en";
      onboardingLevel = state.settings.level || "";
      document.querySelectorAll("[data-onboarding-level]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.onboardingLevel === onboardingLevel));
        button.classList.toggle("is-active", button.dataset.onboardingLevel === onboardingLevel);
      });
      renderOnboardingLanguages();
      setOnboardingStep(1);
      if (!modal.open) {
        if (typeof modal.showModal === "function") modal.showModal();
        else modal.setAttribute("open", "");
      }
    }

    function maybeStartOnboarding() {
      if (onboardingCompleted() || hasAdvancedWorkspaceData()) return;
      window.setTimeout(openOnboarding, 280);
    }

    function simpleReadyLessonsMarkup() {
      return getVisibleLessons().slice(0, 4).map((lesson) => `
        <a class="simple-ready-link" href="#lesson-${Number(lesson.id)}">
          <span aria-hidden="true">📚</span><strong>${escapeHtml(lesson.title || t("nav_lessons"))}</strong>
        </a>`).join("");
    }

    function openSimpleLessonModal() {
      const modal = document.getElementById("simpleLessonModal");
      if (!modal) return;
      state.lastFocus = document.activeElement;
      const topic = document.getElementById("simpleLessonTopic");
      const status = document.getElementById("simpleLessonStatus");
      const ready = document.getElementById("simpleReadyLessons");
      if (topic) topic.value = "";
      if (status) { status.textContent = ""; status.className = "simple-status"; }
      if (ready) ready.innerHTML = `<span class="home-kicker">${escapeHtml(t("simple_ready"))}</span>${simpleReadyLessonsMarkup() || `<p>${escapeHtml(t("simple_no_lessons"))}</p>`}`;
      const level = document.getElementById("simpleLessonLevel");
      if (level) level.value = state.settings.level || "B1";
      if (!modal.open) {
        if (typeof modal.showModal === "function") modal.showModal();
        else modal.setAttribute("open", "");
      }
      window.setTimeout(() => topic?.focus({ preventScroll: true }), 50);
    }

    async function generateSimpleLesson() {
      const modal = document.getElementById("simpleLessonModal");
      const topicInput = document.getElementById("simpleLessonTopic");
      const status = document.getElementById("simpleLessonStatus");
      const button = document.getElementById("simpleLessonGenerate");
      const topic = String(topicInput?.value || "").trim();
      if (!topic) {
        if (status) { status.textContent = t("simple_create_failed"); status.className = "simple-status is-error"; }
        topicInput?.focus({ preventScroll: true });
        return;
      }
      const level = document.getElementById("simpleLessonLevel")?.value || state.settings.level || "B1";
      const goal = document.getElementById("simpleLessonGoal")?.value || "talk";
      if (button) button.disabled = true;
      if (status) { status.textContent = t("simple_generating"); status.className = "simple-status is-loading"; }
      try {
        const prompt = [
          `Create one language lesson for a learner of ${languageLabel(currentLanguage())}.`,
          `Topic: ${topic}. Goal: ${goal}. Level: ${level}.`,
          `Write all target-language content in ${languageLabel(currentLanguage())}; explanations in ${UI_LANGUAGES[state.settings.uiLanguage]?.label || "English"}.`,
          `Return only JSON: {"lesson":{"title":"","subtitle":"","level":"${level}","blocks":[`,
          `{"type":"theory","title":"","content":"","rule_lines":[],"formulas":[],"mistakes":[],"key_phrases":[],"fun_fact":""},`,
          `{"type":"reading_heavy","title":"","text":"<p></p>","glossary":[]},`,
          `{"type":"dialogue","title":"","participants":[],"messages":[]},`,
          `{"type":"quiz","title":"","questions":[]},`,
          `{"type":"practice_write","title":"","brief":""}]}}`
        ].join(" ");
        const result = await generateAiText(prompt, {
          system: "You create clear, friendly language lessons. Return valid JSON only.",
          json: true,
          temperature: 0.55,
          maxOutputTokens: 12000
        });
        const raw = parseGeminiJson(result.text);
        const source = raw?.lesson || raw;
        if (!source || typeof source !== "object") throw new Error("empty lesson");
        const normalized = normalizeImportedLesson({ ...source, title: source.title || topic, level }, nextLessonId());
        if (!normalized) throw new Error("invalid lesson");
        const imported = importPayload({ lessons: [normalized] });
        if (!imported.lessonsAdded && !imported.lessonsUpdated) throw new Error("not imported");
        if (modal?.open) modal.close();
        rerenderCurrentView();
        window.location.hash = `#lesson-${Number(normalized.id)}`;
        showToast(t("simple_created"), "success");
      } catch (error) {
        console.warn("Simple lesson generation failed.", error);
        if (status) { status.textContent = t("simple_ai_unavailable"); status.className = "simple-status is-error"; }
        const ready = document.getElementById("simpleReadyLessons");
        if (ready) ready.innerHTML = `<span class="home-kicker">${escapeHtml(t("simple_ready"))}</span>${simpleReadyLessonsMarkup() || `<p>${escapeHtml(t("simple_no_lessons"))}</p>`}`;
      } finally {
        if (button) button.disabled = false;
      }
    }

    /* ---------- boot ---------- */
    function renderError(error) {
      topbarContext.textContent = "system / error";
      progressValue.textContent = "";
      topProgressBar.style.width = "0%";
      backToLessons.hidden = true;
      app.innerHTML = `
        <div class="error-shell">
          <div class="error-card">
            <span class="error-code">ERR_LESSONS_JSON</span>
            <h1>Курс не загрузился</h1>
            <p>Движок не смог прочитать <code>lessons.json</code>. Открой папку проекта через локальный сервер — так браузер разрешит <code>fetch</code>.</p>
            <pre><code>python -m http.server 8000</code></pre>
            <p>Затем перейди на <code>http://localhost:8000</code>.</p>
            <button class="btn btn-primary" type="button" data-retry>Попробовать снова</button>
            <details>
              <summary>Технические детали</summary>
              <pre>${escapeHtml(error && error.message ? error.message : String(error))}</pre>
            </details>
          </div>
        </div>
      `;
      const retry = app.querySelector("[data-retry]");
      if (retry) retry.addEventListener("click", () => window.location.reload());
    }

    async function boot() {
      try {
        const { data, source } = await loadLessonData();
        state.rootData = data;
        state.languagePacks = normalizeLanguagePacks(data);
        state.source = source;

        loadSettings();
        const active = activeLanguageCodes();
        if (active.length) {
          if (!active.includes(state.settings.language)) state.settings.language = active[0];
          activateLanguageData(state.settings.language);
        } else {
          state.language = null;
          state.languagePack = null;
          state.data = null;
          state.lessons = [];
          state.stories = [];
          state.vocab = [];
          state.settings.language = null;
        }
        renderLanguageLists();
        loadProfile();
        applySettings();
        route(true);
        maybeStartOnboarding();
        setSyncStatus("local");
        initCloudSyncWhenReady();
        window.setTimeout(() => {
          if (!state.profile) renderGoogleAuth();
        }, 350);

        if (source === "embedded") {
          window.setTimeout(() => {
            showToast("Автономный режим: данные курса загружены из встроенной копии", "info");
          }, 700);
        }
      } catch (error) {
        console.error(error);
        renderError(error);
      }
    }
    let confirmResolver = null;

    function requestConfirmation({ title, message, confirmLabel }) {
      return new Promise((resolve) => {
        if (confirmResolver) {
          const previous = confirmResolver;
          confirmResolver = null;
          previous(false);
        }
        confirmResolver = resolve;
        confirmTitle.textContent = title || t("delete_title");
        confirmMessage.textContent = message || "";
        confirmAccept.textContent = confirmLabel || t("delete_confirm");
        if (!confirmModal.open) {
          if (typeof confirmModal.showModal === "function") confirmModal.showModal();
          else confirmModal.setAttribute("open", "");
        }
        window.setTimeout(() => confirmAccept.focus(), 60);
      });
    }

    function settleConfirmation(value) {
      const resolver = confirmResolver;
      confirmResolver = null;
      if (confirmModal.open && typeof confirmModal.close === "function") confirmModal.close();
      else confirmModal.removeAttribute("open");
      if (resolver) resolver(value);
    }

    /* ---------- static interactions ---------- */
    document.getElementById("translationClose").addEventListener("click", closeTranslation);

    document.addEventListener("click", (event) => {
      if (!translationPanel.classList.contains("is-open")) return;
      if (event.target.closest("#translationPanel") || event.target.closest(".vocab")) return;
      closeTranslation();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && translationPanel.classList.contains("is-open")) {
        closeTranslation();
      }
    });

    document.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-mobile-toc-toggle]");
      if (toggle) {
        const panel = document.getElementById("mobileTocPanel");
        if (panel) setMobileTocOpen(panel.hidden);
        return;
      }
      if (event.target.closest("#mobileTocPanel .toc-link")) {
        setMobileTocOpen(false);
        return;
      }
      if (!event.target.closest(".mobile-toc")) {
        const panel = document.getElementById("mobileTocPanel");
        if (panel && !panel.hidden) setMobileTocOpen(false);
      }
    });

    app.addEventListener("click", (event) => {
      const vocab = event.target.closest(".vocab");
      if (!vocab || !app.contains(vocab)) return;
      event.preventDefault();
      openTranslation(vocab);
    });

    app.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("vocab")) {
        event.preventDefault();
        openTranslation(event.target);
      }
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-word-card]")) {
        event.preventDefault();
        openWordEditor(event.target.dataset.wordCard);
      }
    });

    app.addEventListener("click", (event) => {
      const deleteWordButton = event.target.closest("[data-delete-word]");
      if (deleteWordButton) {
        event.preventDefault();
        deleteWordById(deleteWordButton.dataset.deleteWord);
        return;
      }
      const star = event.target.closest("[data-star-word]");
      if (star) {
        event.preventDefault();
        toggleVocabFavorite(star.dataset.starWord);
        return;
      }
      const tag = event.target.closest("[data-vocab-tag]");
      if (tag) {
        event.preventDefault();
        state.vocabTag = tag.dataset.vocabTag || "all";
        renderVocabResults();
        return;
      }
      const card = event.target.closest("[data-word-card]");
      if (card) {
        event.preventDefault();
        openWordEditor(card.dataset.wordCard);
      }
    });

    app.addEventListener("input", (event) => {
      if (event.target.id !== "vocabSearchInput") return;
      state.vocabSearch = event.target.value;
      renderVocabResults();
    });

    backToLessons.addEventListener("click", () => {
      window.location.hash = state.backTarget || "#dashboard";
    });

    document.addEventListener("click", (event) => {
      const importButton = event.target.closest("[data-open-import]");
      if (importButton) {
        openImportModal();
        return;
      }

      const exportButton = event.target.closest("[data-export-vocab]");
      if (exportButton) {
        downloadVocabulary();
        return;
      }

      const createCourseButton = event.target.closest("[data-create-course]");
      if (createCourseButton) {
        openCourseModal();
        return;
      }

      const languageFilterButton = event.target.closest("[data-language-filter]");
      if (languageFilterButton) {
        state.languageFilter = languageFilterButton.dataset.languageFilter || "active";
        renderLanguageLists();
        return;
      }

      const archiveButton = event.target.closest("[data-archive-language]");
      if (archiveButton) {
        event.preventDefault();
        event.stopPropagation();
        const code = archiveButton.dataset.archiveLanguage;
        const customRecord = loadCustomLanguages().find((item) => item.code === code);
        const archived = state.languagePacks[code]
          ? Boolean(state.languagePacks[code].is_archived)
          : Boolean(customRecord?.is_archived);
        withScrollPreserved(() => {
          if (archived) unarchiveLanguage(code);
          else archiveLanguage(code);
        });
        return;
      }

      const deleteLanguageButton = event.target.closest("[data-delete-language]");
      if (deleteLanguageButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteLanguage(deleteLanguageButton.dataset.deleteLanguage);
        return;
      }

      const appLanguageButton = event.target.closest("[data-app-language]");
      if (appLanguageButton) {
        closeSettings();
        setLearningLanguage(appLanguageButton.dataset.appLanguage, true);
        return;
      }

      const languageButton = event.target.closest("[data-learning-language]");
      if (languageButton) {
        setLearningLanguage(languageButton.dataset.learningLanguage, true);
        return;
      }

      const sectionButton = event.target.closest("[data-section-link]");
      if (sectionButton) {
        const section = sectionButton.dataset.sectionLink;
        const target = section === "stories" ? "#stories" : section === "vocabulary" ? "#vocabulary" : "#dashboard";
        if (window.location.hash === target) scrollToTopInstant();
        else window.location.hash = target;
        return;
      }

      const readButton = event.target.closest("[data-mark-story]");
      if (!readButton || !state.story) return;
      const nextReadState = !isStoryRead(state.story.id);
      setStoryRead(state.story.id, nextReadState);
      readButton.classList.toggle("is-read", nextReadState);
      readButton.setAttribute("aria-pressed", String(nextReadState));
      readButton.innerHTML = nextReadState
        ? `${icon("check")} Прочитано`
        : `${icon("book")} Отметить прочитанным`;
      const readState = document.querySelector("[data-story-read-state]");
      if (readState) {
        readState.classList.toggle("is-read", nextReadState);
        readState.innerHTML = nextReadState ? `${icon("check")} Прочитано` : "Не прочитано";
      }
      showToast(nextReadState ? "История отмечена как прочитанная" : "Отметка о прочтении снята", nextReadState ? "success" : "info");
    });

    document.querySelector(".brand").addEventListener("click", () => {
      if (state.view === "dashboard") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    settingsButton.addEventListener("click", openSettings);
    settingsClose.addEventListener("click", closeSettings);

    settingsModal.addEventListener("click", (event) => {
      if (event.target !== settingsModal) return;
      const rect = settingsModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeSettings();
    });

    settingsModal.addEventListener("close", () => {
      setResetConfirmation(false);
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });

    document.querySelectorAll("[data-font-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.font = button.dataset.fontSetting === "large" ? "large" : "normal";
        persistSettings();
        applySettings();
      });
    });

    document.querySelectorAll("[data-mode-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        state.settings.mode = button.dataset.modeSetting === "advanced" ? "advanced" : "simple";
        persistSettings();
        applySettings();
        rerenderCurrentView();
        showToast(t(state.settings.mode === "advanced" ? "mode_advanced" : "mode_simple"), "info");
      });
    });

    document.querySelectorAll("[data-theme-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = button.dataset.themeSetting;
        if (!THEMES[theme]) return;
        state.settings.theme = theme;
        persistSettings();
        applySettings();
        showToast(`${t("theme")}: ${t(theme === "light" ? "theme_light" : "theme_dark")}`, "info");
      });
    });

    document.querySelectorAll("[data-accent-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        const accent = button.dataset.accentSetting;
        if (!ACCENTS[accent]) return;
        state.settings.accent = accent;
        persistSettings();
        applySettings();
        showToast(`${t("accent")}: ${t(accent === "emerald" ? "accent_emerald" : "accent_blue")}`, "info");
      });
    });

    document.querySelectorAll("[data-ui-language]").forEach((button) => {
      button.addEventListener("click", () => setUILanguage(button.dataset.uiLanguage));
    });

    courseForm.addEventListener("submit", createCourseFromForm);
    courseCancel.addEventListener("click", closeCourseModal);
    courseClose.addEventListener("click", closeCourseModal);
    courseFlagSearch.addEventListener("input", () => renderCourseFlagOptions(courseFlagSearch.value));
    courseCustomApply.addEventListener("click", applyCustomCourseFlag);
    courseCustomFlag.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyCustomCourseFlag();
      }
    });
    courseFlagGrid.addEventListener("click", (event) => {
      const flagButton = event.target.closest("[data-course-flag-code]");
      if (!flagButton) return;
      selectCourseFlag(flagButton.dataset.courseFlagCode);
    });
    courseModal.addEventListener("click", (event) => {
      if (event.target !== courseModal) return;
      const rect = courseModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeCourseModal();
    });
    courseModal.addEventListener("close", () => {
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });

    geminiKeyInput.addEventListener("input", () => saveGeminiKey(geminiKeyInput.value));
    geminiToggle.addEventListener("click", () => {
      const show = geminiKeyInput.type === "password";
      geminiKeyInput.type = show ? "text" : "password";
      geminiToggle.textContent = show ? "🙈" : "👁";
      geminiToggle.setAttribute("aria-label", t(show ? "hide" : "show"));
    });
    geminiTest.addEventListener("click", testGeminiKey);

    topbarLevel.addEventListener("click", openLanguageModal);
    languageClose.addEventListener("click", closeLanguageModal);
    languageModal.addEventListener("click", (event) => {
      if (event.target !== languageModal) return;
      const rect = languageModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeLanguageModal();
    });
    languageModal.addEventListener("close", () => {
      topbarLevel.setAttribute("aria-expanded", "false");
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });

    profileButton.addEventListener("click", openProfileModal);
    profileClose.addEventListener("click", closeProfileModal);
    profileSignOut.addEventListener("click", signOutProfile);

    profileModal.addEventListener("click", (event) => {
      if (event.target !== profileModal) return;
      const rect = profileModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeProfileModal();
    });

    profileModal.addEventListener("close", () => {
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });

    wordEditorForm.addEventListener("submit", saveEditedWord);
    wordEditorClose.addEventListener("click", () => wordEditorModal.close());
    wordEditorCancel.addEventListener("click", () => wordEditorModal.close());
    wordEditorDelete.addEventListener("click", () => deleteWordById(state.editingWordId));
    wordEditorModal.addEventListener("close", () => {
      state.editingWordId = null;
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });
    wordEditorModal.addEventListener("click", (event) => {
      if (event.target !== wordEditorModal) return;
      const rect = wordEditorModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) wordEditorModal.close();
    });

    importClose.addEventListener("click", closeImportModal);
    importCancel.addEventListener("click", closeImportModal);
    importConfirm.addEventListener("click", runImport);
    importRetry.addEventListener("click", runImport);
    document.querySelectorAll("[data-import-tab]").forEach((button) => {
      button.addEventListener("click", () => setImportTab(button.dataset.importTab));
    });
    copySimpleTemplateButton.addEventListener("click", () => copyTemplateVariant("simple"));
    copyMasterTemplateButton.addEventListener("click", () => copyTemplateVariant("master"));
    importText.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runImport();
      }
    });
    importModal.addEventListener("close", () => {
      if (state.lastFocus && document.contains(state.lastFocus) && typeof state.lastFocus.focus === "function") {
        state.lastFocus.focus();
      }
    });
    importModal.addEventListener("click", (event) => {
      if (event.target !== importModal) return;
      const rect = importModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeImportModal();
    });

    confirmAccept.addEventListener("click", () => settleConfirmation(true));
    confirmCancel.addEventListener("click", () => settleConfirmation(false));
    confirmModal.addEventListener("close", () => {
      if (!confirmResolver) return;
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(false);
    });
    confirmModal.addEventListener("click", (event) => {
      if (event.target !== confirmModal) return;
      const rect = confirmModal.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) settleConfirmation(false);
    });

    resetProgressButton.addEventListener("click", () => {
      setResetConfirmation(true);
      resetConfirmBtn.focus();
    });
    resetCancel.addEventListener("click", () => {
      setResetConfirmation(false);
      resetProgressButton.focus();
    });
    resetConfirmBtn.addEventListener("click", resetAllProgress);

    window.addEventListener("offline", () => {
      setSyncStatus("local", "Офлайн · локальный режим");
    });
    window.addEventListener("online", () => {
      if (cloudUserId && supabaseClient) {
        void pushCloudData();
      } else {
        setSyncStatus("local");
      }
    });

    document.getElementById("syncRetry")?.addEventListener("click", () => {
      void retryCloudSync();
    });

    document.addEventListener("click", (event) => {
      const onboardingLanguageButton = event.target.closest("[data-onboarding-language]");
      if (onboardingLanguageButton) {
        onboardingLanguage = onboardingLanguageButton.dataset.onboardingLanguage;
        document.querySelectorAll("[data-onboarding-language]").forEach((button) => {
          const active = button === onboardingLanguageButton;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        return;
      }
      const onboardingLevelButton = event.target.closest("[data-onboarding-level]");
      if (onboardingLevelButton) {
        onboardingLevel = onboardingLevelButton.dataset.onboardingLevel;
        document.querySelectorAll("[data-onboarding-level]").forEach((button) => {
          const active = button === onboardingLevelButton;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        return;
      }
      const onboardingAction = event.target.closest("[data-onboarding-action]");
      if (onboardingAction) {
        const action = onboardingAction.dataset.onboardingAction;
        if (action === "next") {
          if (onboardingStep === 4) {
            state.settings.level = onboardingLevel === "unknown" || !onboardingLevel ? "" : onboardingLevel;
            state.settings.mode = state.settings.mode === "advanced" ? "advanced" : "simple";
            if (activeLanguageCodes().includes(onboardingLanguage)) setLearningLanguage(onboardingLanguage, false);
            persistSettings();
            finishOnboarding();
            rerenderCurrentView();
            showToast(t("onboarding_finish"), "success");
          } else {
            setOnboardingStep(onboardingStep + 1);
          }
        } else if (action === "back") {
          setOnboardingStep(onboardingStep - 1);
        } else if (action === "skip") {
          finishOnboarding();
        } else if (action === "login") {
          finishOnboarding();
          openProfileModal();
        } else if (action === "demo") {
          finishOnboarding();
        }
        return;
      }
      if (event.target.closest("#simpleLessonClose")) {
        document.getElementById("simpleLessonModal")?.close();
        state.lastFocus?.focus?.({ preventScroll: true });
        return;
      }
      if (event.target.closest("#simpleLessonGenerate")) {
        event.preventDefault();
        void generateSimpleLesson();
        return;
      }
    });

    document.getElementById("onboardingModal")?.addEventListener("cancel", (event) => {
      event.preventDefault();
      finishOnboarding();
    });
    document.getElementById("simpleLessonModal")?.addEventListener("cancel", (event) => {
      event.preventDefault();
      event.currentTarget.close();
      state.lastFocus?.focus?.({ preventScroll: true });
    });
    document.getElementById("simpleLessonModal")?.addEventListener("click", (event) => {
      if (event.target.id === "simpleLessonModal") event.currentTarget.close();
    });

    document.addEventListener("click", (event) => {
      const appSection = event.target.closest("[data-app-section]");
      if (appSection) {
        event.preventDefault();
        goAppSection(appSection.dataset.appSection || "home");
        document.getElementById("globalSearchResults")?.setAttribute("hidden", "");
        return;
      }
      if (event.target.closest("[data-scroll-tests]")) {
        event.preventDefault();
        document.querySelector(".practice-tests")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (event.target.closest("[data-sidebar-settings]")) {
        event.preventDefault();
        openSettings();
        return;
      }
      if (event.target.closest("[data-open-ai-studio]")) {
        event.preventDefault();
        if (typeof openAiStudio === "function") openAiStudio();
        return;
      }
      const resume = event.target.closest("[data-resume-block]");
      if (resume) {
        window.sessionStorage.setItem("lingua_resume_block", resume.dataset.resumeBlock || "0");
        return;
      }
      const searchResult = event.target.closest("[data-search-kind]");
      if (searchResult) {
        event.preventDefault();
        const kind = searchResult.dataset.searchKind;
        const id = searchResult.dataset.searchId;
        document.getElementById("globalSearchResults")?.setAttribute("hidden", "");
        if (kind === "lesson") window.location.hash = `#lesson-${Number(id)}`;
        else if (kind === "story") window.location.hash = `#story-${Number(id)}`;
        else {
          state.vocabSearch = String(id || "");
          if (window.location.hash === "#vocabulary") renderVocabularyHub();
          else window.location.hash = "#vocabulary";
        }
        return;
      }
      const dismissHint = event.target.closest("[data-dismiss-home-hint]");
      if (dismissHint) {
        event.preventDefault();
        writeJSON("lingua_home_hint_dismissed", true);
        dismissHint.closest(".home-hint")?.remove();
        return;
      }
      const tile = event.target.closest("[data-home-tile]");
      if (tile) {
        event.preventDefault();
        if (tile.dataset.homeTile === "review") openReviewModal();
        else if (tile.dataset.homeTile === "weak") goAppSection("progress");
        else goAppSection("vocabulary");
        return;
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target.id === "globalSearch") renderGlobalSearch(event.target.value);
    });

    document.addEventListener("focusout", (event) => {
      if (!event.target.closest(".sidebar-search")) {
        window.setTimeout(() => document.getElementById("globalSearchResults")?.setAttribute("hidden", ""), 120);
      }
    });

    window.addEventListener("hashchange", () => route(false));

    boot();
