# LINGUA/OS 2.4

Мультиязычная учебная среда на HTML + CSS + Vanilla JS. Локальный режим работает без backend; Google Auth и Supabase Cloud Sync подключаются автоматически.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Приложение: темы, уроки, импорт, Google Auth, Cloud Sync, офлайн-снапшот |
| `lessons.json` | Языковые пакеты и контент |
| `README.md` | Деплой и настройка интеграций |

## Деплой на GitHub Pages

1. Положи `index.html` и `lessons.json` в корень репозитория.
2. **Settings → Pages → Build and deployment** → `Deploy from a branch` → `/ (root)`.
3. Открой `https://<username>.github.io/<repo>/`.

Сборка не нужна. `fetch("./lessons.json")` работает и в подпапке Pages. При `file://` используется встроенный base64-снапшот. Без сети приложение продолжает работать локально.

## Google Auth

Client ID установлен в `index.html`:

```html
<meta name="google-client-id" content="890082377108-ntk8gi1id7utibvc4p9emrrod1oildas.apps.googleusercontent.com" />
```

GIS загружается по требованию, официальная кнопка отображается в шапке (на широких экранах) и в модальном окне профиля. При успешном входе `name`, `email`, `picture`, `sub` сохраняются в `lingua_profile`.

В Google Cloud Console у OAuth Web Client должны быть разрешены:

- `https://<username>.github.io`
- `http://localhost:8765` — для локальных проверок.

## Cloud Sync: Supabase

Проект уже указан в `index.html`, а Supabase SDK подключён через CDN. Схема БД и RLS обновляются вручную файлом [`sql/migration.sql`](sql/migration.sql).

### Supabase Auth

Включи в Supabase Dashboard:

1. **Authentication → Providers → Email**: включён. Email confirmation можно оставить выключенным; при включённом приложение покажет «подтвердите почту».
2. **Authentication → Providers → Google**: включён, Client ID и Client Secret из Google Cloud.
3. В Google Cloud → OAuth Client → **Authorized JavaScript origins** добавь `http://localhost:8000`, `http://127.0.0.1:8765` и GitHub Pages origin.
4. Если в Supabase включена nonce-проверка Google, настрой её отдельно: текущий GIS-вход передаёт ID token без отдельного nonce и рассчитан на провайдер без nonce-проверки.

### Миграция user_id

Выполни [`sql/migration.sql`](sql/migration.sql) в Supabase SQL Editor после бэкапа. Она:

- добавляет `user_id uuid` и уникальный индекс;
- включает RLS и создаёт политики `auth.uid() = user_id`;
- сохраняет старые строки;
- содержит отдельный проверочный запрос и backfill только для подтверждённого e-mail.

Перед backfill просмотри `pg_policies`: старые permissive-политики нужно удалить, иначе они останутся разрешающими.

До миграции приложение работает локально и показывает статус **«Облако не готово»**; оно не пишет данные по непроверенному email.

## Синхронизация

- Строка `user_data` принадлежит `auth.uid()`; `user_email` — только описательное поле.
- При входе и перед каждым push выполняется pull + merge.
- Слова, курсы и tombstones сливаются по `updated_at`/`deleted_at`; настройки — по `updated_at`; прогресс — по `updatedAt`/`savedAt`/`readAt`, массивы discovered объединяются.
- Любые изменения запускают debounce-сохранение через 850 мс.
- Top Bar показывает `⚪ Локальный режим`, `🟡 Сохранение...`, `🟢 Синхронизировано` или `🟠 Облако не готово`.
- Офлайн-изменения остаются в `localStorage` и отправляются при возврате сети.
- Пароль и Gemini key никогда не попадают в payload: пароль хранится только в Supabase Auth, Gemini key — только в браузере.

## Импорт

В модальном окне работают вкладки `vocab`, `lessons`, `stories`:

- выбор вкладки подставляет валидный шаблон;
- **📋 Простой шаблон** копирует компактный урок `theory + quiz`;
- **⚡ Продвинутый шаблон (Master Spec)** копирует урок со всеми типами блоков;
- импорт автоматически распознаёт массив, одиночный объект и legacy-ключи (`vocabulary`, `words`, `turkish_vocab`, `lesson`, `story`, `word`, `content_blocks`).

```json
{
  "vocab": [],
  "lessons": [],
  "stories": []
}
```

## Язык интерфейса и новые курсы

UI локализуется на **English / Dansk / Türkçe / Русский** через `UI_TRANSLATIONS`; выбор сохраняется в `lingua_ui_settings` и применяется без reload.

Кнопка **«+ Новый курс»** доступна на Dashboard, в языковом меню и настройках. Новый курс:

- создаёт запись в `lingua_custom_languages`;
- инициализирует пустые `lingua_<code>_vocab`, `_imported_lessons`, `_imported_stories`;
- сразу становится доступен в переключателе и Top Bar;
- попадает в Supabase payload и синхронизируется между устройствами.

## Gemini API Key

В настройках есть поле **Google Gemini API Key** (`type=password` + 👁):

- ключ хранится только локально в `lingua_gemini_key`;
- не отправляется в Supabase;
- кнопка **«Проверить ключ»** делает запрос к `gemini-1.5-flash` и показывает `🟢 Connected` / `🔴 Error`;
- ключ сохраняется при сбросе прогресса.

## Темы и мобильная версия

- 🌌 **Dark Glass** — по умолчанию.
- 👾 **Cyberpunk Neon** — fuchsia / violet.
- 🟩 **Hacker Mono** — чёрно-зелёная консоль, monospace.
- ⚪ **Nordic Minimal** — приглушённый slate.

Темы на CSS-переменных, сохраняются в `lingua_ui_settings`. На мобильных: tap-targets от 44 px, sticky **LESSON MAP**, bottom-sheet перевода и закреплённые кнопки импорта.

## localStorage

- `lingua_en_quiz_...`, `lingua_tr_writing_...`, `lingua_en_discovered_...`
- `lingua_en_vocab`, `lingua_tr_vocab`, `lingua_da_vocab`
- `lingua_en_imported_lessons`, `lingua_da_imported_stories`
- `lingua_en_story_read_...`
- `lingua_ui_settings` — шрифт, язык интерфейса, язык обучения, тема
- `lingua_custom_languages` — созданные курсы
- `lingua_profile` — Google-профиль
- `lingua_cloud_last_sync` — время последней облачной записи
- `lingua_gemini_key` — Gemini API Key, только локально

Сброс прогресса сохраняет импортированный контент, пользовательские курсы, словари, настройки, профиль и Gemini key.

## Проверено

- GIS: официальные кнопки в шапке и профиле.
- Supabase mock: `user_data`, `user_email`, upsert колонки `data`, pull/merge, debounce-autosave и статусы.
- Офлайн-режим при заблокированных CDN.
- UI i18n: EN / DA / TR / RU без reload, сохранение после reload.
- Создание курса, пустые массивы, reload и список языков.
- Simple / Master templates: копирование и импорт всех 5 типов блоков.
- Gemini: password-поле, show/hide, сохранение ключа, успешный и ошибочный ping.
- 4 темы, мобильный TOC и bottom sheet.
- 1440 / 1301 / 1300 / 1180 / 768 / 430 / 390 / 320 px без переполнений.
