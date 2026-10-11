#!/usr/bin/env node
// Daily snapshot of Obsidian community plugin stats (plus GitHub repo/release metadata).
//
// For each plugin listed in plugins.json it:
//   1. reads the plugin's entry from Obsidian's public community-plugin-stats.json
//   2. appends (or replaces) today's row in docs/data/<id>/history.json
//   3. refreshes docs/data/<id>/meta.json from the GitHub API (repo stats + releases), if reachable
//   4. rewrites history.csv, badge.json and docs/data/index.json
//
// No dependencies. Needs Node 18+ (global fetch). GITHUB_TOKEN is optional but avoids rate limits.
// A missing plugin entry or an unreachable stats file exits non-zero, so the workflow fails
// and GitHub emails you. That failure is the alert.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATS_URL =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs', 'data');

// ---------- pure helpers (unit-tested in snapshot.test.mjs) ----------

/** Turn one raw stats entry into a snapshot row. */
export function buildSnapshot(entry, date, now = new Date()) {
  const versions = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'downloads' || k === 'updated') continue;
    if (Number.isFinite(v)) versions[k] = v;
  }
  return {
    date,
    total: Number.isFinite(entry.downloads) ? entry.downloads : Object.values(versions).reduce((a, b) => a + b, 0),
    versions,
    updated: entry.updated ?? null,
    source: 'actions',
    fetchedAt: now.toISOString(),
  };
}

/** Insert or replace the row for snapshot.date, keep rows sorted, flag suspicious changes. */
export function mergeSnapshot(history, snap) {
  const rows = history.snapshots.filter((s) => s.date !== snap.date);
  rows.push(snap);
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const i = rows.findIndex((s) => s.date === snap.date);
  const prev = i > 0 ? rows[i - 1] : null;
  const warnings = [];
  if (prev) {
    if (snap.total < prev.total) {
      snap.anomaly = 'total_decreased';
      warnings.push(`total decreased ${prev.total} -> ${snap.total}`);
    }
    for (const [v, n] of Object.entries(prev.versions)) {
      if ((snap.versions[v] ?? 0) < n) warnings.push(`version ${v} decreased ${n} -> ${snap.versions[v] ?? 0}`);
    }
  }
  return { history: { ...history, snapshots: rows }, warnings };
}

export function toCsv(history) {
  const versions = [...new Set(history.snapshots.flatMap((s) => Object.keys(s.versions)))].sort(cmpVersion);
  const lines = [['date', 'total', ...versions].join(',')];
  for (const s of history.snapshots) lines.push([s.date, s.total, ...versions.map((v) => s.versions[v] ?? 0)].join(','));
  return lines.join('\n') + '\n';
}

export function cmpVersion(a, b) {
  const pa = a.split(/[.-]/), pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) { if (nx !== ny) return nx - ny; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- IO ----------

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 1) + '\n');
}

async function getJson(url, headers = {}, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'public-stats-snapshot', ...headers } });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw err;
}

async function githubMeta(repo) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const info = await getJson(`https://api.github.com/repos/${repo}`, headers);
  const rels = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=100`, headers);
  return {
    repo,
    fetchedAt: new Date().toISOString(),
    stars: info.stargazers_count,
    forks: info.forks_count,
    watchers: info.subscribers_count ?? info.watchers_count,
    openIssues: info.open_issues_count,
    pushedAt: info.pushed_at,
    releases: rels
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: r.tag_name,
        publishedAt: r.published_at,
        prerelease: !!r.prerelease,
        // Obsidian installs fetch main.js from the release, so its count is the best GitHub-side cross-check.
        // It also includes BRAT/beta installs, which Obsidian's own stats do not.
        mainJsDownloads: (r.assets.find((a) => a.name === 'main.js') || {}).download_count ?? null,
        assetDownloads: r.assets.reduce((n, a) => n + (a.download_count || 0), 0),
      }))
      .sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1)),
  };
}

async function main() {
  const plugins = await readJson(join(ROOT, 'plugins.json'), []);
  if (!plugins.length) throw new Error('plugins.json is empty');

  const stats = await getJson(STATS_URL);
  const today = new Date().toISOString().slice(0, 10);
  const index = [];
  let failed = false;

  for (const p of plugins) {
    const dir = join(DATA, p.id);
    const histPath = join(dir, 'history.json');
    let history = await readJson(histPath, { plugin: p.id, snapshots: [] });
    const entry = stats[p.id];

    if (!entry) {
      console.error(`::error::Plugin "${p.id}" is not in Obsidian's stats file`);
      failed = true;
      continue;
    }

    const snap = buildSnapshot(entry, today);
    const merged = mergeSnapshot(history, snap);
    history = merged.history;
    merged.warnings.forEach((w) => console.warn(`::warning::${p.id}: ${w}`));
    await writeJson(histPath, history);
    await writeFile(join(dir, 'history.csv'), toCsv(history));
    await writeJson(join(dir, 'badge.json'), {
      schemaVersion: 1, label: 'installs', message: String(snap.total), color: 'blue',
    });

    if (p.repo) {
      try {
        await writeJson(join(dir, 'meta.json'), await githubMeta(p.repo));
      } catch (e) {
        // Keep the previous meta.json; GitHub metadata is nice-to-have, installs are the product.
        console.warn(`::warning::${p.id}: GitHub metadata not refreshed (${e.message})`);
      }
    }

    index.push({ id: p.id, name: p.name || p.id, repo: p.repo || null, total: snap.total, date: snap.date });
    console.log(`${p.id}: total ${snap.total} on ${snap.date}`);
  }

  await writeJson(join(DATA, 'index.json'), { generatedAt: new Date().toISOString(), plugins: index });
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
