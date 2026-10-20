# LINGUA/OS — архитектура (v2.4)

Статическое приложение без сборщика: классические `<script>`, общий global scope, `"use strict"` в каждом файле.

## Файлы

| Файл | За что отвечает | Главные функции | Зависит от |
|---|---|---|---|
| `index.html` | Каркас, meta, HTML, спрайт, inline theme bootstrap, подключение CSS/JS | — | `css/style.css`, `js/*` |
| `css/style.css` | Все стили, анимации и 4 темы | — | — |
| `js/config.js` | Константы, storage-ключи, Supabase meta, темы, UI-локали, переводы | `t`, `THEMES`, `UI_TRANSLATIONS`, `LANGUAGE_META` | — |
| `js/data-default.js` | Встроенный offline-снимок курса и шаблоны импорта | `EMBEDDED_LESSONS_B64`, `IMPORT_TEMPLATES` | — |
| `js/state.js` | `state`, localStorage, настройки, загрузка языковых пакетов | `readJSON`, `writeJSON`, `loadSettings`, `activateLanguageData` | `config`, `data-default` |
| `js/dom.js` | Ссылки на DOM-элементы | `app`, модалки, поля, topbar | — |
| `js/helpers.js` | Общие утилиты и форматирование | `escapeHtml`, `icon`, `showToast`, `languageLabel` | `dom` |
| `js/sync.js` | Supabase pull/push, merge, статусы | `initCloudSync`, `pullCloudData`, `pushCloudData` | `config`, `state`, `dom` |
| `js/auth.js` | Google Identity, профиль, выход | `renderGoogleAuth`, `handleGoogleCredential`, `signOutProfile` | `state`, `dom`, `sync` |
| `js/ai-studio.js` | Локальный Gemini API key и проверка | `saveGeminiKey`, `testGeminiKey` | `config`, `dom` |
| `js/ui-settings.js` | Настройки, темы, переводы, reset | `openSettings`, `applySettings`, `resetAllProgress` | `config`, `state`, `dom`, `auth` |
| `js/vocab.js` | Vocabulary Vault, теги, редактор, экспорт | `renderVocabularyHub`, `openWordEditor`, `downloadVocabulary` | `state`, `dom`, `helpers` |
| `js/stories.js` | Истории, чтение, панель перевода | `renderStoriesHub`, `renderStory`, `openTranslation` | `state`, `dom`, `helpers` |
| `js/lessons.js` | Dashboard, уроки, 5 типов блоков, практика, тесты | `renderDashboard`, `renderLesson`, `initQuizzes`, `initWriters` | `state`, `dom`, `helpers`, `stories` |
| `js/import.js` | Import JSON и шаблоны Simple/Master | `importPayload`, `runImport`, `copyTemplateVariant` | `state`, `vocab`, `lessons` |
| `js/app.js` | Навигация, языки, курсы, routing, события, boot | `setLearningLanguage`, `route`, `boot` | все предыдущие |

## Порядок подключения

`config → data-default → state → dom → helpers → sync → auth → ai-studio → ui-settings → vocab → stories → lessons → import → app`

`app.js` всегда последний: в нём статические listeners и `boot()`.

## Правила

- Новые константы и переводы — в `config.js`; новые дефолтные данные — в `data-default.js`.
- Чтение/запись localStorage и настройки — в `state.js`.
- DOM-ссылки — только в `dom.js`; общие утилиты — в `helpers.js`.
- Сетевые интеграции: Supabase — `sync.js`, Google — `auth.js`, Gemini — `ai-studio.js`.
- Новый экран/домен — отдельный `js/<domain>.js`; подключать перед `app.js`.
- Не обращаться к `const`/`let` нижнего файла во время загрузки: только внутри функций после `boot()`.
- Не добавлять `import/export`, `type="module"` или сборщик.
- `index.monolith.html` — резервная копия v2.4; не изменять без подтверждения.
