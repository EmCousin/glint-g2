# Changelog

All notable changes to the Glint WhatsApp plugin are documented here. Even Hub appears to ignore a re-upload at an unchanged `app.json` version, so every hardware build must increment the version.

## 0.1.3

- Load older conversations and retained messages automatically at list boundaries.

## 0.1.2

- Added a full-screen message reader with swipe paging for long message bodies.

## 0.1.1

- Use the dedicated `/whatsapp` Tailscale Serve route so the WhatsApp plugin
  cannot accidentally connect to the Signal bridge hosted at the root URL.

## 0.1.0

- Created the dedicated WhatsApp companion from the proven G2 layout and interaction model.
- Added linked-device history, replies, and reactions through the private workstation bridge.
