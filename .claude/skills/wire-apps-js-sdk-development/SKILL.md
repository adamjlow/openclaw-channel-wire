---
name: wire-apps-js-sdk-development
description: Build, modify, debug, review, deploy, and test server-side Wire Apps in TypeScript/JavaScript using @wireapp/wire-apps-js-sdk with version-aware local types and Wire's official developer documentation. Use for WireAppSdk lifecycle, WireEventsHandler, messaging, assets, conversations, users, MLS/CoreCrypto state, storage, credentials, deployment, and SDK upgrades.
---

# Wire Apps JavaScript SDK Development

Use this skill for `@wireapp/wire-apps-js-sdk` development. This skill is fully standalone and must not assume any other skill, framework, adapter, or host application exists.

The SDK is young and version-sensitive. Never trust model memory for exact exports, constructors, event methods, manager methods, payloads, or return types. Verify against the repository's installed SDK package/types first and Wire's official developer documentation second.

## Current baseline

As of 2026-09-25, Wire documents this as a server-side Node.js SDK. The public package is alpha. Current Wire material targets Node 22, ESM, persistent filesystem access, SDK-managed local storage including SQLite/CoreCrypto state, and a stable 32-byte cryptography storage key.

This is a freshness snapshot, not a permanent contract. Verify the pinned package and current docs.

## Source priority

1. installed/pinned `@wireapp/wire-apps-js-sdk` package metadata, exports, declarations, and shipped source
2. official Wire developer docs at `dev.wire.com`
3. official npm metadata for the exact package version
4. Wire product/release documentation
5. examples shipped with the installed package
6. third-party sources only for extra context

Do not require GitHub. This skill must remain useful without GitHub access.

## Establish target SDK/runtime

Before substantial work inspect `package.json`, lockfile, installed package metadata/types when available, `tsconfig`, runtime/deployment config, SDK imports, event handlers, storage/volume configuration, and shutdown handling.

Determine exact SDK version, Node runtime, ESM settings, storage location/persistence, lifecycle owner, and how the cryptography storage key is provisioned.

Do not silently upgrade an alpha dependency while fixing unrelated code.

## Verify APIs locally

Prefer concrete local inspection:

```bash
node -p "require('./node_modules/@wireapp/wire-apps-js-sdk/package.json').version"
rg 'WireAppSdk|WireEventsHandler|TextMessage' node_modules/@wireapp/wire-apps-js-sdk
rg '<candidate-symbol>' node_modules/@wireapp/wire-apps-js-sdk
```

If package exports block `require(package.json)`, read the file directly. Treat `.d.ts` declarations and exported package surfaces as authoritative for the installed version.

Before writing any Wire-specific symbol, verify it exists in that version.

## Official docs

Read `references/official-sources.md` when current Wire behavior or architecture matters. Prefer `dev.wire.com` over recollection or unofficial examples.


## JS SDK evidence discipline

Wire's developer site contains a mixture of cross-SDK concepts and language-specific examples. Some event pages currently show only JVM examples, and at least one listed event is explicitly marked not implemented. Therefore:

- a docs navigation entry is not proof that the JS SDK implements that event
- a Kotlin/Java sample is not proof of a TypeScript class, method, overload, or async contract
- verify JS support in the installed `@wireapp/wire-apps-js-sdk` declarations/exports before coding
- prefer TypeScript-specific pages/examples when available
- when docs and installed declarations disagree, target the installed package unless the task is an upgrade
- note documentation inconsistencies instead of translating JVM APIs by analogy

The npm package README is useful implementation evidence for packaging/runtime details, but exact application APIs still require installed type verification.

## Wire identity model and federation

Do not flatten Wire identifiers into local UUID strings without checking their types. Wire documents message `conversationId` and `sender` as `QualifiedId`, which combines a local ID with a domain so entities remain unique across federated backends.

Rules:

- preserve `QualifiedId` semantics end-to-end
- do not key caches/databases solely by local UUID when the domain is part of identity
- do not parse IDs with ad hoc string splitting if the SDK exposes typed structures/helpers
- retain sender and conversation domains when bridging to application state
- treat message `id` separately from qualified conversation/user identity
- test federated/non-default-domain IDs when identity mapping is changed

Replyable messages also carry timestamp/reference semantics used to establish the quoted message. Use SDK reply factories/fields rather than reconstructing reply metadata manually.

## Event processing and synchronization

The SDK architecture maintains local conversation/membership state, decrypts incoming messages, routes events, and acknowledges backend notifications after processing. The team listener also owns WebSocket reconnection and incremental synchronization.

Implications:

- do not build a competing WebSocket/reconnect loop around the SDK
- do not mutate SDK-managed SQLite/CoreCrypto state directly
- event-handler latency and failures can affect processing/acknowledgement; keep handlers bounded and move expensive work to controlled application queues where appropriate
- if external side effects can be retried, make them idempotent using stable Wire event/message identity
- never assume event delivery is exactly-once without explicit target-version evidence
- preserve event ordering assumptions only where the installed SDK/docs guarantee them
- use connection-state hooks such as `BackendConnectionListener` only after verifying they exist in the installed JS version

## Storage identity and single-writer invariant

Current Wire deployment docs are stronger than a generic 'persistent volume' requirement:

- `./storage` is relative to the process working directory
- it contains `apps.db` plus CoreCrypto files under `storage/cryptography`
- losing that directory loses the client's cryptographic identity and causes the App to register as a fresh device
- the backend expects one client for the same credentials/storage
- SQLite and crypto state are single-writer; do not run replicas against one credential/state set

Therefore:

- make `cwd` and the mounted storage location deliberate in containers/services
- persist the entire SDK storage directory as one state unit
- restore the matching storage directory and matching `cryptographyStorageKey` together
- do not copy a live SQLite/CoreCrypto directory between concurrently running instances
- do not use horizontal replicas, rolling overlap, or active-active deployment for one App identity unless a future Wire version explicitly supports it
- configure deployment strategies so the old instance releases ownership before the replacement starts
- treat deletion of `apps.db` or crypto files as identity-affecting recovery, not routine cleanup

## Packaging and native-module nuances

The published package README documents implementation details that deployment tooling can easily break:

- SDK database migrations are shipped as non-code files
- when bundling with webpack/esbuild/Rollup, preserve `build/db/migrations/**` beside `build/db/DatabaseService.js`
- local SDK development builds need the build step that copies migrations
- native dependencies must match the Node runtime CPU architecture
- Apple Silicon x64/arm64 mismatches can surface as `dlopen` failures

Before introducing a bundler or single-file packaging:

1. inspect the installed package layout
2. ensure SQL migration assets survive packaging at the expected relative path
3. test startup against an empty persistent volume
4. test restart against existing state
5. build native dependencies for the deployment architecture

Prefer not bundling the SDK if the application's deployment does not require it.

## Feature-support verification

Current Wire docs enumerate events including text, assets, buttons, ping, location, deletion, edits, reactions, membership changes and delivery/read events, but support is not uniform. For every event/message/action feature:

1. confirm the callback/type is exported by the installed JS SDK
2. confirm it is actually implemented, not merely documented in a shared interface page
3. inspect target-version declarations and tests/examples if available
4. add a focused integration test for behavior that matters to production

Do not promise support based on the event list alone.

## Runtime model

Current docs describe `WireAppSdk.create(...)` as taking application credentials/backend information, a cryptography storage key, an event handler, and optionally logging depending on version. Verify the installed signature.

Creating the SDK provides access to locally stored state and operations. Receiving ongoing events requires the listening lifecycle. Current docs expose `startListening()` and `stopListening()`.

Rules:

- one component owns SDK startup/shutdown
- do not call listening lifecycle accidentally during module import
- install graceful shutdown handlers in long-running services
- await async lifecycle calls when the installed types require it
- do not assume multiple active SDK instances are safe
- do not delete SDK storage as a generic recovery strategy
- preserve stable storage and key material across normal restarts

## Event handling

Current docs use a `WireEventsHandler` subclass and provide manager access through the handler. Exact event callback names/types are version-sensitive.

For each event path:

1. verify the callback in installed types
2. identify event/message type
3. preserve conversation/team/user/message identifiers needed by business logic
4. avoid blocking the event loop with long synchronous work
5. make retries/idempotency explicit if external side effects occur
6. handle malformed/unsupported content safely
7. do not log decrypted message content by default

Do not invent callback names by translating JVM SDK names.

## Messaging

Verify exact message factories and manager methods before use. Current official examples show `TextMessage` and reply creation, but alpha APIs can change.

When sending:

- preserve correct conversation destination
- preserve reply/reference semantics only through supported SDK fields/factories
- await send operations when asynchronous
- handle rate/network errors
- avoid duplicate sends on retries
- preserve mentions/link previews only when intended
- do not assume IDs are plain strings if types say otherwise

## Conversations, users, assets, actions

The SDK can expose conversation management, user lookup/search, asset upload/download, and message/action features. Treat each as version-sensitive.

Before implementing an operation:

- inspect installed exports/types
- consult the matching official Wire docs
- confirm required permissions/preconditions
- understand destructive semantics
- add tests around IDs and error paths

Never infer a manager method from an HTTP endpoint name or from the JVM SDK.

## MLS, CoreCrypto, and local state

Wire Apps participate in encrypted conversations and the SDK manages MLS/CoreCrypto state. Do not bypass SDK cryptographic state with ad hoc Wire protocol calls unless explicitly required and supported.

The cryptography storage key is security-critical. Current docs require exactly 32 bytes and stability across restarts.

Production rules:

- generate key material with a cryptographically secure RNG or secret-management system
- never use `new Uint8Array(32)` or `.fill(...)` as a production key
- never log the key
- do not commit it
- keep the same key with the same persisted SDK state
- protect filesystem state and backups
- plan key/state recovery deliberately rather than improvising rotation

If key rotation is required, verify Wire-supported behavior before implementing it.

## Storage/deployment

Current SDK operation requires persistent filesystem storage. Treat SDK-managed storage as state, not cache.

Check:

- persistent writable volume
- stable mount path across restarts
- ownership/permissions
- backup/restore implications
- container redeploy behavior
- no accidental ephemeral filesystem
- one active owner of the same state unless Wire explicitly documents otherwise

Current Wire release material says browser use, CommonJS `require()`, custom storage backends, stateless/serverless runtimes without persistent filesystem, and active-active multi-instance deployment are outside the current release scope. Re-check before relying on this limitation.

## Secrets and privacy

Protect API tokens, storage keys, decrypted messages, conversation/team/user identifiers, downloaded assets, and any derived business data.

Use environment/secret stores appropriate to deployment. Avoid secrets in command-line args, logs, exception dumps, fixtures, snapshots, and telemetry.

The SDK protects transport/cryptographic state, but application code sees decrypted content. Your application owns protection of that plaintext and any copies sent to external systems.

## ESM/Node compatibility

Current SDK is ESM and targets Node 22. Verify the pinned package's `engines`, `type`, and exports.

Do not add CommonJS wrappers or transpilation hacks until you verify they are necessary and compatible. Keep TypeScript module/moduleResolution settings aligned with the actual runtime.

## Error handling and resilience

Differentiate credential/configuration failures, storage/crypto failures, connectivity/reconnect behavior, invalid provider state, and application-handler failures.

Do not create competing reconnect loops if the SDK already owns WebSocket reconnect behavior. Do not swallow crypto/storage errors. Bound application retries and make external mutations idempotent.

## Testing

Test business logic separately from live Wire connectivity where possible. Add focused tests for event mapping, message construction, conversation IDs, reply behavior, idempotency, shutdown, storage configuration, secret handling, and error propagation.

For integration tests, isolate credentials and SDK storage. Never point destructive tests at production teams/conversations.

## Validation

Run:

1. `scripts/validate-wire-apps-js-sdk.sh <repo-path>` from this skill
2. repository tests
3. TypeScript typecheck
4. lint/format
5. build/package checks
6. integration/live tests only when explicitly configured and safe

The validator is a heuristic preflight, not proof of SDK correctness.

## Anti-hallucination rule

Before writing a Wire SDK identifier ask: Have I observed this exact export, method, callback, constructor/factory, property, or type in the installed target version or authoritative matching Wire documentation?

If no, search installed declarations/docs or mark it unresolved. Do not extrapolate from the JVM SDK, Wire HTTP APIs, old Wire client SDKs, or naming conventions.

## Latest vs compatible

For latest/best-practice work, check current `dev.wire.com` plus official package metadata, then compare with the repo's pinned version. For ordinary changes, preserve the pinned version unless the user asks to upgrade.

## Completion report

Report target SDK version, Node/runtime assumptions, what changed, exact SDK contracts verified, tests/checks and results, storage/crypto/deployment implications, and any unverified alpha-API assumptions.
