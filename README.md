# public-stats

Public, self-updating statistics for my projects. Right now it tracks the install numbers of Obsidian plugins.

**Live page:** https://msachet5.github.io/public-stats/

It is a static site. A GitHub Action snapshots the numbers every day, commits the history to this repo, and redeploys the page, so the page stays current with no server.

## What the page shows

Total installs, last 7 and 30 days, installs by month, daily installs with a 7-day average, cumulative installs with release markers, weekly installs by version, where new installs land, a release table (installs, share, first 7 days, GitHub downloads), and a few health checks (data freshness, counter sanity, quiet days, missed snapshots).

## How it works

1. `scripts/snapshot.mjs` reads the plugin's entry from Obsidian's public [community-plugin-stats.json](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugin-stats.json).
2. It appends one row per day to `docs/data/<plugin>/history.json` (and `history.csv`), and refreshes GitHub repo and release metadata in `meta.json`.
3. `.github/workflows/snapshot.yml` runs it daily at 03:17 UTC, commits any change, and deploys `docs/` to GitHub Pages.
4. `docs/` is plain HTML, CSS and JavaScript with no dependencies. It reads the JSON files and draws the charts in the browser.

If the plugin is missing from Obsidian's file or the file cannot be fetched, the job fails and GitHub emails you. That is the alert.

## One-time setup

1. Create the repo `public-stats` on GitHub (public) and push this folder to `main`.
2. Settings, Pages, Source: **GitHub Actions**.
3. Actions tab, run **Snapshot stats and deploy page** once with "Run workflow".
4. Settings, Actions, General, Workflow permissions: **Read and write permissions** (needed so the job can commit the data).

## Add another plugin

Add an entry to `plugins.json`:

```json
{ "id": "your-plugin-id", "name": "Your Plugin", "repo": "owner/repo" }
```

`id` is the `id` in the plugin's `manifest.json`. The page gets a plugin picker automatically, and `?plugin=your-plugin-id` links straight to one plugin. History for a new plugin starts on its first snapshot.

## Embed a badge in a plugin README

```markdown
![installs](https://img.shields.io/endpoint?url=https://msachet5.github.io/public-stats/data/ultisync/badge.json)
[Install stats](https://msachet5.github.io/public-stats/)
```

## Caveats

- An install is a download of that version. Updating to a newer version counts again, so these are not unique users.
- Obsidian publishes running totals only. Daily and monthly numbers are derived from this repo's snapshots. History before 2026-10-11 was recovered from the git history of Obsidian's stats file (daily, from 2026-09-08).
- Each snapshot reflects the state at about 00:30 UTC, so installs are credited to the previous day.
- Pre-releases are not counted by Obsidian. GitHub downloads in the release table do include them (for example BRAT testers).

## Local use

```bash
npm test            # unit tests for the snapshot logic
npm run snapshot    # take a snapshot now (needs network)
npm run serve       # serve docs/ at http://localhost:8080
```
