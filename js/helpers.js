// LINGUA/OS · shared rendering and formatting helpers
"use strict";

    /* ---------- helpers ---------- */
    const pad = (value) => String(value).padStart(2, "0");

    function escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function icon(name, className) {
      return `<svg class="${className || "icon"}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
    }

    function countWords(text) {
      const matches = String(text || "").match(/[A-Za-zА-Яа-яЁё0-9]+(?:[’'][A-Za-zА-Яа-яЁё]+)?/g);
      return matches ? matches.length : 0;
    }

    function pluralRu(value, one, few, many) {
      const absolute = Math.abs(Number(value) || 0);
      const lastTwo = absolute % 100;
      const last = absolute % 10;
      if (lastTwo > 10 && lastTwo < 20) return many;
      if (last === 1) return one;
      if (last >= 2 && last <= 4) return few;
      return many;
    }

    function scrollToTopInstant() {
      const root = document.documentElement;
      const previousBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      try {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      } catch (error) {
        window.scrollTo(0, 0);
      }
      window.setTimeout(() => {
        root.style.scrollBehavior = previousBehavior;
      }, 60);
    }

    function formatSavedAt(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "только что";
      return new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date).replace(" г.", "");
    }

    function showToast(message, type) {
      window.clearTimeout(state.toastTimer);
      toast.textContent = message;
      toast.dataset.type = type || "success";
      toast.classList.add("is-visible");
      state.toastTimer = window.setTimeout(() => {
        toast.classList.remove("is-visible");
      }, 3400);
    }

    function languageLabel(language) {
      if (!language) return t("no_active_courses");
      return state.languagePacks?.[language]?.label || LANGUAGE_META[language]?.label || "English";
    }

    function flagEmoji(code) {
      const normalized = String(code || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(normalized)) return "";
      return String.fromCodePoint(...[...normalized].map((char) => 127397 + char.charCodeAt(0)));
    }

    function flagDisplayName(option) {
      const uiLanguage = UI_LANGUAGES[state.settings.uiLanguage] ? state.settings.uiLanguage : "ru";
      if (typeof Intl.DisplayNames !== "function") return `${option.lang.toUpperCase()} · ${option.code}`;
      try {
        const region = new Intl.DisplayNames([uiLanguage], { type: "region" });
        const language = new Intl.DisplayNames([uiLanguage], { type: "language" });
        const countryName = region.of(option.code) || option.code;
        const languageName = language.of(option.lang) || option.lang.toUpperCase();
        return `${languageName} · ${countryName}`;
      } catch (error) {
        return `${option.lang.toUpperCase()} · ${option.code}`;
      }
    }

    function flagNativeName(option) {
      if (typeof Intl.DisplayNames !== "function") return option.lang;
      try {
        return new Intl.DisplayNames([option.lang], { type: "language" }).of(option.lang) || option.lang;
      } catch (error) {
        return option.lang;
      }
    }

    function resolveFlagEntity(language) {
      if (language && typeof language === "object") return language;
      const code = String(language || "");
      return state.languagePacks?.[code] || LANGUAGE_META[code] || {
        code,
        label: code,
        flag: code.slice(0, 3).toUpperCase()
      };
    }

    function renderFlag(language) {
      const entity = resolveFlagEntity(language);
      const flagCode = String(entity.flagCode || "").toUpperCase();
      const label = String(entity.label || entity.native || entity.code || "");
      const legacy = String(entity.flag || "").trim();
      if (/^[A-Z]{2}$/.test(flagCode)) {
        const languageCode = String(entity.code || "").toUpperCase();
        const fallback = languageCode && languageCode.length <= 3 ? languageCode : flagCode;
        return `<span class="flag-mark" title="${escapeHtml(label || flagCode)}">
          <img class="flag-img" src="https://flagcdn.com/w80/${flagCode.toLowerCase()}.png" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.hidden=false" />
          <span class="flag-fallback" hidden>${escapeHtml(fallback)}</span>
        </span>`;
      }
      const fallback = legacy || String(entity.code || "").slice(0, 3).toUpperCase() || "🌐";
      return `<span class="flag-mark is-legacy" title="${escapeHtml(label || fallback)}">${escapeHtml(fallback)}</span>`;
    }

