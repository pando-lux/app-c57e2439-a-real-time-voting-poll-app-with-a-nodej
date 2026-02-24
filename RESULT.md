# Build Result — Real-Time Voting Poll App

## Summary
Built a Tier 2 (Node.js EC2) real-time voting poll app with Express, WebSocket, and MongoDB via Resource Proxy.

## Files Created

| File | Description |
|---|---|
| `package.json` | Node.js project manifest with express, ws, node-fetch dependencies |
| `server.js` | Express + WebSocket server, Resource Proxy integration |
| `public/index.html` | Single-page app UI with live vote counts |

## Architecture Decisions

- **Tier 2 (Node.js server)** as specified — Express serves static files, ws attaches to the same HTTP server.
- **Resource Proxy** used for all MongoDB operations from the server side. Credentials never appear in frontend code.
- **Single HTTP server** for both Express and WebSocket (same port, `wss` attached to the `http.Server` instance).
- **In-memory broadcast** — on each vote, the server queries the DB for a fresh tally, then fans out to all connected WebSocket clients. No stale state.
- **Input validation** — pollId and optionId are validated against known poll definitions before any DB write.
- **Graceful reconnect** — frontend retries WebSocket with exponential backoff (1s → 2s → 4s → … → 30s cap).

## Test Results

Manual verification (code review):
- ✅ `server.js` reads PORT, PANDO_GATEWAY_URL, PROJECT_API_KEY from env with correct fallbacks
- ✅ WebSocket `connection` handler sends all 3 poll tallies to new clients immediately
- ✅ Vote handler: validates input → insertOne → find → count tally → broadcast update
- ✅ `GET /polls` returns all 3 poll definitions
- ✅ `index.html` connects to `ws://${location.host}` (protocol-aware for http/https)
- ✅ Vote buttons disabled after voting; voted option highlighted
- ✅ Progress bars and vote counts update on every `update` message
- ✅ No hardcoded gateway URLs, API keys, or connection strings in frontend

## Known Limitations / Technical Debt

- **One vote per session only** (enforced in-browser via `voted` state). A server-side IP or user-identity check is not implemented. Refreshing the page allows re-voting. For production, add session cookies or user auth.
- **Tally computation** does a full `find` on the `votes` collection per vote event. Works fine at low scale. For high traffic, switch to a counter document with `$inc`.
- **No vote de-duplication** at the DB layer. The server trusts the client to send only one vote per poll per session.

## Genome Files Updated

- No existing genome components for this project. A new component doc would be at `genome/components/realtime-poll.md` (not created — no genome/ directory exists in workspace).

## Worker Feedback

- Task spec was detailed and clear. Having the exact Resource Proxy request format and the node-fetch usage example made implementation fast.
- A schema or collection index recommendation would help for scale considerations.
- It would be useful to know whether a `votes` collection already exists or needs to be created on first insert.
