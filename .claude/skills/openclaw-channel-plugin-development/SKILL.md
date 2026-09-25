---
name: openclaw-channel-plugin-development
description: Build, modify, debug, review, migrate, and test OpenClaw messaging channel plugins using version-aware, source-verified Plugin SDK APIs. Use for manifests, setup/config, inbound/outbound messaging, threading, security, pairing, lifecycle, commands/actions, tests, and SDK migrations.
---

# OpenClaw Channel Plugin Development

Use this skill for OpenClaw messaging channel plugin work. This skill is fully standalone and must not assume any other skill is installed.

The objective is correct code for the OpenClaw version targeted by the repository. OpenClaw's Plugin SDK is experimental and changes frequently. Never trust model memory for exact SDK symbols, signatures, import paths, manifest fields, registration modes, schemas, CLI flags, or lifecycle semantics.

## Non-negotiable rules

1. Establish the target OpenClaw version first from package manifests, lockfiles, compatibility/build metadata, CI, and existing imports. Do not silently upgrade.
2. Verify exact SDK APIs before using them. Prefer local target-version exports/types/source, then official source at the matching tag/commit, then matching official docs.
3. Prefer narrow `openclaw/plugin-sdk/*` subpaths and verify every new import resolves.
4. Keep discovery/setup import-safe. They must not start clients, sockets, listeners, subprocesses, workers, timers, polling loops, or services.
5. Respect core/plugin ownership. Verify the target-version boundary instead of reimplementing core behavior.
6. Treat security as correctness: authenticate inbound requests before dispatch, preserve actor/source identity required for authorization, apply current policy/pairing contracts, never log secrets, and fail closed.
7. Run relevant tests plus repository-required typecheck/lint/build checks before claiming completion.

## Source priority

1. target repo's installed/pinned OpenClaw source, exports, declarations
2. official OpenClaw source at matching tag/commit
3. official docs matching that version
4. current official source/docs for latest-target or migration work
5. bundled channel implementations
6. OpenClaw tests/examples
7. third-party material only for extra context

Never use generated answers, blogs, issue comments, or stale examples as authority for SDK syntax when a primary source exists.

## Research workflow

Read only what the task needs, usually `package.json`, lockfile, `openclaw.plugin.json`, entry/setup files, relevant source/tests, and CI/build config. Determine target version/commit, bundled vs third-party status, import style, and test/build commands.

Search local contracts first:

```bash
rg 'openclaw/plugin-sdk' .
rg 'defineChannelPluginEntry|defineSetupPluginEntry|ChannelPlugin' .
rg '<candidate-symbol>' node_modules packages extensions openclaw 2>/dev/null
```

Read `references/official-sources.md`. For pinned versions, prefer matching source/tag over current docs. When docs are incomplete, inspect a bundled channel with the same concern and copy contracts/patterns, not provider-specific code blindly.

Search exact symbols for deprecation/migration notes. Do not silently expand a feature task into an SDK migration.

## Task modes

- New channel: establish target version and create the minimum coherent plugin.
- Feature: trace existing architecture and extend established seams.
- Bug: reproduce or identify the failing contract before refactoring.
- Migration: compare old/new contracts explicitly.
- Review: prioritize security, SDK validity, threading/session identity, lifecycle, config drift, tests.
- Setup/config: verify package metadata, manifest schema, runtime schema, setup fields, secrets, account inheritance together.
- Inbound: authenticate, normalize, establish actor/conversation/thread identity, enforce policy, dedupe where needed, then dispatch through supported ingress APIs.
- Outbound: verify adapter/payload contracts, targets, replies, formatting/chunking, media, result IDs, retries, cancellation, and authority semantics.

## Entry/lifecycle

Current docs use narrow helpers such as `defineChannelPluginEntry` and lightweight setup helpers. Verify exact availability/signatures in the target version.

Regardless of helper names: discovery/capability registration stays inert; setup stays lightweight; CLI metadata/help must not activate transport; runtime-only work belongs behind supported full-runtime/lazy seams; every started resource has a stop/reload path; understand every registration mode that can evaluate the entrypoint.


## Current channel composition guidance

For latest-target work, current official docs recommend composing new channels from generic channel SDK seams rather than provider-branded convenience imports. `createChatChannelPlugin` can wire declarative DM security, pairing text flow, threading, and attached outbound results; raw adapters remain available when full control is required. Verify this builder and its option types in the target version before use.

Current setup guidance distinguishes lightweight/import-safe setup seams (`setup-runtime`, `channel-setup`) from heavier setup helpers. A channel that must appear in status/list/SecretRef scans before full runtime startup should expose an import-safe `openclaw.setupEntry`. Keep the main channel module import-safe too because discovery can evaluate it.

Current outbound/threading contracts carry nuanced facts such as delivery-time formatting context and whether a reply target came from an implicit or explicit source. Prefer shared payload/threading helpers over recreating this state in provider code.

Current scheduled write-action authority is explicit and narrow. If a channel declares write-authority actions, preserve the host-provided authority callback through async preparation/queues/retries and invoke it immediately before every provider request. Never turn a plugin declaration into broader operator authority.

## Third-party vs bundled test surfaces

Do not assume every test helper documented for OpenClaw's own bundled plugins is published to third-party packages. Current testing docs explicitly distinguish repo-local focused test subpaths from published runtime APIs and note that the old `plugin-sdk/testing` and `plugin-sdk/test-utils` barrels are removed.

For third-party plugins:

- verify a test subpath is actually exported by the pinned OpenClaw package before importing it
- prefer ordinary unit tests around your plugin's own contracts when repo-local helpers are unavailable
- add loader-backed smoke coverage for registration surfaces where feasible; hand-written API mocks do not exercise loader acceptance gates

## Package, manifest, setup, config

Treat package OpenClaw metadata, `openclaw.plugin.json`, channel config schema, setup fields, UI hints, secret references, and account/default-account behavior as one contract.

Check channel ID consistency, manifest `channels`, runtime-vs-manifest schema, setup-vs-config mapping, secret handling, multi-account semantics, and secret-safe status/inspection. Current docs include channel-owned setup contracts/metadata; verify exact fields for the target version.

## Inbound

Check applicable provider authentication, replay/dedupe, event filtering, account/actor/conversation/thread identity, parent fallback, DM/group classification, mention policy, DM policy/allowlist/pairing, media retrieval, callback/command authentication, normalized content, supported dispatch, acknowledgement semantics, and retry idempotency.

Do not dispatch before security facts required for policy are established.

## Outbound

Check target-version outbound contract, account/client resolution, target parsing, chat/thread destination, reply semantics, formatting/chunking, media, actions/polls, provider IDs, rate limits/retries, cancellation, typing/progress, and payload planning.

Do not create separate send/edit/react agent tools if current OpenClaw core owns the shared message/action surface.

## Threading and authorization

Model provider conversation ID, thread/reply ID, top-level chat, parent fallback, DM/group, account ID, and provider-native topics. Use target SDK session grammar; do not hand-build outer session keys unless required.

For sensitive paths establish who authenticated the event/action, account ownership, initiating actor, authorization, callback binding, secret exposure risk, and whether retries/background work can outlive authority. Never infer privileged intent from arbitrary user strings.

## Native commands/actions

These are version-sensitive. Locate the target contract, inspect an official current implementation, preserve registry/lifecycle semantics, authenticate callbacks, retain actor/source-message checks, avoid serializing process-local dispatch objects, and test stale/replaced registrations when relevant.

## Tests and validation

Add/update tests for changed behavior, especially config/account resolution, secret-safe inspection, setup, policy/pairing, inbound auth/normalization/dedupe, thread mapping, outbound targets/replies/media, retries, lifecycle, inert setup/discovery imports, native actions, and migrations.

Do not use `as any` in production to hide an SDK mismatch.

Run:

1. `scripts/validate-openclaw-channel.sh <repo-or-plugin-path>` from this skill
2. targeted tests
3. typecheck
4. lint/format
5. broader plugin tests if affordable
6. package/manifest validation
7. build/package test if distributed

The validator is a heuristic preflight, not proof of SDK correctness.

## Anti-hallucination rule

Before writing an OpenClaw-specific identifier ask: Have I observed this exact symbol, import path, field, CLI flag, or signature in the target version's source/types or authoritative matching reference? If no, search for it or mark it unresolved. Do not extrapolate from naming conventions.

## Latest vs compatible

For latest/best-practice work, research current official docs/source and compare with the repo's pinned version. If latest requires an upgrade, separate it from the requested feature. For ordinary repo changes, target the pinned version unless the user requests an upgrade.

## Completion report

Report what changed, target OpenClaw version/commit, important contracts verified, checks/results, remaining assumptions/unverified integration points, and migration/deprecation concerns.
