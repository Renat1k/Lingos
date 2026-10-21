# LINGUA/OS — архитектура (v2.18)

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
| `js/sync.js` | Supabase sync по `user_id`, merge, статусы | `ensureSupabaseClient`, `pullCloudData`, `pushCloudData` | `config`, `state`, `dom` |
| `js/auth.js` | Supabase Auth, Google GIS, профиль | `signInWithPassword`, `signInWithIdToken`, `applyAuthUser` | `state`, `dom`, `sync` |
| `js/ai-providers.js` | Единый слой ИИ-провайдеров: адаптеры Gemini/OpenAI-compatible/Anthropic, цепочка моделей, retry, cooling, настройки провайдеров | `generateAiText`, `runProvider`, `listProviderModels`, `testProviderSlot`, `initAiProviderSettings` | `config`, `state`, `dom`, `helpers` |
| `js/ai-studio.js` | AI Studio, курс/чаты, ИИ-Разбор, Gemini-совместимые обёртки | `generateGeminiText`, `generateGeminiOnce`, `runAiAnalysis`, `beginAiGeneration`, `saveGeminiKey`, `testGeminiKey` | `config`, `state`, `dom`, `helpers`, `ai-providers` |
| `js/ui-settings.js` | Настройки, темы, переводы, reset | `openSettings`, `applySettings`, `resetAllProgress` | `config`, `state`, `dom`, `auth` |
| `js/vocab.js` | Vocabulary Vault, теги, редактор, экспорт | `renderVocabularyHub`, `openWordEditor`, `downloadVocabulary` | `state`, `dom`, `helpers` |
| `js/stories.js` | Истории, чтение, панель перевода | `renderStoriesHub`, `renderStory`, `openTranslation` | `state`, `dom`, `helpers` |
| `js/lessons.js` | Dashboard, уроки, 5 типов блоков, практика, тесты | `renderDashboard`, `renderLesson`, `initQuizzes`, `initWriters` | `state`, `dom`, `helpers`, `stories` |
| `js/import.js` | Import JSON и шаблоны Simple/Master | `importPayload`, `runImport`, `copyTemplateVariant` | `state`, `vocab`, `lessons` |
| `js/builder.js` | Визуальный конструктор уроков, черновики, JSON-экспорт, точки расширения ИИ | `openLessonBuilder`, `getBuilderLessonJson`, `getBuilderBlockJson`, `applyBuilderBlockPatch`, `applyBuilderLessonPatch` | `state`, `dom`, `helpers`, `lessons`, `import`, `ai-studio` |
| `js/app.js` | Навигация, языки, курсы, routing, события, boot | `setLearningLanguage`, `route`, `boot` | все предыдущие |
| `sql/migration.sql` | Ручная Supabase-миграция: `user_id`, RLS, backfill | — | выполняется вручную в Supabase SQL Editor |

## Порядок подключения

`config → data-default → state → dom → helpers → sync → auth → ai-providers → ai-studio → ui-settings → vocab → stories → lessons → import → builder → app`

`app.js` всегда последний: в нём статические listeners и `boot()`.

## Правила

- Новые константы и переводы — в `config.js`; новые дефолтные данные — в `data-default.js`.
- Чтение/запись localStorage и настройки — в `state.js`.
- DOM-ссылки — только в `dom.js`; общие утилиты — в `helpers.js`.
- Сетевые интеграции: Supabase — `sync.js`, Google — `auth.js`, ИИ-провайдеры — `ai-providers.js`. `ai-studio.js` использует `generateAiText()` и держит только UI/чат/валидацию.
- Схема Supabase (`user_id`, RLS, backfill) — только `sql/migration.sql`, вручную.
- Новый экран/домен — отдельный `js/<domain>.js`; подключать перед `app.js`.
- Не обращаться к `const`/`let` нижнего файла во время загрузки: только внутри функций после `boot()`.
- Не добавлять `import/export`, `type="module"` или сборщик.
- `index.monolith.html` — резервная копия v2.4; не изменять без подтверждения.

## ИИ-провайдеры (v2.13)

- `generateAiText(prompt, options)` — единая точка генерации для AI Studio и ИИ-Разбора.
- Порядок маршрута: основной провайдер → резервный (если настроен).
- Gemini: выбранная модель → стабильная модель предыдущего поколения → lite → остальные; не более 3 моделей за запрос.
- На 429/500/503/сетевой сбой — до 3 попыток с экспоненциальной паузой и jitter. 429 с `Retry-After`/`retryDelay` > 30 с и дневная квота не повторяются.
- Ошибки 429/500/503 помечают модель «остывающей» на 4 минуты в памяти.
- OpenAI-compatible: `Authorization: Bearer`, `POST {baseUrl}/chat/completions`, `GET {baseUrl}/models`; JSON-режим `response_format` опционален, при 400 выполняется повтор без него; `max_tokens`/`max_completion_tokens` — с fallback при 400.
- Anthropic: `POST /v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; JSON-режима нет, используется системный промт.
- Конфигурация провайдеров: `lingua_ai_provider_*` в localStorage; ключи и baseUrl не попадают в Supabase (`collectCloudPayload`/`applyCloudPayload`).
- Ключи не пишутся в URL, console, чаты и тексты ошибок; технические детали редактируются.
- CORS/сетевой отказ браузера распознаётся как отдельный класс ошибки с подсказкой сменить провайдера.

