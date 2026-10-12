---
name: fdc3-secure-context
description: >-
  Use when consuming `@finos/fdc3-security` to sign and verify FDC3 context, intents and intent
  results, encrypt and decrypt context on channels, request symmetric keys, or run the trusted
  backend contract that keeps private keys out of the browser (`PublicFDC3Security` /
  `PrivateFDC3Security`, their `Jose*` implementations, the signing and encryption support
  classes, `ClientSideHandlersImpl` / `ServerSideHandlersImpl` and `WebSocketMessaging`). Covers
  the public/private split, `ContextVerificationMetadata` and the `allowListFunction` trust
  check, the `fdc3.security.*` context types, anti-replay and the `EdDSA` / `RSA-OAEP-256` /
  `A256GCM` defaults. Not for the core Desktop Agent API (see `fdc3-app-integration`) or for
  authoring App Directory records (see `fdc3-appd-authoring`).
license: Apache-2.0
metadata:
  fdc3-package: '@finos/fdc3-security'
  fdc3-package-version: '3.0.0-beta.1'
---

# Securing FDC3 context with `@finos/fdc3-security`

This skill ships inside the `@finos/fdc3-security` package tarball and describes the API of the version it
ships with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that is:
when the monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump` skill's
`scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3. Where the
published documentation and the implementation disagree, the implementation is what runs and the disagreement
is called out.

## Status: experimental

The package implements the **experimental** FDC3 Security & Identity specification. Every doc page under
`website/docs/context/ref/security/` is marked `@experimental`, and `website/docs/api/security.md` opens with
"Security and Identity features are experimental additions to FDC3. Limited aspects of their design may
change in future." Treat the wire formats and class names here as subject to change between betas.

## The problem and the trust model

In FDC3, applications talk through a Desktop Agent rather than directly. An app cannot necessarily know or
trust that agent, so the security model makes it an _untrusted relay_ whose job is only to forward context and
its metadata unchanged (`website/docs/api/security.md`, "Desktop Agent Requirements"). Applications establish
identity with each other end-to-end using asymmetric cryptography: each app holds a private key and publishes a
public key at a stable HTTPS JWKS endpoint — by convention `/.well-known/jwks.json` on the app's origin. Trust
is _not_ delegated to the agent; each receiving app keeps its own allowlist of senders.

Two consequences drive the whole design:

- Verification results are computed locally and are **never put on the wire**. They live in a
  `ContextVerificationMetadata` object handed to the receiving code, not in `ContextMetadata`.
- Anything requiring a private key (signing, key generation, unwrapping) **MUST** run in a trusted backend,
  never in the browser frontend.

### The trusted backend contract

`packages/fdc3-security/src/secure-boundary/FDC3Handlers.ts` defines the contract between a low-trust frontend
and its high-trust server. A backend that wants to participate implements `FDC3Handlers`:

| Method                                  | Direction       | What it is for                                                                                                                                                    |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleRemoteChannel(purpose, channel)` | client → server | Gives the server a proxied `Channel`/`PrivateChannel` it can listen on and broadcast from, so signing/encryption helpers that need private keys can attach to it. |
| `remoteIntentHandler(intent)`           | client → server | Returns the real `IntentHandler` for an intent name; later calls run on the server over the WebSocket. Returns a `BackendIntentHandler`.                          |
| `exchangeData(purpose, payload)`        | client → server | General-purpose RPC, e.g. `sign-context` or `unwrap-symmetric-key`. The `purpose` strings are application-defined and must match on both ends.                    |

`DefaultFDC3Handlers` (`FDC3Handlers.ts:103`) is a no-op base class to extend. Two library modules implement
the wire protocol on the two sides (see "The secure boundary" below). Using this reference implementation is
optional — the docs explicitly say it is not a requirement — but it is the concrete contract the library ships.

## The public / private split

The core interfaces live in `packages/fdc3-security/src/impl/`:

| Interface                                           | Side                                     | Operations                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PublicFDC3Security` (`PublicFDC3Security.ts:47`)   | frontend or backend, **no private keys** | `verifySignature`, `getPublicKeys`, `verifyJWTToken`, `createSymmetricKey`, `encryptSymmetric`, `decryptSymmetric`, `wrapSymmetricKey`, `encryptContextWithPublicKey` |
| `PrivateFDC3Security` (`PrivateFDC3Security.ts:25`) | backend only                             | extends the above with `sign`, `unwrapSymmetricKey`, `createJWTToken`, `decryptContextWithPrivateKey`                                                                 |

The `jose`-backed implementations are what you actually instantiate:

- `JosePublicFDC3Security` (`impl/JosePublicFDC3Security.ts:53`) — public keys plus a `publicKeyResolver`, an
  `allowListFunction`, time limits, algorithms and an `AntiReplayChecker`. Because this side has no private
  key, it is the one that can safely run in the browser (e.g. a receiver verifying a broadcast). Load it from a
  JWKS URL with `createJosePublicFDC3SecurityFromUrl(jwksUrl, allowListFunction, …)`.
- `JosePrivateFDC3Security` (`impl/JosePrivateFDC3Security.ts:34`) — extends the public class with the signing
  and wrapping private keys, `issUrl` and `jwksUrl`. `createJosePrivateFDC3Security(baseUrl, …)` generates the
  signing and wrapping key pairs and derives the JWKS URL as `${baseUrl}/.well-known/jwks.json`
  (`JosePrivateFDC3Security.ts:239`). This class implements `PrivateFDC3Security`; run it on the backend only.

Note the constructor guard: both sides throw if the signing or wrapping public key has no `kid`
(`JosePublicFDC3Security.ts:77-87`). `createSigningKeyPair` / `createWrappingKeyPair` set `kid`, `alg` and
`use` on the exported public JWKs for you.

## Signing a context

The signature is a **detached** JWS carried in the message metadata, not on the context object. `sign()` produces
both parts:

- `JosePrivateFDC3Security.sign(ctx)` (`impl/JosePrivateFDC3Security.ts:88`) builds `antiReplay = { iat, exp, jti }`,
  canonicalizes `{ context, antiReplay }` with `json-canonicalize`, signs it with `CompactSign`, and returns
  `{ signature: { protected, signature }, antiReplay }` — the JWS payload is dropped because the signed bytes are
  the canonicalized context itself.
- The JWS protected header it writes is `{ alg, jku, iat, kid }` (`JosePrivateFDC3Security.ts:99-104`).
- `verifySignature(signature, ctx, antiReplay)` (`impl/JosePublicFDC3Security.ts:131`) reads `alg`, `jku`, `kid`
  and `iat` from the protected header, reconstitutes the compact JWS from the canonicalized `{ context, antiReplay }`,
  and calls `jose.compactVerify` against the resolved JWKS. It then checks signature freshness, context expiry and
  anti-replay before reporting.

If `signature` or `antiReplay` is missing, verification does not throw — it returns
`{ signed: false, errors: [...] }`.

### The support classes

| Class                                                                                    | Side                              | What it does                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BasicSignedBroadcaster` (`signing/SignedBroadcastSupport.ts:33`)                        | backend                           | Wraps a `Channel`; `broadcast(context, meta?)` signs then broadcasts with `signature` and `antiReplay` in the metadata.                                                                                 |
| `BasicSignatureCheckingHandlerSupport` (`signing/SignatureCheckingHandlerSupport.ts:63`) | frontend (any)                    | Wraps a `SecurityAwareContextHandler` / `SecurityAwareIntentHandler` so incoming signatures are verified first; returns a standard `ContextHandler` / `IntentHandler`.                                  |
| `PublicSignatureCheckingHandlerSupport` (`…:106`)                                        | frontend                          | Subclass that wires the checking function to a `PublicFDC3Security` instance.                                                                                                                           |
| `BasicSignedRaiseIntentSupport` (`signing/SignedRaiseIntentSupport.ts:68`)               | backend signing, frontend raising | Signs the outbound context before `raiseIntent` / `raiseIntentForContext`, and if a checking function is supplied verifies the signature on the returned context. Returns a `VerifiedIntentResolution`. |
| `PrivateSignedRaiseIntentSupport` (`…:215`)                                              | backend                           | Subclass that derives both signing and verification from a `PrivateFDC3Security`.                                                                                                                       |
| `BasicSignedIntentResultSupport` (`signing/SignedIntentResultSupport.ts:44`)             | backend                           | Signs a context intent result before returning it; channels and `void` pass through.                                                                                                                    |
| `PrivateSignedIntentResultSupport` (`…:101`)                                             | backend                           | Subclass wired to a `PrivateFDC3Security`.                                                                                                                                                              |

Note the naming mismatch: the package README calls the broadcast helper `SignedBroadcastSupport`, but
`signing/SignedBroadcastSupport.ts` exports the interface `SignedBroadcaster` and the class
`BasicSignedBroadcaster`. There is no symbol named `SignedBroadcastSupport` — import `BasicSignedBroadcaster`.

### Securing a handler

A security-aware handler is a three-argument variant of the standard handler; the third argument is the
verification result (`signing/SignatureCheckingHandlerSupport.ts:16`, `:27`):

```ts
// Standard
(context: Context, metadata: ContextMetadata | undefined) => void
// Security-aware
(context: Context, metadata: ContextMetadata | undefined, verification: ContextVerificationMetadata) => void
```

`wrapContextHandler` always runs the checking function, even when no signature is present, so
`verification.authenticity.signed` is the field that tells you whether anything was signed.

### Raising and resolving intents with verification

`SignedRaiseIntentSupport` returns a `VerifiedIntentResolution` (`signing/SignedRaiseIntentSupport.ts:24`) — an
`IntentResolution` with an extra `getVerification()` method. The result is memoized: `getResult()`,
`getResultMetadata()` and `getVerification()` share one underlying fetch, and `getVerification()` returns
`undefined` for channel or void results or when no checking function was configured.

## Verification metadata

`ContextVerificationMetadata` (`impl/ContextVerificationMetadata.ts:17`) is the local verification _result_,
never a wire field:

```ts
{
  authenticity?: {
    signed: boolean;          // a signature field was present
    valid?: boolean;          // the JWS cryptographically verified
    trusted?: boolean;        // the signing key's JWKS URL was in the allowlist
    jku?: string; kid?: string; alg?: string;
    errors?: string[];        // human-readable diagnostics
  };
  encryption?: 'decrypted' | 'cant_decrypt' | 'not_encrypted';
}
```

It is exported and is the third argument of `SecurityAwareContextHandler` / `SecurityAwareIntentHandler`.

### How trust is actually decided

There is **no `allowedOrigins` / `allowedApps` field on `ContextVerificationMetadata`** in this version. The
restriction is expressed by the `AllowListFunction` you supply when constructing the security implementation:

```ts
export type AllowListFunction = (jku: string, iss?: string) => boolean; // impl/JosePublicFDC3Security.ts:39
```

`verifySignature` sets `authenticity.trusted = allowListFunction(jku)` (`JosePublicFDC3Security.ts:200`);
`verifyJWTToken` calls it twice — once on the token's `jku`, once on `(jku, payload.iss)`
(`JosePublicFDC3Security.ts:238`, `:254`) — and `createJWTToken` calls it on the audience before minting a token
(`JosePrivateFDC3Security.ts:126`).

What an application author MUST do to be accepted by a receiving app: publish a JWKS at a stable HTTPS URL with
`kid` on each key, and get that JWKS URL into the receiver's allowlist. The `iss` argument exists so an receiver
can additionally restrict which issuers a given JWKS may assert (e.g. an identity provider hosting several
tenants) — see the two example `allowListFunction`s in `website/docs/api/security.md`. A signed, `valid` context
whose `jku` is not trusted still comes back `valid: true, trusted: false`; the receiving app decides what to do.

## Encrypting a context

Encryption uses a symmetric key for the payload and asymmetric cryptography only to distribute that key, so the
Desktop Agent cannot read the content. The wrapper type is `fdc3.security.encryptedContext`
(`EncryptedContextWrapper`): it carries `id.kid` (which symmetric key), `originalType` (for routing) and
`encryptedPayload` (a compact JWE).

Broadcaster side (`encryption/EncryptedBroadcastSupport.ts`):

- `EncryptedBroadcastSupport(security, metadataHandler).broadcastWrapper(channel)` creates a fresh symmetric key
  and returns a `BasicEncryptedBroadcaster`.
- `BasicEncryptedBroadcaster.broadcast(context)` encrypts the context with `encryptSymmetric` and broadcasts a
  `fdc3.security.encryptedContext` (`EncryptedBroadcastSupport.ts:111-127`). Its constructor also registers a
  `fdc3.security.symmetricKeyRequest` listener via `createSymmetricKeyRequestContextListener`.
- `shutdown()` unsubscribes that listener.

Receiver side (`encryption/EncryptedContextListenerSupport.ts`):

- `PublicEncryptedContextListenerSupport` listens for `fdc3.security.encryptedContext`, requests the symmetric
  key, and decrypts. It also registers `createSymmetricKeyResponseContextListener` to catch the key response.
  The two operations needing the private key — signing the key request and unwrapping the response — are
  delegated through the supplied `signingFunction` and `unwrapFunction` (normally `exchangeData` calls).
- `PrivateEncryptedContextListenerSupport` is the same class wired to a `PrivateFDC3Security`, so unwrapping and
  decryption run entirely on the backend and the key never reaches the browser.

### The symmetric key request / response flow

1. The broadcaster encrypts and broadcasts `fdc3.security.encryptedContext` immediately.
2. The receiver, on a message it cannot decrypt, broadcasts a **signed** `fdc3.security.symmetricKeyRequest`
   (an `id.kid` identifying the wanted key).
3. The broadcaster's listener verifies the requestor's JWS; if `signed && trusted && valid` it wraps the
   symmetric key in a JWE addressed to the requestor's public key (`jku` from their JWS header) and broadcasts
   `fdc3.security.symmetricKeyResponse` (`EncryptedBroadcastSupport.ts:57-65`). The requestor resolves the
   pending key promise by `kid` (`EncryptedContextListenerSupport.ts:65-71`).
4. The receiver unwraps the JWE with its private key and decrypts; the handler then receives the decrypted
   context with `verification.encryption === 'decrypted'`.

The five `fdc3.security.*` context types are `fdc3.security.encryptedContext`, `fdc3.security.symmetricKeyRequest`,
`fdc3.security.symmetricKeyResponse`, `fdc3.security.user` and `fdc3.security.userRequest` (see
`website/docs/context/ref/security/`). `userRequest` and `symmetricKeyRequest` **MUST be signed** to be effective;
the key owner uses the signature's `jku` to address the response.

## Anti-replay, algorithms and time limits

- **Anti-replay** is a `jti` set plus freshness/expiry windows. `DefaultAntiReplayChecker`
  (`impl/AntiReplayChecker.ts:15`) records each seen `jti` with its `exp` and refuses a second sighting; a claim
  without `jti` is rejected. It is in-memory, so `Redis` or another shared cache should back it in a real
  distributed backend.
- **Time limits** — `DEFAULT_FDC3_TIME_LIMITS` (`impl/FDC3SecurityTimeLimits.ts:36`) sets
  `signatureFreshnessSeconds` and `contextValiditySeconds` to 300 each (5 minutes). Freshness is checked against
  the JWS header `iat`; expiry against `antiReplay.exp`.
- **Algorithms** — `DEFAULT_FDC3_ALGORITHMS` (`impl/FDC3SecurityAlgorithms.ts:56`): signing `EdDSA` on curve
  `Ed25519`, key wrapping `RSA-OAEP-256` (RSA modulus 2048), content encryption `A256GCM`, direct encryption
  `dir`. `ECDSA_FDC3_ALGORITHMS` (`…:69`) is the `ES256` / `P-256` alternative if Ed25519 is unavailable.

## The secure boundary

Where the FDC3 connection leaves the browser, this package provides a bridge so a frontend can delegate
cryptographic work to a backend over a WebSocket. It sits _beside_ the normal FDC3 connection: the frontend
still holds the real `DesktopAgent` and channels, and the boundary carries only the operations that need
private keys.

| Module                                                                    | Role                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientSideHandlersImpl` (`secure-boundary/ClientSideHandlersImpl.ts:31`) | The low-trust stub. Implements `FDC3Handlers` by forwarding calls to the server; also handles server→client `broadcastRequest`, `addContextListenerRequest`, `contextListenerUnsubscribeRequest` and `privateChannelDisconnectRequest`. `connectRemoteHandlers(url, da, callback)` builds one over a `WebSocket`. |
| `ServerSideHandlersImpl` (`secure-boundary/ServerSideHandlersImpl.ts:44`) | The high-trust adapter. `setupWebsocketServer(httpServer, disconnectCallback, createHandlers)` waits for an `instance-details` handshake, then dispatches messages to your `FDC3Handlers`. `emitToClient(ws, event, payload)` pushes server→client events.                                                        |
| `WebSocketMessaging` (`secure-boundary/WebSocketMessaging.ts:11`)         | The `Messaging` implementation over native `WebSocket`; its outgoing/incoming events default to `SERVER_MESSAGE` / `CLIENT_MESSAGE` (`WebSocketMessaging.ts:28-29`), while `connectRemoteHandlers` passes the opposite (`CLIENT_MESSAGE` out / `SERVER_MESSAGE` in).                                              |
| `Messaging` (`secure-boundary/Messaging.ts:16`)                           | The minimal transport interface (`post`, `postEvent`, `register`, `unregister`, `exchange`, …).                                                                                                                                                                                                                   |
| `MessageTypes.ts`                                                         | The envelope constants and `WsEnvelope` discriminated union (`handle-remote-channel`, `remote-intent-handler`, `exchange-data`, `instance-details`, …).                                                                                                                                                           |

A backend intent handler can return `PRIVATE_CHANNEL_SIGNAL` (`{ type: 'private' }`, `secure-boundary/FDC3Handlers.ts:13`)
to tell the frontend to `createPrivateChannel()` and export it back through `handleRemoteChannel`. This sentinel is
internal to the boundary and is never transmitted over FDC3 or seen by the Desktop Agent (the client converts it at
`ClientSideHandlersImpl.ts:114-118`).

## Metadata packing (FDC3 ≥ 3.0 vs earlier)

`MetadataHandler` (`delegates/MetadataHandler.ts`) hides the difference between agents that forward metadata as a
separate `broadcast` parameter and older ones that have nowhere to put it. `MetadataHandlerImpl` carries a
`metadataAvailable` flag: when true it returns context and metadata unchanged; when false it embeds the metadata
under `__appMeta` on the context and extracts it again on receipt. Build one from the agent with
`createMetadataHandler(desktopAgent)` or from a version string with `createMetadataHandlerWithFDC3Version(version)`
(threshold is FDC3 `3.0`). All the signing and encryption support classes take a `MetadataHandler` for this reason.

## Failure modes worth checking first

| Symptom                                                 | Usual cause                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `authenticity.signed` is `false`                        | the sender did not sign, or `signature` / `antiReplay` was dropped from metadata             |
| `authenticity.valid` is `false` with errors             | tampered context, stale `iat`, expired `antiReplay.exp`, or replayed `jti`                   |
| `authenticity.trusted` is `false` but `valid` is `true` | the signer's `jku` is not in the allowlist                                                   |
| "No key found for algorithm …"                          | the JWKS at `jku` has no key whose `alg` matches the protected header                        |
| "Signing/Wrapping public key must have a 'kid'"         | constructed a `Jose*` instance with a public JWK that lacks `kid`                            |
| Key request rejected: signature invalid or untrusted    | the requestor's `fdc3.security.symmetricKeyRequest` was unsigned or its `jku` is not trusted |
| Handler never called for an encrypted context           | listener registered but decrypted type did not match the requested `contextType`             |
| Import error for `SignedBroadcastSupport`               | the symbol is named `BasicSignedBroadcaster`; the README's name is stale                     |

## Where the detail lives

- `packages/fdc3-security/src/impl/` — `PublicFDC3Security.ts`, `PrivateFDC3Security.ts`,
  `JosePublicFDC3Security.ts`, `JosePrivateFDC3Security.ts`, `ContextVerificationMetadata.ts`,
  `AntiReplayChecker.ts`, `FDC3SecurityAlgorithms.ts`, `FDC3SecurityTimeLimits.ts`, `FDC3UserClaims.ts`,
  `TypeGuards.ts`.
- `packages/fdc3-security/src/signing/` — `SignedBroadcastSupport.ts`, `SignedRaiseIntentSupport.ts`,
  `SignedIntentResultSupport.ts`, `SignatureCheckingHandlerSupport.ts`.
- `packages/fdc3-security/src/encryption/` — `EncryptedBroadcastSupport.ts`, `EncryptedContextListenerSupport.ts`.
- `packages/fdc3-security/src/secure-boundary/` — `FDC3Handlers.ts`, `ClientSideHandlersImpl.ts`,
  `ServerSideHandlersImpl.ts`, `Messaging.ts`, `WebSocketMessaging.ts`, `MessageTypes.ts`.
- `packages/fdc3-security/src/delegates/MetadataHandler.ts` — FDC3 < 3.0 metadata packing.
- `packages/fdc3-security/src/index.ts` — exactly what the package exports.
- `packages/fdc3-security/samples/` — runnable signed-broadcast, signing-intent, encrypted-channel and
  GetUser examples (with sequence diagrams in `samples/README.md`).
- `website/docs/api/security.md` — the normative Security & Identity specification.
- `website/docs/context/ref/security/` — the five `fdc3.security.*` context reference pages.
