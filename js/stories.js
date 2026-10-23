// LINGUA/OS · stories, reading, translation panel
"use strict";

    /* ---------- stories ---------- */
    let showHiddenStories = false;

    function normalizeHiddenEntry(value, fallbackAt) {
      if (value === true) return { hidden: true, at: String(fallbackAt || "") };
      if (!value || typeof value !== "object") return null;
      return { hidden: Boolean(value.hidden), at: String(value.at || fallbackAt || "") };
    }

    function normalizeHiddenBucket(bucket, fallbackAt) {
      const normalized = {};
      if (!bucket || typeof bucket !== "object") return normalized;
      Object.entries(bucket).forEach(([id, value]) => {
        const entry = normalizeHiddenEntry(value, fallbackAt);
        if (entry) normalized[String(id)] = entry;
      });
      return normalized;
    }

    function getHiddenContent() {
      const stored = readJSON(HIDDEN_CONTENT_KEY, null);
      const source = stored && typeof stored === "object" ? stored : {};
      const updatedAt = String(source.updated_at || "");
      return {
        lessons: normalizeHiddenBucket(source.lessons, updatedAt),
        stories: normalizeHiddenBucket(source.stories, updatedAt),
        updated_at: updatedAt
      };
    }

    function hiddenBucketKey(type) {
      return type === "story" ? "stories" : "lessons";
    }

    function hiddenContentKey(type, id, code = state.language) {
      return `${code || "global"}:${String(id)}`;
    }

    function isBuiltinCourseItem(type, id) {
      const items = type === "story" ? state.languagePack?.stories : state.languagePack?.lessons;
      return (Array.isArray(items) ? items : []).some((item) => Number(item.id) === Number(id));
    }

    function isImportedCourseItem(type, id) {
      const items = type === "story" ? state.importedStories : state.importedLessons;
      return (Array.isArray(items) ? items : []).some((item) => Number(item.id) === Number(id));
    }

    function isContentHidden(type, id, allowLegacy = true) {
      if (type !== "lesson" && type !== "story") return false;
      const bucket = getHiddenContent()[hiddenBucketKey(type)] || {};
      const scopedKey = hiddenContentKey(type, id);
      if (Object.prototype.hasOwnProperty.call(bucket, scopedKey)) {
        return Boolean(bucket[scopedKey]?.hidden);
      }
      if (allowLegacy && isBuiltinCourseItem(type, id)) {
        return Boolean(bucket[String(id)]?.hidden);
      }
      return false;
    }

    function setContentHidden(type, id, hidden) {
      if (type !== "lesson" && type !== "story") return false;
      const content = getHiddenContent();
      const bucket = content[hiddenBucketKey(type)];
      const now = new Date().toISOString();
      bucket[hiddenContentKey(type, id)] = { hidden: Boolean(hidden), at: now };
      content.updated_at = now;
      return writeJSON(HIDDEN_CONTENT_KEY, content);
    }

    function isContentDeleted(type, id, updatedAt) {
      return tombstoneBlocks(findTombstone(type, { language: state.language, id: String(id) }), { updated_at: updatedAt });
    }

    function applyHiddenFlags(type, items) {
      const bucket = getHiddenContent()[hiddenBucketKey(type)] || {};
      (Array.isArray(items) ? items : []).forEach((item) => {
        item.is_hidden = isContentHidden(type, item.id, !isImportedCourseItem(type, item.id));
      });
      return items;
    }

    /* ---------- read-aloud (Web Speech API) ---------- */

    function speechSupported() {
      return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }

    function speechLanguageInfo() {
      let code = String(state.language || "").trim();
      if (!SPEECH_LANGUAGE_BCP47[code]) {
        const lower = code.toLocaleLowerCase();
        const match = Object.entries(LANGUAGE_META || {}).find(([, meta]) =>
          String(meta.label || "").toLocaleLowerCase() === lower || String(meta.native || "").toLocaleLowerCase() === lower);
        if (match) code = match[0];
      }
      if (typeof vocabularySpeechLanguageInfo === "function") return vocabularySpeechLanguageInfo(code);
      const pack = state.languagePacks?.[code];
      const flagLanguage = pack?.flagCode ? SPEECH_COUNTRY_LANGUAGES[pack.flagCode] : "";
      const base = flagLanguage || code;
      const baseTag = SPEECH_LANGUAGE_BCP47[base] || (base ? `${base}-${base.toUpperCase()}` : "en-US");
      return { code, language: base, aliases: [base], baseTag, regionTag: baseTag, flagCode: pack?.flagCode || "", label: languageLabel(code) || code };
    }

    function speechLocale() {
      const info = speechLanguageInfo();
      return info?.regionTag || info?.baseTag || "en-US";
    }

    function getSpeechRate() {
      const value = Number(readJSON(SPEECH_RATE_KEY, 1));
      return [0.75, 1, 1.25].includes(value) ? value : 1;
    }

    function setSpeechRate(value) {
      const rate = [0.75, 1, 1.25].includes(Number(value)) ? Number(value) : 1;
      writeJSON(SPEECH_RATE_KEY, rate);
      state.speechRate = rate;
      return rate;
    }

    function speechRateLabel(rate) {
      return `${rate}x`;
    }

    function renderSpeechControls() {
      if (!speechSupported()) return "";
      const rate = getSpeechRate();
      return `
        <div class="speech-controls audio-toolbar" data-speech-controls>
          <button class="speech-btn" type="button" data-speech-action="play" aria-label="${escapeHtml(t("speech_listen"))}" aria-pressed="false">
            ${icon("play")}<span>${escapeHtml(t("speech_listen"))}</span>
          </button>
          <button class="speech-btn" type="button" data-speech-action="pause" aria-label="${escapeHtml(t("speech_pause"))}" aria-pressed="false" disabled>
            ${icon("pause")}<span>${escapeHtml(t("speech_pause"))}</span>
          </button>
          <button class="speech-btn" type="button" data-speech-action="stop" aria-label="${escapeHtml(t("speech_stop"))}" disabled>
            ${icon("stop")}<span>${escapeHtml(t("speech_stop"))}</span>
          </button>
          <label class="speech-rate">
            <span>${escapeHtml(t("speech_speed"))}</span>
            <select data-speech-rate aria-label="${escapeHtml(t("speech_speed"))}">
              ${[0.75, 1, 1.25].map((value) => `<option value="${value}"${Math.abs(rate - value) < 0.01 ? " selected" : ""}>${speechRateLabel(value)}</option>`).join("")}
            </select>
          </label>
        </div>
      `;
    }

    let speechState = { active: false, paused: false, queue: [], index: 0, utterance: null, target: null, token: 0, words: [], activeWord: null, currentWordIndex: -1 };

    function speechSentenceParts(text) {
      const source = String(text || "");
      const pattern = /[^.!?…]+[.!?…]+|[^.!?…]+$/g;
      const parts = [];
      let match;
      while ((match = pattern.exec(source))) {
        const raw = match[0];
        const leading = (raw.match(/^\s*/) || [""])[0].length;
        const value = raw.trim();
        if (!value) continue;
        let local = 0;
        while (value.length - local > 220) {
          let cut = value.lastIndexOf(" ", local + 220);
          if (cut <= local) cut = local + 220;
          const chunk = value.slice(local, cut);
          const chunkLeading = (chunk.match(/^\s*/) || [""])[0].length;
          if (chunk.trim()) parts.push({ text: chunk.trim(), start: match.index + leading + local + chunkLeading });
          local = cut;
        }
        const rest = value.slice(local);
        if (rest.trim()) {
          const restLeading = (rest.match(/^\s*/) || [""])[0].length;
          parts.push({ text: rest.trim(), start: match.index + leading + local + restLeading });
        }
      }
      return parts;
    }

    function wrapSpeechWords(target) {
      if (!target || target.querySelector(".speech-word")) return;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      let offset = 0;
      nodes.forEach((node) => {
        const text = node.nodeValue || "";
        const parent = node.parentElement;
        if (!parent || parent.closest(".vocab, .gloss, .speech-word")) {
          offset += text.length;
          return;
        }
        const pattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
        const matches = [...text.matchAll(pattern)];
        if (!matches.length) {
          offset += text.length;
          return;
        }
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        matches.forEach((match) => {
          const start = offset + match.index;
          if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
          const span = document.createElement("span");
          span.className = "speech-word";
          span.dataset.speechStart = String(start);
          span.dataset.speechEnd = String(start + match[0].length);
          span.textContent = match[0];
          fragment.appendChild(span);
          cursor = match.index + match[0].length;
        });
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
        offset += text.length;
      });
    }

    function highlightSpeechWord(absolute, token) {
      if (!speechState.target || token !== speechState.token) return;
      const words = speechState.words || [];
      let active = null;
      for (const word of words) {
        if (Number(word.dataset.speechStart) > absolute) break;
        active = word;
      }
      speechState.activeWord?.classList.remove("speaking-word-active");
      speechState.activeWord = active;
      speechState.currentWordIndex = active ? words.indexOf(active) : -1;
      active?.classList.add("speaking-word-active");
    }

    function speechControlsFor(target) {
      const container = target?.closest(".reading-card, .story-reader, .lesson-block");
      return container?.querySelector("[data-speech-controls]") || null;
    }

    function updateSpeechControls() {
      document.querySelectorAll("[data-speech-controls]").forEach((controls) => {
        const play = controls.querySelector('[data-speech-action="play"]');
        const pause = controls.querySelector('[data-speech-action="pause"]');
        const stop = controls.querySelector('[data-speech-action="stop"]');
        if (play) {
          play.setAttribute("aria-pressed", String(speechState.active && !speechState.paused));
          play.classList.toggle("is-active", speechState.active && !speechState.paused);
        }
        if (pause) {
          pause.disabled = !speechState.active;
          pause.setAttribute("aria-pressed", String(speechState.paused));
          const label = pause.querySelector("span");
          if (label) label.textContent = t(speechState.paused ? "speech_resume" : "speech_pause");
          pause.setAttribute("aria-label", t(speechState.paused ? "speech_resume" : "speech_pause"));
        }
        if (stop) stop.disabled = !speechState.active;
      });
    }

    function stopSpeech() {
      if (!speechSupported()) return;
      speechState.token += 1;
      speechState.active = false;
      speechState.paused = false;
      speechState.queue = [];
      speechState.index = 0;
      speechState.utterance = null;
      speechState.activeWord?.classList.remove("speaking-word-active");
      speechState.activeWord = null;
      speechState.currentWordIndex = -1;
      speechState.words = [];
      speechState.target?.classList.remove("speaking-highlight");
      speechState.target = null;
      window.speechSynthesis.cancel();
      updateSpeechControls();
    }

    function loadSpeechVoices() {
      if (!speechSupported()) return Promise.resolve([]);
      const existing = window.speechSynthesis.getVoices();
      if (existing.length) return Promise.resolve(existing);
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
          resolve(window.speechSynthesis.getVoices());
        };
        window.speechSynthesis.addEventListener?.("voiceschanged", finish, { once: true });
        window.setTimeout(finish, 1200);
      });
    }

    function pickSpeechVoice(voices, locale) {
      const normalize = (value) => String(value || "").replace(/_/g, "-").toLowerCase();
      const wanted = normalize(locale);
      const base = wanted.split("-")[0];
      return voices.find((voice) => normalize(voice.lang) === wanted)
        || voices.find((voice) => normalize(voice.lang).startsWith(`${base}-`))
        || voices.find((voice) => normalize(voice.lang).split("-")[0] === base)
        || null;
    }

    function speakNext(token) {
      if (!speechState.active || token !== speechState.token) return;
      if (speechState.index >= speechState.queue.length) {
        speechState.active = false;
        speechState.paused = false;
        speechState.utterance = null;
        speechState.activeWord?.classList.remove("speaking-word-active");
        speechState.activeWord = null;
        speechState.target?.classList.remove("speaking-highlight");
        updateSpeechControls();
        return;
      }
      const sentence = speechState.queue[speechState.index];
      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = speechLocale();
      utterance.rate = getSpeechRate();
      if (speechState.voice) {
        try { utterance.voice = speechState.voice; } catch (error) { /* voice may be a plain test object */ }
      }
      utterance.onstart = () => highlightSpeechWord(sentence.start, token);
      utterance.onboundary = (event) => {
        if (event?.name && event.name !== "word") return;
        speechState.boundary = Number(event?.charIndex) || 0;
        highlightSpeechWord(sentence.start + speechState.boundary, token);
      };
      utterance.onend = () => {
        if (token !== speechState.token) return;
        speechState.index += 1;
        speakNext(token);
      };
      utterance.onerror = (event) => {
        if (event?.error === "canceled" || event?.error === "interrupted") return;
        if (token === speechState.token) stopSpeech();
      };
      speechState.utterance = utterance;
      window.speechSynthesis.speak(utterance);
      updateSpeechControls();
    }

    async function startSpeech(target) {
      if (!speechSupported()) {
        showToast(t("speech_unsupported"), "error");
        return;
      }
      const text = String(target?.textContent || "");
      const sentences = speechSentenceParts(text);
      if (!sentences.length) return;
      wrapSpeechWords(target);
      stopSpeech();
      const token = speechState.token + 1;
      speechState.token = token;
      const info = speechLanguageInfo();
      let voice = null;

      if (info && typeof ensureVocabularySpeechVoices === "function") {
        await ensureVocabularySpeechVoices();
        if (token !== speechState.token) return;
        if (typeof speechVoiceFor === "function") voice = speechVoiceFor(info);
      }

      if (!voice) {
        const voices = await loadSpeechVoices();
        if (token !== speechState.token) return;
        if (typeof resolveVocabularySpeechVoices === "function") {
          resolveVocabularySpeechVoices();
          if (typeof speechVoiceFor === "function") voice = speechVoiceFor(info);
        }
        if (!voice) voice = pickSpeechVoice(voices, speechLocale());
      }

      /* A missing Voice object must not block playback: utterance.lang is
         enough for the platform default voice, especially on mobile. */
      if (typeof console !== "undefined" && console.info) {
        console.info("[LINGUA/TTS]", {
          language: state.language,
          locale: speechLocale(),
          voices: (typeof getVocabularySpeechVoices === "function" ? getVocabularySpeechVoices() : [])
            .map((item) => ({ lang: item.lang, name: item.name, local: item.localService })),
          selected: voice ? { lang: voice.lang, name: voice.name } : null
        });
      }
      speechState.active = true;
      speechState.paused = false;
      speechState.queue = sentences;
      speechState.index = 0;
      speechState.voice = voice;
      speechState.target = target;
      speechState.words = [...target.querySelectorAll(".speech-word")];
      speechState.activeWord = null;
      speakNext(token);
    }

    function pauseSpeech() {
      if (!speechSupported() || !speechState.active || speechState.paused) return;
      try { window.speechSynthesis.pause(); } catch (error) { /* pause unavailable */ }
      speechState.paused = true;
      updateSpeechControls();
    }

    function restartSpeechFromSavedWord() {
      if (!speechState.active || !speechState.target) return;
      const token = speechState.token;
      const savedWord = speechState.words[speechState.currentWordIndex];
      const savedStart = Number(savedWord?.dataset.speechStart);
      const sentenceStart = Number(speechState.queue[speechState.index]?.start) || 0;
      const start = Number.isFinite(savedStart) && savedStart >= 0 ? savedStart : sentenceStart;
      const source = String(speechState.target.textContent || "");
      const parts = speechSentenceParts(source.slice(start)).map((part) => ({ ...part, start: part.start + start }));
      if (!parts.length) { stopSpeech(); return; }
      const old = speechState.utterance;
      if (old) { old.onend = null; old.onerror = null; }
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      } catch (error) { /* speech unavailable */ }
      speechState.utterance = null;
      speechState.queue = parts;
      speechState.index = 0;
      speechState.paused = false;
      speechState.boundary = 0;
      speakNext(token);
    }

    function resumeSpeech() {
      if (!speechSupported() || !speechState.active || !speechState.paused) return;
      const token = speechState.token;
      speechState.paused = false;
      try { window.speechSynthesis.resume(); } catch (error) { /* fallback below */ }
      updateSpeechControls();
      window.setTimeout(() => {
        if (!speechState.active || token !== speechState.token) return;
        const synth = window.speechSynthesis;
        if (synth.paused || (!synth.speaking && !synth.pending)) restartSpeechFromSavedWord();
      }, 260);
    }

    function toggleSpeechPause() {
      if (!speechSupported() || !speechState.active) return;
      if (speechState.paused) resumeSpeech();
      else pauseSpeech();
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-speech-action]");
      if (!button) return;
      const controls = button.closest("[data-speech-controls]");
      const target = controls?.closest(".reading-card, .story-reader, .lesson-block")?.querySelector(".reading-prose");
      if (!target) return;
      event.preventDefault();
      const action = button.dataset.speechAction;
      if (action === "play") {
        if (speechState.active && speechState.target === target) {
          toggleSpeechPause();
        } else {
          void startSpeech(target);
        }
      } else if (action === "pause") {
        toggleSpeechPause();
      } else if (action === "stop") {
        stopSpeech();
      }
    });

    document.addEventListener("change", (event) => {
      const select = event.target.closest("[data-speech-rate]");
      if (!select) return;
      setSpeechRate(select.value);
      document.querySelectorAll("[data-speech-rate]").forEach((other) => {
        other.value = String(getSpeechRate());
      });
    });

    document.addEventListener("close", stopSpeech, true);
    window.addEventListener("pagehide", stopSpeech);


    function initSpeechDebugPanel() {
      let params;
      try { params = new URLSearchParams(window.location.search); } catch (error) { return; }
      if (params.get("tts-debug") !== "1") return;
      const panel = document.createElement("div");
      panel.style.cssText = "position:fixed;z-index:99999;left:8px;right:8px;bottom:84px;max-height:60vh;overflow:auto;padding:12px;border:1px solid #3b82f6;border-radius:12px;background:rgba(9,10,15,.97);color:#fff;font:12px/1.45 monospace;box-shadow:0 12px 40px rgba(0,0,0,.5)";
      const title = document.createElement("strong");
      title.textContent = "LINGUA / TTS DEBUG";
      const info = document.createElement("pre");
      info.style.cssText = "margin:8px 0;white-space:pre-wrap;word-break:break-word;color:#e6edf3";
      const status = document.createElement("p");
      status.style.cssText = "margin:6px 0;color:#93c5fd";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
      const refresh = document.createElement("button");
      refresh.type = "button"; refresh.textContent = "Refresh";
      const test = document.createElement("button");
      test.type = "button"; test.textContent = "Test voice";
      const close = document.createElement("button");
      close.type = "button"; close.textContent = "Close";
      [refresh, test, close].forEach((button) => {
        button.style.cssText = "min-height:36px;padding:0 12px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#fff;font:inherit;cursor:pointer";
      });
      const refreshInfo = () => {
        const details = speechLanguageInfo();
        const voices = typeof getVocabularySpeechVoices === "function" ? getVocabularySpeechVoices() : [];
        const selected = details && typeof speechVoiceFor === "function" ? speechVoiceFor(details) : null;
        const synth = window.speechSynthesis;
        info.textContent = [
          `language: ${state.language || "—"} (${details?.label || "—"})`,
          `locale: ${speechLocale()}`,
          `supported: ${speechSupported()}`,
          `voices: ${voices.length}`,
          `selected: ${selected ? `${selected.lang} · ${selected.name}` : "NONE"}`,
          `synth: speaking=${Boolean(synth?.speaking)} pending=${Boolean(synth?.pending)} paused=${Boolean(synth?.paused)}`,
          "",
          ...voices.map((voice) => `- ${voice.lang || "?"} · ${voice.name || "?"} · local=${voice.localService !== false}`)
        ].join("\n");
      };
      refresh.addEventListener("click", refreshInfo);
      test.addEventListener("click", () => {
        if (!speechSupported()) { status.textContent = "speechSynthesis is not supported"; return; }
        const sample = speechLocale().startsWith("tr") ? "Merhaba. Bu bir ses testidir." : "This is a voice test.";
        const utterance = new SpeechSynthesisUtterance(sample);
        utterance.lang = speechLocale();
        const details = speechLanguageInfo();
        const voice = details && typeof speechVoiceFor === "function" ? speechVoiceFor(details) : null;
        try { if (voice) utterance.voice = voice; } catch (error) { /* ignore */ }
        utterance.onstart = () => { status.textContent = "TEST: started"; };
        utterance.onend = () => { status.textContent = "TEST: finished"; };
        utterance.onerror = (event) => { status.textContent = `TEST: error ${event?.error || "unknown"}`; };
        status.textContent = "TEST: requested…";
        window.speechSynthesis.speak(utterance);
      });
      close.addEventListener("click", () => panel.remove());
      actions.append(refresh, test, close);
      panel.append(title, info, status, actions);
      document.body.append(panel);
      refreshInfo();
      window.speechSynthesis?.addEventListener?.("voiceschanged", refreshInfo);
    }


    initSpeechDebugPanel();

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

    function storyReadTimeLabel(story) {
      if (String(story?.read_time || "").trim()) return story.read_time;
      const words = getStoryWordCount(story?.text || "");
      const minutes = Math.max(1, Math.ceil(words / ESTIMATED_WORDS_PER_MINUTE));
      return `${minutes} ${t("minutes")}`;
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
      return applyHiddenFlags("story", state.stories.filter((story) => !isContentDeleted("story", story.id, story.updated_at)))
        .filter((story) => showHiddenStories || !story.is_hidden);
    }

    function getHiddenStoryCount() {
      return state.stories.filter((story) => isContentHidden("story", story.id, !isImportedCourseItem("story", story.id)) && !isContentDeleted("story", story.id, story.updated_at)).length;
    }

    function storyActionMarkup(story) {
      const imported = state.importedStories.some((item) => Number(item.id) === Number(story.id));
      const hidden = isContentHidden("story", story.id, !imported);
      const eye = hidden
        ? `<button class="content-action" type="button" data-show-story="${Number(story.id)}" data-i18n-aria="show_item" aria-label="${escapeHtml(t("show_item"))}">👁</button>`
        : `<button class="content-action" type="button" data-hide-story="${Number(story.id)}" data-i18n-aria="hide_item" aria-label="${escapeHtml(t("hide_item"))}">🙈</button>`;
      if (imported) {
        return `${eye}<button class="content-action is-danger" type="button" data-delete-story="${Number(story.id)}" data-i18n-aria="delete_item" aria-label="${escapeHtml(t("delete_item"))}">${icon("trash")}</button>`;
      }
      return eye;
    }

    function getStoriesStats() {
      const cards = getVisibleStories().map((story) => ({
        story,
        read: isStoryRead(story.id),
        words: getStoryWordCount(story.text),
        vocab: getStoryVocabularyCount(story.text),
        minutes: Number.parseInt(story.read_time, 10) || Math.max(1, Math.ceil(getStoryWordCount(story.text) / ESTIMATED_WORDS_PER_MINUTE))
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

    function renderStoriesStatsMarkup(stats) {
      return `
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("book")}</span><span class="stat-code">LIBRARY</span></div>
          <div><div class="stat-value" data-story-stat="total">${stats.total}</div><span class="stat-label">историй в библиотеке</span></div>
        </div>
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">FINISHED</span></div>
          <div><div class="stat-value" data-story-stat="read">${stats.readCount}<small>из ${stats.total}</small></div><span class="stat-label">прочитано</span></div>
        </div>
        <div class="stat-card reveal active">
          <div class="stat-top"><span class="stat-icon">${icon("clock")}</span><span class="stat-code">MINUTES</span></div>
          <div><div class="stat-value" data-story-stat="minutes">${stats.totalMinutes}<small>мин</small></div><span class="stat-label">доступного чтения</span></div>
        </div>
      `;
    }

    function renderStoriesCourseLines(stats) {
      return stats.cards.map((item, index) => `
        <div class="course-line">
          <span class="course-line-label"><span>${pad(index + 1)}</span>${escapeHtml(item.story.title)}</span>
          <strong>${item.read ? "100" : "0"}%</strong>
          <div class="course-line-track"><span style="width:${item.read ? 100 : 0}%"></span></div>
        </div>
      `).join("");
    }

    function updateStoriesSummary() {
      if (state.view !== "stories") return;
      const stats = getStoriesStats();
      const ring = document.querySelector(".stories-hub .course-ring");
      if (ring) {
        ring.style.setProperty("--p", stats.percent);
        const ringValue = ring.querySelector("strong");
        if (ringValue) ringValue.textContent = `${stats.percent}%`;
      }
      const summaryCopy = document.querySelector(".stories-hub .course-summary-copy");
      if (summaryCopy) {
        const status = summaryCopy.querySelector("strong");
        if (status) status.textContent = stats.readCount === 0 ? "Ready to wander" : stats.readCount >= stats.total ? "Library complete" : "In the middle of a story";
        const detail = summaryCopy.querySelector("p");
        if (detail) detail.textContent = `${stats.readCount}/${stats.total} историй · ${stats.totalMinutes} минут чтения`;
      }
      const courseLines = document.querySelector(".stories-hub .course-lines");
      if (courseLines) courseLines.innerHTML = renderStoriesCourseLines(stats);
      const statHost = document.querySelector(".stories-hub .dashboard-stats");
      if (statHost) statHost.innerHTML = renderStoriesStatsMarkup(stats);
      const eyebrowLevel = document.querySelector(".stories-hub .dashboard-hero .eyebrow-level");
      if (eyebrowLevel) eyebrowLevel.textContent = `${stats.total} STORIES`;
      const kicker = document.querySelector(".stories-hub .modules-kicker");
      if (kicker) kicker.textContent = `STORIES / ${pad(stats.total)}`;
      const count = document.querySelector(".stories-hub .stories-section-count");
      if (count) count.textContent = `${stats.readCount} ${t("read")} · ${stats.total} ${t("total")}`;
      const tools = document.querySelector(".stories-hub .stories-section-tools");
      if (tools) {
        let toggle = tools.querySelector("[data-toggle-hidden-stories]");
        if (stats.hidden || showHiddenStories) {
          if (!toggle) {
            toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "btn btn-quiet content-hidden-toggle";
            toggle.dataset.toggleHiddenStories = "";
            tools.appendChild(toggle);
          }
          toggle.textContent = showHiddenStories ? t("hidden_hide") : t("hidden_show", { n: stats.hidden });
        } else if (toggle) {
          toggle.remove();
        }
      }
      const list = document.querySelector(".stories-hub .story-list");
      if (list) {
        const empty = list.querySelector(".stories-empty");
        if (!stats.cards.length && !empty) {
          list.innerHTML = `<div class="stories-empty"><strong>${escapeHtml(t("stories_empty_title", { lang: languageLabel(currentLanguage()) }))}</strong><br>${escapeHtml(stats.hidden ? t("hidden_show", { n: stats.hidden }) : t("stories_empty_body"))}<br>${stats.hidden ? `<button class="btn btn-primary" type="button" data-toggle-hidden-stories>${escapeHtml(t("hidden_show", { n: stats.hidden }))}</button>` : ""}<button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`;
        } else if (stats.cards.length && empty) {
          empty.remove();
        }
      }
      topbarContext.textContent = `library / ${pad(stats.total)} stories`;
      progressValue.textContent = pad(stats.percent);
      topProgressBar.style.width = `${stats.percent}%`;
      const topbarProgress = document.getElementById("topbarProgress");
      if (topbarProgress) topbarProgress.setAttribute("aria-label", `Прочитано ${stats.readCount} из ${stats.total} историй`);
      const footerMeta = document.getElementById("footerMeta");
      if (footerMeta) footerMeta.textContent = `library / ${stats.total} stories · v2.22`;
      if (typeof refreshSectionCounts === "function") refreshSectionCounts();
    }

    function refreshStoryCard(storyId) {
      const card = document.querySelector(`.story-card[data-story-id="${Number(storyId)}"]`);
      if (!card) return;
      const stats = getStoriesStats();
      const index = stats.cards.findIndex((item) => Number(item.story.id) === Number(storyId));
      if (index < 0) {
        removeStoryCard(storyId);
        return;
      }
      card.outerHTML = renderStoryCard(stats.cards[index], index);
      document.querySelector(`.story-card[data-story-id="${Number(storyId)}"]`)?.classList.add("active");
    }

    function removeStoryCard(storyId) {
      const card = document.querySelector(`.story-card[data-story-id="${Number(storyId)}"]`);
      updateStoriesSummary();
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

    function renderStoryCard(item, index) {
      const { story, read, words, vocab } = item;
      return `
        <article class="story-card reveal${read ? " is-read" : ""}" data-story-id="${Number(story.id)}" style="--i:${index}" aria-labelledby="story-card-title-${story.id}">
          <div class="story-spine" aria-hidden="true">
            <div class="story-spine-top">
              <span>STORY_${pad(story.id)}</span>
              <span>${escapeHtml(story.level || "B1")}</span>
            </div>
            <div class="story-number">${pad(story.id)}</div>
            <div class="story-spine-bottom">
              <span>${escapeHtml(storyReadTimeLabel(story))}</span>
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
                <span>${icon("clock")} ${escapeHtml(storyReadTimeLabel(story))}</span>
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

    function renderStoriesHub(options = {}) {
      stopSpeech();
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "stories";
      if (typeof setActiveAppSection === "function") setActiveAppSection("lessons");
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
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("book")}</span><span class="stat-code">LIBRARY</span></div>
              <div><div class="stat-value" data-story-stat="total">${stats.total}</div><span class="stat-label">историй в библиотеке</span></div>
            </div>
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("check")}</span><span class="stat-code">FINISHED</span></div>
              <div><div class="stat-value" data-story-stat="read">${stats.readCount}<small>из ${stats.total}</small></div><span class="stat-label">прочитано</span></div>
            </div>
            <div class="stat-card reveal active">
              <div class="stat-top"><span class="stat-icon">${icon("clock")}</span><span class="stat-code">MINUTES</span></div>
              <div><div class="stat-value" data-story-stat="minutes">${stats.totalMinutes}<small>мин</small></div><span class="stat-label">доступного чтения</span></div>
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
              ${stats.cards.length ? stats.cards.map(renderStoryCard).join("") : `<div class="stories-empty"><strong>${escapeHtml(t("stories_empty_title", { lang: languageLabel(currentLanguage()) }))}</strong><br>${escapeHtml(stats.hidden ? t("hidden_show", { n: stats.hidden }) : t("stories_empty_body"))}<br>${stats.hidden ? `<button class="btn btn-primary" type="button" data-toggle-hidden-stories>${escapeHtml(t("hidden_show", { n: stats.hidden }))}</button>` : ""}<button class="btn btn-quiet" type="button" data-open-import>${icon("upload")} ${escapeHtml(t("import_json"))}</button></div>`}
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
      if (footerMeta) footerMeta.textContent = `library / ${stats.total} stories · v2.22`;
      if (!options.preserveScroll) scrollToTopInstant();
    }

    function deleteImportedStory(storyId) {
      const story = state.importedStories.find((item) => Number(item.id) === Number(storyId));
      if (!story) return;
      state.importedStories = state.importedStories.filter((item) => Number(item.id) !== Number(storyId));
      writeJSON(importedStoriesKey(), state.importedStories);
      state.stories = mergeById(state.languagePack?.stories || [], state.importedStories);
      addTombstone("story", { id: String(storyId), language: state.language });
      showToast(t("story_deleted"), "success");
      removeStoryCard(storyId);
    }

    function focusStoryAction(selectors) {
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

    function hideStory(storyId) {
      withScrollPreserved(() => {
        setContentHidden("story", storyId, true);
        showHiddenStories = false;
        showToast(t("story_hidden"), "info");
        removeStoryCard(storyId);
      });
      focusStoryAction(["[data-toggle-hidden-stories]", "[data-hide-story]", "[data-show-story]", "[data-open-import]"]);
    }

    function showStory(storyId) {
      withScrollPreserved(() => {
        setContentHidden("story", storyId, false);
        showToast(t("story_shown"), "info");
        refreshStoryCard(storyId);
        updateStoriesSummary();
      });
      focusStoryAction(`[data-hide-story="${Number(storyId)}"]`);
    }

    document.addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-story]");
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
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
        event.stopPropagation();
        hideStory(hideButton.dataset.hideStory);
        return;
      }
      const showButton = event.target.closest("[data-show-story]");
      if (showButton) {
        event.preventDefault();
        event.stopPropagation();
        showStory(showButton.dataset.showStory);
        return;
      }
      if (event.target.closest("[data-toggle-hidden-stories]")) {
        event.preventDefault();
        const snapshot = typeof captureScrollState === "function" ? captureScrollState() : null;
        showHiddenStories = !showHiddenStories;
        renderStoriesHub({ preserveScroll: true });
        if (typeof restoreScrollState === "function") restoreScrollState(snapshot);
      }
    });

    function renderStory(story) {
      stopSpeech();
      if (typeof state.scrollCleanup === "function") {
        state.scrollCleanup();
        state.scrollCleanup = null;
      }
      closeTranslation();
      state.view = "story";
      if (typeof setActiveAppSection === "function") setActiveAppSection("lessons");
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
              <span class="story-meta-chip">${icon("clock")} ${escapeHtml(storyReadTimeLabel(story))}</span>
              <span class="story-meta-chip">${icon("book")} ${words} ${pluralRu(words, "слово", "слова", "слов")}</span>
              <span class="story-meta-chip">${vocab} ${pluralRu(vocab, "слово", "слова", "слов")} в глоссарии</span>
              <span class="story-meta-chip${read ? " is-read" : ""}" data-story-read-state>${read ? `${icon("check")} Прочитано` : "Не прочитано"}</span>
            </div>
          </header>

          <div class="card reveal reading-card story-text-card">
            <div class="story-reader-toolbar">
              <span class="reading-length">${icon("clock")} ${escapeHtml(storyReadTimeLabel(story))} чтения</span>
              ${renderSpeechControls()}
              <span class="glossary-pill"><span class="dot" aria-hidden="true"></span><strong data-vocab-count></strong> слов открыто</span>
            </div>
            <div class="reading-prose story-prose" data-ai-selectable="story">${decorateGlossary(story.text || "", story.glossary)}</div>
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
