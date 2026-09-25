# Wire Apps JS/TS SDK official sources

Primary documentation:
- https://dev.wire.com/
- https://dev.wire.com/quickstart-advanced-js
- https://dev.wire.com/developer-interface/
- https://dev.wire.com/developer-interface/events/
- https://dev.wire.com/developer-interface/events/message-model
- https://dev.wire.com/deployment-tips/deployment-tips-typescript
- https://dev.wire.com/secure-integration-guidelines/security-privacy-basics
- https://dev.wire.com/architecture

Official package:
- https://www.npmjs.com/package/@wireapp/wire-apps-js-sdk
- Prefer the exact installed package's `package.json`, exports, declarations, build assets, and examples over floating `latest`.

Release context:
- https://wire.com/en/blog/wire-apps-sdk-javascript-and-typescript

Authored/reviewed 2026-09-25.

Important freshness/quality notes:
- The package is alpha and has already changed versions rapidly.
- Current docs target Node 22, ESM, persistent `./storage`, one active instance per credentials/storage set, and an exactly 32-byte stable `cryptographyStorageKey`.
- Wire's developer site includes shared/JVM-oriented pages. A listed event or JVM example is not proof that the JS SDK implements the same API.
- Current docs explicitly mark some listed events as not implemented. Verify each feature in the installed JS declarations/exports.
- The npm package README documents bundler-sensitive SQL migration assets under `build/db/migrations/**` and native-module CPU-architecture considerations.
- Wire message conversation/sender identities use `QualifiedId` semantics for federation.
