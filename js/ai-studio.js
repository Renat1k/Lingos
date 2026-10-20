// LINGUA/OS · local Gemini API key and key check
"use strict";

    function setGeminiStatus(kind, detail) {
      if (!geminiStatus) return;
      geminiStatus.dataset.state = kind || "";
      if (!kind) {
        geminiStatus.textContent = "";
        return;
      }
      if (kind === "ok") geminiStatus.textContent = `🟢 ${t("connected")}`;
      else if (kind === "error") geminiStatus.textContent = `🔴 ${t("error")}${detail ? ` · ${detail}` : ""}`;
      else if (kind === "missing") geminiStatus.textContent = `⚪ ${t("missing")}`;
      else geminiStatus.textContent = detail || "";
    }

    function saveGeminiKey(value) {
      state.geminiKey = String(value || "").trim();
      try {
        if (state.geminiKey) window.localStorage.setItem(GEMINI_KEY_STORAGE, state.geminiKey);
        else window.localStorage.removeItem(GEMINI_KEY_STORAGE);
      } catch (error) { /* storage may be unavailable */ }
    }

    async function testGeminiKey() {
      const key = geminiKeyInput.value.trim();
      if (!key) {
        setGeminiStatus("missing");
        geminiKeyInput.focus();
        return;
      }
      saveGeminiKey(key);
      geminiTest.disabled = true;
      setGeminiStatus("checking", `⏳ ${t("sync_saving")}`);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 1 }
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setGeminiStatus("ok");
        showToast(t("connected"), "success");
      } catch (error) {
        console.warn("Gemini key test failed.", error);
        setGeminiStatus("error", error.name === "AbortError" ? "timeout" : "request");
      } finally {
        window.clearTimeout(timer);
        geminiTest.disabled = false;
      }
    }
