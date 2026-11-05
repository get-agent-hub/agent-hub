# Decisions for the implementation

[Overview](README.md) · [Acceptance cases and status](DELIVERY.md)

These decisions close the documented policy gaps. They are requirements for the slice that introduces the corresponding capability, not claims that the beta implements them. The implementation must keep ordinary use to choosing sources, reviewing impact and syncing.

## Source access and discovery

Discovery is an explicit read operation over selected configured client stores. No arbitrary browser-supplied paths, model calls, plugin execution, dependency installation or permission changes. Each adapter declares supported formats, selection coverage and limits. Failure, absence, unsupported data and incomplete reads have different results. None authorizes deletion.

The first slice reads bounded prefixes of top-level local Claude Code JSONL files. It returns project metadata and counts only. Subagent logs, remote environments, late-session cwd changes, native project assignments and complete chat contents are not covered yet. Its IDs identify a transient discovery result; they are not durable project bindings or MCP capabilities. Full project identity/aliases are a later step before persistent associations are introduced.

Keep ordinary folders and unavailable historical locations visible. Use verified Git common-directory evidence to group worktrees. Do not merge separate clones by name or remote URL. When verification cannot finish, preserve an explicitly unverified candidate. Finding or grouping a project never connects memory or expands write scope.

## Archive access

Each connection gets explicit read grants for selected projects and shared content. Default future archive access is the connected project; broader access requires a persisted choice. Search, counts, snippets, assets and direct-ID lookup apply the same authorization before returning data. Related chats and combined project cards cannot expand grants. A profile/account rebinding invalidates inherited grants until reviewed.

The local UI is the machine owner's operator surface: an explicit discovery request can list metadata from the selected stores. This does not grant connected agents archive access. Agent retrieval must use its own scoped MCP connection rather than inherit the UI's operator selection.

Enforce current grants when producing each response, including responses from caches. Revocation cannot recall content already delivered. Hub scopes do not isolate clients that independently have permission to read the archive on disk. Remote multi-user serving is outside the local-Hub contract.

## Canonical data and simultaneous changes

Collect all supported source observations before deciding an item update. Compare portable meaning with each connection's acknowledged version. Preserve all divergent versions, including three-client conflicts; traversal order and clocks do not choose a winner. Only independent approved changes proceed automatically. Revalidate affected sources and targets before each write; acknowledge only completed stages.

One target has one recorded Hub owner. Detect another Hub's generated references/ownership and require a reviewed transfer. Transfer preserves content and recoverable originals; it is not an overwrite shortcut. Do not import Hub-generated launchers as new portable definitions.

## Storage, upgrades and recovery

Store and validate a complete archive unit before committing its checkpoint/index acknowledgement. On interruption or disk failure, retain the last valid generation and resume idempotently. Keep raw/native preserved data authoritative and derived indexes rebuildable. Native sources remain read-only to the importer.

Version Hub metadata and archive formats. Migrate through a new generation with recovery material before switching readers. Unsupported newer versions must not be rewritten by an older binary. Multi-file application remains staged with compensating recovery; do not promise crash-safe transactions. Existing later-edit and lock/ownership guards apply to every new writer.

## Complete chat contents

Track metadata, conversation/event preservation, assets and indexing as separate completion states. Preserve supported unknown native fields/events for later normalization. Images, attachments and deferred outputs need explicit coverage and validated permitted locations. Missing external assets stay marked missing; a text view is not a complete backup.

Detect supported rewrites, truncation, branch changes and compaction using source generations/revisions rather than append offsets alone. Preserve earlier captured revisions under the selected retention policy. One normalized active conversation does not replace original lineage/events.

## Portability and runtime bindings

Initial synchronization is between local clients on one machine. Preserve portable definitions separately from machine/profile paths, credential bindings, permissions and executable availability. Never transfer credentials/accounts because names or endpoints match. On an accepted Hub move, review and rebuild local connections while retaining stable content/project IDs once durable storage exists.

Multi-device replication requires a separate identity/conflict contract. A shared/network folder is not automatically a supported replication mechanism. Remote recorded paths must not be resolved on the host without an explicit environment mapping. Native cross-client continuation is also a separately verified capability; initial interoperability is archive read/search and selected-context handoff.

## Exclusions, deletion and retention

Exclusion stops discovery/import of the selected source/project. Disconnect stops delivery/automation and future access under that connection. Neither deletes already archived data. Explicit archive deletion must state its project/source scope and whether retained recovery copies remain. Update raw data, indexes, snippets and caches consistently; do not claim secure erasure of historical backups or copies held by other apps.

The first archive implementation retains selected history until explicit deletion and offers size/progress and exclusions; automatic eviction is off. Persist deletion/exclusion records so reconnecting sources do not silently reimport removed content. Do not compact deletion records while an old connection can rejoin without a full review. Any future retention policy must disclose what it removes and how recovery copies expire.

## Disconnect and uninstall

Offer two reviewed outcomes: retain the current supported shared content as native copies, or restore recorded original setup. Preserve unrelated settings and later edits. Check active references before removing canonical content. A missing Hub/link produces a repair explanation, not an automatic reset. CLI package removal alone does not perform content recovery.

## Platforms and project changes

Advertise only verified platforms/filesystems. Current CI covers macOS/Linux, not Windows. Check case/Unicode collisions, permissions, path forms and link capabilities before writing. Fail clearly on unavailable/read-only storage; preserve readable data.

For project resources, a checkout/branch change invalidates the effective resource view while preserving project identity. Rescan applicable native locations and precedence. Branch-local content does not automatically become shared/global.

## Visible simplicity

Keep these rules in adapters, connection policies and guarded plans. The user sees source selection, a concise impact summary, one Sync action and item-level choices when versions diverge. Show technical origins/coverage through Details. Do not add a command or setup screen for every case in this document.
