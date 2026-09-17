# Glint G2

Private Even G2 integrations for Signal, WhatsApp, and HEY.

## Structure

- `apps/*/plugin`: app manifests, assets, and thin runtime configuration
- `apps/*/bridge`: service-specific providers and bridge entrypoints
- `packages/g2-plugin`: shared glasses and mobile companion runtime
- `packages/bridge`: shared authenticated API, drafts, and transcription

## Commands

```sh
npm install
npm test
npm run build
npm run pack
```

Individual packages can be built with `npm run pack:signal`,
`npm run pack:whatsapp`, or `npm run pack:hey`.
