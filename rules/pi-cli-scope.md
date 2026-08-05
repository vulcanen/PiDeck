# Pi CLI Capability Scope

## Principles

PiDeck is only a desktop adaptation layer for Pi CLI. Feature names, arguments, states, and error semantics must follow the currently installed Pi CLI/SDK.

Prefer reusing:

- `ModelRuntime`
- `AgentSession`
- `SessionManager`
- `ResourceLoader`
- Pi built-in slash commands
- Pi Agent event stream
- Pi Provider/auth storage
- Pi built-in tools and session export

Do not duplicate a "similar-looking" Agent, model catalog, auth store, or session database inside the adaptation layer.

## UI Mapping Rules

- Pi slash command -> composer suggestion / command palette.
- Pi `@file` / resource -> workspace resource suggestion.
- Pi model/provider/auth -> PiDeck model/provider UI.
- Pi agent event -> conversation stream / tool result / approval state.
- Pi session file/tree/export -> session list / session operations.
- Do not fake support for capabilities Pi CLI lacks; hide them or mark them as not implemented.

## Maintainability

- Visible copy for Chinese, English, and future languages lives in the i18n config.
- Components must not keep adding scattered bilingual literals; add a stable key first, then fill in each language config.
- Pi command, model, and resource catalogs should be read from the runtime first; required fallbacks must live in a dedicated capability config module.

## Compatibility

When upgrading the Pi SDK, read its type declarations and changelog before modifying the adapter. Do not rely on undocumented internal properties unless you also provide version-compatibility guards and clear errors.
