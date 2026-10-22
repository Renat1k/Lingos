// LINGUA/OS · Import JSON and import templates
"use strict";

    /* ---------- import / export ---------- */
    function sanitizeRichText(html) {
      try {
        const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        doc.querySelectorAll("script, iframe, object, embed, style, link, meta, form").forEach((node) => node.remove());
        doc.querySelectorAll("*").forEach((node) => {
          [...node.attributes].forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;
            if (name.startsWith("on") || (["href", "src"].includes(name) && /^\s*javascript:/i.test(value))) {
              node.removeAttribute(attribute.name);
            }
          });
        });
        return doc.body.innerHTML;
      } catch (error) {
        return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "");
      }
    }

    function normalizeGlossary(items) {
      return (Array.isArray(items) ? items : [])
        .map((item) => ({
          word: String(item?.word || "").trim(),
          translation: String(item?.translation || "").trim(),
          explanation: String(item?.explanation || "").trim()
        }))
        .filter((item) => item.word)
        .slice(0, 8);
    }

    function nextLessonId() {
      return state.lessons.reduce((max, lesson) => Math.max(max, Number(lesson.id) || 0), 0) + 1;
    }

    function nextStoryId() {
      return state.stories.reduce((max, story) => Math.max(max, Number(story.id) || 0), 0) + 1;
    }

    function normalizeImportedLesson(raw, fallbackId) {
      if (!raw || typeof raw !== "object") return null;
      const sourceBlocks = Array.isArray(raw.blocks)
        ? raw.blocks
        : Array.isArray(raw.content_blocks)
          ? raw.content_blocks
          : [];
      if (!sourceBlocks.length) return null;
      const blocks = sourceBlocks.map((block) => {
        if (!block || typeof block !== "object") return null;
        const clean = { ...block };
        if (clean.type === "reading_heavy" && typeof clean.text === "string") {
          clean.text = sanitizeRichText(clean.text);
          clean.glossary = normalizeGlossary(clean.glossary);
        }
        if (clean.type === "theory") {
          clean.key_phrases = (Array.isArray(clean.key_phrases) ? clean.key_phrases : [])
            .map((item) => ({
              original: String(item?.original || "").trim(),
              translation: String(item?.translation || "").trim(),
              note: String(item?.note || "").trim()
            }))
            .filter((item) => item.original || item.translation)
            .slice(0, 8);
          clean.fun_fact = String(clean.fun_fact || "").trim();
        }
        return clean;
      }).filter(Boolean);
      if (!blocks.length) return null;
      return {
        ...raw,
        id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : fallbackId,
        title: String(raw.title || "Imported lesson"),
        blocks
      };
    }

    function normalizeImportedStory(raw, fallbackId) {
      if (!raw || typeof raw !== "object" || !String(raw.text || "").trim()) return null;
      return {
        ...raw,
        id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : fallbackId,
        title: String(raw.title || "Imported story"),
        subtitle: String(raw.subtitle || ""),
        read_time: String(raw.read_time || "6 мин"),
        level: String(raw.level || "B1"),
        text: sanitizeRichText(raw.text),
        glossary: normalizeGlossary(raw.glossary)
      };
    }

    function addImportedVocabulary(items) {
      const language = state.language;
      const now = new Date().toISOString();
      const incoming = normalizeVocabularyList(items);
      let added = 0;
      let updated = 0;
      let invalid = 0;
      incoming.forEach((rawWord) => {
        const cleaned = cleanWordForSave(rawWord.word, language);
        if (!cleaned) {
          invalid += 1;
          return;
        }
        const word = {
          ...rawWord,
          word: cleaned,
          created_at: rawWord.created_at || now,
          updated_at: now
        };
        const key = wordKey(cleaned, language);
        const existing = state.vocab.find((item) => wordKey(item.word, language) === key);
        if (existing) {
          const cleanedExisting = cleanWordForSave(existing.word, language);
          if (cleanedExisting) existing.word = cleanedExisting;
          mergeWordData(existing, word);
          existing.updated_at = now;
          updated += 1;
          return;
        }
        const byId = state.vocab.find((item) => Number(item.id) === Number(word.id));
        if (byId) word.id = nextVocabId();
        state.vocab.push(word);
        added += 1;
      });
      if (added || updated) saveVocabulary();
      return { added, updated, invalid };
    }

    function addImportedLessons(items) {
      let added = 0;
      let updated = 0;
      const imported = new Map(state.importedLessons.map((lesson) => [Number(lesson.id), lesson]));
      items.forEach((raw, index) => {
        const lesson = normalizeImportedLesson(raw, nextLessonId() + index);
        if (!lesson) return;
        lesson.updated_at = new Date().toISOString();
        if (state.lessons.some((item) => Number(item.id) === Number(lesson.id))) updated += 1;
        else added += 1;
        imported.set(Number(lesson.id), lesson);
      });
      state.importedLessons = [...imported.values()];
      writeJSON(importedLessonsKey(), state.importedLessons);
      state.lessons = mergeById(state.languagePack?.lessons || [], state.importedLessons);
      return { added, updated };
    }

    function addImportedStories(items) {
      let added = 0;
      let updated = 0;
      const imported = new Map(state.importedStories.map((story) => [Number(story.id), story]));
      items.forEach((raw, index) => {
        const story = normalizeImportedStory(raw, nextStoryId() + index);
        if (!story) return;
        story.updated_at = new Date().toISOString();
        if (state.stories.some((item) => Number(item.id) === Number(story.id))) updated += 1;
        else added += 1;
        imported.set(Number(story.id), story);
      });
      state.importedStories = [...imported.values()];
      writeJSON(importedStoriesKey(), state.importedStories);
      state.stories = mergeById(state.languagePack?.stories || [], state.importedStories);
      return { added, updated };
    }

    function importPayload(payload) {
      if (!payload || typeof payload !== "object") throw new Error("JSON должен быть объектом или массивом.");

      const vocabItems = [];
      const lessonItems = [];
      const storyItems = [];
      const collect = (value, bucket) => {
        const values = Array.isArray(value) ? value : [value];
        values.forEach((item) => {
          if (item && typeof item === "object") bucket.push(item);
        });
      };

      if (Array.isArray(payload)) {
        payload.forEach((item) => {
          if (!item || typeof item !== "object") return;
          if (Array.isArray(item.blocks) || Array.isArray(item.content_blocks)) lessonItems.push(item);
          else if (item.text && item.title) storyItems.push(item);
          else if (item.word || item.translation) vocabItems.push(item);
        });
      } else {
        const explicitVocab = payload.turkish_vocab ?? payload.vocabulary ?? payload.vocab ?? payload.words;
        const explicitLessons = payload.lessons ?? payload.lesson;
        const explicitStories = payload.stories ?? payload.story;
        if (explicitVocab !== undefined) collect(explicitVocab, vocabItems);
        if (explicitLessons !== undefined) collect(explicitLessons, lessonItems);
        if (explicitStories !== undefined) collect(explicitStories, storyItems);

        if (explicitLessons === undefined && (Array.isArray(payload.blocks) || Array.isArray(payload.content_blocks))) {
          lessonItems.push(payload);
        }
        if (explicitStories === undefined && payload.text && payload.title
          && !Array.isArray(payload.blocks) && !Array.isArray(payload.content_blocks)) {
          storyItems.push(payload);
        }
        if (explicitVocab === undefined && (payload.word || payload.translation)) {
          vocabItems.push(payload);
        }
      }

      if (!vocabItems.length && !lessonItems.length && !storyItems.length) {
        throw new Error("Не найдено ни слов, ни уроков, ни историй. Используй ключи vocab, lessons или stories.");
      }

      const result = {
        vocabAdded: 0,
        vocabUpdated: 0,
        vocabInvalid: 0,
        lessonsAdded: 0,
        lessonsUpdated: 0,
        storiesAdded: 0,
        storiesUpdated: 0
      };

      if (vocabItems.length) {
        const vocabResult = addImportedVocabulary(vocabItems);
        result.vocabAdded = vocabResult.added;
        result.vocabUpdated = vocabResult.updated;
        result.vocabInvalid = vocabResult.invalid;
      }
      if (lessonItems.length) {
        const lessonResult = addImportedLessons(lessonItems);
        result.lessonsAdded = lessonResult.added;
        result.lessonsUpdated = lessonResult.updated;
      }
      if (storyItems.length) {
        const storyResult = addImportedStories(storyItems);
        result.storiesAdded = storyResult.added;
        result.storiesUpdated = storyResult.updated;
      }

      if (!result.vocabAdded && !result.vocabUpdated && !result.lessonsAdded && !result.lessonsUpdated && !result.storiesAdded && !result.storiesUpdated) {
        if (vocabItems.length && result.vocabInvalid) throw new Error(t("vocab_word_invalid"));
        throw new Error("JSON распознан, но элементы не прошли проверку. Проверь обязательные поля.");
      }
      return result;
    }

    function importTemplate(tab) {
      const template = IMPORT_TEMPLATES[tab] || IMPORT_TEMPLATES.vocab;
      return JSON.stringify(template, null, 2);
    }

    function defaultImportTab() {
      if (state.view === "stories") return "stories";
      if (state.view === "vocabulary") return "vocab";
      if (state.view === "lesson") return "lessons";
      if (!state.lessons.length) return "lessons";
      return "vocab";
    }

    function setImportTab(tab, preserveCurrent = true) {
      const nextTab = IMPORT_TEMPLATES[tab] ? tab : "vocab";
      if (preserveCurrent && state.importTab && state.importTab !== nextTab) {
        const previous = importText.value.trim();
        const previousTemplate = importTemplate(state.importTab).trim();
        if (previous && previous !== previousTemplate) state.importDrafts[state.importTab] = importText.value;
      }
      state.importTab = nextTab;
      const draft = Object.prototype.hasOwnProperty.call(state.importDrafts, nextTab)
        ? state.importDrafts[nextTab]
        : importTemplate(nextTab);
      importText.value = draft;
      importText.scrollTop = 0;
      importText.setSelectionRange(0, 0);
      document.querySelectorAll("[data-import-tab]").forEach((button) => {
        const active = button.dataset.importTab === nextTab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      importStatus.textContent = "";
      importStatus.className = "import-status";
    }

    function copyTextFallback(text) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      helper.style.pointerEvents = "none";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      return copied;
    }

    async function copyTextToClipboard(text) {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }
      if (!copyTextFallback(text)) throw new Error("Clipboard unavailable.");
    }

    async function copyTemplateVariant(kind) {
      const template = kind === "master" ? IMPORT_TEMPLATES.master : IMPORT_TEMPLATES.lessons;
      const text = JSON.stringify(template, null, 2);
      try {
        await copyTextToClipboard(text);
        const label = kind === "master" ? t("master_template") : t("simple_template");
        importStatus.textContent = `${t("copied")}: ${label}`;
        importStatus.className = "import-status is-success";
        showToast(`${t("copied")}: ${label}`, "success");
      } catch (error) {
        console.warn(error);
        importStatus.textContent = t("error");
        importStatus.className = "import-status is-error";
      }
    }

    function openImportModal() {
      state.lastFocus = document.activeElement;
      state.importTab = defaultImportTab();
      if (importLanguageLabel) importLanguageLabel.textContent = languageLabel(currentLanguage());
      setImportTab(state.importTab, false);
      if (!importModal.open) {
        if (typeof importModal.showModal === "function") importModal.showModal();
        else importModal.setAttribute("open", "");
      }
      window.setTimeout(() => {
        importText.scrollTop = 0;
        importText.setSelectionRange(0, 0);
        importText.focus({ preventScroll: true });
      }, 80);
    }

    function closeImportModal() {
      if (importModal.open && typeof importModal.close === "function") importModal.close();
      else importModal.removeAttribute("open");
    }

    function runImport() {
      const raw = importText.value.trim();
      if (!raw) {
        importStatus.textContent = "Вставь JSON перед импортом.";
        importStatus.className = "import-status is-error";
        return;
      }
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const payload = JSON.parse(cleaned);
        const result = importPayload(payload);
        const parts = [];
        if (result.vocabAdded || result.vocabUpdated) parts.push(`слов: +${result.vocabAdded}${result.vocabUpdated ? ` / обновлено ${result.vocabUpdated}` : ""}`);
        if (result.vocabUpdated) parts.push(t("vocab_merged"));
        if (result.vocabInvalid) parts.push(t("vocab_invalid_skipped", { n: result.vocabInvalid }));
        if (result.lessonsAdded || result.lessonsUpdated) parts.push(`уроков: +${result.lessonsAdded}${result.lessonsUpdated ? ` / обновлено ${result.lessonsUpdated}` : ""}`);
        if (result.storiesAdded || result.storiesUpdated) parts.push(`историй: +${result.storiesAdded}${result.storiesUpdated ? ` / обновлено ${result.storiesUpdated}` : ""}`);
        const message = `Импорт завершён · ${parts.join(" · ")}`;
        state.importDrafts = {};
        importStatus.textContent = message;
        importStatus.className = "import-status is-success";
        closeImportModal();
        rerenderCurrentView();
        showToast(message, "success");
      } catch (error) {
        importStatus.textContent = `Не удалось импортировать: ${error.message}`;
        importStatus.className = "import-status is-error";
      }
    }
