// LINGUA/OS · navigation, language/course UI, routing, events, boot
"use strict";

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
      if (storiesSwitchCount) storiesSwitchCount.textContent = String(state.stories.length);
      if (vocabSwitchCount) vocabSwitchCount.textContent = String(state.vocab.length);
    }

    function renderSectionTabs(active) {
      const tabs = [
        { key: "course", icon: "book", label: t("nav_course"), count: state.lessons.length },
        { key: "stories", icon: "spark", label: t("nav_stories"), count: state.stories.length },
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

    function languageCounts(code) {
      const pack = state.languagePacks[code] || {};
      const lessons = Array.isArray(pack.lessons) ? pack.lessons.length : 0;
      const stories = Array.isArray(pack.stories) ? pack.stories.length : 0;
      return `${lessons} ${t("nav_course").toLowerCase()} · ${stories} ${t("nav_stories").toLowerCase()}`;
    }

    function isBuiltinLanguage(code) {
      return BUILTIN_LANGUAGE_CODES.includes(code);
    }

    function renderLanguageFilterTabs() {
      const active = activeLanguageCodes().length;
      const archived = LANGUAGE_CODES.filter((code) => state.languagePacks[code]?.is_archived).length;
      const tabs = [
        { key: "active", label: t("filter_active"), count: active },
        { key: "archived", label: t("filter_archived"), count: archived },
        { key: "all", label: t("filter_all"), count: LANGUAGE_CODES.length }
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
      const archivedCodes = LANGUAGE_CODES.filter((code) => state.languagePacks[code]?.is_archived);
      const filter = state.languageFilter || "active";
      const visibleCodes = filter === "archived" ? archivedCodes : filter === "all" ? LANGUAGE_CODES : activeCodes;
      const optionMarkup = (code) => {
        const archived = Boolean(state.languagePacks[code]?.is_archived);
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
      if (settingsList) settingsList.innerHTML = markup;
      if (modalList) modalList.innerHTML = markup;
      const hint = document.querySelector('[aria-labelledby="languageSettingLabel"] .settings-hint');
      if (hint) hint.textContent = `${activeCodes.length} ${t("active")}`;
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

    function setLearningLanguage(language, navigate) {
      if (!activeLanguageCodes().includes(language)) return;
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
        courseCustomFlag.focus();
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
      window.setTimeout(() => courseName.focus(), 80);
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
        courseName.focus();
        return;
      }
      const customFlag = courseCustomFlag.value.trim();
      if (customFlag) {
        if ([...customFlag].length > 3) {
          showToast(t("flag_custom_invalid"), "error");
          courseCustomFlag.focus();
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
      topbarContext.textContent = "no_active_course";
      progressValue.textContent = "00";
      topProgressBar.style.width = "0%";
      backToLessons.hidden = true;
      updateSectionUI("course");
      syncLanguageUI();
      document.title = `LINGUA/OS — ${t("no_active_courses")}`;
      scrollToTopInstant();
    }

    function archiveLanguage(code) {
      const pack = state.languagePacks[code];
      if (!pack) return;
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
      const pack = state.languagePacks[code];
      if (!pack) return;
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
      if (state.view === "dashboard") renderDashboard();
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

      if (!force && state.view === "dashboard") return;
      renderDashboard();
    }

    /* ---------- boot ---------- */
    function renderError(error) {
      topbarContext.textContent = "system / error";
      progressValue.textContent = "00";
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
        const code = archiveButton.dataset.archiveLanguage;
        if (state.languagePacks[code]?.is_archived) unarchiveLanguage(code);
        else archiveLanguage(code);
        return;
      }

      const deleteLanguageButton = event.target.closest("[data-delete-language]");
      if (deleteLanguageButton) {
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

    document.querySelectorAll("[data-theme-setting]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = button.dataset.themeSetting;
        if (!THEMES[theme]) return;
        state.settings.theme = theme;
        persistSettings();
        applySettings();
        showToast(`${t("theme")}: ${THEMES[theme].label}`, "info");
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

    window.addEventListener("hashchange", () => route(false));

    boot();
