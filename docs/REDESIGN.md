# LINGUA/OS — редизайн для обычных пользователей

## 1. Карта проекта

### Экраны и рендер
| Экран | Что видно | Файл → функция |
|---|---|---|
| Главная / курсы | hero, прогресс, карточки уроков, тесты | `js/lessons.js` → `renderDashboard`, `renderHero`, `renderLessonCard`, `renderDashboardStatsMarkup` |
| Урок | теория, чтение, диалог, квиз, письмо, TOC | `js/lessons.js` → `renderLesson`, `renderTheory`, `renderReading`, `renderDialogue`, `renderQuiz`, `renderPractice` |
| Истории | библиотека и читалка | `js/stories.js` → `renderStoriesHub`, `renderStoryCard`, `renderStory` |
| Словарь | карточки, теги, поиск, дубли, редактор | `js/vocab.js` → `renderVocabularyHub`, `renderVocabResults`, `openWordEditor`, `openDuplicateChecker` |
| Повторение | Leitner-карточки | `js/vocab.js` → `renderReviewSetup`, `startReview`, `renderReviewCard`, `answerReview` |
| Тесты | результаты и работа над ошибками | `js/lessons.js` → `renderTestsPanel`, `openErrorQuiz`, `finishErrorQuiz` |
| Конструктор | ручное создание/редактирование | `js/builder.js` → `renderBuilder`, `openLessonBuilder`, `builderSave` |
| Импорт | JSON, шаблоны, автодетект | `js/import.js` → `openImportModal`, `runImport`, `importPayload` |
| ИИ-студия | генерация, чат, настройки провайдера | `js/ai-studio.js` → `openAiStudio`, `beginAiGeneration`, `importAiPreview`; `js/ai-providers.js` |
| Озвучка | Web Speech, скорость, пауза | `js/stories.js` → `renderSpeechControls`, `startSpeech` |
| Выбор языка/курса | активные, архив, создание | `js/app.js` → `renderLanguageLists`, `renderLanguageSwitch`, `renderLanguageFilterTabs` |
| Синхронизация | Supabase pull/push, статус | `js/sync.js` → `pullCloudData`, `pushCloudData`, `setSyncStatus` |
| Вход/профиль | e-mail, Google, аватар | `js/auth.js` → `renderAuthTabs`, `openProfileModal`, `submitAuthForm` |
| Настройки | тема, язык UI, шрифт, ключи | `js/ui-settings.js`, `js/app.js` → `applySettings`, `setUILanguage` |

### localStorage
- `lingua_ui_settings`, `lingua_profile`, `lingua_custom_languages`
- `lingua_deleted`, `lingua_hidden_content` (ключи скрытия `${code}:${id}`; старые bare-id читаются для встроенных)
- `lingua_<lang>_vocab`, `lingua_<lang>_imported_lessons`, `lingua_<lang>_imported_stories`
- `lingua_<lang>_writing_lesson_<id>_block_<n>`, `_quiz_lesson_...`, `_story_read_<id>`, `_discovered_lesson_<id>`
- `lingua_builder_draft_<lang>`, `lingua_speech_rate`, `lingua_speech_voice`
- `lingua_gemini_key`, `lingua_gemini_model`, `lingua_ai_chats_<course>`, `lingua_ai_provider_*`
- `lingua_cloud_last_sync`, `lingua_cloud_last_push_fingerprint`

### Офлайн
Работают: уроки, истории, словарь, повторение, прогресс, поиск, конструктор, импорт/экспорт, локальная озвучка. Нужны сеть/аккаунт: Supabase sync, Google/e-mail вход, ИИ-провайдеры. Без сети данные остаются локальными.

## 2. Выдуманные и фиксированные числа

| Место | Проблема |
|---|---|
| `js/lessons.js` `renderLesson` / `renderDashboard` | `progressValue = "00"` до расчёта; выглядит как реальный прогресс |
| `js/lessons.js` футеры | `v2.22` вместо версии приложения |
| `js/stories.js` | fallback `"6 мин"` и старые `READ/UNREAD` |
| `js/lessons.js` | fallback `MODULE 01`, `GRAMMAR // 01`, `A2–B1` — выглядят как данные |
| `js/lessons.js` | `LIVE`, `READ_ONLY`, `END OF STORY`, `LIVE SYNTAX CHECK` — технические ярлыки |
| `js/lessons.js` | `100/0%` в course-lines историй — бинарная заглушка вместо доли |
| `js/data-default.js` | фиксированные `read_time`, `duration`, бейджи `NEW/GRAMMAR` |
| `index.html` / `js/vocab.js` | ранее `1 / 1`, `0 / 0`; сейчас очищены, но счётчики надо скрывать до первого расчёта |

## 3. Новая навигация (5 разделов)

1. **Главная** — приветствие, «Продолжить»/«Начать», «Пора повторить», 2–3 рекомендации, компактный реальный прогресс. Новому пользователю — только объяснение и одно действие.
2. **Уроки** — список уроков; вкладка «Истории» (хаб и читалка). Сюда же текущий урок. Без дублей с Главной.
3. **Практика и повторение** — повторение слов, тесты, работа над ошибками, письменные задания. Кнопки ведут в существующие модалки/уроки.
4. **Мой словарь** — словарь, поиск, теги, избранное, дубли, редактор, экспорт. Глоссарные слова добавляются сюда же.
5. **Мой прогресс** — общий прогресс, слова/квизы, серия, прочитанные истории, статистика курса. Только вычисляемые значения.

Инструменты разработчика — конструктор, ручное редактирование блоков/JSON, импорт/экспорт, ИИ-студия и настройки провайдеров, raw-ключи — в «Дополнительно» (продвинутый режим), не в основной навигации.

## 4. Главная

Порядок: приветствие по имени/времени → одна карточка «Продолжить» (последний незавершённый урок) или «Начать первый урок» → «Пора повторить» только при `getDueReviewCount() > 0` → 2–3 рекомендованных урока (следующие по прогрессу) → компактная строка реального прогресса. Нули, пустые кольца и фиктивные серии новому пользователю не показывать.

## 5. Визуальная система

- Фон `#FAF8F5`; карточки `#FFFFFF`, рамка `1px` `#E7E1D8`, мягкая тень, радиус `16–20px`.
- Акцент терракота `#B85C38`; главная кнопка — спокойный синий `#2F5D8A`; вторичные — тёплый нейтральный.
- Заголовки: `Georgia, serif`; текст: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- H1 36–44px, основной текст 18px, подписи ≥14px, кнопки/поля ≥44px; межстрочный 1.5–1.65.
- Боковое меню: группы «Учиться», «Инструменты», «Прогресс», эмодзи + текст, активный пункт — мягкая терракотовая плашка. На ≤768px — нижняя панель из 5 пунктов.
- Закрываемый блок «Что ещё можно делать» с 2–3 подсказками, `localStorage`-флаг закрытия.
- Тёмная тема: тёплый графит `#1C1A18`, карточки `#24211E`, тот же терракотовый/синий, без неона и свечений.
- Сохранить focus-visible, 44px, `prefers-reduced-motion`, переносы длинных названий.

## 6. План внедрения

1. **Токены и оболочка** — `css/style.css`, `index.html`: новые цвета, типографика, sidebar, mobile bar. Риск: только оформление, данные не трогаем.
2. **Главная** — `js/lessons.js` + небольшой агрегатор в `js/app.js`: «Продолжить», повторение, рекомендации. Риск: не менять `state.lessons`, `state.vocab`, `next_review_at`.
3. **Уроки/Истории** — `js/lessons.js`, `js/stories.js`: убрать технические ярлыки, оставить хэши `#lesson-*`, `#story-*`. Риск: сломать закладки — сохранить маршруты.
4. **Практика/Словарь/Прогресс** — `js/vocab.js`, `js/lessons.js`: перенести кнопки и статистику, не меняя логику повторения и формат слов.
5. **Продвинутый режим** — `js/builder.js`, `js/import.js`, `js/ai-studio.js`: скрыть входы за «Дополнительно», сами функции не переписывать.
6. **Тёмная тема и мобильные** — `css/style.css`: проверить 360/390/768, контраст, 44px, reduced-motion.
7. **Синхронизация** — `js/sync.js` не менять: новые экраны используют те же ключи; проверить, что скрытые/устройство-локальные ключи не попали в payload.

**Данные:** формат уроков, историй, слов, ключи localStorage и `REVIEW_INTERVALS` не меняются; миграций нет. Не удалять старые ключи, не переименовывать `lingua_*`, не менять `updated_at`/tombstones. Риск потери — только при ошибочном `localStorage.clear()` или перезаписи sync; редизайн не должен писать данные.
