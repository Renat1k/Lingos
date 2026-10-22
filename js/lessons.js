// LINGUA/OS · dashboard, lessons, block renderers, practice, quizzes
"use strict";

    function getLessonBlocks(lesson) {
      if (!lesson) return [];
      if (Array.isArray(lesson.blocks)) return lesson.blocks;
      if (Array.isArray(lesson.content_blocks)) return lesson.content_blocks;
      return [];
    }

    function getLessonDiscovered(lessonId) {
      const stored = readJSON(discoveredKey(lessonId), []);
      return Array.isArray(stored) ? stored : [];
    }

    function lessonDurationLabel(lesson, blocks) {
      if (String(lesson?.duration || "").trim()) return lesson.duration;
      const readingWords = (blocks || []).filter((block) => block.type === "reading_heavy")
        .reduce((sum, block) => sum + countWords(String(block.text || "").replace(/<[^>]+>/g, " ")), 0);
      const minutes = Math.max(5, Math.round((blocks || []).length * ESTIMATED_MINUTES_PER_BLOCK + readingWords / ESTIMATED_WORDS_PER_MINUTE));
      return `${minutes} ${t("minutes")}`;
    }

    function readingLengthLabel(block) {
      if (String(block?.word_count_label || "").trim()) return block.word_count_label;
      const words = countWords(String(block?.text || "").replace(/<[^>]+>/g, " "));
      return `${words} ${t("words")}`;
    }

    function getLessonVocabulary(lesson) {
      const words = new Set();
      getLessonBlocks(lesson).forEach((block) => {
        if (block.type !== "reading_heavy") return;
        const pattern = /<span[^>]*class=["']vocab["'][^>]*>([\s\S]*?)<\/span>/gi;
        let match = pattern.exec(block.text || "");
        while (match) {
          const word = vocabularyKey(String(match[1] || "").replace(/<[^>]+>/g, ""));
          if (word) words.add(word);
          match = pattern.exec(block.text || "");
        }
      });
      return [...words];
    }

    function getLessonMetrics(lesson) {
      const blocks = getLessonBlocks(lesson);
      const vocabulary = getLessonVocabulary(lesson);
      const discovered = new Set(getLessonDiscovered(lesson.id));
      const learnedWords = vocabulary.filter((word) => discovered.has(word)).length;
      let quizTotal = 0;
      let quizCorrect = 0;
      let quizCompleted = 0;
      let quizBlocksTotal = 0;
      let writingTotal = 0;
      let writingSaved = 0;

      blocks.forEach((block, index) => {
        if (block.type === "quiz") {
          quizBlocksTotal += 1;
          const questions = Array.isArray(block.questions) ? block.questions : [];
          quizTotal += questions.length;
          const result = readJSON(getQuizKey(lesson.id, index), null);
          if (result && typeof result === "object") {
            const answers = result.answers && typeof result.answers === "object" ? result.answers : {};
            let answered = 0;
            questions.forEach((question, questionIndex) => {
              if (Object.prototype.hasOwnProperty.call(answers, questionIndex)) {
                answered += 1;
                if (Number(answers[questionIndex]) === Number(question.correct)) quizCorrect += 1;
              }
            });
            if (questions.length && answered >= questions.length) quizCompleted += 1;
          }
        }

        if (block.type === "practice_write") {
          writingTotal += 1;
          const saved = readJSON(getWritingKey(lesson.id, index), null);
          if (saved && typeof saved.text === "string" && saved.text.trim()) writingSaved += 1;
        }
      });

      const components = [];
      if (vocabulary.length) {
        components.push({ value: learnedWords / vocabulary.length, weight: 35 });
      }
      if (quizTotal) {
        components.push({ value: quizCorrect / quizTotal, weight: 40 });
      }
      if (writingTotal) {
        components.push({ value: writingSaved / writingTotal, weight: 25 });
      }
      const weightSum = components.reduce((sum, item) => sum + item.weight, 0);
      const percent = weightSum
        ? Math.round(components.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum * 100)
        : 0;

      return {
        percent: Math.max(0, Math.min(100, percent)),
        words: learnedWords,
        vocabTotal: vocabulary.length,
        quizCompleted,
        quizBlocksTotal,
        quizTotal,
        quizCorrect,
        writingSaved,
        writingTotal
      };
    }

    let showHiddenLessons = false;
    let coursePanel = "lessons";
    let errorQuizState = null;

    function getVisibleLessons() {
      return applyHiddenFlags("lesson", state.lessons.filter((lesson) => !isContentDeleted("lesson", lesson.id, lesson.updated_at)))
        .filter((lesson) => showHiddenLessons || !lesson.is_hidden);
    }

    function getHiddenLessonCount() {
      return state.lessons.filter((lesson) => isContentHidden("lesson", lesson.id, !isImportedCourseItem("lesson", lesson.id)) && !isContentDeleted("lesson", lesson.id, lesson.updated_at)).length;
    }

    function lessonActionMarkup(lesson) {
      const imported = state.importedLessons.some((item) => Number(item.id) === Number(lesson.id));
      const hidden = isContentHidden("lesson", lesson.id, !imported);
      const eye = hidden
        ? `<button class="content-action" type="button" data-show-lesson="${Number(lesson.id)}" data-i18n-aria="show_item" aria-label="${escapeHtml(t("show_item"))}">👁</button>`
        : `<button class="content-action" type="button" data-hide-lesson="${Number(lesson.id)}" data-i18n-aria="hide_item" aria-label="${escapeHtml(t("hide_item"))}">🙈</button>`;
      if (imported) {
        return `${eye}<button class="content-action" type="button" data-edit-lesson="${Number(lesson.id)}" data-i18n-aria="builder_edit_lesson" aria-label="${escapeHtml(t("builder_edit_lesson"))}">✎</button><button class="content-action is-danger" type="button" data-delete-lesson="${Number(lesson.id)}" data-i18n-aria="delete_item" aria-label="${escapeHtml(t("delete_item"))}">${icon("trash")}</button>`;
      }
      return eye;
    }

    function deleteImportedLesson(lessonId) {
      const lesson = state.importedLessons.find((item) => Number(item.id) === Number(lessonId));
      if (!lesson) return;
      state.importedLessons = state.importedLessons.filter((item) => Number(item.id) !== Number(lessonId));
      writeJSON(importedLessonsKey(), state.importedLessons);
      state.lessons = mergeById(state.languagePack?.lessons || [], state.importedLessons);
      addTombstone("lesson", { id: String(lessonId), language: state.language });
      showToast(t("lesson_deleted"), "success");
      removeDashboardLessonCard(lessonId);
    }

    function focusLessonAction(selectors) {
      const list = Array.isArray(selectors) ? selectors : [selectors];
      window.setTimeout(() => {
        for (const selector of list) {
          const target = document.querySelector(selector);
          if (target) {
            target.focus({ preventScroll: true });
            return;
          }
        }
      }, 420);
    }

    function hideLesson(lessonId) {
      withScrollPreserved(() => {
        setContentHidden("lesson", lessonId, true);
        showHiddenLessons = false;
        showToast(t("lesson_hidden"), "info");
        removeDashboardLessonCard(lessonId);
      });
      focusLessonAction(["[data-toggle-hidden-lessons]", "[data-hide-lesson]", "[data-show-lesson]", "[data-create-lesson]", ".lesson-grid"]);
    }

    function showLesson(lessonId) {
      withScrollPreserved(() => {
        setContentHidden("lesson", lessonId, false);
        showToast(t("lesson_shown"), "info");
        refreshDashboardLessonCard(lessonId);
        updateDashboardSummary();
      });
      focusLessonAction(`[data-hide-lesson="${Number(lessonId)}"]`);
    }

    document.addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-lesson]");
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        const lesson = state.lessons.find((item) => Number(item.id) === Number(deleteButton.dataset.deleteLesson));
        requestConfirmation({
          title: t("delete_lesson_title"),
          message: t("delete_lesson_message", { name: lesson?.title || "" }),
          confirmLabel: t("delete_item")
        }).then((confirmed) => {
          if (confirmed) deleteImportedLesson(deleteButton.dataset.deleteLesson);
        });
        return;
      }
      const hideButton = event.target.closest("[data-hide-lesson]");
      if (hideButton) {
        event.preventDefault();
        event.stopPropagation();
        hideLesson(hideButton.dataset.hideLesson);
        return;
      }
      const showButton = event.target.closest("[data-show-lesson]");
      if (showButton) {
        event.preventDefault();
        event.stopPropagation();
        showLesson(showButton.dataset.showLesson);
        return;
      }
      if (event.target.closest("[data-toggle-hidden-lessons]")) {
        event.preventDefault();
        showHiddenLessons = !showHiddenLessons;
        renderDashboard();
        return;
      }
      const panelButton = event.target.closest("[data-course-panel]");
      if (panelButton) {
        event.preventDefault();
        coursePanel = panelButton.dataset.coursePanel === "tests" ? "tests" : "lessons";
        renderDashboard();
      }
    });


    function getCourseStats() {
      const visibleLessons = getVisibleLessons();
      const cards = visibleLessons.map((lesson) => ({ lesson, metrics: getLessonMetrics(lesson) }));
      const completion = cards.length
        ? Math.round(cards.reduce((sum, item) => sum + item.metrics.percent, 0) / cards.length)
        : 0;
      const uniqueWords = new Set();
      visibleLessons.forEach((lesson) => {
        const discovered = new Set(getLessonDiscovered(lesson.id));
        getLessonVocabulary(lesson).forEach((word) => {
          if (discovered.has(word)) uniqueWords.add(word);
        });
      });
      return {
        cards,
        completion,
        words: uniqueWords.size,
        quizzes: cards.reduce((sum, item) => sum + item.metrics.quizCompleted, 0),
        quizzesTotal: cards.reduce((sum, item) => sum + item.metrics.quizBlocksTotal, 0)
      };
    }

    function renderDashboardStatsMarkup(stats) {
      return `
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("book")}</span><span class="stat-code">LEXICON</span></div>
          <div><div class="stat-value" data-dashboard-stat="words">${stats.words}</div><span class="stat-label">${escapeHtml(t("words_learned"))}</span></div>
        </div>
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">QUIZZES</span></div>
          <div><div class="stat-value" data-dashboard-stat="quizzes">${stats.quizzes}<small>${escapeHtml(t("total"))} ${stats.quizzesTotal}</small></div><span class="stat-label">${escapeHtml(t("quizzes_passed"))}</span></div>
        </div>
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("terminal")}</span><span class="stat-code">COURSE</span></div>
          <div><div class="stat-value" data-dashboard-stat="completion">${stats.completion}<small>%</small></div><span class="stat-label">${escapeHtml(t("course_complete"))}</span></div>
        </div>
      `;
    }

    function renderDashboardCourseLines(stats) {
      return stats.cards.map((item, index) => `
        <div class="course-line">
          <span class="course-line-label"><span>${pad(index + 1)}</span>${escapeHtml(item.lesson.title)}</span>
          <strong>${item.metrics.percent}%</strong>
          <div class="course-line-track"><span style="width:${item.metrics.percent}%"></span></div>
        </div>
      `).join("");
    }

    function updateDashboardSummary() {
      if (state.view !== "dashboard") return;
      const stats = getCourseStats();
      const hiddenLessonCount = getHiddenLessonCount();
      const visibleLessons = stats.cards.map((item) => item.lesson);
      const languageName = languageLabel(currentLanguage());
      const ring = document.querySelector(".dashboard .course-ring");
      if (ring) {
        ring.style.setProperty("--p", stats.completion);
        const ringValue = ring.querySelector("strong");
        if (ringValue) ringValue.textContent = `${stats.completion}%`;
      }
      const summaryCopy = document.querySelector(".dashboard .course-summary-copy");
      if (summaryCopy) {
        const status = summaryCopy.querySelector("strong");
        if (status) status.textContent = stats.completion === 0 ? t("ready") : stats.completion >= 100 ? t("complete") : t("in_progress");
        const detail = summaryCopy.querySelector("p");
        if (detail) detail.textContent = `${stats.words} ${t("words")} · ${stats.quizzes}/${stats.quizzesTotal} ${t("quizzes_passed")}`;
      }
      const courseLines = document.querySelector(".dashboard .course-lines");
      if (courseLines) courseLines.innerHTML = renderDashboardCourseLines(stats);
      const statHost = document.querySelector(".dashboard .dashboard-stats");
      if (statHost) statHost.innerHTML = renderDashboardStatsMarkup(stats);
      const eyebrowLevel = document.querySelector(".dashboard-hero .eyebrow-level");
      if (eyebrowLevel) eyebrowLevel.textContent = `${visibleLessons.length} ${t("modules").toUpperCase()}`;
      const modulesKicker = document.querySelector(".dashboard .modules-kicker");
      if (modulesKicker) modulesKicker.textContent = `MODULES / ${pad(visibleLessons.length)}`;
      const modulesCount = document.querySelector(".dashboard .modules-count");
      if (modulesCount) {
        const started = stats.cards.filter((item) => item.metrics.percent > 0).length;
        modulesCount.textContent = `${started} ${t("started")} · ${visibleLessons.length} ${t("total")}`;
      }
      const tools = document.querySelector(".dashboard .modules-head-tools");
      if (tools) {
        let toggle = tools.querySelector("[data-toggle-hidden-lessons]");
        if (hiddenLessonCount || showHiddenLessons) {
          if (!toggle) {
            toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "btn btn-quiet content-hidden-toggle";
            toggle.dataset.toggleHiddenLessons = "";
            tools.appendChild(toggle);
          }
          toggle.textContent = showHiddenLessons ? t("hidden_hide") : t("hidden_show", { n: hiddenLessonCount });
        } else if (toggle) {
          toggle.remove();
        }
      }
      const grid = document.querySelector(".dashboard .lesson-grid");
      if (grid) {
        const empty = grid.querySelector(".dashboard-empty");
        if (!stats.cards.length && !empty) {
          grid.innerHTML = `<div class="dashboard-empty"><strong>${escapeHtml(t("no_lessons_title", { lang: languageName }))}</strong><br>${escapeHtml(hiddenLessonCount ? t("hidden_show", { n: hiddenLessonCount }) : t("no_lessons_body"))}<br>${hiddenLessonCount ? `<button class="btn btn-primary" type="button" data-toggle-hidden-lessons>${escapeHtml(t("hidden_show", { n: hiddenLessonCount }))}</button>` : `<button class="btn btn-primary" type="button" data-create-lesson>${icon("plus")} ${escapeHtml(t("builder_create_lesson"))}</button>`}<button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`;
        } else if (stats.cards.length && empty) {
          empty.remove();
        }
      }
      topbarContext.textContent = `${currentLanguage()} / ${pad(visibleLessons.length)} modules`;
      progressValue.textContent = pad(stats.completion);
      topProgressBar.style.width = `${stats.completion}%`;
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", `Курс завершён на ${stats.completion}%`);
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `${currentLanguage()} / ${visibleLessons.length} modules · v2.22`;
      if (typeof refreshSectionCounts === "function") refreshSectionCounts();
    }

    function refreshDashboardLessonCard(lessonId) {
      const card = document.querySelector(`.dash-lesson[data-lesson-id="${Number(lessonId)}"]`);
      if (!card) return;
      const stats = getCourseStats();
      const index = stats.cards.findIndex((item) => Number(item.lesson.id) === Number(lessonId));
      if (index < 0) {
        removeDashboardLessonCard(lessonId);
        return;
      }
      card.outerHTML = renderLessonCard(stats.cards[index], index);
      document.querySelector(`.dash-lesson[data-lesson-id="${Number(lessonId)}"]`)?.classList.add("active");
    }

    function removeDashboardLessonCard(lessonId) {
      const card = document.querySelector(`.dash-lesson[data-lesson-id="${Number(lessonId)}"]`);
      updateDashboardSummary();
      if (!card) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduce || typeof card.animate !== "function") {
        card.remove();
        return;
      }
      card.style.pointerEvents = "none";
      const animation = card.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-8px)" }],
        { duration: 160, easing: "ease-out" }
      );
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        card.remove();
      };
      window.setTimeout(finish, 220);
      if (animation?.finished?.then) animation.finished.then(finish).catch(finish);
      else finish();
    }

    /* ---------- markup fragments ---------- */
    function getTitleParts(lesson) {
      if (Array.isArray(lesson.title_parts) && lesson.title_parts.length >= 2) {
        return [lesson.title_parts[0], lesson.title_parts.slice(1).join(" ")];
      }
      const title = lesson.title || "English lesson";
      const split = title.split(/\s+vs\.?\s+/i);
      if (split.length > 1) return [split[0], `vs ${split.slice(1).join(" vs ")}`];
      return [title, ""];
    }

    function renderHero(lesson, blocks, practiceIndex) {
      const [lead, accent] = getTitleParts(lesson);
      const check = lesson.hero_check || {
        bad: "I have seen him yesterday.",
        error: "TIME_ANCHOR_CONFLICT",
        pointer: "yesterday → Past Simple",
        good: "I saw him yesterday.",
        result: "1 rule applied · exit code 0"
      };
      const writing = blocks.find((block) => block.type === "practice_write");
      const firstBlock = blocks.length ? 1 : 0;
      const target = practiceIndex >= 0 ? practiceIndex + 1 : firstBlock;

      return `
        <section class="hero" aria-labelledby="lessonTitle">
          <div class="hero-copy">
            <div class="hero-eyebrow">
              <span class="eyebrow-dot" aria-hidden="true"></span>
              <span>${escapeHtml(lesson.module || "GRAMMAR // 01")}</span>
              <span class="eyebrow-sep" aria-hidden="true">/</span>
              <span class="eyebrow-level">${escapeHtml(lesson.level || "A2–B1")}</span>
            </div>
            <h1 id="lessonTitle">${escapeHtml(lead)}${accent ? `<br><span class="gradient-text">${escapeHtml(accent)}</span>` : ""}</h1>
            <p class="hero-subtitle">${escapeHtml(lesson.subtitle || lesson.description || "")}</p>
            <div class="hero-actions">
              <a class="btn btn-primary" href="#block-${firstBlock}">
                ${escapeHtml(t("lesson_start"))} ${icon("arrow-down")}
              </a>
              <a class="btn btn-secondary" href="#block-${target}">
                ${escapeHtml(t("lesson_practice"))} ${icon("arrow-right")}
              </a>
              <button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("lesson_import"))}</button>
              <button class="btn btn-quiet" type="button" data-copy-lesson-json>📋 ${escapeHtml(t("builder_copy_json"))}</button>
              ${state.importedLessons.some((item) => Number(item.id) === Number(lesson.id)) ? `<button class="btn btn-secondary" type="button" data-edit-lesson="${Number(lesson.id)}">✎ ${escapeHtml(t("builder_edit_lesson"))}</button>` : ""}
            </div>
            <div class="hero-metrics" aria-label="${escapeHtml(t("lesson_map"))}">
              <div class="metric"><strong>${pad(blocks.length)}</strong><span>${escapeHtml(t("blocks"))}</span></div>
              <div class="metric"><strong>${escapeHtml(lessonDurationLabel(lesson, blocks))}</strong><span>${escapeHtml(t("minutes"))}</span></div>
              <div class="metric"><strong>${escapeHtml(lesson.level || "A2–B1")}</strong><span>${escapeHtml(t("level"))}</span></div>
              <div class="metric"><strong>${writing ? `${writing.min_words}+` : "—"}</strong><span>${escapeHtml(t("words_to_write"))}</span></div>
            </div>
          </div>

          <div class="hero-visual" aria-label="Пример автоматической проверки предложения">
            <div class="visual-chip"><span class="signal" aria-hidden="true"></span> LIVE SYNTAX CHECK</div>
            <div class="compiler">
              <div class="compiler-head">
                <span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="compiler-file">syntax_check.js</span>
                <span class="compiler-state"><i aria-hidden="true"></i> LIVE</span>
              </div>
              <div class="compiler-body">
                <div class="code-row"><span class="code-prompt">$</span><span class="code-call">check(<span class="code-string">"${escapeHtml(check.bad)}"</span>)</span></div>
                <div class="error-box"><strong>✕ ERROR</strong><span>${escapeHtml(check.error)}</span></div>
                <div class="code-note">// ${escapeHtml(check.pointer)}</div>
                <div class="code-row"><span class="code-prompt">$</span><span class="code-call">fix()</span></div>
                <div class="success-box"><span class="success-mark">✓</span><span>"${escapeHtml(check.good)}"</span></div>
                <div class="code-result">${escapeHtml(check.result)}</div>
              </div>
              <div class="compiler-foot">
                <span>engine · grammar.v2</span>
                <span class="ready-status">READY</span>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    function renderToc(lesson, blocks) {
      const items = blocks.map((block, index) => {
        const meta = TYPE_META[block.type] || { tag: "BLOCK", label: "Блок" };
        const label = block.nav_label || meta.label;
        return `
          <a class="toc-link${index === 0 ? " is-active" : ""}" href="#block-${index + 1}" data-toc-index="${index}" data-toc-label="${escapeHtml(label)}"${index === 0 ? ' aria-current="true"' : ""}>
            <span class="toc-num">${pad(index + 1)}</span>
            <span class="toc-copy">
              <span class="toc-label">${escapeHtml(label)}</span>
              <span class="toc-type">${meta.tag}</span>
            </span>
            <span class="toc-mark" aria-hidden="true"></span>
          </a>
        `;
      }).join("");
      const firstMeta = TYPE_META[blocks[0]?.type] || { label: "Блок" };
      const firstLabel = blocks[0]?.nav_label || firstMeta.label;

      return `
        <div class="mobile-toc" aria-label="${escapeHtml(t("lesson_map"))}">
          <button class="mobile-toc-toggle" type="button" data-mobile-toc-toggle aria-expanded="false" aria-controls="mobileTocPanel">
            <span class="mobile-toc-icon" aria-hidden="true">${icon("book")}</span>
            <span class="mobile-toc-copy">
              <span>${escapeHtml(t("lesson_map").toUpperCase())}</span>
              <strong id="mobileTocCurrent">${pad(1)} · ${escapeHtml(firstLabel)}</strong>
            </span>
            <span class="mobile-toc-percent" id="mobileTocPercent">0%</span>
            <svg class="icon" aria-hidden="true"><use href="#i-chevron-down"></use></svg>
          </button>
          <div class="mobile-toc-panel" id="mobileTocPanel" hidden>
            <div class="mobile-toc-panel-head">
              <span>${escapeHtml(t("lesson_map"))}</span>
              <span id="mobileTocVocabCount"></span>
            </div>
            <nav class="toc-nav" aria-label="${escapeHtml(t("lesson_map"))}">${items}</nav>
          </div>
        </div>
        <aside class="toc-column" aria-label="${escapeHtml(t("lesson_map"))}">
          <div class="toc glass">
            <div class="toc-head">
              <span>${escapeHtml(t("lesson_map").toUpperCase())}</span>
              <span class="toc-live"><i aria-hidden="true"></i> LIVE</span>
            </div>
            <div class="toc-progress">
              <div class="toc-ring" id="tocRing" style="--p:0"><span id="tocPercent">0%</span></div>
              <div class="toc-progress-copy">
                <span>${escapeHtml(t("depth"))}</span>
                <strong id="tocProgressText">${escapeHtml(t("beginning"))}</strong>
              </div>
            </div>
            <nav class="toc-nav" aria-label="${escapeHtml(t("lesson_map"))}">${items}</nav>
            <div class="toc-words">
              <span class="toc-words-icon">${icon("book")}</span>
              <div class="toc-words-copy">
                <span>${escapeHtml(t("opened_words"))}</span>
                <strong id="tocVocabCount"></strong>
              </div>
            </div>
          </div>
          <div class="local-note">
            <span class="signal" aria-hidden="true"></span>
            <p><strong>Local-first.</strong> ${escapeHtml(t("local_note"))}</p>
          </div>
        </aside>
      `;
    }

    function setMobileTocOpen(open) {
      const toggle = document.querySelector("[data-mobile-toc-toggle]");
      const panel = document.getElementById("mobileTocPanel");
      if (!toggle || !panel) return;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    }

    function renderLessonCard(item, index) {      const { lesson, metrics } = item;
      const blocks = getLessonBlocks(lesson);
      const tags = [...new Set(blocks.map((block) => (TYPE_META[block.type] || {}).tag).filter(Boolean))];
      const launchLabel = metrics.percent > 0 ? t("continue_learning") : t("lesson_start");
      return `
        <article class="dash-lesson reveal" data-lesson-id="${Number(lesson.id)}" style="--i:${index}" aria-labelledby="dashboard-lesson-${lesson.id}">
          <div class="lesson-card-top">
            <span class="lesson-module">${escapeHtml(lesson.module || `MODULE ${pad(index + 1)}`)}</span>
            <div class="lesson-badges">
              ${lesson.badge ? `<span class="lesson-badge">${escapeHtml(lesson.badge)}</span>` : ""}
              <span class="level-badge">${escapeHtml(lesson.level || "A2–B1")}</span>
              ${lessonActionMarkup(lesson)}
            </div>
          </div>
          <h3 id="dashboard-lesson-${lesson.id}">${escapeHtml(lesson.title || "English lesson")}</h3>
          <p class="lesson-description">${escapeHtml(lesson.subtitle || lesson.description || "")}</p>
          <div class="lesson-tags" aria-label="Типы заданий">
            ${tags.map((tag) => `<span class="lesson-tag">${tag}</span>`).join("")}
          </div>
          <div class="lesson-card-progress">
            <div class="lesson-progress-head">
              <span>Прогресс урока</span>
              <strong>${metrics.percent}%</strong>
            </div>
            <div class="lesson-progress-track" role="progressbar" aria-label="Прогресс урока ${escapeHtml(lesson.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${metrics.percent}">
              <span style="width:${metrics.percent}%"></span>
            </div>
          </div>
          <div class="lesson-card-footer">
            <span class="lesson-meta">${blocks.length} блоков · ${escapeHtml(lessonDurationLabel(lesson, blocks))} · ${metrics.words}/${metrics.vocabTotal} слов</span>
            <a class="btn btn-primary lesson-launch" href="#lesson-${Number(lesson.id)}">
              ${launchLabel} ${icon("arrow-right")}
            </a>
          </div>
        </article>
      `;
    }

    function renderDashboard() {
      stopSpeech();
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "dashboard";
      state.lesson = null;
      state.lessonId = null;
      state.story = null;
      state.storyId = null;
      state.activeBlock = 0;
      state.backTarget = "#dashboard";

      const stats = getCourseStats();
      const visibleLessons = stats.cards.map((item) => item.lesson);
      const hiddenLessonCount = getHiddenLessonCount();
      const next = stats.cards.find((item) => item.metrics.percent > 0 && item.metrics.percent < 100)
        || stats.cards.find((item) => item.metrics.percent === 0)
        || stats.cards[0];
      const nextLabel = next && next.metrics.percent > 0 ? t("continue_learning") : t("start_first");
      const language = currentLanguage();
      const languageName = languageLabel(language);
      const isEmptyLanguage = visibleLessons.length === 0;

      app.innerHTML = `
        <section class="dashboard" aria-labelledby="dashboardTitle">
          <div class="dashboard-topline">
            ${renderSectionTabs("course")}
            ${renderLanguageSwitch()}
          </div>
          <div class="course-view-tabs" role="tablist" aria-label="${escapeHtml(t("course_panel_lessons"))} / ${escapeHtml(t("course_panel_tests"))}">
            <button class="course-view-tab${coursePanel === "lessons" ? " is-active" : ""}" type="button" role="tab" aria-selected="${coursePanel === "lessons"}" data-course-panel="lessons">${escapeHtml(t("course_panel_lessons"))}</button>
            <button class="course-view-tab${coursePanel === "tests" ? " is-active" : ""}" type="button" role="tab" aria-selected="${coursePanel === "tests"}" data-course-panel="tests">${escapeHtml(t("course_panel_tests"))}</button>
          </div>

          <div class="dashboard-hero">
            <div class="dashboard-copy">
              <div class="hero-eyebrow">
                <span class="eyebrow-dot" aria-hidden="true"></span>
                <span>${escapeHtml(languageName.toUpperCase())} // LEARNING_OS</span>
                <span class="eyebrow-sep" aria-hidden="true">/</span>
                <span class="eyebrow-level">${visibleLessons.length} ${escapeHtml(t("modules").toUpperCase())}</span>
              </div>
              <h1 class="dashboard-title" id="dashboardTitle">${escapeHtml(t("dashboard_title_1"))}<br><span class="gradient-text">${escapeHtml(t("dashboard_title_2"))}</span></h1>
              <p class="dashboard-subtitle">${isEmptyLanguage
                ? escapeHtml(t("dashboard_subtitle_empty", { lang: languageName }))
                : escapeHtml(t("dashboard_subtitle", { lang: languageName }))}</p>
              <div class="dashboard-actions">
                ${next ? `<a class="btn btn-primary" href="#lesson-${Number(next.lesson.id)}">${escapeHtml(nextLabel)} ${icon("arrow-right")}</a>` : ""}
                <button class="btn btn-secondary" type="button" data-create-lesson>${icon("plus")} ${escapeHtml(t("builder_create_lesson"))}</button>
                <button class="btn btn-secondary" type="button" data-section-link="stories">${escapeHtml(t("free_reading"))} ${icon("spark")}</button>
                <button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button>
              </div>
            </div>

            <div class="course-console" aria-label="${escapeHtml(t("course_status"))}">
              <div class="console-head">
                <span>COURSE_STATUS</span>
                <span class="console-live"><i aria-hidden="true"></i> LOCAL</span>
              </div>
              <div class="console-body">
                <div class="course-summary">
                  <div class="course-ring" style="--p:${stats.completion}">
                    <div><strong>${stats.completion}%</strong><span>COMPLETE</span></div>
                  </div>
                  <div class="course-summary-copy">
                    <span>CURRICULUM</span>
                    <strong>${stats.completion === 0 ? escapeHtml(t("ready")) : stats.completion >= 100 ? escapeHtml(t("complete")) : escapeHtml(t("in_progress"))}</strong>
                    <p>${stats.words} ${escapeHtml(t("words"))} · ${stats.quizzes}/${stats.quizzesTotal} ${escapeHtml(t("quizzes_passed"))}</p>
                  </div>
                </div>
                <div class="course-lines">
                  ${stats.cards.map((item, index) => `
                    <div class="course-line">
                      <span class="course-line-label"><span>${pad(index + 1)}</span>${escapeHtml(item.lesson.title)}</span>
                      <strong>${item.metrics.percent}%</strong>
                      <div class="course-line-track"><span style="width:${item.metrics.percent}%"></span></div>
                    </div>
                  `).join("")}
                </div>
              </div>
              <div class="console-foot">
                <span>db: local_progress</span>
                <span>SYNCED</span>
              </div>
            </div>
          </div>

          <div class="dashboard-stats" aria-label="${escapeHtml(t("course_status"))}">
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("book")}</span><span class="stat-code">LEXICON</span></div>
              <div><div class="stat-value" data-dashboard-stat="words">${stats.words}</div><span class="stat-label">${escapeHtml(t("words_learned"))}</span></div>
            </div>
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">QUIZZES</span></div>
              <div><div class="stat-value" data-dashboard-stat="quizzes">${stats.quizzes}<small>${escapeHtml(t("total"))} ${stats.quizzesTotal}</small></div><span class="stat-label">${escapeHtml(t("quizzes_passed"))}</span></div>
            </div>
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("terminal")}</span><span class="stat-code">COURSE</span></div>
              <div><div class="stat-value" data-dashboard-stat="completion">${stats.completion}<small>%</small></div><span class="stat-label">${escapeHtml(t("course_complete"))}</span></div>
            </div>
          </div>

          <section class="dashboard-modules${coursePanel === "tests" ? " is-hidden" : ""}" aria-labelledby="modulesTitle">
            <div class="modules-head">
              <div class="modules-head-copy">
                <div class="modules-kicker">MODULES / ${pad(visibleLessons.length)}</div>
                <h2 id="modulesTitle">${escapeHtml(t("modules"))}</h2>
              </div>
              <div class="modules-head-tools">
                <span class="modules-count">${stats.cards.filter((item) => item.metrics.percent > 0).length} ${escapeHtml(t("started"))} · ${visibleLessons.length} ${escapeHtml(t("total"))}</span>
                ${hiddenLessonCount || showHiddenLessons ? `<button class="btn btn-quiet content-hidden-toggle" type="button" data-toggle-hidden-lessons>${showHiddenLessons ? escapeHtml(t("hidden_hide")) : escapeHtml(t("hidden_show", { n: hiddenLessonCount }))}</button>` : ""}
              </div>
            </div>
            <div class="lesson-grid">
              ${stats.cards.length ? stats.cards.map(renderLessonCard).join("") : `<div class="dashboard-empty"><strong>${escapeHtml(t("no_lessons_title", { lang: languageName }))}</strong><br>${escapeHtml(hiddenLessonCount ? t("hidden_show", { n: hiddenLessonCount }) : t("no_lessons_body"))}<br>${hiddenLessonCount ? `<button class="btn btn-primary" type="button" data-toggle-hidden-lessons>${escapeHtml(t("hidden_show", { n: hiddenLessonCount }))}</button>` : `<button class="btn btn-primary" type="button" data-create-lesson>${icon("plus")} ${escapeHtml(t("builder_create_lesson"))}</button>`}<button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`}
            </div>
          </section>
          ${coursePanel === "tests" ? renderTestsPanel() : ""}
        </section>
      `;

      topbarContext.textContent = `${language} / ${pad(visibleLessons.length)} modules`;
      syncLanguageUI();
      progressValue.textContent = pad(stats.completion);
      topProgressBar.style.width = `${stats.completion}%`;
      backToLessons.hidden = true;
      backLabel.textContent = t("back_lessons");
      state.backTarget = "#dashboard";
      updateSectionUI("course");
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", `Курс завершён на ${stats.completion}%`);
      document.title = `LINGUA/OS — ${languageName} Dashboard`;
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `${language} / ${visibleLessons.length} modules · v2.22`;
      scrollToTopInstant();
    }

    function getQuizAttempts() {
      const attempts = [];
      getVisibleLessons().forEach((lesson) => {
        getLessonBlocks(lesson).forEach((block, blockIndex) => {
          if (block.type !== "quiz") return;
          const questions = Array.isArray(block.questions) ? block.questions : [];
          const result = readJSON(getQuizKey(lesson.id, blockIndex), null);
          if (!result || !result.answers || typeof result.answers !== "object" || !questions.length) return;
          const answers = result.answers;
          const answered = questions.filter((question, questionIndex) => Object.prototype.hasOwnProperty.call(answers, questionIndex)).length;
          if (!answered) return;
          let correct = 0;
          const wrong = [];
          questions.forEach((question, questionIndex) => {
            if (!Object.prototype.hasOwnProperty.call(answers, questionIndex)) return;
            const selected = Number(answers[questionIndex]);
            if (selected === Number(question.correct)) {
              correct += 1;
            } else {
              wrong.push({ question, questionIndex, selected });
            }
          });
          attempts.push({
            lessonId: Number(lesson.id),
            lessonTitle: lesson.title || "",
            blockIndex,
            blockTitle: block.title || block.nav_label || t("tests_quiz"),
            questions,
            answers,
            answered,
            correct,
            total: questions.length,
            percent: Math.round((correct / questions.length) * 100),
            wrong
          });
        });
      });
      return attempts;
    }

    function renderTestsPanel() {
      const attempts = getQuizAttempts();
      return `
        <section class="tests-panel" aria-labelledby="testsTitle">
          <div class="tests-head">
            <div>
              <div class="modules-kicker">${escapeHtml(t("tests_kicker"))} / ${pad(attempts.length)}</div>
              <h2 id="testsTitle">${escapeHtml(t("tests_title"))}</h2>
            </div>
            <span class="tests-count">${attempts.length} ${escapeHtml(t("tests_attempted"))}</span>
          </div>
          ${attempts.length ? `
            <div class="tests-list">
              ${attempts.map((attempt) => `
                <article class="test-card">
                  <div class="test-card-copy">
                    <span class="test-card-kicker">${escapeHtml(attempt.lessonTitle)}</span>
                    <h3>${escapeHtml(attempt.blockTitle)}</h3>
                    <p>${escapeHtml(t("tests_questions", { correct: attempt.correct, total: attempt.total }))} · ${attempt.answered}/${attempt.total}</p>
                  </div>
                  <div class="test-score">
                    <strong>${attempt.percent}%</strong>
                    <span>${escapeHtml(t("tests_percent"))}</span>
                    <div class="test-score-track" aria-hidden="true"><span style="width:${attempt.percent}%"></span></div>
                  </div>
                  <div class="test-actions">
                    ${attempt.wrong.length
                      ? `<button class="btn btn-secondary" type="button" data-start-error-quiz="${attempt.lessonId}:${attempt.blockIndex}">${escapeHtml(t("tests_work_errors"))} (${attempt.wrong.length})</button>`
                      : `<span class="test-no-errors">${escapeHtml(t("tests_no_errors"))}</span>`}
                  </div>
                </article>
              `).join("")}
            </div>
          ` : `
            <div class="tests-empty">
              <strong>${escapeHtml(t("tests_empty"))}</strong>
              <p>${escapeHtml(t("tests_empty_hint"))}</p>
            </div>
          `}
        </section>
      `;
    }

    function renderErrorQuizQuestion(item, index) {
      const question = item.question;
      const options = Array.isArray(question.options) ? question.options : [];
      return `
        <article class="error-question" data-error-index="${index}">
          <div class="error-question-kicker">${escapeHtml(t("tests_question", { n: index + 1, total: errorQuizState.attempt.wrong.length }))}</div>
          <h3>${escapeHtml(question.question || question.text || "")}</h3>
          <div class="error-options">
            ${options.map((option, optionIndex) => `
              <button class="error-option" type="button" data-error-option="${index}:${optionIndex}">
                <span class="error-option-letter">${String.fromCharCode(65 + optionIndex)}</span>
                <span>${escapeHtml(option)}</span>
              </button>
            `).join("")}
          </div>
          <p class="error-feedback" data-error-feedback hidden></p>
        </article>
      `;
    }

    function openErrorQuiz(lessonId, blockIndex) {
      const attempt = getQuizAttempts().find((item) => item.lessonId === Number(lessonId) && item.blockIndex === Number(blockIndex));
      if (!attempt || !attempt.wrong.length) {
        showToast(t("tests_error_empty"), "info");
        return;
      }
      errorQuizState = { attempt, answers: {}, correct: 0 };
      const modal = document.getElementById("errorQuizModal");
      const title = document.getElementById("errorQuizTitle");
      const body = document.getElementById("errorQuizBody");
      const result = document.getElementById("errorQuizResult");
      if (!modal || !body || !result) return;
      if (title) title.textContent = `${t("tests_error_title")} · ${attempt.blockTitle}`;
      body.innerHTML = attempt.wrong.map(renderErrorQuizQuestion).join("");
      result.hidden = true;
      result.innerHTML = "";
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }

    function finishErrorQuiz() {
      if (!errorQuizState) return;
      const total = errorQuizState.attempt.wrong.length;
      const percent = total ? Math.round((errorQuizState.correct / total) * 100) : 0;
      writeJSON(getQuizKey("error", 0), {
        answers: errorQuizState.answers,
        correct: errorQuizState.correct,
        total,
        percent,
        completed: true,
        updatedAt: new Date().toISOString()
      });
      const result = document.getElementById("errorQuizResult");
      if (result) {
        result.hidden = false;
        result.innerHTML = `
          <div class="error-result-mark" aria-hidden="true">${percent >= 70 ? "✓" : "↻"}</div>
          <strong>${escapeHtml(t("tests_result", { correct: errorQuizState.correct, total, percent }))}</strong>
          <p>${escapeHtml(t("tests_result_text"))}</p>
          <button class="btn btn-primary" type="button" data-close-error-quiz>${escapeHtml(t("tests_close"))}</button>
        `;
      }
    }

    function closeErrorQuiz() {
      const modal = document.getElementById("errorQuizModal");
      if (!modal) return;
      if (modal.open && typeof modal.close === "function") modal.close();
      else modal.removeAttribute("open");
      errorQuizState = null;
      if (coursePanel === "tests" && state.view === "dashboard") renderDashboard();
    }

    document.addEventListener("click", (event) => {
      const startButton = event.target.closest("[data-start-error-quiz]");
      if (startButton) {
        event.preventDefault();
        const [lessonId, blockIndex] = startButton.dataset.startErrorQuiz.split(":");
        openErrorQuiz(lessonId, blockIndex);
        return;
      }
      const optionButton = event.target.closest("[data-error-option]");
      if (optionButton && errorQuizState) {
        event.preventDefault();
        const [itemIndex, optionIndex] = optionButton.dataset.errorOption.split(":").map(Number);
        const item = errorQuizState.attempt.wrong[itemIndex];
        if (!item || Object.prototype.hasOwnProperty.call(errorQuizState.answers, itemIndex)) return;
        const questionEl = optionButton.closest(".error-question");
        const selected = Number(optionIndex);
        const isCorrect = selected === Number(item.question.correct);
        errorQuizState.answers[itemIndex] = selected;
        if (isCorrect) errorQuizState.correct += 1;
        questionEl?.querySelectorAll("[data-error-option]").forEach((button, index) => {
          button.disabled = true;
          if (index === Number(item.question.correct)) button.classList.add("is-correct");
          if (index === selected && !isCorrect) button.classList.add("is-wrong");
        });
        const feedback = questionEl?.querySelector("[data-error-feedback]");
        if (feedback) {
          feedback.hidden = false;
          feedback.className = `error-feedback ${isCorrect ? "is-correct" : "is-wrong"}`;
          const explanation = item.question.explanation || item.question.why || "";
          feedback.textContent = `${isCorrect ? t("tests_correct") : t("tests_wrong")}${explanation ? ` · ${explanation}` : ""}`;
        }
        if (Object.keys(errorQuizState.answers).length >= errorQuizState.attempt.wrong.length) finishErrorQuiz();
        return;
      }
      if (event.target.closest("[data-close-error-quiz]") || event.target.closest("#errorQuizClose")) {
        event.preventDefault();
        closeErrorQuiz();
      }
    });

    document.getElementById("errorQuizModal")?.addEventListener("click", (event) => {
      if (event.target.id === "errorQuizModal") closeErrorQuiz();
    });

    function blockHead(block, index) {
      const meta = TYPE_META[block.type] || { tag: "BLOCK" };
      return `
        <header class="block-head">
          <span class="block-index" aria-hidden="true">${pad(index + 1)}</span>
          <div class="block-heading">
            <div class="block-eyebrow">${escapeHtml(block.eyebrow || meta.tag)}</div>
            <h2 id="block-title-${index + 1}">${escapeHtml(block.title || "")}</h2>
          </div>
          <span class="block-type">${meta.tag}</span>
        </header>
      `;
    }

    function renderTheory(block, index, number) {
      const rules = Array.isArray(block.rule_lines) ? block.rule_lines : [];
      const toneClass = (tone) => ["cyan", "emerald", "red", "muted"].includes(tone) ? ` is-${tone}` : "";
      const formulas = Array.isArray(block.formulas) ? block.formulas : [];
      const mistakes = Array.isArray(block.mistakes) ? block.mistakes : [];
      const keyPhrases = Array.isArray(block.key_phrases) ? block.key_phrases.filter((item) => item && (item.original || item.translation)) : [];

      return `
        <section class="lesson-block" id="block-${number}" data-block-index="${index}" data-block-type="theory" style="--i:${index}" aria-labelledby="block-title-${number}">
          <div class="card reveal theory-card">
            ${blockHead(block, index)}
            <div class="terminal" role="figure" aria-label="${escapeHtml(block.terminal_label || "Грамматическое правило")}">
              <div class="terminal-bar">
                <span class="traffic" aria-hidden="true"><i></i><i></i><i></i></span>
                <span class="terminal-file">${escapeHtml(block.terminal_label || "grammar.rule")}</span>
                <span class="terminal-mode">READ_ONLY</span>
              </div>
              <div class="terminal-body">
                ${rules.map((line) => `
                  <div class="rule-line${toneClass(line.tone)}">
                    <span class="rule-prompt">${escapeHtml(line.prompt || "")}</span>
                    <span class="rule-text">${escapeHtml(line.text || "")}</span>
                  </div>
                `).join("")}
              </div>
            </div>
            ${keyPhrases.length ? `
              <div class="theory-key-phrases" aria-label="${escapeHtml(t("theory_key_phrases"))}">
                <div class="theory-section-label">${escapeHtml(t("theory_key_phrases"))}</div>
                ${keyPhrases.map((item) => `
                  <div class="theory-key-phrase">
                    <strong dir="auto">${escapeHtml(item.original || "")}</strong>
                    ${item.translation ? `<span>${escapeHtml(item.translation)}</span>` : ""}
                    ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
                  </div>
                `).join("")}
              </div>
            ` : ""}
            <p class="theory-body">${escapeHtml(block.content || block.body || "")}</p>

            ${formulas.length ? `
              <div class="formula-grid">
                ${formulas.map((formula) => `
                  <div class="formula">
                    <div class="formula-label">${escapeHtml(formula.label || "Pattern")}</div>
                    <code>${escapeHtml(formula.structure || "")}</code>
                    <p class="formula-example">“${escapeHtml(formula.example || "")}”</p>
                    <span class="formula-note">${escapeHtml(formula.note || "")}</span>
                  </div>
                `).join("")}
              </div>
            ` : ""}

            ${mistakes.length ? `
              <div class="mistake-list">
                ${mistakes.map((mistake) => `
                  <div class="mistake">
                    <div class="mistake-line mistake-bad"><span class="mark">✕</span><span>${escapeHtml(mistake.bad || "")}</span></div>
                    <div class="mistake-line mistake-good"><span class="mark">✓</span><span>${escapeHtml(mistake.good || "")}</span></div>
                    <p class="mistake-why">${escapeHtml(mistake.why || "")}</p>
                  </div>
                `).join("")}
              </div>
            ` : ""}

            ${block.tip ? `
              <div class="rule-tip">
                ${icon("spark")}
                <p>${escapeHtml(block.tip)}</p>
              </div>
            ` : ""}
            ${block.fun_fact ? `
              <div class="theory-fun-fact">
                <strong>${escapeHtml(t("theory_fun_fact"))}</strong>
                <p>${escapeHtml(block.fun_fact)}</p>
              </div>
            ` : ""}
          </div>
        </section>
      `;
    }

    function renderReading(block, index, number) {
      // The reading text is trusted course content and intentionally contains
      // inline <span class="vocab"> glossary markup.
      return `
        <section class="lesson-block" id="block-${number}" data-block-index="${index}" data-block-type="reading_heavy" style="--i:${index}" aria-labelledby="block-title-${number}">
          <div class="card reveal reading-card">
            ${blockHead(block, index)}
            ${block.intro ? `<p class="reading-intro">${escapeHtml(block.intro)}</p>` : ""}
            <div class="reading-toolbar">
              <span class="reading-length">${icon("clock")} ${escapeHtml(readingLengthLabel(block))}</span>
              ${renderSpeechControls()}
              <span class="glossary-pill"><span class="dot" aria-hidden="true"></span><strong data-vocab-count></strong> слов открыто</span>
            </div>
            <div class="reading-prose" data-ai-selectable="reading">${decorateGlossary(block.text || "", block.glossary)}</div>
            <div class="reading-footer">
              <div class="glossary-tip">
                ${icon("book")}
                <p>${escapeHtml(block.glossary_hint || "Нажми на слово, чтобы увидеть перевод.")}</p>
              </div>
              <span class="reading-end">END OF STORY</span>
            </div>
          </div>
        </section>
      `;
    }

    function renderDialogue(block, index, number) {
      const participants = Array.isArray(block.participants) ? block.participants : [];
      const byId = Object.fromEntries(participants.map((participant) => [participant.id, participant]));
      const names = participants.map((participant) => participant.name).filter(Boolean).join(" & ");
      const viewer = block.viewer || (participants[0] && participants[0].id);
      const messages = Array.isArray(block.messages) ? block.messages : [];
      const notes = Array.isArray(block.grammar_notes) ? block.grammar_notes : [];

      return `
        <section class="lesson-block" id="block-${number}" data-block-index="${index}" data-block-type="dialogue" style="--i:${index}" aria-labelledby="block-title-${number}">
          <div class="card reveal dialogue-card">
            ${blockHead(block, index)}
            ${block.intro ? `<p class="dialogue-intro">${escapeHtml(block.intro)}</p>` : ""}
            <div class="messenger">
              <div class="messenger-head">
                <div class="avatar-stack" aria-hidden="true">
                  ${participants.map((participant) => `<span class="avatar${participant.tone === "emerald" ? " tone-emerald" : ""}">${escapeHtml(participant.initials || participant.name?.charAt(0) || "?")}</span>`).join("")}
                </div>
                <div class="chat-identity">
                  <strong>${escapeHtml(names || "Conversation")}</strong>
                  <span><i class="online-dot" aria-hidden="true"></i> online · ${escapeHtml(block.setting || "live dialogue")}</span>
                </div>
                <span class="messenger-chip">EN / LIVE</span>
              </div>
              <div class="chat-body" data-ai-selectable="dialogue" tabindex="0" aria-label="Диалог ${escapeHtml(names)}">
                <div class="chat-date">${escapeHtml(block.date_label || "Today")}</div>
                ${messages.map((message, messageIndex) => {
                  const person = byId[message.from] || { name: message.from || "Unknown", initials: "?", tone: "cyan" };
                  const isMe = message.side ? message.side === "right" : message.from === viewer;
                  return `
                    <div class="message${isMe ? " is-me" : ""}" style="--m:${messageIndex}">
                      ${!isMe ? `<span class="avatar${person.tone === "emerald" ? " tone-emerald" : ""}" aria-hidden="true">${escapeHtml(person.initials || "?")}</span>` : ""}
                      <div class="msg-stack">
                        <div class="msg-bubble">${escapeHtml(message.text || "")}${message.reaction ? `<span class="msg-reaction">${escapeHtml(message.reaction)}</span>` : ""}</div>
                        <div class="msg-meta">
                          <span>${escapeHtml(isMe ? "You" : person.name)}</span>
                          <span aria-hidden="true">·</span>
                          <time>${escapeHtml(message.time || "")}</time>
                          ${isMe ? icon("double-check", "icon read") : ""}
                        </div>
                      </div>
                      ${isMe ? `<span class="avatar${person.tone === "emerald" ? " tone-emerald" : ""}" aria-hidden="true">${escapeHtml(person.initials || "?")}</span>` : ""}
                    </div>
                  `;
                }).join("")}
              </div>
              ${messages.length > 6 ? `<div class="chat-scroll-hint">${messages.length} сообщений · прокрути чат</div>` : ""}
              ${notes.length ? `
                <div class="grammar-trace">
                  <div class="grammar-trace-head"><span>GRAMMAR TRACE</span><span>${notes.length} signals</span></div>
                  ${notes.map((note) => `
                    <div class="grammar-note">
                      <code>${escapeHtml(note.phrase || "")}</code>
                      <p>${escapeHtml(note.explanation || "")}</p>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
            </div>
          </div>
        </section>
      `;
    }

    function renderQuiz(block, index, number) {
      const questions = Array.isArray(block.questions) ? block.questions : [];
      const letters = ["A", "B", "C", "D", "E"];
      return `
        <section class="lesson-block" id="block-${number}" data-block-index="${index}" data-block-type="quiz" style="--i:${index}" aria-labelledby="block-title-${number}">
          <div class="card reveal quiz-card" data-quiz data-lesson-id="${Number(state.lesson?.id) || 1}" data-block-index="${index}">
            ${blockHead(block, index)}
            ${block.intro ? `<p class="quiz-intro">${escapeHtml(block.intro)}</p>` : ""}
            <div class="quiz-status">
              <div class="quiz-meter-wrap">
                <div class="quiz-meter" aria-hidden="true"><span data-quiz-meter></span></div>
              </div>
              <div class="quiz-status-copy">
                <span><strong data-quiz-answered>0</strong> / ${questions.length} answered</span>
                <span aria-hidden="true">·</span>
                <span><strong data-quiz-correct>0</strong> correct</span>
              </div>
            </div>
            <div class="quiz-list">
              ${questions.map((question, questionIndex) => `
                <article class="quiz-question" data-quiz-question="${questionIndex}" aria-labelledby="quiz-${number}-q-${questionIndex}">
                  <div class="quiz-question-head">
                    <span class="quiz-number" aria-hidden="true">${pad(questionIndex + 1)}</span>
                    <h3 id="quiz-${number}-q-${questionIndex}">${escapeHtml(question.question || "")}</h3>
                  </div>
                  <div class="quiz-options" role="group" aria-labelledby="quiz-${number}-q-${questionIndex}">
                    ${(Array.isArray(question.options) ? question.options : []).map((option, optionIndex) => `
                      <button class="quiz-option" type="button" data-quiz-option="${optionIndex}">
                        <span class="option-letter" aria-hidden="true">${letters[optionIndex] || optionIndex + 1}</span>
                        <span class="option-text">${escapeHtml(option)}</span>
                        <span class="option-mark" aria-hidden="true"></span>
                      </button>
                    `).join("")}
                  </div>
                  <div class="quiz-feedback" data-quiz-feedback hidden aria-live="polite">
                    <span class="quiz-feedback-title" data-feedback-title></span>
                    <p data-feedback-text></p>
                  </div>
                </article>
              `).join("")}
            </div>
            <div class="quiz-result" data-quiz-result hidden aria-live="polite">
              <div class="quiz-result-main">
                <strong class="quiz-result-value" data-quiz-result-value></strong>
                <div class="quiz-result-copy">
                  <strong data-quiz-result-title></strong>
                  <p data-quiz-result-copy></p>
                </div>
              </div>
              <button class="btn btn-quiet" type="button" data-quiz-reset>Пройти заново</button>
            </div>
          </div>
        </section>
      `;
    }

    function renderPractice(block, index, number, lesson) {
      const minWords = Number(block.min_words) || 90;
      const maxWords = Number(block.max_words) || 140;
      const constraints = Array.isArray(block.constraints) ? block.constraints : [];
      const checklist = Array.isArray(block.checklist) ? block.checklist : [];
      const suggestions = Array.isArray(block.suggestions) ? block.suggestions : [];
      const targetId = `practice-brief-${number}`;

      return `
        <section class="lesson-block" id="block-${number}" data-block-index="${index}" data-block-type="practice_write" style="--i:${index}" aria-labelledby="block-title-${number}">
          <div class="card reveal practice-card">
            ${blockHead(block, index)}
            <div class="practice-top">
              <div>
                <p class="practice-prompt">${escapeHtml(block.prompt || "")}</p>
                <p class="practice-brief" id="${targetId}">${escapeHtml(block.brief || "")}</p>
              </div>
              ${constraints.length ? `<div class="constraint-list">${constraints.map((item) => `<span class="constraint">${escapeHtml(item)}</span>`).join("")}</div>` : ""}
            </div>

            <div class="practice-grid">
              <div class="editor" data-writer data-lesson-id="${escapeHtml(lesson.id)}" data-block-index="${index}" data-min-words="${minWords}" data-max-words="${maxWords}">
                <div class="editor-head">
                  <label class="editor-label" for="writing-${number}">Черновик / draft</label>
                  <span class="editor-status" data-writer-status>Новый черновик</span>
                </div>
                <textarea
                  class="practice-textarea"
                  id="writing-${number}"
                  data-writer-input
                  rows="10"
                  spellcheck="true"
                  lang="en"
                  aria-describedby="${targetId}"
                  placeholder="${escapeHtml(block.placeholder || "Start writing here...")}"
                ></textarea>
                <div class="editor-foot">
                  <div class="word-meter" data-word-meter>
                    <div class="meter" aria-hidden="true"><span data-meter-bar></span></div>
                    <span><strong data-word-count>0</strong> / ${minWords}–${maxWords} слов</span>
                  </div>
                  <div class="editor-actions">
                    <button class="btn btn-quiet" type="button" data-clear>Очистить</button>
                    <button class="btn btn-save" type="button" data-save>
                      ${icon("save")}<span>${escapeHtml(block.save_label || "Сохранить работу")}</span>
                    </button>
                  </div>
                </div>
                <p class="saved-line" data-saved-line hidden></p>
              </div>

              <aside class="practice-aside">
                ${checklist.length ? `
                  <div class="side-card">
                    <h3>Чек-лист</h3>
                    <ul class="checklist">${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                  </div>
                ` : ""}
                ${suggestions.length ? `
                  <div class="side-card">
                    <h3>Фразы-стартеры</h3>
                    <div class="chips">
                      ${suggestions.map((phrase) => `<button class="phrase-chip" type="button" data-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>`).join("")}
                    </div>
                  </div>
                ` : ""}
                <p class="local-privacy">${icon("shield")}<span>${escapeHtml(block.restore_hint || "Черновик хранится только в этом браузере.")}</span></p>
              </aside>
            </div>
          </div>
        </section>
      `;
    }

    function renderBlock(block, index, lesson) {
      const number = index + 1;
      switch (block.type) {
        case "theory":
          return renderTheory(block, index, number);
        case "reading_heavy":
          return renderReading(block, index, number);
        case "dialogue":
          return renderDialogue(block, index, number);
        case "quiz":
          return renderQuiz(block, index, number);
        case "practice_write":
          return renderPractice(block, index, number, lesson);
        default:
          return `
            <section class="lesson-block" id="block-${number}" data-block-index="${index}" style="--i:${index}">
              <div class="card reveal">
                <div class="block-eyebrow">UNKNOWN BLOCK</div>
                <h2>${escapeHtml(block.title || block.type || "Блок")}</h2>
                <p class="theory-body">Этот тип контента пока не поддерживается движком.</p>
              </div>
            </section>
          `;
      }
    }

    function renderLesson(lesson) {
      stopSpeech();
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "lesson";
      state.lesson = lesson;
      state.lessonId = Number(lesson.id);
      state.story = null;
      state.storyId = null;
      state.activeBlock = 0;
      state.backTarget = "#dashboard";

      const blocks = getLessonBlocks(lesson);
      const practiceIndex = blocks.findIndex((block) => block.type === "practice_write");

      app.innerHTML = `
        ${renderHero(lesson, blocks, practiceIndex)}
        <div class="shell">
          <div class="lesson-layout">
            ${renderToc(lesson, blocks)}
            <article class="lesson-content" id="lesson" aria-label="${escapeHtml(lesson.title || "Урок")}">
              ${blocks.map((block, index) => renderBlock(block, index, lesson)).join("")}
            </article>
          </div>
        </div>
      `;

      const section = (lesson.module || "lesson").split("//")[0].trim().toLowerCase() || "lesson";
      topbarContext.textContent = `lesson_${pad(lesson.id || 1)} / ${section}`;
      progressValue.textContent = "00";
      topProgressBar.style.width = "0%";
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", "Глубина прохождения урока");
      backToLessons.hidden = false;
      backLabel.textContent = t("back_lessons");
      backToLessons.setAttribute("aria-label", "Вернуться к урокам");
      updateSectionUI("course");
      document.title = `LINGUA/OS — ${lesson.title || "Lesson"}`;
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `lesson_${pad(lesson.id || 1)} / ${blocks.length} blocks`;

      enhanceVocabulary();
      initWriters(lesson);
      initQuizzes(lesson);
      state.scrollCleanup = setupScrollTracking();
      scrollToTopInstant();
    }

    /* ---------- writing practice ---------- */
    function initWriters(lesson) {
      document.querySelectorAll("[data-writer]").forEach((writer) => {
        const lessonId = Number(writer.dataset.lessonId || lesson.id || 1);
        const blockIndex = Number(writer.dataset.blockIndex);
        const storageKey = getWritingKey(lessonId, blockIndex);
        const minWords = Number(writer.dataset.minWords) || 90;
        const maxWords = Number(writer.dataset.maxWords) || 140;
        const textarea = writer.querySelector("[data-writer-input]");
        const saveButton = writer.querySelector("[data-save]");
        const clearButton = writer.querySelector("[data-clear]");
        const status = writer.querySelector("[data-writer-status]");
        const wordCount = writer.querySelector("[data-word-count]");
        const wordMeter = writer.querySelector("[data-word-meter]");
        const meterBar = writer.querySelector("[data-meter-bar]");
        const savedLine = writer.querySelector("[data-saved-line]");
        const practiceScope = writer.closest(".lesson-block") || writer;
        let savedRecord = null;
        let clearArmed = false;
        let clearTimer = null;

        function setStatus(kind, text) {
          status.className = `editor-status${kind ? ` is-${kind}` : ""}`;
          status.textContent = text;
        }

        function updateMeter() {
          const words = countWords(textarea.value);
          wordCount.textContent = String(words);
          const percent = Math.min(100, (words / minWords) * 100);
          meterBar.style.width = `${percent}%`;
          wordMeter.classList.toggle("is-complete", words >= minWords);
          wordMeter.classList.toggle("is-over", words > maxWords);
        }

        function autoGrow() {
          textarea.style.height = "auto";
          const nextHeight = Math.min(Math.max(textarea.scrollHeight, 300), 560);
          textarea.style.height = `${nextHeight}px`;
        }

        function renderSavedInfo(record) {
          if (!record || !record.savedAt) {
            savedLine.hidden = true;
            savedLine.innerHTML = "";
            return;
          }
          savedLine.hidden = false;
          savedLine.innerHTML = `${icon("check")}<span>Сохранено ${escapeHtml(formatSavedAt(record.savedAt))} · ${Number(record.words) || countWords(record.text)} слов</span>`;
        }

        function resetClearArmed() {
          clearArmed = false;
          window.clearTimeout(clearTimer);
          clearButton.classList.remove("is-armed");
          clearButton.textContent = "Очистить";
        }

        function save() {
          const text = textarea.value;
          if (!text.trim()) {
            setStatus("error", "Пустой черновик");
            showToast("Сначала напиши хотя бы одно предложение.", "info");
            textarea.focus();
            return;
          }
          const record = {
            text,
            words: countWords(text),
            savedAt: new Date().toISOString()
          };
          const stored = writeJSON(storageKey, record);
          if (!stored) {
            setStatus("error", "localStorage недоступен");
            showToast("Браузер запретил локальное сохранение.", "error");
            return;
          }
          savedRecord = record;
          setStatus("saved", "Сохранено в этом браузере");
          renderSavedInfo(record);
          showToast(`Работа сохранена · ${record.words} слов`, "success");
        }

        textarea.addEventListener("input", () => {
          updateMeter();
          autoGrow();
          setStatus("dirty", "Есть несохранённые изменения");
        });

        textarea.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "s" || event.key === "Enter")) {
            event.preventDefault();
            save();
          }
        });

        saveButton.addEventListener("click", save);

        clearButton.addEventListener("click", () => {
          if (!clearArmed) {
            clearArmed = true;
            clearButton.classList.add("is-armed");
            clearButton.textContent = "Точно удалить?";
            clearTimer = window.setTimeout(resetClearArmed, 3200);
            return;
          }
          removeStored(storageKey);
          textarea.value = "";
          savedRecord = null;
          updateMeter();
          autoGrow();
          renderSavedInfo(null);
          setStatus("", "Новый черновик");
          resetClearArmed();
          textarea.focus();
          showToast("Черновик удалён", "info");
        });

        practiceScope.querySelectorAll("[data-phrase]").forEach((button) => {
          button.addEventListener("click", () => {
            const phrase = button.dataset.phrase || "";
            const start = textarea.selectionStart ?? textarea.value.length;
            const end = textarea.selectionEnd ?? start;
            const before = textarea.value.slice(0, start);
            const needsSpace = before && !/\s$/.test(before) ? " " : "";
            textarea.setRangeText(`${needsSpace}${phrase}`, start, end, "end");
            textarea.focus();
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
          });
        });

        const restored = readJSON(storageKey, null);
        if (restored && typeof restored.text === "string") {
          textarea.value = restored.text;
          savedRecord = restored;
          setStatus("saved", "Восстановлено из памяти");
          renderSavedInfo(restored);
        }
        updateMeter();
        window.requestAnimationFrame(autoGrow);
      });
    }

    /* ---------- quizzes ---------- */
    function initQuizzes(lesson) {
      document.querySelectorAll("[data-quiz]").forEach((quiz) => {
        const lessonId = Number(quiz.dataset.lessonId || lesson.id || 1);
        const blockIndex = Number(quiz.dataset.blockIndex);
        const block = getLessonBlocks(lesson)[blockIndex];
        if (!block || !Array.isArray(block.questions) || !block.questions.length) return;

        const questions = block.questions;
        const storageKey = getQuizKey(lessonId, blockIndex);
        const stored = readJSON(storageKey, null);
        const answers = {};
        if (stored && stored.answers && typeof stored.answers === "object") {
          Object.entries(stored.answers).forEach(([key, value]) => {
            const questionIndex = Number(key);
            const optionIndex = Number(value);
            const question = questions[questionIndex];
            if (
              Number.isInteger(questionIndex)
              && questionIndex >= 0
              && questionIndex < questions.length
              && Number.isInteger(optionIndex)
              && optionIndex >= 0
              && optionIndex < (question.options || []).length
            ) {
              answers[questionIndex] = optionIndex;
            }
          });
        }

        const questionEls = [...quiz.querySelectorAll("[data-quiz-question]")];
        const answeredEl = quiz.querySelector("[data-quiz-answered]");
        const correctEl = quiz.querySelector("[data-quiz-correct]");
        const meterEl = quiz.querySelector("[data-quiz-meter]");
        const resultEl = quiz.querySelector("[data-quiz-result]");
        const resultValue = quiz.querySelector("[data-quiz-result-value]");
        const resultTitle = quiz.querySelector("[data-quiz-result-title]");
        const resultCopy = quiz.querySelector("[data-quiz-result-copy]");
        const resetButton = quiz.querySelector("[data-quiz-reset]");

        function getCorrectCount() {
          return Object.entries(answers).reduce((sum, [questionIndex, selected]) => {
            return sum + (Number(selected) === Number(questions[questionIndex].correct) ? 1 : 0);
          }, 0);
        }

        function applyAnswer(questionIndex, selected) {
          const question = questions[questionIndex];
          const questionEl = questionEls[questionIndex];
          if (!question || !questionEl) return;
          const selectedIndex = Number(selected);
          const correctIndex = Number(question.correct);
          const isCorrect = selectedIndex === correctIndex;
          const optionButtons = [...questionEl.querySelectorAll("[data-quiz-option]")];

          optionButtons.forEach((button, optionIndex) => {
            button.disabled = true;
            button.classList.remove("is-correct", "is-wrong");
            if (optionIndex === correctIndex) button.classList.add("is-correct");
            if (!isCorrect && optionIndex === selectedIndex) button.classList.add("is-wrong");
          });

          const feedback = questionEl.querySelector("[data-quiz-feedback]");
          const feedbackTitle = questionEl.querySelector("[data-feedback-title]");
          const feedbackText = questionEl.querySelector("[data-feedback-text]");
          if (feedback) {
            feedback.hidden = false;
            feedback.classList.toggle("is-wrong", !isCorrect);
            if (feedbackTitle) feedbackTitle.textContent = isCorrect ? "Correct · правило сработало" : "Not quite · разберём";
            if (feedbackText) {
              feedbackText.textContent = isCorrect
                ? (question.explanation || "Верно.")
                : `${question.explanation || ""} Правильный ответ: ${question.options[correctIndex]}.`.trim();
            }
          }
        }

        function updateSummary() {
          const answeredCount = Object.keys(answers).length;
          const correctCount = getCorrectCount();
          const total = questions.length;
          const allAnswered = answeredCount === total;

          if (answeredEl) answeredEl.textContent = String(answeredCount);
          if (correctEl) correctEl.textContent = String(correctCount);
          if (meterEl) meterEl.style.width = `${total ? (answeredCount / total) * 100 : 0}%`;

          if (resultEl && resultValue && resultTitle && resultCopy) {
            resultEl.hidden = !allAnswered;
            if (allAnswered) {
              const ratio = total ? correctCount / total : 0;
              resultValue.textContent = `${correctCount} / ${total}`;
              resultTitle.textContent = ratio === 1
                ? "Чисто. Правило встроено."
                : ratio >= 0.67
                  ? "Хороший результат."
                  : "Нужен ещё один проход.";
              resultCopy.textContent = ratio === 1
                ? "Все вопросы закрыты. Возвращайся к практике, когда захочешь закрепить."
                : ratio >= 0.67
                  ? "Основа уверенная. Перечитай объяснение к ошибке — там остался нюанс."
                  : "Вернись к теории и пройди тест ещё раз. Лучше медленно, но без багов.";
            }
          }

          return { answeredCount, correctCount, allAnswered };
        }

        function persist(completed) {
          writeJSON(storageKey, {
            answers,
            correct: getCorrectCount(),
            total: questions.length,
            completed,
            updatedAt: new Date().toISOString()
          });
        }

        quiz.addEventListener("click", (event) => {
          const option = event.target.closest("[data-quiz-option]");
          if (!option || !quiz.contains(option)) return;
          const questionEl = option.closest("[data-quiz-question]");
          if (!questionEl) return;
          const questionIndex = Number(questionEl.dataset.quizQuestion);
          if (Object.prototype.hasOwnProperty.call(answers, questionIndex)) return;
          const selected = Number(option.dataset.quizOption);
          if (!Number.isInteger(selected)) return;

          answers[questionIndex] = selected;
          applyAnswer(questionIndex, selected);
          const summary = updateSummary();
          persist(summary.allAnswered);
        });

        if (resetButton) {
          resetButton.addEventListener("click", () => {
            removeStored(storageKey);
            Object.keys(answers).forEach((key) => delete answers[key]);
            questionEls.forEach((questionEl) => {
              questionEl.querySelectorAll("[data-quiz-option]").forEach((button) => {
                button.disabled = false;
                button.classList.remove("is-correct", "is-wrong");
              });
              const feedback = questionEl.querySelector("[data-quiz-feedback]");
              if (feedback) {
                feedback.hidden = true;
                feedback.classList.remove("is-wrong");
              }
            });
            updateSummary();
            showToast("Тест сброшен. Можно попробовать снова.", "info");
          });
        }

        Object.keys(answers).forEach((questionIndex) => {
          applyAnswer(Number(questionIndex), answers[questionIndex]);
        });
        updateSummary();
      });
    }

    /* ---------- navigation / progress ---------- */
    function setupScrollTracking() {
      const blocks = [...document.querySelectorAll(".lesson-block")];
      const tocLinks = [...document.querySelectorAll(".toc-link")];
      const tocRing = document.getElementById("tocRing");
      const tocPercent = document.getElementById("tocPercent");
      const tocProgressText = document.getElementById("tocProgressText");
      const mobileTocCurrent = document.getElementById("mobileTocCurrent");
      const mobileTocPercent = document.getElementById("mobileTocPercent");
      let ticking = false;
      let rafId = 0;

      function update() {
        ticking = false;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const percent = Math.min(100, Math.max(0, (scrollTop / maxScroll) * 100));
        const rounded = Math.round(percent);

        topProgressBar.style.width = `${percent.toFixed(2)}%`;
        progressValue.textContent = pad(rounded);
        if (tocRing) tocRing.style.setProperty("--p", percent.toFixed(2));
        if (tocPercent) tocPercent.textContent = `${rounded}%`;
        if (mobileTocPercent) mobileTocPercent.textContent = `${rounded}%`;
        if (tocProgressText) {
          tocProgressText.textContent = percent < 12
            ? t("beginning")
            : percent < 45
              ? t("in_progress")
              : percent < 80
                ? t("deeper")
                : t("final_stretch");
        }

        let active = 0;
        const marker = scrollTop + window.innerHeight * 0.35;
        blocks.forEach((block, index) => {
          const top = block.getBoundingClientRect().top + scrollTop;
          if (top <= marker) active = index;
        });

        if (active !== state.activeBlock) {
          state.activeBlock = active;
          tocLinks.forEach((link) => {
            const index = Number(link.dataset.tocIndex);
            const isActive = index === active;
            link.classList.toggle("is-active", isActive);
            link.classList.toggle("is-passed", index < active);
            if (isActive) link.setAttribute("aria-current", "true");
            else link.removeAttribute("aria-current");
          });
        }
        if (mobileTocCurrent) {
          const activeLink = tocLinks.find((link) => Number(link.dataset.tocIndex) === active);
          mobileTocCurrent.textContent = `${pad(active + 1)} · ${activeLink?.dataset.tocLabel || "Блок"}`;
        }
      }

      function onScroll() {
        if (!ticking) {
          ticking = true;
          rafId = window.requestAnimationFrame(update);
        }
      }

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      update();

      return () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (rafId) window.cancelAnimationFrame(rafId);
      };
    }
