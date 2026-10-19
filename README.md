# LINGUA/OS 2.1

Статическая мультиязычная учебная среда на HTML + CSS + Vanilla JS. Без сборки, без фреймворков и без backend. Полностью работает локально: контент, прогресс, словарь и настройки живут в браузере.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Всё приложение: разметка, темы, логика, офлайн-снапшот данных |
| `lessons.json` | Языковые пакеты и контент |

## Деплой на GitHub Pages

1. Положи `index.html` и `lessons.json` в корень репозитория (или в папку, которую публикует Pages).
2. **Settings → Pages → Build and deployment**: `Deploy from a branch`, выбери ветку и `/ (root)`.
3. Открой `https://<username>.github.io/<repo>/`.

Сборка не нужна. Все пути относительные: `fetch("./lessons.json")` работает и в корне домена, и в подпапке репозитория. При открытии через `file://` автоматически используется встроенный base64-снапшот. Внешних обязательных запросов нет.

## Языки

В `lessons.json`:

```json
{
  "default_language": "en",
  "languages": {
    "en": { "label": "English", "lessons": [], "stories": [], "vocab": [] },
    "tr": { "label": "Türkçe",  "lessons": [], "stories": [], "vocab": [] },
    "da": { "label": "Dansk",   "lessons": [], "stories": [], "vocab": [] }
  }
}
```

В поставке:

- **English** — 5 уроков и 2 истории.
- **Türkçe** — пустые `lessons`, `stories`, `vocab`.
- **Dansk** — пустые `lessons`, `stories`, `vocab`.

Контент добавляется через **«Импортировать JSON»** и попадает только в активный язык.

## Импорт JSON

В модальном окне есть вкладки `vocab`, `lessons`, `stories`:

- клик по вкладке подставляет валидный шаблон;
- **«📋 Скопировать шаблон для ИИ»** копирует текущий JSON в буфер;
- импорт автоматически определяет формат: массив, одиночный объект, ключи `vocab` / `lessons` / `stories`, а также legacy-ключи.

```json
{
  "vocab": [],
  "lessons": [],
  "stories": []
}
```

Также принимаются `vocabulary`, `words`, `turkish_vocab`, `lesson`, `story`, `word` и старое поле `content_blocks`.
Экспорт словаря выгружает `{ "meta": { "language": "..." }, "vocab": [...] }`.

## Схема урока: динамические блоки

Урок не привязан к фиксированному набору блоков. Используется массив `blocks`; блоки можно повторять и располагать в любом порядке, а навигация строится по массиву.

```json
{
  "id": 1,
  "title": "Present Perfect vs Past Simple",
  "blocks": [
    { "type": "theory", "nav_label": "Модель", "title": "Модель", "content": "..." },
    { "type": "dialogue", "nav_label": "Диалог 1", "title": "Ten Years Later", "messages": [] },
    { "type": "dialogue", "nav_label": "Диалог 2", "title": "The Morning After", "messages": [] },
    { "type": "quiz", "nav_label": "Тест", "questions": [] }
  ]
}
```

Поддерживаемые типы: `theory`, `reading_heavy`, `dialogue`, `quiz`, `practice_write`. Неизвестный тип безопасно рендерится заглушкой. Старое поле `content_blocks` принимается при импорте, но канонический формат — `blocks`.

## Темы оформления

В настройках доступны 4 пресета:

- 🌌 **Dark Glass** — исходный тёмный стеклянный UI.
- 👾 **Cyberpunk Neon** — fuchsia / violet.
- 🟩 **Hacker Mono** — чёрно-зелёная консоль, monospace.
- ⚪ **Nordic Minimal** — приглушённый slate для чтения.

Тема применяется мгновенно, сохраняется в `lingua_ui_settings` и восстанавливается до первого кадра. Цвета построены на CSS-переменных (`--accent-rgb`, `--cyan-bright`, `--emerald-bright`, `--bg`, `--surface` и т.д.).

## Мобильная версия

- 320–430 px: без горизонтального overflow.
- Кнопки ответов, вкладок и списков — минимум 44 px по высоте.
- Sidebar урока на мобильном превращается в sticky-плашку **LESSON MAP** с выпадающим содержанием.
- Перевод слова в историях открывается как **bottom sheet**, а выбранное слово прокручивается выше панели.
- Импорт на мобильном имеет закреплённые кнопки действий.

## Google Auth — опционально

Google-вход больше не является зависимостью. Скрипт GIS **не загружается при старте**; он подключается только при открытии профиля и только если задан Client ID.

1. Создай **OAuth 2.0 Client ID → Web application**.
2. Добавь **Authorized JavaScript origins**:
   - `https://<username>.github.io`
   - `http://localhost:8765`
3. Укажи Client ID:

```html
<meta name="google-client-id" content="1234567890-xxxx.apps.googleusercontent.com" />
```

После этого при открытии профиля вызывается `google.accounts.id.renderButton(...)`. JWT-credential декодируется, `name`, `email`, `picture` и `sub` сохраняются в `lingua_profile`. Без Client ID приложение работает полностью локально и показывает disabled-fallback, а не имитацию входа.

## localStorage

Данные изолированы по языку:

- `lingua_en_quiz_...`, `lingua_tr_writing_...`, `lingua_en_discovered_...`
- `lingua_en_vocab`, `lingua_tr_vocab`, `lingua_da_vocab`
- `lingua_en_imported_lessons`, `lingua_da_imported_stories`
- `lingua_en_story_read_...`

Глобальные ключи:

- `lingua_ui_settings` — шрифт, язык и тема
- `lingua_profile` — Google-профиль

Сброс прогресса удаляет только progress-ключи, сохраняя импортированный контент, словари, настройки и профиль.

## Проверено

- GitHub Pages-стиль подпапки и `file://` fallback.
- Динамическая навигация: 7 блоков, два диалога подряд.
- Переключение EN → TR → DA без смешивания данных.
- Импорт `vocab` / `lessons` / `stories`, одиночных объектов и шаблонов.
- Копирование шаблона в буфер обмена.
- 4 темы и сохранение после reload.
- Мобильный TOC, bottom sheet и tap-targets.
- Google credential-flow только как опция.
- 1440 / 768 / 430 / 390 / 320 px без горизонтального overflow.
