# myai Desktop and Cloud Feature Reference

- Status: Developer reference
- Last reviewed: 2026-09-02
- Scope: Desktop application and the cloud services used by Desktop

## 1. Why this document exists

This document explains what the current application can do. It is written for
developers, product owners, designers, and testers. The language is kept simple
so that a student can understand the product without already knowing the code.

Use this document when deciding:

- Which features myai should keep.
- Which features myai should remove.
- Which features need new branding.
- Which features depend on OpenWork Den or other cloud services.
- Which features work only on one operating system.
- Which features are active, experimental, old, or only planned.
- Which parts must change if myai supports more than one agent harness.

This is a product-level feature reference. It does not list every helper
function or private API route.

## 2. Status words used in this document

| Status | Simple meaning |
| --- | --- |
| **Active** | The feature is connected to the normal product flow. |
| **Conditional** | The feature works only after a setting, login, provider, policy, or service is available. |
| **Preview** | The feature works, but it is still experimental. |
| **Local only** | The feature needs the Desktop app and a local machine. |
| **Cloud dependent** | The feature needs Den or another cloud service. |
| **Dormant** | Some code exists, but the normal user flow is not complete. |
| **Legacy** | The code mainly exists for old versions or compatibility. |
| **Removed** | The product no longer provides this feature. |
| **Proposed** | A design exists, but the feature is not shipped. |

### How to navigate this document

- Sections 3-4 explain the architecture, application shell, and onboarding.
- Sections 5-17 explain local Desktop features.
- Sections 18-26 explain Desktop-to-cloud and organization features.
- Section 27 lists removed, dormant, and misleading code.
- Section 28 explains the proposed multi-harness architecture.
- Section 29 is the keep, adapt, remove, or later decision worksheet.
- Section 30 explains how future feature changes must be verified.

## 3. Product architecture in simple words

The product has four main layers.

```text
myai Desktop user interface
        |
        v
Local OpenWork server
        |
        +----> OpenCode agent engine
        |
        +----> Files on the user's machine
        |
        +----> Den cloud services, when the user signs in
```

### 3.1 Desktop user interface

The user interface is a React application. Electron turns it into a native
desktop app for macOS, Windows, and Linux. The same React application can also
run in a browser for headless or cloud deployments.

Main source areas:

- `apps/app/src/react-app/`
- `apps/app/src/app/`
- `apps/desktop/electron/`

### 3.2 Local OpenWork server

The local server gives the user interface a stable HTTP API. It manages
workspaces, files, extensions, configuration, cloud synchronization, and the
connection to the agent engine.

Main source area:

- `apps/server/src/`

### 3.3 Agent engine

The current agent engine is OpenCode. OpenCode runs prompts, calls tools,
streams messages, manages models, asks permission questions, and stores its
native session data.

This dependency is deep. OpenCode is not only a command that the app starts.
Many message, session, provider, tool, permission, and configuration types are
currently OpenCode-specific.

### 3.4 Den cloud

Den is the optional organization and cloud control plane. Desktop uses it for
login, organization policies, shared providers, OpenWork Connect, cloud
plugins, dashboards, and Automations.

Important license note: code under `ee/` has a separate license from the
open-source Desktop code. Rebranding or selling a hosted Den service needs a
separate legal review.

## 4. Application shell and first-time setup

### 4.1 Native desktop application

**Status:** Active

The product runs as an Electron desktop application on macOS, Windows, and
Linux. Electron provides native windows, menus, file pickers, notifications,
deep links, secure storage, updates, and process management.

Main code:

- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/preload.mjs`
- `packages/types/src/desktop-ipc.ts`

### 4.2 Shared web interface

**Status:** Active

The same React interface can run without Electron. This is useful for local
headless testing and OpenWork Web/cloud-worker deployments. Features that need
Electron, such as a local terminal or native file picker, are disabled in this
mode.

### 4.3 Sign-in screen

**Status:** Active; cloud dependent

The user can sign in through a browser. Den sends the login result back through
a deep link or a one-time code. A self-hosted Den server can also be used.

### 4.4 Organization onboarding

**Status:** Active; cloud dependent

After sign-in, the app can:

- List organizations the user can access.
- Select the active organization.
- Download organization model assignments.
- Download organization policies and branding.
- Show organization-provided starter prompts.

### 4.5 Welcome page

**Status:** Active; policy controlled

The Welcome page helps a new user create a workspace and start the first task.
An organization policy can hide this page.

### 4.6 Main application routes

**Status:** Active

The main route groups are:

- Sign in.
- Onboarding.
- Welcome.
- Tasks and conversations.
- Automations.
- Organization dashboards.
- Extensions library.
- Settings.

Main code:

- `apps/app/src/react-app/shell/app-root.tsx`

## 5. Workspace features

### 5.1 Create a local workspace

**Status:** Active

The user chooses a folder on the computer. That folder becomes the working
directory for the agent. The agent can read and modify files inside the folder,
subject to permissions.

### 5.2 Workspace presets

**Status:** Active

The app supports starter, automation, and minimal presets. A preset can create
starter files, starter prompts, initial sessions, or actions.

### 5.3 Multiple workspaces

**Status:** Active; policy controlled

The user can keep several workspaces and switch between them. An organization
can restrict the app to one workspace.

### 5.4 Remote workspace

**Status:** Active

The user can connect to an OpenWork or OpenCode worker running somewhere else.
The connection may include:

- Server URL.
- Access token or username/password.
- Display name.
- Remote working directory.

Remote workspaces can run agent tasks, but local-only features such as the
integrated PTY terminal may not be available.

### 5.5 Remote connection diagnostics

**Status:** Active

The app tests the remote URL, authentication, workspace path, and server type.
It explains common connection failures and lets the user repair the saved
connection.

### 5.6 Rename and decorate a workspace

**Status:** Active

The user can change the workspace display name, color, and image avatar. These
values organize the interface; they do not rename the real folder.

### 5.7 Reveal a workspace folder

**Status:** Active; local only

The app can open the workspace folder in Finder or Explorer.

### 5.8 Forget a workspace

**Status:** Active

The app can remove a workspace from its list without deleting the user's
files. This distinction must stay clear in the interface.

### 5.9 Export and import workspace configuration

**Status:** Active; local only

Desktop can export a limited workspace archive and import it later. Archive
validation protects against unsafe paths and very large extracted files.

### 5.10 Additional authorized folders

**Status:** Active; local only

The workspace root is always allowed. The user can grant the agent access to
extra folders. These folders can later be removed from the allowed list.

### 5.11 Share a local worker

**Status:** Active; local only

The local OpenWork server can be shared on the local network. The app provides
owner and collaborator connection information. Remote access is off by default
and requires an explicit action because it increases security risk.

### 5.12 Sandbox workspace creation

**Status:** Dormant

Microsandbox types, settings, and flags exist, but the normal workspace dialog
does not currently provide a complete sandbox creation flow.

Main workspace code:

- `apps/app/src/react-app/domains/workspace/`
- `apps/desktop/electron/workspace-store.mjs`
- `apps/desktop/electron/workspace-archive.mjs`
- `packages/types/src/workspace.ts`

## 6. Task and conversation features

### 6.1 Create and manage tasks

**Status:** Active

A task is a conversation with an agent. The user can create, rename, delete,
pin, archive, and unarchive tasks.

### 6.2 Automatic task titles

**Status:** Active

The agent or engine can generate a title from the conversation. The app has
recovery behavior when title generation fails.

### 6.3 Search and pagination

**Status:** Active

The user can search task titles and load older tasks in pages. This keeps the
sidebar usable when a workspace has many conversations.

### 6.4 Custom task groups

**Status:** Active

The user can create, rename, delete, and reorder groups. Tasks can move between
groups or return to the normal list.

### 6.5 Task status indicators

**Status:** Active

The sidebar can show:

- A task is running.
- A task has unread activity.
- A task needs user attention.
- A task is pinned or archived.

### 6.6 Conversation tabs

**Status:** Active

The workbench can remember several open conversations. Temporary navigation to
Settings does not have to destroy the open-tab state.

### 6.7 Split view

**Status:** Active

Two tasks can be viewed side by side. The app tracks which side is focused so
commands and keyboard shortcuts act on the correct task.

### 6.8 Command palette

**Status:** Active

The command palette can create tasks, find tasks, open split view, change
models or agents, move tasks, and open product areas such as Settings or
Extensions.

### 6.9 Draft isolation

**Status:** Active

Each task keeps its own unsent draft. A draft from one workspace or task must
not appear in another task.

Main task code:

- `apps/app/src/react-app/domains/session/`
- `apps/app/src/react-app/shell/session-route.tsx`

## 7. Composer and prompt features

### 7.1 Rich prompt editor

**Status:** Active

The composer is a rich text editor. It supports multiline prompts, keyboard
submission, inline chips, attachments, and mentions.

### 7.2 Model and agent selection

**Status:** Active

The user can choose a model, reasoning level, and agent. The selected model can
be remembered for the task.

### 7.3 Slash commands

**Status:** Active

Slash commands provide short ways to run predefined prompts or actions.

### 7.4 Mentions

**Status:** Active

The composer supports mentions for files, skills, agents, and, when Computer
Use is available, running macOS applications.

### 7.5 Attachments

**Status:** Active

The user can add images and files by picker, drag and drop, or clipboard.
Images may be compressed before they are sent. Remote workspaces copy files
through the workspace inbox so tools can access them.

### 7.6 Long pasted text

**Status:** Active

Very long pasted text becomes a compact chip instead of filling the entire
composer. The user can expand or remove it.

### 7.7 Prompt history

**Status:** Active

Arrow keys can recall earlier prompts when the editor is in the correct state.

### 7.8 Queue and steer

**Status:** Active

While an agent is busy, the user can queue a follow-up or steer the current
run immediately. Queued messages can be edited, reordered, removed, or sent
now.

### 7.9 Stop and resume

**Status:** Active

The user can stop an active run. Interrupted work can be resumed when the
engine supports it.

### 7.10 Context compaction

**Status:** Active

Compaction shortens a long conversation so it fits inside the model's context
window. It can run automatically or through `/compact`.

### 7.11 Safe edit and resend

**Status:** Active

The user can edit an earlier message and resend from that point. The app
reverts the later conversation boundary instead of mixing two histories.

### 7.12 Repeated-tool protection

**Status:** Active

If the engine repeats the same tool call many times, the app can stop and ask
the user whether to continue.

Main composer code:

- `apps/app/src/react-app/domains/session/surface/composer/`
- `apps/app/src/react-app/domains/session/sync/`

## 8. Message and tool rendering

### 8.1 Streaming messages

**Status:** Active

Assistant text, reasoning, and tool activity appear while the agent is still
working.

### 8.2 Markdown and code

**Status:** Active

Messages support Markdown, tables, lists, links, syntax-highlighted code, and
mathematical notation.

### 8.3 Reasoning display

**Status:** Active; user controlled

Reasoning sections can be shown or hidden. The application should never assume
that every model provides reasoning data.

### 8.4 Tool cards

**Status:** Active

Special cards explain common tool activity, including:

- Shell commands.
- File reads, writes, edits, and patches.
- Search and glob operations.
- Language-server operations.
- Web fetch and web search.
- Skills and todos.
- Questions and environment-variable requests.
- OpenWork capability calls.
- MCP Apps.
- Subagent runs.

### 8.5 Permission approval

**Status:** Active; currently OpenCode dependent

The app can ask the user to allow an action once, allow it for the current
session, or deny it. Permission types include shell, edit, read, external
folder, task, skill, question, and todo operations.

### 8.6 Agent questions

**Status:** Active

The agent can ask a question with suggested answers. The user can also type a
custom answer.

### 8.7 Errors and incomplete tools

**Status:** Active

The app keeps errors close to the tool or message that caused them. It also
handles tool calls that were interrupted before a final result arrived.

Main rendering code:

- `apps/app/src/components/chat/`
- `apps/app/src/components/tools/`
- `apps/app/src/components/markdown/`

## 9. Files, attachments, and artifacts

### 9.1 Workspace file tree

**Status:** Active

The right panel can browse workspace files, search, refresh, and open a file in
an artifact tab.

### 9.2 Text and Markdown editing

**Status:** Active

Plain text and Markdown files can be viewed and edited. Save-conflict handling
reduces the chance of overwriting a newer file version.

### 9.3 Code preview

**Status:** Active

Source files can be viewed with syntax highlighting. Supported text formats
can also be edited.

### 9.4 Spreadsheet editor

**Status:** Active

CSV, TSV, XLS, XLSX, and ODS files can be opened. Supported spreadsheets can
be edited and saved.

### 9.5 HTML, image, and PDF preview

**Status:** Active

The artifact panel can preview HTML, common images, and PDF files.

### 9.6 Office attachment reading

**Status:** Active

DOCX, PPTX, and XLSX attachments are recognized. The server extracts bounded
text for the model and protects against unsafe ZIP paths, encrypted archives,
very large files, and decompression bombs.

### 9.7 Document and slide limitation

**Status:** Partial

The product recognizes generated Word and PowerPoint files and lets the user
open, download, reveal, or launch them externally. The current artifact panel
does not provide a complete native Word or PowerPoint renderer.

### 9.8 Native file actions

**Status:** Active; local only

Desktop can download, reveal, open externally, or choose an application with
which to open a file.

Main artifact code:

- `apps/app/src/react-app/domains/session/artifacts/`
- `apps/server/src/opencode-plugins/openwork-office-attachments.ts`

## 10. Built-in browser

### 10.1 Browser panel

**Status:** Active; desktop only

The right panel contains a real browser with multiple tabs, an address bar,
back, forward, reload, close, and tab-reordering controls.

### 10.2 Persistent browser session

**Status:** Active

Browser cookies and session state can stay available between tasks. This is
useful when a user signs in to a site and then lets the agent work on it.

### 10.3 Browser automation

**Status:** Active

The built-in Browser extension uses a Chrome DevTools/OpenCode plugin so the
agent can inspect and interact with the visible browser.

### 10.4 External browser actions

**Status:** Active

The user can copy the current URL or open it in the normal system browser.

Main code:

- `apps/app/src/react-app/domains/session/panel/`
- `apps/app/src/app/extensions.ts`

## 11. Integrated terminal

### 11.1 Local PTY terminal

**Status:** Active; local only

The Desktop app uses xterm and `node-pty` to provide a real terminal. It
supports input, output, focus, resize, and process lifecycle.

### 11.2 Remote limitation

The terminal is not available for a normal remote worker because the PTY runs
inside the local Electron process.

Main code:

- `apps/app/src/react-app/domains/session/terminal/`
- `apps/desktop/electron/main.mjs`

## 12. Voice Mode

### 12.1 Realtime voice conversation

**Status:** Preview; conditional

Voice Mode uses OpenAI Realtime. It can capture microphone audio, show live
transcription, play assistant audio, and accept typed commands.

### 12.2 Voice control of the interface

**Status:** Preview

Voice Mode can call the same semantic UI-control actions used by the internal
UI MCP. This allows spoken navigation and commands.

### 12.3 Requirements

Voice Mode requires:

- Microphone permission.
- An OpenAI API key.
- Network access to OpenAI Realtime.

Main code:

- `apps/app/src/react-app/domains/session/voice/`

## 13. Models and providers

### 13.1 Provider onboarding

**Status:** Active

The user can connect a model provider during setup or later in Settings.

### 13.2 Authentication methods

**Status:** Active; provider and runtime dependent

Supported methods include API keys, browser OAuth, device flow, and headless
OAuth. The available method changes for local, remote, and browser runtimes.

### 13.3 Default and per-task models

**Status:** Active

The user can choose an application default and a different model for an
individual task. Reasoning or thinking levels are also model-specific.

### 13.4 Provider recovery

**Status:** Active

The interface detects missing credentials, removed models, or failed provider
connections and guides the user toward reconnection.

### 13.5 Organization providers

**Status:** Active; cloud dependent

Den can assign providers and models to a member. Desktop materializes the
required configuration into the local runtime. When access is removed, cloud-
managed configuration is removed without deleting the user's own providers.

### 13.6 Organization restrictions

**Status:** Active; cloud dependent

An organization can disable custom providers or OpenCode Zen models.

### 13.7 Ollama

**Status:** Active; local only

The Ollama extension can discover local models, pull a model, detect likely
vision support, and add Ollama as an OpenAI-compatible provider.

Main code:

- `apps/app/src/react-app/domains/connections/provider-auth/`
- `apps/app/src/react-app/domains/settings/pages/ai-view.tsx`
- `apps/app/src/react-app/domains/settings/ollama-config.tsx`

## 14. Extensions library

### 14.1 Unified library

**Status:** Active

The Extensions area brings several resource types into one screen:

- Built-in apps.
- Direct MCP servers.
- Organization connections.
- Skills.
- Commands.
- Agents.
- OpenCode plugins.
- Cloud plugins and marketplace items.

Items can be grouped as ready, available, disabled, needs sign-in, or needs
administrator setup.

### 14.2 Direct MCP servers

**Status:** Active

The user can add a remote HTTP MCP server or a local command/stdio MCP server.
The user can enable, disable, reconnect, authenticate, and remove it.

### 14.3 Quick-connect MCP catalog

**Status:** Active

The built-in quick-connect list includes Notion, Linear, Sentry, Stripe, and
Context7.

### 14.4 Managed local OAuth

**Status:** Active; local only

The local server can manage OAuth discovery, PKCE, dynamic client registration,
encrypted credentials, refresh, and reconnect for compatible remote MCPs.

### 14.5 Skills

**Status:** Active

The app can list, read, create, edit, delete, import, and install skills.
Skills can be global or workspace-specific.

### 14.6 Commands and agents

**Status:** Active

The app can manage custom slash commands and list available agents.

### 14.7 OpenCode plugins

**Status:** Active; OpenCode dependent

The app can add and remove OpenCode npm plugins and preserve their loading
order.

### 14.8 Claude-compatible plugin import

**Status:** Active

The app can preview and import an Anthropic/Claude-compatible plugin from a Git
URL. Supported skills, commands, and remote MCP definitions are translated
into the local product structure.

### 14.9 Built-in extensions

The canonical built-in list currently contains:

| Extension | Status | Main purpose |
| --- | --- | --- |
| myai Browser | Active | Automate the visible built-in browser. |
| Computer Use | Preview; macOS only | Control macOS apps through accessibility APIs. |
| Voice Mode | Preview | Talk to the app through OpenAI Realtime. |
| Ollama | Active | Use local Ollama models. |

Main code:

- `apps/app/src/app/extensions.ts`
- `apps/app/src/app/constants.ts`
- `apps/app/src/react-app/domains/settings/pages/mcp-view.tsx`
- `apps/app/src/react-app/domains/settings/state/extensions-store.ts`

## 15. MCP Apps

### 15.1 Inline MCP App rendering

**Status:** Active

An MCP tool result can include a small interactive application. Desktop shows
the application under the normal text result, so the text remains usable if
the app fails.

### 15.2 Security boundary

**Status:** Active

MCP App HTML runs inside a restricted iframe. The host applies a strict content
security policy, size limits, origin rules, and same-server tool restrictions.

### 15.3 Direct MCP compatibility

**Status:** Partial

The normal inline resolver supports remote Streamable HTTP and legacy SSE. It
does not currently resolve app resources directly from local stdio MCP
processes.

### 15.4 Organization MCP Apps

**Status:** Active; cloud dependent

MCP Apps delivered through OpenWork Connect use a separate short-lived app-
host credential. This credential is not placed in model context. The model
continues to use only capability search and execution.

### 15.5 Standalone URL-imported apps

**Status:** Unavailable

The product does not currently let a user install an arbitrary HTML MCP App by
URL. Old storage code for this idea is not an active product surface.

Main references:

- `docs/features/mcp-apps-host/README.md`
- `docs/features/remote-mcp-apps/README.md`

## 16. Settings

### 16.1 General

**Status:** Active

Shows product information, help, documentation, feedback, and common actions.

### 16.2 Preferences

**Status:** Active

Includes reasoning visibility, automatic compaction, notification level,
analytics choice, and Linux AppImage integration.

### 16.3 Appearance

**Status:** Active

Includes system/light/dark theme, application zoom, titlebar preference,
Windows/Linux menu preference, and organization accent color.

Supported interface languages currently include Catalan, English, Spanish,
French, Japanese, Brazilian Portuguese, Russian, Thai, Vietnamese, and
Chinese.

### 16.4 Permissions

**Status:** Active; local only

Lists the workspace root and extra authorized folders.

### 16.5 Environment variables

**Status:** Active; local only

The user can add, edit, mask, reveal, and delete environment variables. Runtime
restart is required to apply changes. Restart is blocked while a task is
actively running.

### 16.6 Updates

**Status:** Active; desktop only

The app can check, download, install, and restart into updates. Stable and
Alpha channels are supported. Organization policy can disable Alpha or limit
allowed Desktop versions.

### 16.7 Advanced

**Status:** Active

Advanced settings include server addresses, self-hosted Den configuration,
runtime status, cloud MCP maintenance, OpenCode configuration ownership,
developer mode, and selected experimental flags.

### 16.8 Debug and diagnostics

**Status:** Active; mostly developer mode

Developers can inspect versions, health, events, permissions, cloud MCP state,
runtime configuration, logs, and agent-context diagnostics. Diagnostics can be
copied or exported with sensitive values redacted.

### 16.9 Recovery

**Status:** Partial

The product has lower-level reset and cleanup infrastructure. Some visible
Recovery buttons for config reset, cache repair, and Docker cleanup currently
show an unavailable message instead of doing the action.

Main settings code:

- `apps/app/src/react-app/domains/settings/`
- `apps/app/src/react-app/shell/settings-route.tsx`

## 17. Native operating-system features

### 17.1 File and folder dialogs

**Status:** Active; desktop only

Electron opens native folder, file, and save dialogs.

### 17.2 Notifications

**Status:** Active; desktop only

The app can show system notifications. Clicking a notification focuses the app
and opens the related destination.

### 17.3 Deep links

**Status:** Active; desktop only

The `openwork://` protocol handles sign-in callbacks, install links, and other
application navigation. A rebrand must decide whether to migrate this protocol
to a new myai-specific scheme while keeping old links compatible.

### 17.4 Secure storage

**Status:** Active; desktop only

The app uses operating-system secure storage for important encryption keys. A
production build must not fall back to plaintext storage.

### 17.5 Native menu and shortcuts

**Status:** Active; desktop only

The native menu provides edit, view, window, zoom, fullscreen, Settings,
updates, documentation, and developer commands.

### 17.6 Auto-updater and recovery

**Status:** Active; desktop only

The app can download releases and keep recovery information for the previous
version.

### 17.7 Linux integration

**Status:** Active; Linux AppImage only

The app can install, repair, or remove its launcher, icon, and deep-link
integration.

### 17.8 Enterprise certificate support

**Status:** Active

The runtime can use system and enterprise certificate authorities when it
connects to private services.

### 17.9 Crash reporting and analytics

**Status:** Conditional

Sentry and product analytics work only when configured. A rebrand must replace
or disable all OpenWork-owned endpoints and keys.

### 17.10 Semantic UI control

**Status:** Active; internal

The Desktop publishes a structured description of the current interface. The
hidden UI MCP and Voice Mode can use semantic queries and commands instead of
blindly clicking screen coordinates.

## 18. Den account and organization connection

### 18.1 Browser sign-in handoff

**Status:** Active; cloud dependent

Desktop opens Den in a browser. Den returns a short-lived handoff result through
a deep link or one-time code.

### 18.2 Organization selection

**Status:** Active; cloud dependent

The user can list and choose an active organization. The only organization can
be selected automatically.

### 18.3 Join methods

**Status:** Active; cloud dependent

Desktop understands an organization install link, invitation link, self-hosted
server address, or pasted authentication code.

### 18.4 Self-hosted control plane

**Status:** Active

The app can point at a different Den base URL. Production builds should protect
this setting when an organization policy requires one trusted server.

### 18.5 Offline resilience

**Status:** Active

A temporary Den failure should not immediately destroy the local login state or
stop local chat. Cloud-dependent features show an error and retry separately.

Main code:

- `apps/app/src/app/lib/den.ts`
- `apps/app/src/react-app/domains/cloud/`
- `apps/app/src/react-app/domains/settings/cloud/`

## 19. Cloud provider and resource sync

### 19.1 Assigned models

**Status:** Active; cloud dependent

Den returns model providers assigned to the member. Desktop writes only its
managed runtime configuration and reloads the engine when needed.

### 19.2 Resource snapshot

**Status:** Active; cloud dependent

Desktop downloads a snapshot of marketplaces, plugins, connections, and config
objects visible to the member.

### 19.3 Change detection

**Status:** Active

The app separates new, changed, and removed cloud resources. It can show that a
plugin needs an update or that an upstream item was removed.

### 19.4 Local ownership protection

**Status:** Active

Cloud synchronization must not delete a user's unrelated local skills,
providers, plugins, or MCP entries.

## 20. OpenWork Connect

### 20.1 Central capability gateway

**Status:** Active when enabled; cloud dependent

Desktop attaches one hidden cloud MCP to the agent engine. It exposes two main
tools:

- `search_capabilities`
- `execute_capability`

The model searches first, then executes the selected capability.

### 20.2 Organization connections

**Status:** Active; cloud dependent

Capabilities may come from shared skills, plugins, external MCP servers,
Google Workspace, or Microsoft 365.

### 20.3 Credentials and grants

**Status:** Active

Den can use a shared organization credential or ask each member to connect a
personal account. Access can be granted through the organization, a team, or a
direct member grant.

### 20.4 Connect, reconnect, and disconnect

**Status:** Active

Members can connect their account, reconnect after a token or scope problem,
and disconnect their own personal credential.

### 20.5 Tool policy and audit

**Status:** Active

Den checks access, disabled tools, approval requirements, and audit policy
before executing an external operation.

### 20.6 Cloud MCP maintenance

**Status:** Active

Desktop can inspect health, refresh the engine, reconcile configuration, and
show diagnostics when the central cloud connection is not ready.

Main code:

- `apps/app/src/react-app/domains/connections/`
- `apps/app/src/react-app/domains/connections/cloud-mcp-reconciler.ts`
- `apps/server/src/routes/cloud-mcp.ts`
- `ee/apps/den-api/src/mcp/`

## 21. Google Workspace capabilities

**Status:** Active when configured; cloud dependent

An administrator chooses the allowed Google features. A member connects a
Google account and grants the required scopes.

Available capability groups include:

### Gmail

- Search and list messages.
- Read a message body.
- Read attachment metadata.
- Download an attachment.
- Create a draft.
- Create a reply or forward draft.
- Create a draft with workspace attachments.

The system creates drafts instead of sending mail automatically. This keeps a
human review step.

### Google Calendar

- List events in a time range.
- Create an event.
- Create an event with a Google Meet link.
- Add a Meet link to an existing event.

### Google Drive

- Search by name or text.
- Read Google Docs as text.
- Read text or bounded binary files.
- Upload a workspace file directly.
- Share a file with a person or organization domain.

Direct upload routes keep file bytes outside model context when possible.

### Google Chat

- Read spaces or messages when the feature and scopes are enabled.
- Create messages when write permission is enabled.

Main code:

- `ee/apps/den-api/src/routes/org/google-workspace.ts`

## 22. Microsoft 365 capabilities

**Status:** Active when configured; cloud dependent

Available capability groups include:

### Outlook Mail

- Search and list messages.
- Read a message.
- Create a draft.

### Outlook Calendar

- List events.
- Create an event.

### OneDrive

- Search files.
- Read text and bounded binary files.
- Create or replace a text file.

### Microsoft Teams

- List chats.
- Read messages in a chat.
- Send a message to an existing chat.

Main code:

- `ee/apps/den-api/src/routes/org/microsoft-365.ts`

## 23. Automations

### 23.1 Deployment gate

**Status:** Conditional; cloud dependent

Den must explicitly enable Automations. Older or unsupported Den deployments
fail closed and hide the feature.

### 23.2 Desktop Automation creation

**Status:** Active when enabled

Desktop can create an Automation with:

- Name.
- Instructions.
- Model and reasoning level.
- Timezone.
- Once, daily, or weekly schedule.
- Selected weekdays for weekly schedules.

Desktop-created Automations run on a signed-in Desktop.

### 23.3 Durable schedule and history

**Status:** Active; cloud dependent

Den stores the schedule, immutable revisions, run state, events, errors, usage,
and receipts.

### 23.4 Desktop runner

**Status:** Active; desktop and cloud dependent

Electron registers a per-machine runner. It asks Den for work, claims a run,
sends heartbeats, reports events, supports cancellation, and completes with a
durable receipt.

### 23.5 Visible local execution

**Status:** Active

Each Desktop run creates a normal local task. The user can watch it or open it
from the Automation receipt.

### 23.6 Missed runs

**Status:** Active

If no signed-in Desktop claims a scheduled occurrence before its deadline, Den
records it as missed instead of pretending it ran.

### 23.7 Automation controls

**Status:** Active

The user can search, edit, activate, deactivate, run now, cancel a run, and
archive an Automation. Editing creates a new immutable revision.

### 23.8 Cloud Automations

**Status:** Partially managed from Desktop

Cloud Automations are created from Web or Cloud Chat and run without Desktop.
Desktop can list and inspect them and can perform supported lifecycle actions,
but its New Automation form creates Desktop placement only.

Main code:

- `apps/app/src/react-app/domains/automations/`
- `apps/desktop/electron/automation-runner.mjs`
- `ee/apps/den-api/src/routes/automations/`
- `packages/types/src/automations.ts`

## 24. Organization dashboards

### 24.1 Deployment gate

**Status:** Conditional; cloud dependent

Den must explicitly enable Dashboards.

### 24.2 Assigned dashboards

**Status:** Active when enabled

Desktop lists dashboards granted to the current member through an organization,
team, or direct-member grant.

### 24.3 MCP App tiles

**Status:** Active

A dashboard contains MCP App tiles connected to organization capabilities.
Tiles use per-user authorization and keep a last-known-good result.

### 24.4 Safety

**Status:** Active

Read-only tiles can refresh safely after an initial successful run. Write
operations still require explicit approval.

### 24.5 Authoring limitation

Dashboard authoring, layout management, and access grants happen in Den, not in
Desktop.

Main code:

- `apps/app/src/react-app/domains/dashboard/`
- `ee/apps/den-api/src/routes/org/dashboards.ts`

## 25. Organization Desktop policy and branding

**Status:** Active; cloud dependent

Den can control the following Desktop behavior:

| Policy or setting | Effect in Desktop |
| --- | --- |
| Custom providers | Allow or block user-added model providers. |
| OpenCode Zen models | Allow or block built-in OpenCode models. |
| Multiple workspaces | Allow or restrict additional workspaces. |
| Control Settings | Allow or block Settings changes. |
| Manage Extensions | Allow or block local extension management. |
| Built-in Extensions | Show or hide built-in apps. |
| Alpha updates | Allow or block the Alpha channel. |
| Welcome page | Show or hide first-run Welcome. |
| Onboarding prompts | Replace the default starter prompts. |
| Allowed versions | Force Desktop onto an approved version list. |
| App name | Change the displayed application name. |
| Logo | Change organization branding in the interface. |
| Icon | Change supported runtime icons and shortcuts. |
| Accent color | Change the organization accent family. |
| Automations | Enable or disable the feature for the deployment. |
| Dashboards | Enable or disable the feature for the deployment. |
| Connect | Enable or disable the cloud capability gateway. |

Main code:

- `packages/types/src/den/desktop-policies.ts`
- `apps/app/src/react-app/domains/cloud/desktop-config-provider.tsx`
- `apps/desktop/electron/connect-link-branding.mjs`

## 26. Cloud workers and remote execution

### 26.1 Manual remote-worker connection

**Status:** Active

Desktop can connect to an existing remote OpenWork or OpenCode worker by URL
and credentials.

### 26.2 Cloud worker lifecycle APIs

**Status:** Active in Den; limited Desktop user flow

Den contains APIs for worker creation, state, tokens, update, runtime version,
heartbeat, wake, stop, and recovery. The current local Desktop interface does
not provide a complete modern worker-provisioning screen.

### 26.3 Gateway cloud status overlay

**Status:** Active in cloud/gateway deployment

The web/cloud version can show worker boot, update, retry, failure, version, and
backup status. This overlay is not the same as normal local Desktop workspace
management.

### 26.4 Worker billing

**Status:** Retired

New self-service cloud-worker billing endpoints are explicitly retired.

### 26.5 Remote chat handoff

**Status:** Proposed

A design exists for creating or continuing a cloud session through the central
MCP gateway. The document is marked as a proposal and must not be presented as
a shipped feature.

Main references:

- `ee/apps/den-api/src/routes/workers/`
- `ee/apps/den-api/src/routes/cloud/`
- `apps/app/src/react-app/shell/cloud-workspace-overlay.tsx`
- `docs/remote-chat-over-mcp-architecture.md`

## 27. Removed, dormant, and misleading code

Developers must not treat the following items as normal current features.

### 27.1 Memory Bank

**Status:** Removed

Old Desktop builds may still show a Memory screen. Den compatibility routes
always return an empty list and reject new saves. New branding should remove or
hide the old UI instead of advertising Memory.

Main code:

- `ee/apps/den-api/src/routes/deprecated-memory.ts`

### 27.2 Telegram

**Status:** Removed

Only historical database migrations and a removal test remain.

### 27.3 Standalone URL MCP Apps

**Status:** Unavailable

Old storage and validation work does not mean users can install arbitrary HTML
apps.

### 27.4 OpenAI image-generation extension action

**Status:** Dormant/internal

A server action and some Settings code exist, but the extension is not in the
canonical built-in extension catalog.

### 27.5 Local experimental Google Workspace routes

**Status:** Legacy

The current product path is the Den-managed organization connection. Old local
experimental routes should not be confused with the supported cloud flow.

### 27.6 Recovery buttons

**Status:** Dormant

Several visible Recovery actions currently stop at an unavailable message.

### 27.7 Cloud-to-Desktop task dispatch

**Status:** Proposed

The Automation runner provides useful building blocks, but the generalized
remote-session task protocol described in design documents is not shipped.

## 28. Proposed multi-harness architecture

This section describes a future product direction. It is not current behavior.

### 28.1 Goal

Allow a user to choose an open-source agent harness, such as OpenCode or Pi,
without changing the myai user interface or losing myai-owned data.

### 28.2 Recommended ownership model

```text
myai Desktop
    |
    +---- myai canonical data store
    |       workspaces, tasks, messages, artifacts,
    |       approvals, automations, and settings
    |
    +---- myai Agent Runtime API
             |
             +---- OpenCode adapter
             +---- Pi adapter
             +---- future adapter
```

myai should own the user-visible product data. A harness should perform agent
execution and may keep private recovery data, but it should not be the only
place where the conversation exists.

### 28.3 Canonical data myai should own

- Workspace identity and settings.
- Task identity, title, and group.
- User and assistant messages.
- Normalized reasoning and tool events.
- Attachments and artifacts.
- Permission requests and decisions.
- Queued and steering messages.
- Model and harness selection.
- Automation definitions and receipts.
- Mapping from a myai task to a harness session.

Example mapping:

```text
myai task id: task_123
harness id: pi
harness session id: pi-session-456
```

### 28.4 Agent runtime adapter responsibilities

Every full adapter should provide:

- Detect, install, and update the harness.
- Start, stop, restart, and check health.
- List models and authentication requirements.
- Create, resume, fork, and delete a session.
- Send text and attachments.
- Queue, steer, stop, and resume work.
- Stream normalized events.
- Report tool calls, reasoning, usage, and errors.
- Ask questions or request permission.
- Compact a conversation when supported.
- Load skills and project instructions.
- Provide MCP or an equivalent tool bridge.
- Export or recover a transcript.

### 28.5 Normalized event model

The UI should receive myai events instead of OpenCode or Pi events directly.

```ts
type AgentEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "tool.started"; callId: string; name: string; input: unknown }
  | { type: "tool.updated"; callId: string; output: unknown }
  | { type: "tool.completed"; callId: string; result: unknown }
  | { type: "permission.requested"; requestId: string; action: string }
  | { type: "question.requested"; questionId: string; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string };
```

The adapter converts native harness events into this format. The React UI does
not need to know which harness produced them.

### 28.6 Capability negotiation

Harnesses do not have equal features. Each adapter must report the truth.

```ts
type HarnessCapabilities = {
  streaming: boolean;
  reasoning: boolean;
  queue: boolean;
  steering: boolean;
  permissions: boolean;
  questions: boolean;
  compaction: boolean;
  mcp: boolean;
  skills: boolean;
  subagents: boolean;
  sessionForking: boolean;
};
```

The interface should:

- Use a native harness feature when it exists.
- Use a myai implementation when it can be safely provided outside the
  harness.
- Hide or disable a feature when it is not available.
- Explain the limitation to the user.

Do not pretend that every terminal CLI can provide full structured integration.
A CLI that only prints text should run in a clearly limited basic mode.

### 28.7 OpenCode adapter

The first adapter should wrap the existing OpenCode behavior without changing
what users see. This creates a stable boundary before adding another harness.

The adapter will initially translate:

- OpenCode sessions to myai tasks.
- OpenCode messages to canonical messages.
- OpenCode tool parts to canonical tool events.
- OpenCode permissions and questions to canonical requests.
- OpenCode models and providers to the myai model catalog.
- OpenCode configuration reloads to generic runtime lifecycle actions.

### 28.8 Pi adapter

Pi is a good second adapter because it provides a TypeScript SDK and a JSONL
RPC mode. It can stream structured message and tool events and supports
sessions, models, queue behavior, steering, compaction, skills, extensions, and
custom tools.

Official references:

- [Pi SDK documentation](https://pi.dev/docs/latest/sdk)
- [Pi RPC documentation](https://pi.dev/docs/latest/rpc)
- [Pi coding-agent feature reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)

Pi deliberately does not include built-in MCP, permission popups, subagents,
todos, or plan mode. myai must provide these features through an outer security
layer or a managed Pi extension when they are required.

### 28.9 Permission ownership

myai should not trust every harness to implement the same safety model.
Permissions need an outer enforcement layer around file access, shell commands,
network operations, credentials, and destructive actions.

A permission popup without real enforcement is only decoration. The adapter
must be able to block or sandbox the underlying action.

### 28.10 Skill and MCP translation

Some resources are portable and some are harness-specific.

- `AGENTS.md` and many `SKILL.md` files can be shared.
- OpenCode plugin packages are OpenCode-specific.
- Pi extensions and Pi packages are Pi-specific.
- MCP may be native in one harness and extension-based in another.
- OpenWork Connect can remain above the harness if myai exposes it through a
  consistent tool bridge.

The Extensions library should label resources as portable, OpenCode-only,
Pi-only, or supported by selected adapters.

### 28.11 Recommended selection scope

Use an application-wide default harness and allow each workspace to override
it. Keep one harness for the lifetime of a task unless the user explicitly
migrates the task.

Changing harness in the middle of a task is difficult because native session
state, tool history, compaction summaries, and provider behavior are not equal.
A safe migration should start a new harness session using a bounded canonical
transcript or summary.

### 28.12 Safe migration order

1. Define canonical runtime types and capability rules.
2. Wrap current OpenCode behavior behind an OpenCode adapter.
3. Store normalized task data in a myai-owned local database.
4. Stop the React interface from importing OpenCode-specific types directly.
5. Add the Pi adapter through SDK or RPC.
6. Add the setup-time and workspace-level harness picker.
7. Move permission enforcement above individual harnesses.
8. Translate portable skills and cloud tools.
9. Add a documented adapter SDK only after two adapters prove the contract.

### 28.13 Main risks

| Risk | Why it matters | Basic response |
| --- | --- | --- |
| False feature parity | Harnesses support different behavior. | Use capability negotiation. |
| Data duplication | myai and the harness may both store sessions. | Make myai canonical and treat harness state as execution/recovery state. |
| Permission bypass | A harness may run a tool without myai approval. | Enforce permissions outside the harness. |
| Event mismatch | Tool and message events have different shapes. | Normalize events in adapters. |
| Config mismatch | Skills, plugins, and MCPs use different formats. | Mark portable and adapter-specific resources. |
| Session migration loss | A new harness cannot reproduce hidden native state. | Migrate by transcript/summary into a new session. |
| Maintenance cost | Every harness release can change behavior. | Version adapter contracts and run conformance tests. |

## 29. Rebranding decision checklist

For every feature area, record one decision:

- **Keep:** Keep the feature and change only branding.
- **Adapt:** Keep the idea, but change its architecture or user flow.
- **Remove:** Remove the UI, server route, configuration, tests, and docs.
- **Later:** Hide it now and reconsider after the core product is stable.

Suggested decision table:

| Feature area | Decision | Cloud needed? | Harness-specific? | Branding work | Owner notes |
| --- | --- | --- | --- | --- | --- |
| Workspaces |  | No | Partly | Names, icons, help text |  |
| Tasks and chat |  | No | Yes today | Names and empty states |  |
| Composer |  | No | Yes today | Prompts and labels |  |
| Artifacts |  | No | No | Icons and labels |  |
| Browser |  | No | Plugin today | Extension name and icon |  |
| Terminal |  | No | No | Labels |  |
| Voice Mode |  | External API | No | Name, icon, provider copy |  |
| Providers |  | Optional | Yes today | Provider help and policy text |  |
| Extensions |  | Optional | Partly | Catalog names and icons |  |
| MCP Apps |  | Optional | Partly | Host identity and CSP origins |  |
| Automations |  | Yes | OpenCode today | Full product copy |  |
| Dashboards |  | Yes | No | Full product copy |  |
| Google Workspace |  | Yes | No | OAuth app and consent branding |  |
| Microsoft 365 |  | Yes | No | OAuth app and consent branding |  |
| Organization policy |  | Yes | Partly | All administrator text |  |
| Cloud workers |  | Yes | Yes today | Full worker terminology |  |
| Multi-harness runtime |  | Optional | This is the abstraction | New setup flow |  |

## 30. Verification expectations

This document is descriptive. It does not replace executable proof.

For a runtime-visible change:

1. Write or update a spec in `evals/specs/**/*.test.ts`.
2. Use `test` from `@openwork/testkit`.
3. Run the relevant local or Daytona lane.
4. Publish the commands, results, and observable assertions.
5. Do not call skipped or missing proof a pass.

Documentation-only wording changes can skip runtime proof, but the change must
still be reviewed for accuracy, links, spelling, and stale product claims.
