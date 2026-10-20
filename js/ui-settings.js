// LINGUA/OS · settings modal, translations, reset
"use strict";

    function applyStaticTranslations() {
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage] ? state.settings.uiLanguage : "ru";
      document.documentElement.lang = uiLanguage;
      document.querySelectorAll("[data-i18n]").forEach((element) => {
        element.textContent = t(element.dataset.i18n);
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
        element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
      });
      document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
        element.setAttribute("aria-label", t(element.dataset.i18nAria));
      });
      document.querySelectorAll("[data-ui-language]").forEach((button) => {
        const active = button.dataset.uiLanguage === uiLanguage;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (geminiToggle) {
        geminiToggle.setAttribute("aria-label", t(geminiKeyInput?.type === "password" ? "show" : "hide"));
      }
    }

    function syncSettingsUI() {
      document.querySelectorAll("[data-font-setting]").forEach((button) => {
        const active = button.dataset.fontSetting === state.settings.font;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll("[data-theme-setting]").forEach((button) => {
        const active = button.dataset.themeSetting === state.settings.theme;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      syncLanguageUI();
    }

    function applySettings() {
      const theme = THEME_IDS.includes(state.settings.theme) ? state.settings.theme : "glass";
      document.documentElement.dataset.theme = theme;
      document.body.classList.toggle("font-large", state.settings.font === "large");
      applyStaticTranslations();
      syncSettingsUI();
      updateProfileUI();
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
        if (background) themeMeta.setAttribute("content", background);
      }
    }

    /* ---------- settings / reset ---------- */
    let resetConfirmTimer = null;

    function setResetConfirmation(show) {
      window.clearTimeout(resetConfirmTimer);
      resetActions.hidden = show;
      resetConfirm.hidden = !show;
      if (show) {
        resetConfirmTimer = window.setTimeout(() => setResetConfirmation(false), 6000);
      }
    }

    function openSettings() {
      state.lastFocus = document.activeElement;
      closeTranslation();
      if (geminiKeyInput) {
        geminiKeyInput.value = state.geminiKey || "";
        geminiKeyInput.type = "password";
      }
      if (geminiToggle) geminiToggle.textContent = "👁";
      setGeminiStatus("");
      syncSettingsUI();
      setResetConfirmation(false);
      if (!settingsModal.open) {
        if (typeof settingsModal.showModal === "function") settingsModal.showModal();
        else settingsModal.setAttribute("open", "");
      }
    }

    function closeSettings() {
      if (settingsModal.open && typeof settingsModal.close === "function") {
        settingsModal.close();
      } else {
        settingsModal.removeAttribute("open");
        if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
      }
      setResetConfirmation(false);
    }

    function resetAllProgress() {
      const keepExact = new Set([UI_SETTINGS_KEY, PROFILE_KEY, GEMINI_KEY_STORAGE, CUSTOM_LANGUAGES_KEY, DELETED_KEY]);
      const contentPattern = /^lingua_[a-z0-9-]+_(vocab|imported_lessons|imported_stories)$/;
      try {
        const keys = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (!key || keepExact.has(key) || contentPattern.test(key)) continue;
          if (key.startsWith("lingua_")) keys.push(key);
        }
        keys.forEach((key) => window.localStorage.removeItem(key));
      } catch (error) {
        console.warn("Could not clear progress.", error);
      }

      const currentLesson = state.lesson;
      const currentStory = state.story;
      closeSettings();
      if (!activeLanguageCodes().length) renderNoActiveCourses();
      else if (state.view === "lesson" && currentLesson) renderLesson(currentLesson);
      else if (state.view === "story" && currentStory) renderStory(currentStory);
      else if (state.view === "stories") renderStoriesHub();
      else if (state.view === "vocabulary") renderVocabularyHub();
      else renderDashboard();
      showToast("Прогресс текущего и других языков сброшен. Импортированные материалы и настройки сохранены.", "info");
    }
