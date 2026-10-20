// LINGUA/OS · Supabase Auth, Google Identity and profile settings
"use strict";

    const GOOGLE_CLIENT_ID = (document.querySelector('meta[name="google-client-id"]')?.content || "").trim();
    let googleScriptPromise = null;

    function getInitials(name) {
      return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "?";
    }

    function profileFromUser(user) {
      const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
      const email = String(user?.email || "");
      const name = String(metadata.nickname || metadata.full_name || metadata.name || email.split("@")[0] || t("guest")).trim();
      const picture = String(metadata.avatar_url || metadata.picture || "").trim();
      const avatarEmoji = String(metadata.avatar_emoji || "").trim();
      const identities = Array.isArray(user?.identities) ? user.identities : [];
      const provider = String(user?.app_metadata?.provider || identities[0]?.provider || "email");
      const hasEmailIdentity = identities.some((identity) => identity?.provider === "email") || (identities.length === 0 && provider === "email");
      return {
        name,
        nickname: name,
        email,
        picture,
        avatar_emoji: avatarEmoji,
        avatarEmoji,
        initials: getInitials(name || email),
        id: String(user?.id || ""),
        provider,
        hasEmailIdentity,
        emailConfirmed: Boolean(user?.email_confirmed_at),
        signedInAt: new Date().toISOString()
      };
    }

    function avatarMarkup(profile) {
      const source = profile || {};
      const initials = source.initials || getInitials(source.name || source.nickname || source.email);
      const emoji = String(source.avatar_emoji || source.avatarEmoji || "").trim();
      if (emoji) return `<span class="avatar-emoji">${escapeHtml(emoji)}</span>`;
      const picture = String(source.picture || source.avatar_url || "").trim();
      if (picture) {
        return `<span class="avatar-visual"><img src="${escapeHtml(picture)}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="avatar-initials" hidden>${escapeHtml(initials)}</span></span>`;
      }
      return `<span class="avatar-initials">${escapeHtml(initials)}</span>`;
    }

    function loadProfile() {
      const stored = readJSON(PROFILE_KEY, null);
      state.profile = stored && typeof stored.name === "string" ? stored : null;
    }

    function authErrorMessage(error) {
      const code = String(error?.code || "").toLowerCase();
      const message = String(error?.message || "").toLowerCase();
      const text = `${code} ${message}`;
      if (text.includes("email not confirmed") || text.includes("email_not_confirmed")) return t("auth_error_confirm");
      if (text.includes("invalid login") || text.includes("invalid_credentials")) return t("auth_error_invalid");
      if (text.includes("already registered") || text.includes("user_already_exists") || text.includes("already exists")) return t("auth_error_exists");
      if (text.includes("password") && (text.includes("weak") || text.includes("least") || text.includes("characters"))) return t("auth_error_weak");
      if (text.includes("failed to fetch") || text.includes("network") || text.includes("load failed")) return t("auth_error_network");
      if (text.includes("provider") || text.includes("google") || text.includes("id_token")) return t("auth_error_google");
      if (text.includes("cloud config") || text.includes("supabase sdk") || text.includes("supabase") || text.includes("unavailable")) return t("auth_error_unavailable");
      return t("auth_error_generic");
    }

    function setAuthStatus(node, message, type) {
      if (!node) return;
      node.textContent = message || "";
      node.className = `auth-status${type ? ` is-${type}` : ""}`;
    }

    function setAuthBusy(busy) {
      state.authBusy = Boolean(busy);
      if (authSubmit) authSubmit.disabled = Boolean(busy);
      if (profileSave) profileSave.disabled = Boolean(busy);
      if (profilePasswordSave) profilePasswordSave.disabled = Boolean(busy);
    }

    function renderAuthTabs() {
      const mode = state.authMode === "signup" ? "signup" : "login";
      if (authTabLogin) {
        authTabLogin.classList.toggle("is-active", mode === "login");
        authTabLogin.setAttribute("aria-selected", String(mode === "login"));
      }
      if (authTabSignup) {
        authTabSignup.classList.toggle("is-active", mode === "signup");
        authTabSignup.setAttribute("aria-selected", String(mode === "signup"));
      }
      if (authSubmit) authSubmit.textContent = t(mode === "signup" ? "auth_sign_up" : "auth_sign_in");
      if (authPassword) authPassword.autocomplete = mode === "signup" ? "new-password" : "current-password";
    }

    function setAuthMode(mode) {
      state.authMode = mode === "signup" ? "signup" : "login";
      setAuthStatus(authStatus, "");
      renderAuthTabs();
    }

    function syncAvatarPresetButtons() {
      if (!avatarPresets) return;
      const selected = state.avatarEmojiDraft || "";
      avatarPresets.querySelectorAll("[data-avatar-emoji]").forEach((button) => {
        const active = (button.dataset.avatarEmoji || "") === selected;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    function syncAvatarPreview() {
      if (!profileAvatarPreview) return;
      const nickname = profileNickname?.value || state.profile?.nickname || state.profile?.name || "";
      const picture = profileAvatarUrl?.value.trim() || "";
      profileAvatarPreview.innerHTML = avatarMarkup({
        ...(state.profile || {}),
        name: nickname,
        nickname,
        picture,
        avatar_emoji: state.avatarEmojiDraft || ""
      });
    }

    function fillProfileForm() {
      const profile = state.profile || {};
      if (profileNickname) profileNickname.value = profile.nickname || profile.name || "";
      if (profileAvatarUrl) profileAvatarUrl.value = profile.picture || "";
      state.avatarEmojiDraft = profile.avatar_emoji || "";
      syncAvatarPresetButtons();
      syncAvatarPreview();
    }

    function updateProfileUI() {
      const signedIn = Boolean(state.authUser);
      const profile = state.profile || {};
      if (profileAvatar) profileAvatar.innerHTML = signedIn ? avatarMarkup(profile) : icon("user");
      if (profileLabel) profileLabel.textContent = signedIn ? String(profile.nickname || profile.name).split(/\s+/)[0] : t("login");
      if (profileButton) {
        profileButton.classList.toggle("is-signed-in", signedIn);
        profileButton.setAttribute("aria-label", signedIn ? `${t("profile_title")}: ${profile.name}` : t("profile_title"));
      }
      if (profileAvatarLarge) profileAvatarLarge.innerHTML = signedIn ? avatarMarkup(profile) : "?";
      if (profileName) profileName.textContent = signedIn ? (profile.nickname || profile.name) : t("guest");
      if (profileEmail) profileEmail.textContent = signedIn ? profile.email : t("google_note");
      if (profileProvider) {
        profileProvider.textContent = signedIn
          ? t(profile.provider === "google" ? "google_account" : "email_account")
          : t("local_profile");
      }
      if (profileSyncStatus) {
        profileSyncStatus.textContent = currentSyncState === "synced"
          ? t("cloud_synced")
          : currentSyncState === "saving"
            ? t("sync_saving")
            : currentSyncState === "blocked"
              ? t("cloud_not_ready")
              : t("local_only");
      }
      if (profileLanguage) profileLanguage.textContent = languageLabel(currentLanguage());
      if (profileSignOut) profileSignOut.hidden = !signedIn;
      if (googleButtonHost) googleButtonHost.hidden = signedIn;
      if (authSignedOut) authSignedOut.hidden = signedIn;
      if (authSignedIn) authSignedIn.hidden = !signedIn;

      const noPassword = signedIn && !profile.hasEmailIdentity;
      if (profilePasswordWarning) {
        profilePasswordWarning.hidden = !noPassword;
        profilePasswordWarning.title = t("profile_password_not_set");
        profilePasswordWarning.setAttribute("aria-label", t("profile_password_not_set"));
      }
      if (profilePasswordWarningText) {
        profilePasswordWarningText.hidden = !noPassword;
        profilePasswordWarningText.textContent = noPassword ? t("profile_password_not_set_hint") : "";
      }
      if (profilePasswordLabel) profilePasswordLabel.textContent = t(noPassword ? "profile_password_set" : "profile_password_change");
      if (profilePasswordHint) profilePasswordHint.textContent = t(noPassword ? "profile_password_not_set_hint" : "auth_password_hint");
      if (profilePasswordSave) profilePasswordSave.textContent = t("profile_password_save");
      if (profileSyncNote) profileSyncNote.textContent = t(currentSyncState === "blocked" ? "cloud_not_ready_hint" : "profile_sync_hint");
      renderAuthTabs();
    }

    function applyAuthUser(user) {
      state.authUser = user || null;
      if (user) {
        state.profile = profileFromUser(user);
        writeJSON(PROFILE_KEY, state.profile);
      } else {
        state.profile = null;
        removeStored(PROFILE_KEY);
      }
      updateProfileUI();
      fillProfileForm();
      renderAuthTabs();
      renderGoogleAuth();
    }

    function applyAuthSession(session) {
      const user = session?.user || null;
      cloudUserId = user?.id ? String(user.id) : null;
      applyAuthUser(user);
      return user;
    }

    function hydrateAuthSession(session) {
      applyAuthSession(session);
    }

    async function submitAuthForm(event) {
      event.preventDefault();
      if (state.authBusy) return;
      const email = String(authEmail?.value || "").trim();
      const password = String(authPassword?.value || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setAuthStatus(authStatus, t("auth_error_email"), "error");
        authEmail?.focus();
        return;
      }
      if (!password) {
        setAuthStatus(authStatus, t("auth_error_password"), "error");
        authPassword?.focus();
        return;
      }
      if (password.length < 6) {
        setAuthStatus(authStatus, t("auth_error_weak"), "error");
        authPassword?.focus();
        return;
      }
      setAuthBusy(true);
      setAuthStatus(authStatus, t("sync_saving"));
      try {
        const client = await ensureSupabaseClient();
        if (state.authMode === "signup") {
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { data: { nickname: email.split("@")[0] } }
          });
          if (error) throw error;
          if (!data?.session) {
            setAuthStatus(authStatus, t("auth_confirm_email"), "success");
            return;
          }
          applyAuthSession(data.session);
        } else {
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (!data?.session) throw new Error("No session returned.");
          applyAuthSession(data.session);
        }
        if (authPassword) authPassword.value = "";
        setAuthStatus(authStatus, t("auth_signed_in"), "success");
        showToast(t("auth_success"), "success");
        void startCloudSyncForProfile();
      } catch (error) {
        console.warn("Auth request failed.", error?.code || error?.message || error);
        setAuthStatus(authStatus, authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
        renderAuthTabs();
      }
    }

    async function saveProfileSettings(event) {
      event.preventDefault();
      if (!state.authUser) {
        setAuthStatus(profileStatus, t("profile_sign_in_needed"), "error");
        return;
      }
      const nickname = String(profileNickname?.value || "").trim();
      if (!nickname) {
        setAuthStatus(profileStatus, t("profile_nickname_required"), "error");
        profileNickname?.focus();
        return;
      }
      setAuthBusy(true);
      setAuthStatus(profileStatus, t("sync_saving"));
      try {
        const client = await ensureSupabaseClient();
        const metadata = { ...(state.authUser.user_metadata || {}) };
        const avatarUrl = String(profileAvatarUrl?.value || "").trim();
        const avatarEmoji = String(state.avatarEmojiDraft || "").trim();
        const { data, error } = await client.auth.updateUser({
          data: { ...metadata, nickname, avatar_url: avatarUrl, avatar_emoji: avatarEmoji }
        });
        if (error) throw error;
        if (data?.user) applyAuthUser(data.user);
        setAuthStatus(profileStatus, t("profile_saved"), "success");
        showToast(t("profile_saved"), "success");
      } catch (error) {
        console.warn("Profile update failed.", error?.code || error?.message || error);
        setAuthStatus(profileStatus, t("profile_save_error"), "error");
      } finally {
        setAuthBusy(false);
      }
    }

    async function saveProfilePassword() {
      if (!state.authUser) {
        setAuthStatus(profilePasswordStatus, t("profile_sign_in_needed"), "error");
        return;
      }
      const password = String(profilePassword?.value || "");
      if (password.length < 6) {
        setAuthStatus(profilePasswordStatus, t("auth_error_weak"), "error");
        profilePassword?.focus();
        return;
      }
      setAuthBusy(true);
      setAuthStatus(profilePasswordStatus, t("sync_saving"));
      try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        const { data } = await client.auth.getUser();
        if (data?.user) applyAuthUser(data.user);
        if (profilePassword) profilePassword.value = "";
        setAuthStatus(profilePasswordStatus, t("profile_password_saved"), "success");
        showToast(t("profile_password_saved"), "success");
      } catch (error) {
        console.warn("Password update failed.", error?.code || error?.message || error);
        setAuthStatus(profilePasswordStatus, authErrorMessage(error), "error");
      } finally {
        setAuthBusy(false);
      }
    }

    async function handleGoogleCredential(response) {
      if (!response?.credential) return;
      setAuthBusy(true);
      setAuthStatus(authStatus, t("sync_saving"));
      try {
        const client = await ensureSupabaseClient();
        const { data, error } = await client.auth.signInWithIdToken({
          provider: "google",
          token: response.credential
        });
        if (error) throw error;
        if (!data?.session) throw new Error("No Supabase session returned for Google sign-in.");
        applyAuthSession(data.session);
        setAuthStatus(authStatus, t("auth_signed_in"), "success");
        showToast(t("auth_success"), "success");
        void startCloudSyncForProfile();
      } catch (error) {
        console.warn("Google Supabase sign-in failed.", error?.code || error?.message || error);
        setAuthStatus(authStatus, authErrorMessage(error), "error");
        showToast(t("auth_error_google"), "error");
      } finally {
        setAuthBusy(false);
      }
    }

    function handleCredentialResponse(response) {
      void handleGoogleCredential(response);
    }

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
      if (state.authUser) {
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
        if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>${escapeHtml(t("google_client_missing"))}</span></button>`;
        if (googleAuthNote) googleAuthNote.textContent = t("auth_local_note");
        return;
      }
      if (!window.google?.accounts?.id) {
        if (googleButtonHost) googleButtonHost.innerHTML = `<div class="google-auth-loading">${escapeHtml(t("google_loading"))}</div>`;
        if (googleAuthNote) googleAuthNote.textContent = t("google_loading");
        loadGoogleIdentityScript()
          .then(() => {
            if (!state.authUser) renderGoogleAuth();
          })
          .catch((error) => {
            console.warn(error);
            if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>${escapeHtml(t("google_unavailable"))}</span></button>`;
            if (googleAuthNote) googleAuthNote.textContent = t("google_unavailable");
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
        if (googleButtonHost) {
          googleButtonHost.innerHTML = "";
          google.accounts.id.renderButton(googleButtonHost, {
            type: "standard",
            theme: "outline",
            size: "large",
            shape: "pill",
            text: "signin_with",
            logo_alignment: "left",
            width: 320,
            locale: state.settings.uiLanguage || "en"
          });
        }
        if (googleHeaderHost) {
          googleHeaderHost.innerHTML = "";
          googleHeaderHost.title = t("login");
          google.accounts.id.renderButton(googleHeaderHost, {
            type: "standard",
            theme: "outline",
            size: "medium",
            shape: "pill",
            text: "signin_with",
            width: 180,
            locale: state.settings.uiLanguage || "en"
          });
          googleHeaderHost.hidden = false;
        }
        if (googleAuthNote) googleAuthNote.textContent = t("google_ready");
      } catch (error) {
        console.error(error);
        if (googleButtonHost) googleButtonHost.innerHTML = `<button class="google-button google-button-disabled" type="button" disabled><span class="google-g" aria-hidden="true">G</span><span>${escapeHtml(t("google_unavailable"))}</span></button>`;
        if (googleHeaderHost) googleHeaderHost.hidden = true;
        if (googleAuthNote) googleAuthNote.textContent = t("auth_error_google");
      }
    }

    function openProfileModal() {
      state.lastFocus = document.activeElement;
      setAuthStatus(authStatus, "");
      setAuthStatus(profileStatus, "");
      setAuthStatus(profilePasswordStatus, "");
      updateProfileUI();
      fillProfileForm();
      renderAuthTabs();
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

    async function signOutProfile() {
      try {
        if (supabaseClient) await supabaseClient.auth.signOut();
      } catch (error) {
        console.warn("Supabase sign-out failed.", error);
      }
      state.authUser = null;
      state.profile = null;
      cloudUserId = null;
      window.clearTimeout(cloudTimer);
      removeStored(PROFILE_KEY);
      try {
        if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      } catch (error) {
        console.warn("Google sign-out cleanup failed.", error);
      }
      setSyncStatus("local");
      updateProfileUI();
      fillProfileForm();
      renderAuthTabs();
      renderGoogleAuth();
      showToast(t("auth_signed_out"), "info");
    }

    function initAuthUI() {
      authTabLogin?.addEventListener("click", () => setAuthMode("login"));
      authTabSignup?.addEventListener("click", () => setAuthMode("signup"));
      authForm?.addEventListener("submit", submitAuthForm);
      profileForm?.addEventListener("submit", saveProfileSettings);
      passwordForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveProfilePassword();
      });
      profilePasswordSave?.addEventListener("click", () => void saveProfilePassword());
      profileAvatarUrl?.addEventListener("input", () => {
        state.avatarEmojiDraft = "";
        syncAvatarPresetButtons();
        syncAvatarPreview();
      });
      profileNickname?.addEventListener("input", syncAvatarPreview);
      avatarPresets?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-avatar-emoji]");
        if (!button) return;
        state.avatarEmojiDraft = button.dataset.avatarEmoji || "";
        syncAvatarPresetButtons();
        syncAvatarPreview();
      });
      document.addEventListener("click", (event) => {
        const openButton = event.target.closest("[data-open-profile]");
        if (!openButton) return;
        closeSettings();
        openProfileModal();
      });
    }

    initAuthUI();
