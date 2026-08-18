# Minimal Pyromind chat frontend

This client consumes only the harness-neutral product API:

- Snapshot: `GET /api/v2/pyromind/conversations/{id}/snapshot`
- Commands: `POST /api/v2/pyromind/conversations/{id}/commands`
- Events: authenticated fetch-SSE from `GET /api/v2/pyromind/conversations/{id}/events`

The UI renders `ConversationSnapshot` and `ProductEvent` data. It does not parse
OpenHands, Pi, or any other harness-native event shape.

```bash
npm install
npm run dev
```

Use `npm run build` and `npm run lint` as the local verification checks.
