// LINGUA/OS · stories, reading, translation panel
"use strict";

    /* ---------- stories ---------- */
    let showHiddenStories = false;

    function getHiddenContent() {
      const stored = readJSON(HIDDEN_CONTENT_KEY, null);
      const source = stored && typeof stored === "object" ? stored : {};
      return {
        lessons: source.lessons && typeof source.lessons === "object" ? source.lessons : {},
        stories: source.stories && typeof source.stories === "object" ? source.stories : {},
        updated_at: String(source.updated_at || "")
      };
    }

    function hiddenBucketKey(type) {
      return type === "story" ? "stories" : "lessons";
    }

    function isContentHidden(type, id) {
      if (type !== "lesson" && type !== "story") return false;
      const bucket = getHiddenContent()[hiddenBucketKey(type)];
      return Boolean(bucket && bucket[String(id)]);
    }

    function setContentHidden(type, id, hidden) {
      if (type !== "lesson" && type !== "story") return false;
      const content = getHiddenContent();
      const bucket = content[hiddenBucketKey(type)];
      if (hidden) bucket[String(id)] = true;
      else delete bucket[String(id)];
      content.updated_at = new Date().toISOString();
      return writeJSON(HIDDEN_CONTENT_KEY, content);
    }

    function isContentDeleted(type, id) {
      return Boolean(findTombstone(type, { language: state.language, id: String(id) }));
    }

    function applyHiddenFlags(type, items) {
      const bucket = getHiddenContent()[hiddenBucketKey(type)] || {};
      (Array.isArray(items) ? items : []).forEach((item) => {
        item.is_hidden = Boolean(bucket[String(item.id)]);
      });
      return items;
    }

    function storyReadKey(storyId) {
      return languageKey(`story_read_${storyId}`);
    }

    function isStoryRead(storyId) {
      const stored = readJSON(storyReadKey(storyId), null);
      return Boolean(stored && stored.read);
    }

    function setStoryRead(storyId, read) {
      if (read) {
        writeJSON(storyReadKey(storyId), { read: true, readAt: new Date().toISOString() });
      } else {
        removeStored(storyReadKey(storyId));
      }
    }

    function stripMarkup(html) {
      return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    function getStoryWordCount(text) {
      const clean = stripMarkup(text);
      return clean ? clean.split(/\s+/).filter(Boolean).length : 0;
    }

    function getStoryVocabularyCount(text) {
      const matches = String(text || "").match(/class=["']vocab["']/g);
      return matches ? matches.length : 0;
    }

    function getVisibleStories() {
      return applyHiddenFlags("story", state.stories.filter((story) => !isContentDeleted("story", story.id)))
        .filter((story) => showHiddenStories || !story.is_hidden);
    }

    function getHiddenStoryCount() {
      return state.stories.filter((story) => isContentHidden("story", story.id) && !isContentDeleted("story", story.id)).length;
    }

    function storyActionMarkup(story) {
      const imported = state.importedStories.some((item) => Number(item.id) === Number(story.id));
      if (imported) {
        return `<button class="content-action is-danger" type="button" data-delete-story="${Number(story.id)}" data-i18n-aria="delete_item" aria-label="${escapeHtml(t("delete_item"))}">${icon("trash")}</button>`;
      }
      return story.is_hidden
        ? `<button class="content-action" type="button" data-show-story="${Number(story.id)}" data-i18n-aria="show_item" aria-label="${escapeHtml(t("show_item"))}">👁</button>`
        : `<button class="content-action" type="button" data-hide-story="${Number(story.id)}" data-i18n-aria="hide_item" aria-label="${escapeHtml(t("hide_item"))}">🙈</button>`;
    }

    function getStoriesStats() {
      const cards = getVisibleStories().map((story) => ({
        story,
        read: isStoryRead(story.id),
        words: getStoryWordCount(story.text),
        vocab: getStoryVocabularyCount(story.text),
        minutes: Number.parseInt(story.read_time, 10) || 0
      }));
      const readCount = cards.filter((card) => card.read).length;
      return {
        cards,
        readCount,
        total: cards.length,
        hidden: getHiddenStoryCount(),
        totalMinutes: cards.reduce((sum, card) => sum + card.minutes, 0),
        percent: cards.length ? Math.round((readCount / cards.length) * 100) : 0
      };
    }

    function renderStoryCard(item, index) {
      const { story, read, words, vocab } = item;
      return `
        <article class="story-card${read ? " is-read" : ""}" style="--i:${index}" aria-labelledby="story-card-title-${story.id}">
          <div class="story-spine" aria-hidden="true">
            <div class="story-spine-top">
              <span>STORY_${pad(story.id)}</span>
              <span>${escapeHtml(story.level || "B1")}</span>
            </div>
            <div class="story-number">${pad(story.id)}</div>
            <div class="story-spine-bottom">
              <span>${escapeHtml(story.read_time || "6 мин")}</span>
              <span class="story-status">${read ? "READ" : "UNREAD"}</span>
            </div>
          </div>
          <div class="story-content">
            <div class="story-meta-row">
              <span class="story-chip">FREE READING</span>
              <span class="story-chip">${escapeHtml(story.level || "B1")}</span>
              ${read ? `<span class="story-chip is-read">${escapeHtml(t("read").toUpperCase())}</span>` : ""}
              <span class="story-chip">${vocab} ${escapeHtml(t("words"))}</span>
              ${storyActionMarkup(story)}
            </div>
            <h2 id="story-card-title-${story.id}">${escapeHtml(story.title || "Story")}</h2>
            <p class="story-card-subtitle">${escapeHtml(story.subtitle || "")}</p>
            <div class="story-card-footer">
              <div class="story-card-stats">
                <span>${icon("clock")} ${escapeHtml(story.read_time || "6 мин")}</span>
                <span>${icon("book")} ${words} ${escapeHtml(t("words"))}</span>
              </div>
              <a class="btn btn-primary story-open" href="#story-${Number(story.id)}">
                ${escapeHtml(t("read"))} ${icon("arrow-right")}
              </a>
            </div>
          </div>
        </article>
      `;
    }

    function renderStoriesHub() {
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "stories";
      state.lesson = null;
      state.lessonId = null;
      state.story = null;
      state.storyId = null;
      state.activeBlock = 0;
      state.backTarget = "#stories";

      const stats = getStoriesStats();
      app.innerHTML = `
        <section class="stories-hub" aria-labelledby="storiesTitle">
          ${renderSectionTabs("stories")}

          <div class="dashboard-hero">
            <div class="dashboard-copy">
              <div class="hero-eyebrow">
                <span class="eyebrow-dot" aria-hidden="true"></span>
                <span>FREE_READING // LIBRARY</span>
                <span class="eyebrow-sep" aria-hidden="true">/</span>
                <span class="eyebrow-level">${stats.total} STORIES</span>
              </div>
              <h1 class="dashboard-title" id="storiesTitle">${escapeHtml(t("stories_title_1"))}<br><span class="gradient-text">${escapeHtml(t("stories_title_2"))}</span></h1>
              <p class="dashboard-subtitle">${escapeHtml(t("stories_subtitle"))}</p>
              <div class="dashboard-actions">
                <button class="btn btn-secondary" type="button" data-section-link="course">← ${escapeHtml(t("nav_course"))}</button>
                <button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button>
              </div>
            </div>

            <div class="course-console" aria-label="Статус библиотеки">
              <div class="console-head">
                <span>LIBRARY_STATUS</span>
                <span class="console-live"><i aria-hidden="true"></i> LOCAL</span>
              </div>
              <div class="console-body">
                <div class="course-summary">
                  <div class="course-ring" style="--p:${stats.percent}">
                    <div><strong>${stats.percent}%</strong><span>READ</span></div>
                  </div>
                  <div class="course-summary-copy">
                    <span>READING HUB</span>
                    <strong>${stats.readCount === 0 ? "Ready to wander" : stats.readCount >= stats.total ? "Library complete" : "In the middle of a story"}</strong>
                    <p>${stats.readCount}/${stats.total} историй · ${stats.totalMinutes} минут чтения</p>
                  </div>
                </div>
                <div class="course-lines">
                  ${stats.cards.map((item, index) => `
                    <div class="course-line">
                      <span class="course-line-label"><span>${pad(index + 1)}</span>${escapeHtml(item.story.title)}</span>
                      <strong>${item.read ? "100" : "0"}%</strong>
                      <div class="course-line-track"><span style="width:${item.read ? 100 : 0}%"></span></div>
                    </div>
                  `).join("")}
                </div>
              </div>
              <div class="console-foot">
                <span>db: reading_progress</span>
                <span>SYNCED</span>
              </div>
            </div>
          </div>

          <div class="dashboard-stats" aria-label="Статистика чтения">
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("book")}</span><span class="stat-code">LIBRARY</span></div>
              <div><div class="stat-value">${stats.total}</div><span class="stat-label">историй в библиотеке</span></div>
            </div>
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">FINISHED</span></div>
              <div><div class="stat-value">${stats.readCount}<small>из ${stats.total}</small></div><span class="stat-label">прочитано</span></div>
            </div>
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("clock")}</span><span class="stat-code">MINUTES</span></div>
              <div><div class="stat-value">${stats.totalMinutes}<small>мин</small></div><span class="stat-label">доступного чтения</span></div>
            </div>
          </div>

          <section class="stories-section" aria-labelledby="storyListTitle">
            <div class="stories-section-head">
              <div>
                <div class="modules-kicker">STORIES / ${pad(stats.total)}</div>
                <h2 id="storyListTitle">${escapeHtml(t("stories_section"))}</h2>
                <p>${escapeHtml(t("stories_subtitle"))}</p>
              </div>
              <div class="stories-section-tools">
                <span class="stories-section-count">${stats.readCount} ${escapeHtml(t("read"))} · ${stats.total} ${escapeHtml(t("total"))}</span>
                ${stats.hidden || showHiddenStories ? `<button class="btn btn-quiet content-hidden-toggle" type="button" data-toggle-hidden-stories>${showHiddenStories ? escapeHtml(t("hidden_hide")) : escapeHtml(t("hidden_show", { n: stats.hidden }))}</button>` : ""}
              </div>
            </div>
            <div class="story-list">
              ${stats.cards.length ? stats.cards.map(renderStoryCard).join("") : `<div class="stories-empty"><strong>${escapeHtml(t("stories_empty_title", { lang: languageLabel(currentLanguage()) }))}</strong><br>${escapeHtml(t("stories_empty_body"))}<br><button class="btn btn-primary" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`}
            </div>
          </section>
        </section>
      `;

      topbarContext.textContent = `library / ${pad(stats.total)} stories`;
      progressValue.textContent = pad(stats.percent);
      topProgressBar.style.width = `${stats.percent}%`;
      backToLessons.hidden = true;
      backLabel.textContent = t("nav_stories");
      updateSectionUI("stories");
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", `Прочитано ${stats.readCount} из ${stats.total} историй`);
      document.title = "LINGUA/OS — Stories";
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `library / ${stats.total} stories · v2.7`;
      scrollToTopInstant();
    }

    function deleteImportedStory(storyId) {
      const story = state.importedStories.find((item) => Number(item.id) === Number(storyId));
      if (!story) return;
      state.importedStories = state.importedStories.filter((item) => Number(item.id) !== Number(storyId));
      writeJSON(importedStoriesKey(), state.importedStories);
      state.stories = mergeById(state.languagePack?.stories || [], state.importedStories);
      addTombstone("story", { id: String(storyId), language: state.language });
      showToast(t("story_deleted"), "success");
      renderStoriesHub();
    }

    function hideStory(storyId) {
      setContentHidden("story", storyId, true);
      showHiddenStories = false;
      showToast(t("story_hidden"), "info");
      renderStoriesHub();
    }

    function showStory(storyId) {
      setContentHidden("story", storyId, false);
      showToast(t("story_shown"), "info");
      renderStoriesHub();
    }

    document.addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-story]");
      if (deleteButton) {
        event.preventDefault();
        const story = state.stories.find((item) => Number(item.id) === Number(deleteButton.dataset.deleteStory));
        const message = t("delete_story_message", { name: story?.title || "" });
        requestConfirmation({
          title: t("delete_story_title"),
          message,
          confirmLabel: t("delete_item")
        }).then((confirmed) => {
          if (confirmed) deleteImportedStory(deleteButton.dataset.deleteStory);
        });
        return;
      }
      const hideButton = event.target.closest("[data-hide-story]");
      if (hideButton) {
        event.preventDefault();
        hideStory(hideButton.dataset.hideStory);
        return;
      }
      const showButton = event.target.closest("[data-show-story]");
      if (showButton) {
        event.preventDefault();
        showStory(showButton.dataset.showStory);
        return;
      }
      if (event.target.closest("[data-toggle-hidden-stories]")) {
        event.preventDefault();
        showHiddenStories = !showHiddenStories;
        renderStoriesHub();
      }
    });

    function renderStory(story) {
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "story";
      state.lesson = null;
      state.lessonId = null;
      state.story = story;
      state.storyId = Number(story.id);
      state.activeBlock = 0;
      state.backTarget = "#stories";

      const read = isStoryRead(story.id);
      const words = getStoryWordCount(story.text);
      const vocab = getStoryVocabularyCount(story.text);
      const nextStory = getVisibleStories().find((item) => Number(item.id) !== Number(story.id));

      app.innerHTML = `
        <article class="story-reader" aria-labelledby="storyTitle">
          <header class="story-reader-hero">
            <div class="story-reader-kicker">
              <span>STORY_${pad(story.id)}</span>
              <span>/</span>
              <span>FREE READING</span>
              <span>·</span>
              <span>${escapeHtml(story.level || "B1")}</span>
            </div>
            <h1 id="storyTitle">${escapeHtml(story.title || "Story")}</h1>
            <p class="story-reader-subtitle">${escapeHtml(story.subtitle || "")}</p>
            <div class="story-reader-meta">
              <span class="story-meta-chip">${icon("clock")} ${escapeHtml(story.read_time || "6 мин")}</span>
              <span class="story-meta-chip">${icon("book")} ${words} ${pluralRu(words, "слово", "слова", "слов")}</span>
              <span class="story-meta-chip">${vocab} ${pluralRu(vocab, "слово", "слова", "слов")} в глоссарии</span>
              <span class="story-meta-chip${read ? " is-read" : ""}" data-story-read-state>${read ? `${icon("check")} Прочитано` : "Не прочитано"}</span>
            </div>
          </header>

          <div class="card reading-card story-text-card">
            <div class="story-reader-toolbar">
              <span class="reading-length">${icon("clock")} ${escapeHtml(story.read_time || "6 мин")} чтения</span>
              <span class="glossary-pill"><span class="dot" aria-hidden="true"></span><strong data-vocab-count>0 / ${vocab}</strong> слов открыто</span>
            </div>
            <div class="reading-prose story-prose">${story.text || ""}</div>
            <div class="story-read-footer">
              <button class="btn btn-save story-read-button${read ? " is-read" : ""}" type="button" data-mark-story data-story-id="${Number(story.id)}" aria-pressed="${read ? "true" : "false"}">
                ${read ? `${icon("check")} Прочитано` : `${icon("book")} Отметить прочитанным`}
              </button>
              <span class="story-read-note">${icon("shield")} Статус чтения хранится только в этом браузере</span>
            </div>
          </div>

          ${nextStory ? `
            <div class="story-reader-meta" style="margin-top:24px">
              <a class="btn btn-secondary" href="#story-${Number(nextStory.id)}">Следующая история: ${escapeHtml(nextStory.title)} ${icon("arrow-right")}</a>
            </div>
          ` : ""}
        </article>
      `;

      topbarContext.textContent = `story_${pad(story.id)} / reading`;
      progressValue.textContent = "00";
      topProgressBar.style.width = "0%";
      backToLessons.hidden = false;
      backLabel.textContent = t("nav_stories");
      backToLessons.setAttribute("aria-label", "Вернуться к историям");
      updateSectionUI("stories");
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", "Глубина прочтения истории");
      document.title = `LINGUA/OS — ${story.title || "Story"}`;
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `story_${pad(story.id)} / ${story.read_time || "reading"}`;

      enhanceVocabulary();
      state.scrollCleanup = setupScrollTracking();
      scrollToTopInstant();
    }

    /* ---------- vocabulary ---------- */
    function vocabularyKey(word) {
      return String(word || "").trim().toLowerCase();
    }

    function discoveredKey(lessonId) {
      return languageKey(`discovered_lesson_${lessonId}`);
    }

    function activeDiscoveryKey() {
      if (state.view === "story" && state.story) {
        return languageKey(`discovered_story_${state.story.id}`);
      }
      if (state.view === "lesson" && state.lesson) return discoveredKey(state.lesson.id);
      return null;
    }

    function getContextSentence(element) {
      const paragraph = element.closest("p, li, blockquote");
      const fullText = (paragraph ? paragraph.textContent : element.parentElement?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!fullText) return "";
      const word = element.textContent.trim();
      const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullText];
      const sentence = sentences.find((item) => item.toLowerCase().includes(word.toLowerCase())) || fullText;
      const clean = sentence.trim();
      return clean.length > 230 ? `${clean.slice(0, 227)}…` : clean;
    }

    function openTranslation(element) {
      const word = element.textContent.trim();
      const meaning = element.dataset.translation || "Перевод не указан";
      translationWord.textContent = word;
      translationPos.textContent = element.dataset.pos || "слово из текста";
      translationMeaning.textContent = meaning;
      translationContext.textContent = getContextSentence(element);
      translationPanel.classList.add("is-open");
      translationPanel.setAttribute("aria-hidden", "false");
      if (window.matchMedia("(max-width: 700px)").matches) {
        translationPanel.scrollTop = 0;
        const rect = element.getBoundingClientRect();
        const targetTop = Math.max(104, window.innerHeight * 0.24);
        window.scrollBy({ top: rect.top - targetTop, behavior: "smooth" });
      }

      const key = vocabularyKey(word);
      if (!state.discovered.has(key)) {
        state.discovered.add(key);
        element.classList.add("is-found");
        const discoveryKey = activeDiscoveryKey();
        if (discoveryKey) writeJSON(discoveryKey, [...state.discovered]);
        updateVocabularyCounters();
      }
    }

    function closeTranslation() {
      translationPanel.classList.remove("is-open");
      translationPanel.setAttribute("aria-hidden", "true");
    }

    function updateVocabularyCounters() {
      const total = document.querySelectorAll(".vocab").length;
      const found = document.querySelectorAll(".vocab.is-found").length;
      document.querySelectorAll("[data-vocab-count]").forEach((node) => {
        node.textContent = `${found} / ${total}`;
      });
      const tocCount = document.getElementById("tocVocabCount");
      if (tocCount) tocCount.textContent = `${found} / ${total}`;
      const mobileTocCount = document.getElementById("mobileTocVocabCount");
      if (mobileTocCount) mobileTocCount.textContent = `${found} / ${total} ${t("words")}`;
    }

    function enhanceVocabulary() {
      const discoveryKey = activeDiscoveryKey();
      const stored = discoveryKey ? readJSON(discoveryKey, []) : [];
      state.discovered = new Set(Array.isArray(stored) ? stored : []);

      document.querySelectorAll(".vocab").forEach((element) => {
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-haspopup", "dialog");
        element.setAttribute("aria-label", `${element.textContent.trim()}: ${element.dataset.translation || "перевод"}. Показать перевод.`);
        if (state.discovered.has(vocabularyKey(element.textContent))) {
          element.classList.add("is-found");
        }
      });

      updateVocabularyCounters();
    }
