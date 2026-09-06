// --- Localization ---

const UI_TRANSLATIONS = {
  ru: {
    "Pornolab.net forum scraper": "Парсер форума Pornolab.net",
    "prnlb-browser — Pornolab Scraper": "prnlb-browser — парсер Pornolab",
    "Config": "Настройки",
    "Crawl": "Сканирование",
    "Results": "Результаты",
    "Search": "Поиск",
    "Search...": "Поиск...",
    "Downloaded": "Загруженные",
    "Actress": "Актрисы",
    "Credentials": "Учетные данные",
    "Username": "Имя пользователя",
    "Password": "Пароль",
    "Request Delay (ms)": "Задержка запросов (мс)",
    "Min delay": "Мин. задержка",
    "Max delay": "Макс. задержка",
    "Screenshot Cache": "Кэш скриншотов",
    "Max cache size (MB)": "Максимальный размер кэша (МБ)",
    "Screenshots shown in the preview carousel are cached on disk. Oldest cached files are deleted first once this limit is exceeded. Set to 0 to disable caching.": "Скриншоты из карусели предпросмотра сохраняются на диске. При превышении лимита сначала удаляются самые старые файлы. Укажите 0, чтобы отключить кэширование.",
    "Model Context Protocol": "Model Context Protocol",
    "Allow local MCP clients to use prnlb-browser tools. The MCP endpoint is available only on this computer.": "Разрешить локальным MCP-клиентам использовать инструменты prnlb-browser. MCP-эндпоинт доступен только на этом компьютере.",
    "Enable embedded MCP server": "Включить встроенный MCP-сервер",
    "Endpoint": "Эндпоинт",
    "TurboImageHost": "TurboImageHost",
    "Clear the dedicated browser profile used for TurboImageHost verification. This does not affect your app settings, Pornolab login, saved results, or screenshot cache.": "Очистить отдельный профиль браузера, используемый для проверки TurboImageHost. Настройки приложения, вход в Pornolab, сохраненные результаты и кэш скриншотов не будут изменены.",
    "🧽 Clear TurboImageHost cookies": "🧽 Очистить cookies TurboImageHost",
    "💾 Save Config": "💾 Сохранить настройки",
    "📥 Export Topics CSV": "📥 Экспортировать темы в CSV",
    "🗑 Clear Results": "🗑 Очистить результаты",
    "Crawl Pornolab Updates": "Сканирование обновлений Pornolab",
    "+ Add forum": "+ Добавить форум",
    "Pages to scan": "Страниц для сканирования",
    "▶ Start Crawl": "▶ Начать сканирование",
    "Progress": "Прогресс",
    "Waiting...": "Ожидание...",
    "🔄 Refresh": "🔄 Обновить",
    "All forums": "Все форумы",
    "All actresses": "Все актрисы",
    "★ Fav actresses": "★ Избранные актрисы",
    "Exclude hidden": "Исключить скрытые",
    "Show all": "Показать все",
    "All tags": "Все теги",
    "✕ Clear tags": "✕ Очистить теги",
    "Newest": "Новые",
    "Rate": "Оценка",
    "File size": "Размер файла",
    "Cast": "Актеры",
    "DESC": "По убыванию",
    "ASC": "По возрастанию",
    "Search Pornolab Tracker": "Поиск в трекере Pornolab",
    "🔍 Search": "🔍 Найти",
    "Everywhere": "Везде",
    "Downloaded Files": "Загруженные файлы",
    "Select folder containing downloaded videos...": "Выберите папку с загруженными видео...",
    "📁 Select Folder": "📁 Выбрать папку",
    "Search file / title / cast / tag...": "Поиск по файлу / названию / актерам / тегу...",
    "File creation date": "Дата создания файла",
    "Search actress...": "Поиск актрисы...",
    "➕ New actress": "➕ Новая актриса",
    "No actresses yet. Click \"New actress\" to add one.": "Актрис пока нет. Нажмите «Новая актриса», чтобы добавить ее.",
    "✏️ Edit Downloaded Item": "✏️ Редактирование загруженного файла",
    "✏️ Edit Result Item": "✏️ Редактирование результата",
    "Topic URL": "URL темы",
    "Not set": "Не задан",
    "Post image URL": "URL изображения публикации",
    "⬇ Download / Resolve": "⬇ Скачать / определить",
    "Remove image": "Удалить изображение",
    "Title": "Название",
    "Production date": "Дата выпуска",
    "Duration": "Длительность",
    "Size": "Размер",
    "Comments / AI context": "Комментарии / контекст для ИИ",
    "Notes or context for this item...": "Заметки или контекст этого элемента...",
    "Cancel": "Отмена",
    "💾 Save": "💾 Сохранить",
    "🏷️ Add tag": "🏷️ Добавить тег",
    "Tag name": "Название тега",
    "Color (optional)": "Цвет (необязательно)",
    "No color": "Без цвета",
    "Existing tags — click to assign:": "Существующие теги — нажмите, чтобы назначить:",
    "🔗 Set Topic URL": "🔗 Указать URL темы",
    "🔍 Fetch details": "🔍 Загрузить данные",
    "🎭 New actress": "🎭 Новая актриса",
    "🎭 Actress": "🎭 Актриса",
    "Picture URL": "URL изображения",
    "Name": "Имя",
    "Other names": "Другие имена",
    "+ Add": "+ Добавить",
    "🗑 Delete": "🗑 Удалить",
    "Images": "Изображения",
    "Loading images...": "Загрузка изображений...",
    "🔐 Captcha required": "🔐 Требуется капча",
    "Enter the code shown in the image below:": "Введите код с изображения:",
    "Submit": "Отправить",
    "Enter code...": "Введите код...",
    "Label": "Метка",
    "Forum URL": "URL форума",
    "Remove tag": "Удалить тег",
    "Add or assign tag": "Добавить или назначить тег",
    "Pick a custom color": "Выбрать свой цвет",
    "Tag color": "Цвет тега",
    "Hold Ctrl/Cmd to select multiple tags": "Удерживайте Ctrl/Cmd, чтобы выбрать несколько тегов",
    "Use \"Set topic URL\" from the popup menu to change this": "Используйте «Указать URL темы» в меню, чтобы изменить значение",
    "Topic URL is the item's identity and can't be changed here": "URL темы — идентификатор элемента, его нельзя изменить здесь",
    "File size is set automatically from disk — click Refresh to update it": "Размер файла определяется автоматически — нажмите «Обновить», чтобы обновить его",
    "e.g. favorite, rewatch, 4k": "например, favorite, rewatch, 4k",
    "Primary name": "Основное имя",
    "Add alternate name...": "Добавить альтернативное имя...",
    "Fetch actress data from Boobpedia": "Загрузить данные об актрисе с Boobpedia",
    "Fetch actress data from IAFD": "Загрузить данные об актрисе с IAFD",
    "Loading...": "Загрузка...",
    "Previewing from the web — Save or Download/Resolve to store a local copy": "Предпросмотр из интернета — сохраните или скачайте, чтобы сохранить локальную копию",
    "Language": "Язык",
    "Interface language": "Язык интерфейса",
    "English": "English",
    "Russian": "Русский",
    "Forum:": "Форум:",
    "File:": "Файл:",
    "Date:": "Дата:",
    "Comment:": "Комментарий:",
    "Please enter the captcha code": "Введите код капчи",
    "Submitting...": "Отправка...",
    "Code submitted! Waiting for login...": "Код отправлен! Ожидание входа...",
    "Failed to submit code — challenge expired": "Не удалось отправить код — срок действия проверки истек",
    "🔍 Screens": "🔍 Скриншоты",
    "⬇ Torrent": "⬇ Торрент",
    "➕ Add": "➕ Добавить",
    "✅ Added": "✅ Добавлено",
    "⚠️ Exists": "⚠️ Уже есть",
    "← Prev": "← Назад",
    "Next →": "Далее →",
    "🔗 Set topic URL": "🔗 Указать URL темы",
    "🔄 Refresh details": "🔄 Обновить данные",
    "▶ Play": "▶ Воспроизвести",
    "📂 Show in Finder": "📂 Показать в Finder",
    "No tags yet": "Тегов пока нет",
    "No tags yet.": "Тегов пока нет.",
    "⏳ Running...": "⏳ Выполняется...",
    "Config saved!": "Настройки сохранены!",
    "CSV exported!": "CSV экспортирован!",
    "Are you sure you want to delete ALL topics from the database? This cannot be undone.": "Удалить ВСЕ темы из базы данных? Это действие нельзя отменить.",
    "Clear TurboImageHost cookies, local storage, and cache? This closes any active verification window and cancels its current image resolution. Your app settings, Pornolab login, saved results, and screenshot cache will not be changed.": "Очистить cookies, локальное хранилище и кэш TurboImageHost? Все активные окна проверки будут закрыты, а текущие операции определения изображений отменены. Настройки приложения, вход в Pornolab, сохраненные результаты и кэш скриншотов не изменятся.",
    "No results yet. Run a crawl first.": "Результатов пока нет. Сначала запустите сканирование.",
    "No topics found.": "Темы не найдены.",
    "topics": "тем",
    "search": "поиск",
    "in DB": "в базе",
    "★ fav actresses": "★ избранные актрисы",
    "👁 Show": "👁 Показать",
    "🙈 Hide": "🙈 Скрыть",
    "Refresh details for \"{title}\"?": "Обновить данные для «{title}»?",
    "Error: {message}": "Ошибка: {message}",
    "Failed to reload details: {message}": "Не удалось обновить данные: {message}",
    "Delete this topic from the database? This cannot be undone.": "Удалить эту тему из базы данных? Это действие нельзя отменить.",
    "Topic not found in database.": "Тема не найдена в базе данных.",
    "Failed to delete: {message}": "Не удалось удалить: {message}",
    "{count} results found": "Найдено результатов: {count}",
    "{count} actress(es)": "Актрис: {count}",
    "Enter a search phrase": "Введите поисковую фразу",
    "Loading page {page}...": "Загрузка страницы {page}...",
    "Starting search...": "Запуск поиска...",
    "No results found.": "Результаты не найдены.",
    "No results": "Нет результатов",
    "Refreshing...": "Обновление...",
    "Scanning...": "Сканирование...",
    "No downloaded files found.": "Загруженные файлы не найдены.",
    "No items match the current filter.": "Нет элементов, соответствующих текущему фильтру.",
    "Refreshing details...": "Обновление данных...",
    "Delete this downloaded file and its database entry?": "Удалить этот файл и его запись в базе данных?",
    "Enter a URL first": "Сначала введите URL",
    "Resolving & downloading...": "Определение и скачивание...",
    "✅ Image updated": "✅ Изображение обновлено",
    "⚠️ Couldn't resolve/download — URL saved without preview": "⚠️ Не удалось определить или скачать изображение — URL сохранен без предпросмотра",
    "⚠️ Couldn't resolve — original kept": "⚠️ Не удалось определить изображение — сохранен исходный вариант",
    "Image cleared": "Изображение удалено",
    "Item updated": "Элемент обновлен",
    "Scan folder \"{folder}\"?\n\nThis will purge existing downloaded data and search pornolab for each video file.": "Сканировать папку «{folder}»?\n\nСуществующие данные о загрузках будут удалены, а для каждого видео будет выполнен поиск на Pornolab.",
    "Delete this actress? This cannot be undone.": "Удалить эту актрису? Это действие нельзя отменить.",
    "Name is required": "Укажите имя",
    "Fetching from {provider}...": "Загрузка данных из {provider}...",
    "Remove from favorites": "Удалить из избранного",
    "Add to favorites": "Добавить в избранное",
    "Open in Downloaded": "Открыть в разделе «Загруженные»",
    "Open in Results": "Открыть в разделе «Результаты»",
    "Search forums": "Искать на форумах",
    "Enter a tag name first": "Сначала введите название тега",
    "Tag \"{tag}\" is already on this item": "Тег «{tag}» уже назначен этому элементу",
    "Tag \"{tag}\" added": "Тег «{tag}» добавлен",
    "Scraping topic images...": "Получение изображений темы...",
    "No images found from supported hosts.": "На поддерживаемых хостингах изображения не найдены.",
  },
};

function getLocale() {
  const saved = window.localStorage.getItem("prnlb-locale");
  if (saved === "ru" || saved === "en") return saved;
  return navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function localeText(source) {
  return UI_TRANSLATIONS[getLocale()]?.[source] || source;
}

function canonicalUiText(value) {
  if (getLocale() === "en") return value;
  const entry = Object.entries(UI_TRANSLATIONS.ru).find(([, translated]) => translated === value);
  return entry ? entry[0] : value;
}

function t(source, values = {}) {
  let text = localeText(source);
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{${key}}`, String(value));
  return text;
}

function translateNode(node) {
  const source = node.nodeValue || "";
  const trimmed = source.trim();
  if (!trimmed) return;
  const translated = localeText(trimmed);
  if (translated !== trimmed) node.nodeValue = source.replace(trimmed, translated);
}

function isUiTextElement(element) {
  return element.matches("title, h1, h2, h3, label, button, option, p, pre.log-output, .subtitle, .card-description, .empty-state, .modal-title, .label, .status-msg, .carousel-loading, .carousel-counter, #carousel-progress-text, .popup-menu-item, .btn, .tab, .help-icon");
}

function applyTranslations(root = document) {
  const elements = root === document
    ? Array.from(document.querySelectorAll("*"))
    : [root, ...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.dataset.i18n) element.textContent = t(element.dataset.i18n);
    if (element.dataset.i18nPlaceholder) element.placeholder = t(element.dataset.i18nPlaceholder);
    if (element.dataset.i18nTitle) element.title = t(element.dataset.i18nTitle);
    for (const attr of ["placeholder", "title", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value && (isUiTextElement(element) || element.dataset.i18n || element.dataset.i18nPlaceholder || element.dataset.i18nTitle)) {
        const translated = localeText(value);
        if (translated !== value) element.setAttribute(attr, translated);
      }
    }
    if (isUiTextElement(element) || element.dataset.i18n) {
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) translateNode(child);
      }
    }
  }
  document.documentElement.lang = getLocale();
}

function setupLocalePicker() {
  const picker = document.getElementById("cfg-language");
  if (!picker) return;
  picker.value = getLocale();
  picker.addEventListener("change", () => {
    window.localStorage.setItem("prnlb-locale", picker.value);
    window.location.reload();
  });
}

applyTranslations();
setupLocalePicker();
const translationObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) applyTranslations(node);
      else if (node.nodeType === Node.TEXT_NODE) translateNode(node);
    }
  }
});
translationObserver.observe(document.body, { childList: true, subtree: true });
