---
name: fdc3-build-desktop-agent
description: >-
  Use when implementing a Desktop Agent or an FDC3 bridge that already has a transport (a MessagePort, a
  WebSocket, an IPC channel) and needs to expose a conformant `DesktopAgent` on top of it: wiring a
  `Messaging` implementation, assembling `DesktopAgentProxy` from its support classes, adding channels,
  intent, app and heartbeat behaviour, and registering removable listeners. Covers the delegation model,
  the `AbstractMessaging` extension point, the `RegisterableListener` family, private-channel event
  listeners and heartbeat acknowledgement, plus the boundary between this package and `@qcomp/fdc3-schema`
  (wire types) and `@qcomp/fdc3-get-agent` (discovery and identity). Not for writing application code
  (see `fdc3-app-integration`), and not for changing the wire schemas themselves (see `fdc3-schema-change`).
license: Apache-2.0
metadata:
  fdc3-package: '@qcomp/fdc3-agent-proxy'
  fdc3-package-version: '3.0.0-beta.1'
---

# Building a Desktop Agent on `@qcomp/fdc3-agent-proxy`

This skill ships inside the `@qcomp/fdc3-agent-proxy` package tarball and describes the API of the version it
ships with — `3.0.0-beta.1`. The `metadata.fdc3-package-version` above is the record of which version that is:
when the monorepo bumps the shared version, this file has to be reviewed, and the `fdc3-version-bump` skill's
`scripts/check-skill-versions.mjs` is what reports it as stale.

Everything below is drawn from the sources in this repository, not from general knowledge of FDC3. Where the
published documentation and the implementation disagree, the implementation is what runs and the disagreement is
called out.

## What the package is — and what it is not

The README states the scope plainly: this package is a complete implementation of the **Desktop Agent
Communication Protocol (DACP)**. `DesktopAgentProxy` is a client-side `DesktopAgent` that translates every API
call into DACP messages and every inbound DACP message back into a callback. It is the object that
`getAgent()` resolves to for a Browser-Resident Desktop Agent (see `website/docs/api/specs/webConnectionProtocol.md`,
Step 4).

The four things it deliberately does **not** do are the most common source of confusion:

| Not done here                                                                                                              | Where it lives                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire message types and their JSON-schema type guards                                                                       | `@qcomp/fdc3-schema` — `packages/fdc3-schema/generated/api/BrowserTypes.ts` (message types) and the `BrowserTypesCore` type-guard namespace                                         |
| Finding an agent, WCP handshake, `WCP4ValidateAppIdentity` / `WCP5ValidateAppIdentityResponse`, SessionStorage persistence | `@qcomp/fdc3-get-agent` — `packages/fdc3-get-agent/src/strategies/` (`HelloHandler.ts`, `IdentityValidationHandler.ts`) and `packages/fdc3-get-agent/src/messaging/message-port.ts` |
| The `DesktopAgent`, `Channel`, `PrivateChannel` interfaces, error enumerations and metadata types                          | `@qcomp/fdc3-standard`                                                                                                                                                              |
| The default message-exchange and app-launch timeouts                                                                       | `@qcomp/fdc3-get-agent` — `packages/fdc3-get-agent/src/strategies/Timeouts.ts` (`DEFAULT_MESSAGE_EXCHANGE_TIMEOUT_MS = 10000`, `DEFAULT_APP_LAUNCH_TIMEOUT_MS = 100000`)            |

The proxy has **no built-in timeout defaults of its own** — every constructor takes the timeouts it needs as
arguments, and `packages/fdc3-get-agent/src/messaging/message-port.ts:53-57` is where the real ones are threaded
through from the `WCP3Handshake`. If you are wiring this package by hand, supplying those two numbers is your
responsibility.

## The delegation model

`packages/fdc3-agent-proxy/src/DesktopAgentProxy.ts` implements `DesktopAgent` and `Connectable` and holds no
transport of its own. It is constructed with four concerns and a list of connectables:

```ts
// packages/fdc3-agent-proxy/src/DesktopAgentProxy.ts:36-43
constructor(
  heartbeat: HeartbeatSupport,
  channels: ChannelSupport,
  intents: IntentSupport,
  apps: AppSupport,
  connectables: Connectable[],
  logLevel: LogLevel | null
)
```

Each public method is a thin forward: `getInfo()` calls `this.apps.getImplementationMetadata()`, the intent
methods call `this.intents.*`, the channel methods call `this.channels.*`, `addEventListener` calls
`this.channels.addEventListener`, and `connect()`/`disconnect()` map over `connectables` calling `connect()` /
`disconnect()` on each. `broadcast` is not purely a forward: it fetches the current user channel
and broadcasts on it, and if there is no current channel it resolves without doing anything at all — no error and
no warning (`packages/fdc3-agent-proxy/src/DesktopAgentProxy.ts:87-94`). `addContextListener` likewise carries
logic of its own — it validates its arguments (a non-function handler, an empty context-type array, or a non-string
array element) and throws `ChannelError.InvalidArguments` (`packages/fdc3-agent-proxy/src/DesktopAgentProxy.ts:98-121`).

The constructor also **binds every public method to the instance** (`DesktopAgentProxy.ts:55-76`). This is not
cosmetic: the standard _requires_ it for web implementations — "All public methods of FDC3 interface objects …
MUST be bound to their respective instances (e.g. using `.bind(this)` in constructors) to support correct behavior
when methods are destructured" (`website/docs/api/spec.md:135`). If you add a method, bind it too. The same rule is
honoured by `DefaultChannel` (`src/channels/DefaultChannel.ts:63-67`) and `DefaultPrivateChannel`
(`src/channels/DefaultPrivateChannel.ts:28-31`).

### How the real wiring looks

`packages/fdc3-get-agent/src/messaging/message-port.ts:53-57` is the canonical assembly, and is the pattern to
copy:

```ts
const hs = new DefaultHeartbeatSupport(messaging);
const cs = new DefaultChannelSupport(messaging, channelSelector, cd.messageExchangeTimeout);
const is = new DefaultIntentSupport(messaging, intentResolver, cd.messageExchangeTimeout, cd.appLaunchTimeout);
const as = new DefaultAppSupport(messaging, cd.messageExchangeTimeout, cd.appLaunchTimeout);
const da = new DesktopAgentProxy(hs, cs, is, as, [hs, cs, intentResolver, channelSelector], logLevel);
await da.connect();
```

Note the `connectables` list carries not only the two proxy-owned supports (`hs`, `cs`) but also the injected
`intentResolver` and `channelSelector` UI adaptors, so a single `da.connect()` starts all four.

## The extension point: implementing `Messaging`

Everything specific to your transport lives in one class. `packages/fdc3-agent-proxy/src/Messaging.ts` defines the
interface the proxy and every support class depend on:

| Member                                                             | Contract                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `createUUID(): string`                                             | Source of the UUIDs stamped into outgoing message `meta`                                  |
| `post(message): Promise<void>`                                     | Send an `AppRequestMessage` (or a `WCP6Goodbye`) to the agent                             |
| `register(l: RegisterableListener): void`                          | Add a listener to the inbound dispatch table, keyed by `l.id`                             |
| `unregister(id: string): void`                                     | Remove a listener by id                                                                   |
| `createMeta(): AppRequestMessage['meta']`                          | Build the top-level `meta` for an outgoing request (`requestUuid`, `timestamp`, `source`) |
| `waitFor<X>(filter, timeoutMs?, timeoutErrorMessage?): Promise<X>` | Resolve when a matching response arrives, or reject on timeout                            |
| `exchange<X>(message, expectedTypeName, timeoutMs): Promise<X>`    | Post a request, wait for the matching response, and throw if `payload.error` is set       |
| `getAppIdentifier(): AppIdentifier`                                | Identity used in `meta.source` and intent resolutions                                     |
| `disconnect(): Promise<void>`                                      | Tear down the transport                                                                   |

`AbstractMessaging` (`packages/fdc3-agent-proxy/src/messaging/AbstractMessaging.ts`) implements `waitFor`,
`exchange` and `getAppIdentifier` for you and leaves only the transport-specific parts abstract:

```ts
// packages/fdc3-agent-proxy/src/messaging/AbstractMessaging.ts:14-22
abstract createUUID(): string;
abstract post(message: AppRequestMessage | WebConnectionProtocol6Goodbye): Promise<void>;
abstract register(l: RegisterableListener): void;
abstract unregister(id: string): void;
abstract createMeta(): AppRequestMessage['meta'];
```

plus `abstract disconnect(): Promise<void>` (line 104) and the `constructor(appIdentifier: AppIdentifier)`
(line 20), which stores the identity returned by `getAppIdentifier()`.

Two behaviours are worth understanding before you write one, because they decide whether your listeners ever fire:

- `waitFor` registers a _transient_ `RegisterableListener` with its own UUID, and unregisters it — and clears the
  timeout — the moment the filter matches (`AbstractMessaging.ts:29-66`). Timeouts reject with the supplied
  `timeoutErrorMessage` string; `exchange` passes `AgentError.ApiTimeout` (line 79) and additionally throws
  `new Error(out.payload.error)` when a successful-looking response carries a payload error
  (`AbstractMessaging.ts:84-97`).
- `register`/`unregister` are the inbound routing table. Your transport must dispatch **every** inbound message
  through the registered listeners' `filter(m)` and call `action(m)` on a match. The reference implementation does
  exactly this in a single `message` event handler over a `MessagePort`:
  `packages/fdc3-get-agent/src/messaging/MessagePortMessaging.ts:32-39`. A listener whose `id` is `null` is never
  in the table (registration only happens after `register()` assigns an id).

`MessagePortMessaging` is the worked example of a complete subclass — read it in full
(`packages/fdc3-get-agent/src/messaging/MessagePortMessaging.ts`), including its `disconnect()`, which posts a
`WCP6Goodbye` and then closes the port (lines 66-76).

## The support classes

All four supports are interfaces in this package, and every `Default*Support` is a concrete implementation of one.
The proxy takes the interface types, so any of them can be substituted — but there is rarely a reason to: a
DACP-backed agent should keep the defaults and write only its `Messaging`. `HeartbeatSupport`
(`src/heartbeat/HeartbeatSupport.ts`) is the exception in that it is a _marker_ interface — it extends
`Connectable` and declares nothing else, because `DefaultHeartbeatSupport` needs only `connect`/`disconnect`.

| Support            | Interface file                      | Default                   | Responsibility                                                                                                           |
| ------------------ | ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ChannelSupport`   | `src/channels/ChannelSupport.ts`    | `DefaultChannelSupport`   | User-channel membership, App channels, Private channels, channel-scoped context and event listeners                      |
| `IntentSupport`    | `src/intents/IntentSupport.ts`      | `DefaultIntentSupport`    | `findIntent`, `findIntentsByContext`, `raiseIntent`, `raiseIntentForContext`, intent listeners and the resolver hand-off |
| `AppSupport`       | `src/apps/AppSupport.ts`            | `DefaultAppSupport`       | `findInstances`, `getAppMetadata`, `open`, `close`, and `getImplementationMetadata` (which backs `getInfo()`)            |
| `HeartbeatSupport` | `src/heartbeat/HeartbeatSupport.ts` | `DefaultHeartbeatSupport` | Connection lifecycle and responding to the agent's liveness pings                                                        |

`ChannelSupport` and `HeartbeatSupport` are `Connectable`; `IntentSupport`/`AppSupport` are not, which is why the
`connectables` list in `message-port.ts` contains `hs` and `cs` rather than `is`/`as`.

## The `RegisterableListener` pattern

Listeners here are **objects registered with the messaging layer**, not bare callbacks, and that is the single
design fact that everything else follows from. `RegisterableListener`
(`packages/fdc3-agent-proxy/src/listeners/RegisterableListener.ts`) extends the public `Listener` with
`id: string | null`, `filter(m)`, `action(m)` and `register(): Promise<void>`. The reasons it exists:

- **Removal.** `exchange()`-based registration sends an `addXListenerRequest` and stores the `listenerUUID` the
  agent returns as `this.id` (`src/listeners/AbstractListener.ts:118-133`); `unsubscribe()` sends the matching
  `xListenerUnsubscribeRequest` carrying that id (`AbstractListener.ts:88-109`). A plain callback has no id, so it
  cannot be removed from the agent's routing table.
- **Filtering and multiplexing.** The DACP sends one message per API action and expects the _receiving_ end to fan
  it out to the right listeners (`website/docs/api/specs/desktopAgentCommunicationProtocol.md:97`). `filter(m)`
  is where each listener decides whether a given message is for it — e.g. `DefaultContextListener.filter` matches
  the channel id, the message type, and the (possibly array) context type
  (`src/listeners/DefaultContextListener.ts:55-62`).
- **Wrapping.** A listener can translate the wire message into the public event shape before calling the app's
  handler, or wrap another listener. `DefaultPrivateChannel`'s private-event listeners and
  `DesktopAgentEventListener` both do this.

The family in `src/listeners/`:

| File                             | Role                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegisterableListener.ts`        | The interface every listener implements                                                                                                                        |
| `AbstractListener.ts`            | Base class: holds `messaging`/`messageExchangeTimeout`, sends subscribe on `register()` and unsubscribe on `unsubscribe()`, stores the returned `listenerUUID` |
| `DefaultContextListener.ts`      | Context broadcasts on a specific channel id; also used for array context types (via the `contextTypes` payload field)                                          |
| `DefaultIntentListener.ts`       | Raised intents; sends the `intentResultRequest` back to the agent, and optionally filters by context types                                                     |
| `DesktopAgentEventListener.ts`   | Agent-level events (`userChannelChanged`, `contextCleared`) via a single `addEventListenerRequest`                                                             |
| `EventListener.ts`               | Channel-scoped events (currently `contextCleared`) for one channel id                                                                                          |
| `HeartbeatListener.ts`           | Responds to `heartbeatEvent` (see below)                                                                                                                       |
| `PrivateChannelEventListener.ts` | Four subclasses for `PrivateChannel` events: null (all types), disconnect, add-context-listener, unsubscribe                                                   |
| `UserChannelContextListener.ts`  | Extra interface for listeners that must react to a user-channel change (`changeChannel()`)                                                                     |

Only `HeartbeatListener` does not go through the subscribe/unsubscribe exchange and therefore does not extend
`AbstractListener`: it registers directly in the messaging table. The four private-channel listeners _do_ extend
`AbstractListener`, via an internal `AbstractPrivateChannelEventListener` that passes
`'privateChannelAddEventListenerRequest'`/`'privateChannelAddEventListenerResponse'` and
`'privateChannelUnsubscribeEventListenerRequest'`/`'privateChannelUnsubscribeEventListenerResponse'` to `super(...)`,
so their inherited `register()`/`unsubscribe()` carry out the same DACP exchanges.

## Heartbeats

Read the code, not the diagram. `DefaultHeartbeatSupport`
(`packages/fdc3-agent-proxy/src/heartbeat/DefaultHeartbeatSupport.ts`) has only two methods:

- `connect()` creates a `HeartbeatListener` and calls `register()` on it. The listener's id is
  `'heartbeat-' + messaging.createUUID()` and `register()` merely adds it to the messaging table — there is **no**
  DACP subscription exchange for heartbeats (`src/listeners/HeartbeatListener.ts:15,38-40`).
- `disconnect()` unsubscribes that listener and then calls `messaging.disconnect()`, so a `WCP6Goodbye` (or
  whatever your transport's goodbye is) is the last thing sent.

The listener is purely reactive. Its `filter` matches `heartbeatEvent`, and its `action` posts a
`heartbeatAcknowledgementRequest` whose `heartbeatEventUuid` is the event's `meta.eventUuid`
(`src/listeners/HeartbeatListener.ts:19-36`). **Nothing in this package initiates a heartbeat or detects a missed
one** — liveness polling and the decision to consider an app dead are the Desktop Agent's job (the DACP documents
the exchange at `website/docs/api/specs/desktopAgentCommunicationProtocol.md:569-582`). Your job is only to
answer. There is no failure callback to hook; wire detection into your own `Messaging` or the agent side.

## Channels: user, app, private

`DefaultChannelSupport` (`src/channels/DefaultChannelSupport.ts`) owns all three kinds and their wiring.

**User channels.** The constructor installs a callback on the injected `ChannelSelector` UI so that a user's
selection in that UI drives `joinUserChannel` / `leaveUserChannel` (`DefaultChannelSupport.ts:51-58`).
`connect()` then reconciles the agent's current channel and subscribes to `userChannelChanged` so that
agent-initiated changes are reflected back into the selector (lines 80-115). Membership calls `exchange` a
`joinUserChannelRequest`/`leaveCurrentChannelRequest`, update the cached `currentChannel`, and call
`channelSelector.updateChannel(...)`; `joinUserChannel` also notifies every user-channel context listener to
`changeChannel()` (lines 267-290). Context listeners added through the proxy are wrapped in an
`UnsubscribingDefaultContextListener` (implements `UserChannelContextListener`) that, on registration and on every
channel change, replays the channel's current context — and matching metadata — into the handler, and filters
inbound broadcasts by the current channel id while also accepting channel-less "open" broadcasts
(`DefaultChannelSupport.ts:292-376`). This replay is why a listener added after a broadcast still receives the last
value.

**App channels.** `getOrCreateChannel` exchanges a `getOrCreateChannelRequest` and wraps the response in a
`DefaultChannel` with type `'app'` (`DefaultChannelSupport.ts:195-228`). It throws
`ChannelError.InvalidArguments` for a non-string or empty id, and `ChannelError.CreationFailed` if the response
omits the channel.

**Private channels.** `createPrivateChannel` exchanges a `createPrivateChannelRequest` and returns a
`DefaultPrivateChannel` (`DefaultChannelSupport.ts:230-250`). `DefaultPrivateChannel`
(`src/channels/DefaultPrivateChannel.ts`) adds the private event surface: `addEventListener(type, handler)` maps
`'addContextListener'`, `'unsubscribe'` and `'disconnect'` onto the corresponding
`privateChannelAddEventListenerRequest` with the right `listenerType`, and a `null` type registers **both** a
channel-level `contextCleared` listener and a private-channel null listener and returns a composite
`unsubscribe` (lines 33-79). `disconnect()` exchanges a `privateChannelDisconnectRequest` (lines 81-94) — the
actual unsubscribing of participants is the agent's responsibility, per
`website/docs/api/specs/desktopAgentCommunicationProtocol.md:567`.

## Intents and apps on the wire

`DefaultIntentSupport` (`src/intents/DefaultIntentSupport.ts`) is worth reading before you write an agent, because
it encodes the parts of intent resolution the agent has to support:

- If a `raiseIntentResponse` (or `raiseIntentForContextResponse`) comes back with `payload.appIntent(s)` rather
  than a resolved `intentResolution`, the proxy calls the injected `IntentResolver`'s `chooseIntent(...)` and
  re-raises against the choice — a `void` choice becomes `ResolveError.UserCancelled`
  (`DefaultIntentSupport.ts:199-221, 258-280`). Your agent must therefore be able to answer with unresolved
  options when it cannot pick a target.
- `raiseIntent` with no context (or `null`) substitutes `{ type: 'fdc3.nothing' }` before sending
  (`DefaultIntentSupport.ts:167-169`), matching the standard's MUST at `website/docs/api/spec.md:138`.
- Only app-supplied metadata is forwarded, and `payload.metadata` is **omitted entirely** when the app passed
  none (`DefaultIntentSupport.ts:178-181`). This is the normative DACP encoding rule at
  `website/docs/api/specs/desktopAgentCommunicationProtocol.md:107` — your agent must accept a request with no
  `payload.metadata`.
- Registering a second intent listener that would overlap an existing one (same intent, either unfiltered or with
  overlapping context types) throws `ResolveError.IntentListenerConflict`
  (`DefaultIntentSupport.ts:320-339`).
- The result of an accepted intent is delivered later as a `raiseIntentResultResponse` matched on the original
  `requestUuid` (`DefaultIntentSupport.ts:139-158`), and `DefaultIntentResolution`
  (`src/intents/DefaultIntentResolution.ts`) exposes it as a `result` promise plus a separate `resultMetadata`
  promise.

`DefaultAppSupport` (`src/apps/DefaultAppSupport.ts`) covers `findInstances`, `getAppMetadata`, `open` (using the
longer `appLaunchTimeout`), `close` and `getImplementationMetadata`. `getImplementationMetadata` is what
`getInfo()` returns, so the `optionalFeatures` flags your agent reports come from this exchange.

## What you still have to build to be conformant

The proxy handles the client half of DACP. The standard's mandatory list
(`website/docs/api/spec.md:96-139`) is the checklist for the agent you are writing; the proxy gives you the
client-side of each, but the _agent-side_ behaviour is yours:

- [ ] Answer the full required API surface: `addContextListener`, `addIntentListener`, `addEventListener`,
      `broadcast`, `close`, `createPrivateChannel`, `findInstances`, `findIntent`, `findIntentsByContext`,
      `getCurrentChannel`, `getInfo`, `getOrCreateChannel`, `getUserChannels`, `open`, `raiseIntent`,
      `raiseIntentForContext` (`spec.md:105-121`).
- [ ] Keep a channel's most recent context per type, and return `null` for cleared types — the proxy's replay and
      `getCurrentContext` depend on it (`spec.md:173-179`).
- [ ] Deliver enriched `ContextMetadata` (with `source`, `timestamp` and a `traceId`) and never strip `signature`
      or `antiReplay` (`spec.md:136-137`).
- [ ] Support intent resolution for ambiguous/unspecified intents, respecting input/output context types
      (`spec.md:122-124`).
- [ ] Give each `PrivateChannel` an id and refuse to return it from `getOrCreateChannel` (`spec.md:128`); on
      `disconnect`, unsubscribe the disconnecting party's listeners and emit the `unsubscribe` events **before** the
      `disconnect` event (`desktopAgentCommunicationProtocol.md:567`).
- [ ] Provide a minimum 15-second window for a launched app to initialise FDC3 (`spec.md:132-133`), and let it be
      overridden via `payload.appLaunchTimeout` (`desktopAgentCommunicationProtocol.md:113`).
- [ ] Dispatch `userChannelChanged` after a membership change, _before_ resolving `joinUserChannel`
      (`spec.md:131`); the proxy's `connect()` relies on this to keep its cache coherent.
- [ ] Validate app identity: match `identityUrl` to an AppD record, check origin agreement across `identityUrl`,
      `actualUrl` and the `WCP1Hello` origin, and compare the `WindowProxy` for instance reconnection
      (`website/docs/api/specs/browserResidentDesktopAgents.md:79-196`).
- [ ] Implement the transport-facing DACP exchanges your `Messaging` will send — see the message-by-message
      definitions in `website/docs/api/specs/desktopAgentCommunicationProtocol.md`.

The `test/features/` directory in the tarball is there to help you check all of this: it holds Gherkin acceptance
features covering DACP behaviour (`broadcast`, `user-channels`, `app-channels`, `private-channels`,
`raise-intents`, `intent-results`, `heartbeat`, `user-channel-selector`, …). They are shipped because they are
runnable against a conformant agent using the reusable steps in `@finos/cucumber-testing-steps` and
`@qcomp/fdc3-schema/test` — the proxy's own suite drives them through a `TestMessaging` double, but the same
feature files are the specification of the message exchanges you must produce and consume.

## Failure modes worth checking first

| Symptom                                                 | Usual cause                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `broadcast` silently does nothing                       | the app is not on a user channel; `DesktopAgentProxy.broadcast` resolves without sending (`DesktopAgentProxy.ts:87-94`)              |
| A listener's handler never fires                        | your `Messaging.register` dispatch loop is not calling `filter`/`action`, or the listener was never `register()`-ed and so has no id |
| `unsubscribe()` throws "doesn't have an id"             | the listener was used before `register()` completed (`AbstractListener.ts:105-108`)                                                  |
| Registration rejects with `ChannelError.CreationFailed` | the agent's response omitted `listenerUUID` (`AbstractListener.ts:126-131`)                                                          |
| A call hangs, then rejects with `ApiTimeout`            | message exchanged against the wrong `messageExchangeTimeout`, or the agent never sent the matching response type/UUID                |
| Heartbeats go unanswered and the agent drops the app    | the `HeartbeatListener` is not registered — check that `DefaultHeartbeatSupport.connect()` ran as part of `da.connect()`             |
| Second intent listener for the same intent throws       | `ResolveError.IntentListenerConflict` — unfiltered or overlapping context types (`DefaultIntentSupport.ts:325-339`)                  |
| Agent logs are unexpectedly chatty                      | see the discrepancy below — the effective default log level is `DEBUG`, not `WARN`                                                   |
| After `disconnect()`, the port is still open            | your `Messaging.disconnect()` did not close it; `DefaultHeartbeatSupport.disconnect()` only calls through to it                      |

## Documentation that disagrees with the implementation

- **Default log level.** `src/util/Logger.ts:5-6` claims the logger "defaults to only printing WARN and ERROR
  level messages", but the effective default comes from the static field in the base class —
  `packages/fdc3-agent-proxy/src/util/AbstractFDC3Logger.ts:33`, `private static logLevel: LogLevel = LogLevel.DEBUG`.
  The `logLevel` declared in `Logger.ts` is an instance field that never shadows the base's static one, so unless
  `setLogLevel` is called (which `DesktopAgentProxy` does only when a `logLevel` argument is supplied), you get
  `DEBUG`. Trust `AbstractFDC3Logger.ts:33`.
- **Default `getAgent()` discovery timeout.** `website/docs/api/specs/webConnectionProtocol.md:107` says the
  default is 750 ms; the implementation is 1000 ms —
  `packages/fdc3-get-agent/src/strategies/Timeouts.ts:4` (`DEFAULT_GETAGENT_TIMEOUT_MS = 1000`). Discovery is
  outside this package, but the constant is what the `message-port.ts` wiring actually depends on.
- **SessionStorage key.** `website/docs/api/specs/webConnectionProtocol.md:97, :99` and `:277` refer to the key
  `FDC3-Desktop-Agent-Details`; the implementation prefixes each window's key —
  `packages/fdc3-standard/src/api/GetAgent.ts:206` defines
  `DESKTOP_AGENT_SESSION_STORAGE_KEY_PREFIX = 'fdc3-desktop-agent-details'` (lower-case), joined with the browsing
  context's name. Trust the constant.

## Where the detail lives

- `packages/fdc3-agent-proxy/src/index.ts` — exactly what this package exports.
- `packages/fdc3-agent-proxy/src/DesktopAgentProxy.ts` — the delegation model and the bound public methods.
- `packages/fdc3-agent-proxy/src/Messaging.ts`, `src/messaging/AbstractMessaging.ts` — the extension point you implement.
- `packages/fdc3-agent-proxy/src/channels/`, `src/intents/`, `src/apps/`, `src/heartbeat/` — the support classes and their interfaces.
- `packages/fdc3-agent-proxy/src/listeners/` — the whole `RegisterableListener` family.
- `packages/fdc3-agent-proxy/src/util/AbstractFDC3Logger.ts` — logging, including the real default level.
- `packages/fdc3-get-agent/src/messaging/MessagePortMessaging.ts` — a complete `AbstractMessaging` subclass to model yours on.
- `packages/fdc3-get-agent/src/messaging/message-port.ts` — the canonical assembly of the proxy and its supports.
- `packages/fdc3-agent-proxy/test/features/` — the DACP acceptance features shipped in the tarball.
- `website/docs/api/spec.md` — the normative API standard and the conformance MUST/SHOULD lists.
- `website/docs/api/specs/desktopAgentCommunicationProtocol.md` — the DACP message definitions your agent must implement.
- `website/docs/api/specs/browserResidentDesktopAgents.md` and `webConnectionProtocol.md` — the connection and identity behaviour that precedes the proxy.
