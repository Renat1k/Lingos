// LINGUA/OS · Vocabulary Vault
"use strict";

    /* ---------- vocabulary vault ---------- */
    function normalizeVocabWord(raw, fallbackId) {
      if (!raw || typeof raw !== "object") return null;
      const word = String(raw.word || "").trim();
      const translation = String(raw.translation || "").trim();
      if (!word || !translation) return null;
      return {
        id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : fallbackId,
        word,
        translation,
        description: String(raw.description || "").trim(),
        tags: Array.isArray(raw.tags)
          ? [...new Set(raw.tags.map((tag) => String(tag).trim()).filter(Boolean))]
          : [],
        is_favorite: Boolean(raw.is_favorite),
        updated_at: String(raw.updated_at || "")
      };
    }

    function normalizeVocabularyList(list) {
      return (Array.isArray(list) ? list : [])
        .map((item, index) => normalizeVocabWord(item, index + 1))
        .filter(Boolean);
    }

    function loadVocabulary(baseVocabulary) {
      const stored = readJSON(vocabStorageKey(), null);
      const source = Array.isArray(stored) && stored.length
        ? stored
        : (Array.isArray(baseVocabulary) ? baseVocabulary : []);
      state.vocab = normalizeVocabularyList(source)
        .filter((word) => !isWordDeleted(state.language, word.id, word.updated_at));
      state.vocabTag = "all";
      state.vocabSearch = "";
    }

    function saveVocabulary() {
      writeJSON(vocabStorageKey(), state.vocab);
    }

    function getVocabTags() {
      const counts = new Map();
      state.vocab.forEach((word) => {
        word.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
    }

    function getFilteredVocabulary() {
      const query = state.vocabSearch.trim().toLocaleLowerCase();
      return state.vocab
        .filter((word) => {
          const matchesTag = state.vocabTag === "all"
            || (state.vocabTag === "__favorites" ? word.is_favorite : word.tags.includes(state.vocabTag));
          if (!matchesTag) return false;
          if (!query) return true;
          const haystack = [
            word.word,
            word.translation,
            word.description,
            ...word.tags
          ].join(" ").toLocaleLowerCase();
          return haystack.includes(query);
        })
        .sort((a, b) => {
          if (Boolean(b.is_favorite) !== Boolean(a.is_favorite)) return Number(b.is_favorite) - Number(a.is_favorite);
          return a.word.localeCompare(b.word, "tr");
        });
    }

    function nextVocabId() {
      return state.vocab.reduce((max, word) => Math.max(max, Number(word.id) || 0), 0) + 1;
    }

    function saveEditedWord(event) {
      event.preventDefault();
      const wordId = state.editingWordId;
      const word = state.vocab.find((item) => Number(item.id) === Number(wordId));
      if (!word) return;
      const nextWord = wordEditorWord.value.trim();
      const nextTranslation = wordEditorTranslation.value.trim();
      if (!nextWord || !nextTranslation) {
        showToast("Слово и перевод не могут быть пустыми.", "error");
        return;
      }
      word.word = nextWord;
      word.translation = nextTranslation;
      word.description = wordEditorDescription.value.trim();
      word.tags = [...new Set(wordEditorTags.value.split(",").map((tag) => tag.trim()).filter(Boolean))];
      word.is_favorite = wordEditorFavorite.checked;
      word.updated_at = new Date().toISOString();
      saveVocabulary();
      if (wordEditorModal.open) wordEditorModal.close();
      renderVocabTagChips();
      renderVocabResults();
      updateVocabStats();
      showToast("Слово обновлено.", "success");
    }

    function renderVocabCard(word) {
      return `
        <article class="vocab-item${word.is_favorite ? " is-favorite" : ""}" data-word-card="${Number(word.id)}" tabindex="0" role="button" aria-label="Редактировать слово ${escapeHtml(word.word)}">
          <div class="vocab-item-top">
            <h3 class="vocab-word">${escapeHtml(word.word)}</h3>
            <div class="vocab-item-actions">
              <button class="star-button${word.is_favorite ? " is-starred" : ""}" type="button" data-star-word="${Number(word.id)}" aria-label="${word.is_favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${escapeHtml(word.word)}" aria-pressed="${word.is_favorite ? "true" : "false"}">${word.is_favorite ? "★" : "☆"}</button>
              <button class="vocab-delete" type="button" data-delete-word="${Number(word.id)}" aria-label="${escapeHtml(t("delete_word"))}: ${escapeHtml(word.word)}">${icon("trash")}</button>
            </div>
          </div>
          <p class="vocab-translation">${escapeHtml(word.translation)}</p>
          ${word.description ? `<p class="vocab-description">${escapeHtml(word.description)}</p>` : ""}
          <div class="vocab-card-tags">
            ${word.tags.map((tag) => `<span class="vocab-card-tag">#${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="vocab-item-footer">
            <span class="vocab-card-state">${word.is_favorite ? "STARRED" : "IN VAULT"}</span>
            <span class="vocab-edit-hint">EDIT →</span>
          </div>
        </article>
      `;
    }

    function renderVocabTagChips() {
      const tags = getVocabTags();
      return `
        <button class="vocab-tag${state.vocabTag === "all" ? " is-active" : ""}" type="button" data-vocab-tag="all">${escapeHtml(t("all"))}</button>
        <button class="vocab-tag is-favorites${state.vocabTag === "__favorites" ? " is-active" : ""}" type="button" data-vocab-tag="__favorites">${escapeHtml(t("favorites"))}</button>
        ${tags.map(([tag, count]) => `<button class="vocab-tag${state.vocabTag === tag ? " is-active" : ""}" type="button" data-vocab-tag="${escapeHtml(tag)}">${escapeHtml(tag)} <span>${count}</span></button>`).join("")}
      `;
    }

    function renderVocabTagLines() {
      const total = state.vocab.length || 1;
      const tags = getVocabTags().slice(0, 4);
      if (!tags.length) return `<div class="course-line"><span class="course-line-label">Добавь первый тег</span><strong>—</strong></div>`;
      return tags.map(([tag, count]) => `
        <div class="course-line">
          <span class="course-line-label">${escapeHtml(tag)}</span>
          <strong>${count}</strong>
          <div class="course-line-track"><span style="width:${Math.min(100, (count / total) * 100)}%"></span></div>
        </div>
      `).join("");
    }

    function updateVocabStats() {
      const total = state.vocab.length;
      const favorites = state.vocab.filter((word) => word.is_favorite).length;
      const tags = getVocabTags();
      const favoritePercent = total ? Math.round((favorites / total) * 100) : 0;
      const setText = (id, value) => {
        const node = document.getElementById(id);
        if (node) node.textContent = value;
      };
      setText("vocabStatTotal", String(total));
      setText("vocabStatFavorites", String(favorites));
      setText("vocabStatTags", String(tags.length));
      setText("vocabFavoritePercent", `${favoritePercent}%`);
      setText("vocabConsoleTitle", `${total} ${t("words")}`);
      setText("vocabConsoleMeta", `${favorites} ${t("starred")} · ${tags.length} ${t("tags")}`);
      setText("vocabSwitchCount", String(total));
      const ring = document.getElementById("vocabFavoriteRing");
      if (ring) ring.style.setProperty("--p", favoritePercent);
      const tagLines = document.getElementById("vocabTagLines");
      if (tagLines) tagLines.innerHTML = renderVocabTagLines();
    }

    function renderVocabResults() {
      const list = document.getElementById("vocabList");
      if (!list) return;
      const filtered = getFilteredVocabulary();
      list.innerHTML = filtered.length
        ? filtered.map(renderVocabCard).join("")
        : `<div class="vocab-empty">Ничего не нашлось. Попробуй другой тег или добавь новое слово через импорт.<br><button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} Импортировать JSON</button></div>`;
      const count = document.getElementById("vocabResultCount");
      if (count) count.textContent = String(filtered.length);
      const tags = document.getElementById("vocabTags");
      if (tags) tags.innerHTML = renderVocabTagChips();
      updateVocabStats();
    }

    function openWordEditor(wordId) {
      const word = state.vocab.find((item) => Number(item.id) === Number(wordId));
      if (!word) return;
      state.lastFocus = document.activeElement;
      state.editingWordId = Number(word.id);
      wordEditorTitle.textContent = word.word;
      wordEditorWord.value = word.word;
      wordEditorTranslation.value = word.translation;
      wordEditorDescription.value = word.description;
      wordEditorTags.value = word.tags.join(", ");
      wordEditorFavorite.checked = Boolean(word.is_favorite);
      if (!wordEditorModal.open) {
        if (typeof wordEditorModal.showModal === "function") wordEditorModal.showModal();
        else wordEditorModal.setAttribute("open", "");
      }
      window.setTimeout(() => wordEditorTranslation.focus(), 80);
    }

    function toggleVocabFavorite(wordId) {
      const word = state.vocab.find((item) => Number(item.id) === Number(wordId));
      if (!word) return;
      word.is_favorite = !word.is_favorite;
      word.updated_at = new Date().toISOString();
      saveVocabulary();
      renderVocabResults();
      showToast(word.is_favorite ? "Добавлено в избранное. Слово закреплено сверху." : "Слово убрано из избранного.", word.is_favorite ? "success" : "info");
    }

    function deleteWordById(wordId) {
      const word = state.vocab.find((item) => Number(item.id) === Number(wordId));
      if (!word || !state.language) return;
      requestConfirmation({
        title: t("delete_word"),
        message: t("delete_word_message", { name: word.word }),
        confirmLabel: t("delete_confirm")
      }).then((confirmed) => {
        if (!confirmed) return;
        const language = state.language;
        const id = Number(word.id);
        state.vocab = state.vocab.filter((item) => Number(item.id) !== id);
        addTombstone("word", { language, id });
        saveVocabulary();
        if (wordEditorModal.open) wordEditorModal.close();
        renderVocabResults();
        updateVocabStats();
        showToast(t("word_deleted"), "success");
      });
    }

    function renderVocabularyHub() {
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "vocabulary";
      state.lesson = null;
      state.lessonId = null;
      state.story = null;
      state.storyId = null;
      state.activeBlock = 0;
      state.backTarget = "#vocabulary";

      const total = state.vocab.length;
      const favorites = state.vocab.filter((word) => word.is_favorite).length;
      const tags = getVocabTags();
      const favoritePercent = total ? Math.round((favorites / total) * 100) : 0;
      const filtered = getFilteredVocabulary();

      app.innerHTML = `
        <section class="vocab-hub" aria-labelledby="vocabTitle">
          <div class="dashboard-topline">
            ${renderSectionTabs("vocabulary")}
            ${renderLanguageSwitch()}
          </div>

          <div class="dashboard-hero">
            <div class="dashboard-copy">
              <div class="hero-eyebrow">
                <span class="eyebrow-dot" aria-hidden="true"></span>
                <span>${escapeHtml(languageLabel(currentLanguage()).toUpperCase())}_LEXICON // VAULT</span>
                <span class="eyebrow-sep" aria-hidden="true">/</span>
                <span class="eyebrow-level">${total} WORDS</span>
              </div>
              <h1 class="dashboard-title" id="vocabTitle">${escapeHtml(t("vocab_title_1"))}<br><span class="gradient-text">${escapeHtml(t("vocab_title_2"))}</span></h1>
              <p class="dashboard-subtitle">${escapeHtml(t("vocab_subtitle", { lang: languageLabel(currentLanguage()) }))}</p>
              <div class="dashboard-actions">
                <button class="btn btn-primary" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button>
                <button class="btn btn-secondary" type="button" data-export-vocab>${icon("download")} ${escapeHtml(t("download_vocab"))}</button>
              </div>
            </div>

            <div class="course-console" aria-label="Статус словаря">
              <div class="console-head">
                <span>LEXICON_STATUS</span>
                <span class="console-live"><i aria-hidden="true"></i> LOCAL</span>
              </div>
              <div class="console-body">
                <div class="course-summary">
                  <div class="course-ring" id="vocabFavoriteRing" style="--p:${favoritePercent}">
                    <div><strong id="vocabFavoritePercent">${favoritePercent}%</strong><span>STARRED</span></div>
                  </div>
                  <div class="course-summary-copy">
                    <span>LEXICON VAULT</span>
                    <strong id="vocabConsoleTitle">${total} ${escapeHtml(t("words"))}</strong>
                    <p id="vocabConsoleMeta">${favorites} ${escapeHtml(t("starred"))} · ${tags.length} ${escapeHtml(t("tags"))}</p>
                  </div>
                </div>
                <div class="course-lines" id="vocabTagLines">${renderVocabTagLines()}</div>
              </div>
              <div class="console-foot">
                <span>db: lexicon_${currentLanguage()}</span>
                <span>SYNCED</span>
              </div>
            </div>
          </div>

          <div class="dashboard-stats" aria-label="Статистика словаря">
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("vault")}</span><span class="stat-code">ENTRIES</span></div>
              <div><div class="stat-value" id="vocabStatTotal">${total}</div><span class="stat-label">${escapeHtml(t("words"))}</span></div>
            </div>
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">STARRED</span></div>
              <div><div class="stat-value"><span id="vocabStatFavorites">${favorites}</span><small>${escapeHtml(t("total"))} ${total}</small></div><span class="stat-label">${escapeHtml(t("starred"))}</span></div>
            </div>
            <div class="stat-card">
              <div class="stat-top"><span class="stat-icon">${icon("spark")}</span><span class="stat-code">TAGS</span></div>
              <div><div class="stat-value" id="vocabStatTags">${tags.length}</div><span class="stat-label">${escapeHtml(t("tags"))}</span></div>
            </div>
          </div>

          <section class="stories-section" aria-labelledby="vocabListTitle">
            <div class="stories-section-head">
              <div>
                <div class="modules-kicker">VOCABULARY / ${pad(total)}</div>
                <h2 id="vocabListTitle">${escapeHtml(t("vocab_section"))} · ${escapeHtml(languageLabel(currentLanguage()))}</h2>
                <p>${escapeHtml(t("vocab_subtitle", { lang: languageLabel(currentLanguage()) }))}</p>
              </div>
              <span class="stories-section-count">${favorites} ${escapeHtml(t("starred"))} · ${total} ${escapeHtml(t("total"))}</span>
            </div>

            <div class="vocab-toolbar">
              <label class="vocab-search">
                ${icon("search")}
                <input id="vocabSearchInput" type="search" value="${escapeHtml(state.vocabSearch)}" placeholder="${escapeHtml(t("search_placeholder"))}" autocomplete="off" aria-label="${escapeHtml(t("search_placeholder"))}" />
              </label>
              <div class="vocab-toolbar-actions">
                <button class="btn btn-secondary data-tool-btn" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import"))}</button>
                <button class="btn btn-quiet data-tool-btn" type="button" data-export-vocab>${icon("download")} ${escapeHtml(t("export"))}</button>
              </div>
            </div>
            <div class="vocab-tags" id="vocabTags">${renderVocabTagChips()}</div>
            <div class="vocab-results-head">
              <span><strong id="vocabResultCount">${filtered.length}</strong> ${escapeHtml(t("total"))}</span>
              <span>${escapeHtml(t("starred"))}</span>
            </div>
            <div class="vocab-grid" id="vocabList">
              ${filtered.length ? filtered.map(renderVocabCard).join("") : `<div class="vocab-empty">${escapeHtml(t("empty_vocab", { lang: languageLabel(currentLanguage()) }))}<br><button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`}
            </div>
          </section>
        </section>
      `;

      topbarContext.textContent = `lexicon / ${pad(total)} words`;
      progressValue.textContent = pad(favoritePercent);
      topProgressBar.style.width = `${favoritePercent}%`;
      backToLessons.hidden = true;
      backLabel.textContent = t("nav_vocabulary");
      updateSectionUI("vocabulary");
      syncLanguageUI();
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", `Избранное: ${favorites} из ${total}`);
      document.title = `LINGUA/OS — ${languageLabel(currentLanguage())} Vocabulary`;
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `lexicon / ${currentLanguage()} / ${total} words · v2.4`;
      scrollToTopInstant();
    }

    function downloadVocabulary() {
      const language = currentLanguage();
      const payload = {
        meta: {
          app: "LINGUA/OS",
          version: "2.4.0",
          exported_at: new Date().toISOString(),
          language
        },
        vocab: state.vocab
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `linguaos-${language}-vocabulary.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      showToast(`Словарь ${languageLabel(language)} выгружен · ${state.vocab.length} слов`, "success");
    }
