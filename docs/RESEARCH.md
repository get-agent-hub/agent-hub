# Research: конкуренты и спрос

Дата: 2026-11-02. Источники — README репозиториев, форумы, блоги. Звёзды/метрики — на момент просмотра, часть из сторонних обзоров (помечено).

## TL;DR

- Рынок **есть, но раздроблен**: десятки мелких инструментов, каждый закрывает один срез (rules, MCP, skills, handoff, memory, history). Почти у всех 0–40 звёзд.
- Единственный крупный игрок по конфигам — **Ruler** (~3k ★): rules + MCP + (эксп.) skills, но **project-scoped**, без памяти, сессий, handoff.
- По памяти крупный — **agentmemory** (~9k ★ по стороннему обзору): MCP-память, не управляет конфигами.
- **Никто не объединяет** глобальный SSOT (skills + MCP + инструкции + память) + детект дрейфа + handoff задачи + поиск по чатам + новые харнесы (DSH).
- Спрос подтверждается **количеством независимых велосипедов** (люди пишут себе одно и то же), а не громкими постами: HN-пост Handoff — 2 поинта, форум OpenAI — 3 участника. Боль массовая, но «тихая».

## Карта конкурентов

### 1. Синк конфигов (rules / MCP / skills)

| Проект | Что синкает | Модель истины | Агенты | Стек | Тракция |
|---|---|---|---|---|---|
| [Ruler](https://github.com/intellectronica/ruler) | rules, MCP, skills/subagents (эксп.) | `.ruler/` в проекте, глобальный `~/.config/ruler` фолбэк | 31 | Node/TS | ~3.0k ★, beta |
| [ai-config-sync-manager](https://github.com/slash9494/ai-config-sync-manager) ([пост](https://community.openai.com/t/sync-codex-and-claude-code-configs-skills-agents-mcp-permissions/1380517)) | skills, agents, MCP, permissions, hooks | **нет мастера**: выбираешь источник на каждый sync | Claude ↔ Codex | npm | v0.1, ~3 участника треда |
| [agent-rules-sync](https://github.com/dhruv-anand-aintech/agent-rules-sync) | rules, skills, settings/hooks, MCP | двусторонний, newest wins; демон FS-events | 8 | Python | 7 ★ |
| [ai-rules-sync (lbb00)](https://github.com/lbb00/ai-rules-sync) | skills, rules, commands, subagents (без MCP) | git-репо → кеш → симлинки | ~30 | Node/TS | 40 ★ |
| [ai-rules-sync (Panis)](https://github.com/PanisHandsome/ai-rules-sync) | только rules-файлы | один канонический файл | ~8 | — | — |
| [agentsync (Go)](https://pkg.go.dev/github.com/spxrogers/agentsync) | MCP JSON↔TOML, rules | — | Claude, Codex, OpenCode | Go | — |
| [agentsync-cli](https://pypi.org/project/agentsync-cli/) | MCP + rules | Claude → остальные | 4 | Python | v0.1 |
| mcptoon ([статья](https://explore.n1n.ai/blog/unifying-mcp-configurations-agent-skills-claude-code-cursor-codex-2026-10-07)) | MCP + индекс skills, gateway | SSOT master config | 5+ | — | — |
| `skills` CLI (vercel-labs, skills.sh) | только skills | `~/.agents/skills` + симлинки, lock-файл | ~50 | Node | де-факто стандарт для skills |

### 2. MCP-менеджеры / агрегаторы

| Проект | Суть |
|---|---|
| [mcpm / mcp-fleet](https://github.com/AZERDSQ131/mcpm) | установка MCP в несколько клиентов |
| MCPM (pipx/brew) | менеджер MCP, Codex — в роадмапе |
| [1MCP](https://github.com/1mcp-app/agent) | агрегатор: много MCP → один endpoint, `1mcp cli-setup` для Claude/Codex |

Агрегатор — альтернативный подход к MCP: вместо генерации N конфигов каждому клиенту даётся **один** MCP-сервер-прокси. Плюс: секреты в одном процессе. Минус: единая точка отказа, оверхед.

### 3. Handoff между агентами

| Проект | Механизм | Тракция |
|---|---|---|
| [context-relay](https://github.com/krika2810/context-relay) | читает сессии Claude/Codex/Cursor, SessionStart-хуки, `.relay/CONTEXT.md` (≤9k симв.) + полные транскрипты, macOS-app | 0 ★ |
| [handoff (zaki2993)](https://github.com/zaki2993/handoff) | `handoff codex` → `.handoff/HANDOFF.md`, 6 агентов | 0 ★ |
| Handoff (sahir2k, [HN](https://news.ycombinator.com/item?id=47206954)) | парсит сессии, 3 уровня детализации, тащит CLAUDE.md/MEMORY.md | 2 pts |
| which-ai-to-use, ccswap, codex-mode | note при лимите / свитч аккаунтов / делегирование (codex-mode заархивирован) | — |

Все — **реактивные** (собирают контекст из логов после факта). Наш подход с `NOW.md` — **проактивный** (агент ведёт состояние сам) — дополняет, а не заменяет: лучший вариант = NOW.md + авто-экстракт из сессии как фолбэк.

### 4. Память

| Проект | Суть |
|---|---|
| agentmemory ([обзор](https://dev.to/andrew-ooo/agentmemory-review-persistent-memory-for-ai-coding-agents-55g2)) | MCP-память, авто-хуки для Claude/Codex, ~9k ★ (по обзору) |
| Memorix, mcp-memory-service, aimemory-mcp, Basic Memory, [shared-agent-memory](https://github.com/dan-calin/shared-agent-memory) | MCP-память разной сложности (граф, вектор, markdown) |

Память — самый занятый сегмент. Свою **не надо изобретать**: файлы в hub для MVP, далее — либо свой тонкий MCP поверх тех же файлов, либо адаптер к существующему (Basic Memory хранит markdown — совместимо по духу).

### 5. История чатов

| Проект | Суть |
|---|---|
| [claude-history](https://github.com/raine/claude-history) | Rust TUI, fuzzy search по Claude + Codex + Pi, есть skill чтобы агент искал свои прошлые чаты |
| Claude Code & Codex Assist (VS Code) | браузер истории 5 агентов, diff, cost |
| Claude Explorer | единый архив Desktop + CLI |

Поиск по чатам **уже решён** неплохо (claude-history). Нам — интегрировать/переиспользовать, а не писать с нуля; ценность — доступ из любого агента через MCP + DSH-сессии.

## Белые пятна (наша ниша)

1. **Глобальный SSOT с импортом дрейфа.** Ruler — проектный, ai-config-sync — без мастера, agent-rules-sync — newest-wins. Никто не делает «hub — истина, клиенты — проекции, правки в клиенте ловятся `status` и забираются `import`».
2. **Секреты по ссылке.** Почти никто не говорит о секретах (agent-rules-sync синкает конфиги с токенами как есть). У нас: `${VAR}` в реестре, значения в `.env`/Keychain, bridge подставляет при запуске.
3. **Связка fallback-сценария целиком**: skills + MCP + память + состояние задачи + история — чтобы сменить агента за минуту. Сейчас это 4–5 разных тулов.
4. **Новые харнесы** (DSH и т.п.) — никто не поддерживает; адаптерная архитектура это закрывает.
5. **Совместимость, а не замена**: работать поверх `skills` CLI, AGENTS.md-стандарта, существующих memory-форматов.

## Риски

- **Вендоры закроют сами**: Codex читает `~/.agents/skills`, AGENTS.md становится стандартом, OpenAI выпустил `migrate-to-codex`. Часть ценности (skills) уже коммодитизирована.
- **Ruler может расшириться** до global + memory.
- **Хрупкость форматов**: `~/.claude.json`, `config.toml`, DSH YAML меняются без предупреждения → нужны тесты адаптеров и версионирование.
- **Низкая видимость спроса**: боль массовая, но люди решают её скриптами; нужен очень низкий порог входа (`npx agent-hub init` → работает за 2 минуты).

## Выводы для продукта

- Не конкурировать с `skills` CLI и memory-серверами — **встраиваться**.
- Фокус MVP: **SSOT + MCP-генерация с секретами по ссылке + drift detection + repo state (NOW.md)**. Это то, чего нет ни у кого вместе.
- v2: hub MCP (memory + sessions search через переиспользование парсеров), handoff-фолбэк из сессий.
- Позиционирование: «**один источник правды для всех твоих AI-агентов. Сменил агента — ничего не потерял.**»

## Пробелы ресёрча

- Reddit-треды не прочитаны (блок доступа) — метрики спроса оттуда не сняты.
- Не проверены: MetaMCP, Basic Memory/OpenMemory детально, npm-загрузки `@intellectronica/ruler`, `ai-config-sync`.
- Звёзды agentmemory — из стороннего обзора, не проверены.
