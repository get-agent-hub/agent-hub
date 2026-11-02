# agent-hub — Design (draft v0.1)

Один источник правды для всех AI-агентов разработки. Сменил агента (Claude Code → Codex → DSH) — ничего не потерял: те же skills, MCP, правила, память и состояние текущей задачи.

Стек: Node.js ≥ 20, TypeScript. Дистрибуция: `npx agent-hub` / `npm i -g agent-hub`.

См. также: [RESEARCH.md](RESEARCH.md).

Текущее состояние: `init`, импорт MCP, launcher, MCP `sync`/`restore` и локальный веб-интерфейс реализованы. `sync` по умолчанию делает dry run с точной командой применения; UI использует тот же планировщик. `doctor` проверяет MCP-подключения и tools/list в CLI/UI, с таймаутами, отменой и кэшем результатов. Доставка инструкций/памяти и `init-repo` ещё не реализованы. См. [UI.md](UI.md).

## 1. Принципы

1. **Hub — истина, клиенты — проекции.** Правим в `~/.agent-hub`. `hub sync` генерирует конфиги клиентов.
2. **Трогаем только своё.** В чужих файлах (`~/.claude.json`, `config.toml`) пишем только свои ключи, остальное не меняем. Всегда бэкап перед записью.
3. **Дрейф ловим, а не перетираем.** Если клиент изменился сам (`claude mcp add`), `hub status` показывает расхождение, `hub import` забирает его в hub. Молча ничего не перезаписываем.
4. **Секретов нет ни в git, ни в сгенерированных конфигах.** Где формат клиента позволяет, в конфиге остаётся ссылка, а значение подставляет launcher при запуске.
5. **Совместимость вместо замены.** Работаем поверх `skills` CLI (`~/.agents/skills`), стандарта AGENTS.md и формата SKILL.md.
6. **Local-first.** Всё работает офлайн. Git по умолчанию локальный, remote — опционально.
7. **Два уровня истины.** Глобальная живёт в hub. Проектная (архитектура, решения, текущая задача) — в самом репозитории, вместе с кодом и ветками.

## 2. Структура hub

```
~/.agent-hub/                     # git (локальный по умолчанию)
├── hub.yaml                      # настройки: клиенты, пути, версия схемы
├── skills/<name>/SKILL.md        # оригиналы skills
├── mcp/servers.yaml              # реестр MCP (без секретов)
├── instructions/AGENTS.md        # глобальные правила для всех агентов
├── memory/
│   ├── MEMORY.md                 # индекс (одна строка — один факт-файл)
│   └── *.md                      # факты (frontmatter: name, description, type)
├── templates/repo/               # AGENTS.md, .agents/state/{PROJECT,NOW}.md
├── .env                          # секреты (600, в .gitignore)
├── .gitignore
├── backups/                      # снапшоты конфигов клиентов перед sync (в .gitignore)
└── state/                        # служебное: последние хэши проекций (для дрейфа)
```

## 3. Адаптеры клиентов

Каждый клиент — это адаптер с одним интерфейсом:

```ts
interface ClientAdapter {
  id: 'claude-code' | 'codex' | 'dsh' | string;
  detect(): Promise<DetectResult>;            // установлен? где конфиги?
  read(): Promise<ClientSnapshot>;            // текущие skills/mcp/instructions в клиенте
  plan(hub: HubState): Promise<Change[]>;     // что изменит sync (dry-run)
  apply(changes: Change[]): Promise<void>;    // запись с бэкапом
}
```

| Слой | Claude Code | Codex CLI | DSH |
|---|---|---|---|
| Skills | `~/.claude/skills/<x>` → симлинк на `hub/skills/<x>` | `~/.agents/skills` → симлинк на `hub/skills` | тот же `~/.agents/skills` |
| MCP | ключ `mcpServers` в `~/.claude.json` | таблица `[mcp_servers.*]` в `~/.codex/config.toml` | блок `agenthub-mcp-*` в `~/.dsh/profiles/<p>/cordis.patch.yml` |
| Инструкции | `~/.claude/CLAUDE.md` содержит `@~/.agent-hub/instructions/AGENTS.md` | `~/.codex/AGENTS.md` → симлинк | `~/.agents/AGENTS.md` / симлинк (уточнить) |
| Память | memory-каталоги Claude → симлинк на `hub/memory` (хук SessionStart делает это для новых папок) | индекс `MEMORY.md` встраивается в AGENTS.md | так же |

Секция в чужом файле помечается так: JSON — ключ `_agentHub: {generatedAt, hash}`, где это допустимо, иначе хэш хранится в `state/`. TOML и YAML — комментарием-маркером.

## 4. MCP-реестр

`~/.agent-hub/mcp/servers.yaml`:

```yaml
version: 1
servers:
  todoist:
    transport: http            # stdio | http | sse
    url: https://ai.todoist.net/mcp
    proxy: true                # проброс HTTP(S)_PROXY из .env
    tags: [personal]           # задел под профили (v2)
  atlassian:
    command: uvx
    args: [mcp-atlassian]
    env:
      JIRA_URL: https://jira.example.net/
      JIRA_PERSONAL_TOKEN: ${JIRA_PERSONAL_TOKEN}   # значение — в .env
    tags: [work]
  figma-bridge:
    command: npx
    args: [-y, "@gethopp/figma-mcp-bridge"]
    clients:
      codex:                   # оверрайды под клиента
        tools: { get_node: { approval_mode: approve } }
```

**Подстановка секретов.** Если клиент сам раскрывает `${VAR}` из окружения, пишем ссылку как есть. Если нет — используется **launcher**: `command: agent-hub`, `args: [mcp, run, <name>]`. Launcher читает реестр и `.env` и запускает сервер через `exec`. Это обобщение текущего `mcp-stdio-bridge.py`. По умолчанию launcher используется всегда: так ни в одном клиентском конфиге нет секретов. Для HTTP-серверов без stdio — либо `mcp-remote`-обёртка через launcher, либо нативный HTTP-конфиг с заголовком из окружения, если клиент это умеет.

## 5. CLI

| Команда | Что делает |
|---|---|
| `hub init` | Создаёт `~/.agent-hub`, git, `.env`. Находит клиенты (спрашивает подтверждение). Предлагает импортировать существующие skills, MCP и память. Спрашивает про remote |
| `hub status` | Таблица: что есть в hub и в каждом клиенте, где дрейф (only-in-client / only-in-hub / differs) |
| `hub sync [--dry-run] [--client x]` | hub → клиенты. Сначала показывает план, применяет с бэкапом |
| `hub import [item]` | клиент → hub, по одному элементу или всё. Секреты выносит в `.env` и ставит на их место `${VAR}` |
| `hub doctor` | Проверяет каждый MCP (initialize + tools/list), битые симлинки, права на `.env` |
| `hub mcp add/rm/ls`, `hub mcp run <name>` | Управление реестром; `run` — launcher |
| `hub skill add/rm/ls` | Тонкая обёртка: локальный путь → `hub/skills`, удалённый → делегирует `skills` CLI |
| `hub init-repo` | Кладёт в текущий репозиторий `AGENTS.md` (протокол), `.agents/state/PROJECT.md` и `NOW.md`, добавляет `@AGENTS.md` в `CLAUDE.md` |
| `hub restore <backup>` | Откат конфигов клиента |

Все команды поддерживают `--json`, чтобы ими мог пользоваться агент.

## 6. Состояние задачи в репозитории

```
repo/
├── AGENTS.md                 # общий протокол (из шаблона) + специфика проекта
├── CLAUDE.md                 # содержит @AGENTS.md
└── .agents/state/
    ├── PROJECT.md            # долгоживущее: архитектура, решения, ограничения
    └── NOW.md                # оперативное: задача, ветка, сделано, изменённые файлы, проверки, следующий шаг
```

Протокол в AGENTS.md:
- **На старте:** прочитать PROJECT.md и NOW.md, посмотреть `git status` и diff, сверить заметки с кодом.
- **По ходу:** обновлять NOW.md после значимых этапов. Не писать «тесты прошли», если они не запускались.
- **На handoff:** что сделано, что осталось, изменённые файлы, следующее действие.
- Git и файловая система важнее устаревших заметок.

Решить: коммитить ли NOW.md. По умолчанию — да, это часть ветки. Опция — gitignored.

v2: авто-checkpoint через хуки (Stop/SessionEnd у Claude, аналоги у Codex и DSH). Если NOW.md устарел — фолбэк-экстракт из последней сессии, как в context-relay.

## 7. Этапы

**MVP (v0.1)**
1. Каркас CLI (commander), конфиг `hub.yaml`, пути через `~` и переменные.
2. `init` + адаптеры detect/read для Claude, Codex, DSH.
3. Skills: перенос оригиналов в hub, симлинки, совместимость со `skills` CLI.
4. MCP: `servers.yaml`, импорт из Claude и Codex (секреты → `.env`), launcher, генерация в 3 клиента.
5. `status` / `sync --dry-run` / `import` / `doctor`.
6. Инструкции и память: AGENTS.md, симлинк памяти Claude, встраивание индекса для Codex и DSH.
7. `init-repo` + шаблоны.
8. Миграция текущего `~/.agent-hub` автора (dogfooding).

**v0.2+ (TODO)**
- Профили и теги work/personal (`hub sync --profile work`).
- Keychain вместо `.env` (macOS `security`, libsecret).
- MCP-сервер `hub`: `memory.search/get/put`, `sessions.search/read` (индекс Claude, Codex и DSH; посмотреть переиспользование парсеров claude-history).
- Автосинк: хуки клиентов + опциональный launchd/systemd watcher.
- Handoff-фолбэк из сессий.
- Адаптеры: Cursor, Gemini CLI, OpenCode.
- Шаринг: публикация skills и шаблонов отдельно от личного.

## 8. Открытые вопросы

- Как DSH читает глобальные инструкции (`~/.agents/AGENTS.md`?) — проверить.
- Перезаписывает ли Claude `~/.claude.json` целиком (гонки при одновременной записи)? Нужна атомарная запись и проверка mtime.
- Поддерживает ли `skills` CLI `~/.agents/skills` в виде симлинка на каталог — проверить.
- Имя пакета: `agent-hub` скорее всего занято на npm — проверить, есть запасные варианты.
- Где хранить метаданные дрейфа: в `state/` (просто) или маркерами в файлах (переносимо).
