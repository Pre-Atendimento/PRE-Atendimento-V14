---
name: Instance status sync
description: GET /api/instances was returning stale DB status; EvoGo is the source of truth after QR scan.
---

## Rule
`GET /api/instances` must sync status from EvoGo on every call. The DB status is set to `creating` at creation time and is never automatically updated when a user scans a QR code.

## Why
The Monitor tab queries EvoGo live (via `getInstanceStatus`) and correctly shows `connected`. The Instances tab was reading from DB only, so it showed `disconnected` even when EvoGo had `LoggedIn: true`. The two tabs disagreed because they used different data sources.

## How to apply
In `GET /api/instances` (server.ts): after fetching from DB, call `getInstanceStatus(token, cfg.url)` in parallel for each instance (with a 5s timeout). Map `LoggedIn === true` → `connected`, else `inactive`. Update the DB row if status changed, then return live status. Wrap the entire sync block in try/catch — if EvoGo is unreachable, fall back to DB status silently.
