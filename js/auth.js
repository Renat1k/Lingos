// LINGUA/OS · Google Identity profile and authentication
"use strict";

    /* ---------- profile / Google Identity ---------- */
    const GOOGLE_CLIENT_ID = (document.querySelector('meta[name="google-client-id"]')?.content || "").trim();
    function getInitials(name) {
      return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "?";
    }

    function avatarMarkup(profile, sizeClass) {
      if (profile && profile.picture) {
        return `<img src="${escapeHtml(profile.picture)}" alt="" referrerpolicy="no-referrer" />`;
      }
      return escapeHtml(profile ? (profile.initials || getInitials(profile.name)) : "?");
    }

    function loadProfile() {
      const stored = readJSON(PROFILE_KEY, null);
      state.profile = stored && typeof stored.name === "string" ? stored : null;
    }

    function updateProfileUI() {
      const signedIn = Boolean(state.profile);
      const initials = signedIn ? (state.profile.initials || getInitials(state.profile.name)) : "";

      if (profileAvatar) {
        profileAvatar.innerHTML = signedIn ? avatarMarkup(state.profile) : icon("user");
      }
      if (profileLabel) {
        profileLabel.textContent = signedIn ? String(state.profile.name).split(/\s+/)[0] : t("login");
      }
      if (profileButton) {
        profileButton.classList.toggle("is-signed-in", signedIn);
        profileButton.setAttribute("aria-label", signedIn ? `Профиль ${state.profile.name}` : "Профиль и вход");
      }
      if (profileAvatarLarge) {
        profileAvatarLarge.innerHTML = signedIn ? avatarMarkup(state.profile) : "?";
      }
      if (profileName) profileName.textContent = signedIn ? state.profile.name : t("guest");
      if (profileEmail) {
        profileEmail.textContent = signedIn
          ? state.profile.email
          : t("google_note");
      }
      if (profileProvider) profileProvider.textContent = signedIn ? t("google_account") : t("local_profile");
      if (profileSyncStatus) {
        profileSyncStatus.textContent = currentSyncState === "synced"
          ? t("cloud_synced")
          : currentSyncState === "saving"
            ? t("sync_saving")
            : t("local_only");
      }
      if (profileLanguage) profileLanguage.textContent = languageLabel(currentLanguage());
      if (profileSignOut) profileSignOut.hidden = !signedIn;
      if (googleButtonHost) googleButtonHost.hidden = signedIn;
      if (signedIn && googleAuthNote) googleAuthNote.textContent = "";
      if (signedIn) {
        if (googleButtonHost) googleButtonHost.innerHTML = "";
        if (googleHeaderHost) {
          googleHeaderHost.hidden = true;
          googleHeaderHost.innerHTML = "";
        }
      }
    }

    function decodeGoogleCredential(token) {
      const payload = String(token || "").split(".")[1];
      if (!payload) throw new Error("Google token has no payload.");
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const binary = window.atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    }

    function handleGoogleCredential(response) {
      try {
        if (!response || !response.credential) throw new Error("Google не вернул credential.");
        const claims = decodeGoogleCredential(response.credential);
        if (!claims || !claims.email) throw new Error("В Google-профиле нет email.");
        state.profile = {
          name: claims.name || claims.email.split("@")[0],
          email: claims.email,
          picture: claims.picture || "",
          initials: getInitials(claims.name || claims.email),
          sub: claims.sub || "",
          provider: "google",
          signedInAt: new Date().toISOString()
        };
        writeJSON(PROFILE_KEY, state.profile);
        updateProfileUI();
        showToast("Google-профиль подключён. Имя и фото сохранены локально.", "success");
        if (cloudConfigReady()) {
          startCloudSyncForProfile();
        }
      } catch (error) {
        console.error(error);
        showToast(`Google-вход не завершён: ${error.message}`, "error");
      }
    }

    function handleCredentialResponse(response) {
      handleGoogleCredential(response);
    }

    let googleScriptPromise = null;

    function loadGoogleIdentityScript() {
      if (window.google?.accounts?.id) return Promise.resolve();
      if (!GOOGLE_CLIENT_ID) return Promise.resolve();
      if (googleScriptPromise) return googleScriptPromise;
      googleScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
          googleScriptPromise = null;
          reject(new Error("Google Identity script failed to load."));
        };
        document.head.appendChild(script);
      });
      return googleScriptPromise;
    }

    function renderGoogleAuth() {
      if (!googleButtonHost && !googleHeaderHost) return;
      if (state.profile) {
        if (googleButtonHost) {
          googleButtonHost.innerHTML = "";
          googleButtonHost.hidden = true;
        }
        if (googleHeaderHost) {
          googleHeaderHost.innerHTML = "";
          googleHeaderHost.hidden = true;
        }
        return;
      }
      if (googleButtonHost) googleButtonHost.hidden = false;
      if (googleHeaderHost) googleHeaderHost.hidden = true;
      if (!GOOGLE_CLIENT_ID) {
        if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>Локальный профиль · Google не обязателен</span></button>`;
        googleAuthNote.textContent = "Приложение полностью работает без входа и внешних ключей. Google Client ID нужен только для необязательной синхронизации профиля.";
        return;
      }
      if (!window.google?.accounts?.id) {
        if (googleButtonHost) googleButtonHost.innerHTML = `<div class="google-auth-loading">Загружаем Google Identity…</div>`;
        googleAuthNote.textContent = "Авторизация подключается при открытии профиля.";
        loadGoogleIdentityScript()
          .then(() => {
            if (!state.profile) renderGoogleAuth();
          })
          .catch((error) => {
            console.warn(error);
            if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>Google Identity недоступен офлайн</span></button>`;
            googleAuthNote.textContent = "Локальный режим продолжает работать. Проверь сеть или OAuth Client ID.";
          });
        return;
      }
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true
        });
        const buttonContainer = document.getElementById("google-btn-container");
        if (buttonContainer) {
          buttonContainer.innerHTML = "";
          google.accounts.id.renderButton(buttonContainer, {
            type: "standard",
            theme: "outline",
            size: "large",
            shape: "pill",
            text: "signin_with",
            logo_alignment: "left",
            width: 320,
            locale: "ru"
          });
        }
        if (googleHeaderHost) {
          googleHeaderHost.innerHTML = "";
          googleHeaderHost.title = "Войти через Google";
          google.accounts.id.renderButton(googleHeaderHost, {
            type: "standard",
            theme: "outline",
            size: "medium",
            shape: "pill",
            text: "signin_with",
            width: 180,
            locale: "ru"
          });
          googleHeaderHost.hidden = false;
        }
        googleAuthNote.textContent = "Официальный Google Identity Services активирован. Вход опционален: прогресс хранится локально.";
      } catch (error) {
        console.error(error);
        if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>Google временно недоступен</span></button>`;
        if (googleHeaderHost) googleHeaderHost.hidden = true;
        googleAuthNote.textContent = "Проверь Client ID и Authorized JavaScript origins. Локальный режим работает без входа.";
      }
    }

    function openProfileModal() {
      state.lastFocus = document.activeElement;
      updateProfileUI();
      if (!profileModal.open) {
        if (typeof profileModal.showModal === "function") profileModal.showModal();
        else profileModal.setAttribute("open", "");
      }
      renderGoogleAuth();
    }

    function closeProfileModal() {
      if (profileModal.open && typeof profileModal.close === "function") profileModal.close();
      else profileModal.removeAttribute("open");
    }

    function signOutProfile() {
      state.profile = null;
      cloudEmail = null;
      window.clearTimeout(cloudTimer);
      removeStored(PROFILE_KEY);
      try {
        if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      } catch (error) {
        console.warn("Google sign-out cleanup failed.", error);
      }
      setSyncStatus("local");
      updateProfileUI();
      if (profileModal.open) renderGoogleAuth();
      showToast("Вы вышли из профиля. Локальные данные сохранены.", "info");
    }
