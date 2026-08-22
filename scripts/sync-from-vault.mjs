#!/usr/bin/env node
/**
 * Sync the campaign wiki from the Obsidian vault into Quartz's content directory.
 *
 * The vault is the source of truth. `content/` is a build input and should never
 * be edited by hand, because the next sync overwrites it.
 *
 *   node scripts/sync-from-vault.mjs [path-to-dnd-vault]
 *
 * Default vault path is ../EM-Vault/dnd-vault relative to the repo root.
 *
 * Rules:
 *   - copies every .md file, preserving folder structure
 *   - Home.md becomes index.md, which is Quartz's root page
 *   - README.md is skipped, it documents the vault and is not campaign content
 *   - .obsidian is skipped, it is app config
 *   - files in content/ that no longer exist in the vault are deleted, so a
 *     rename in the vault does not leave an orphan on the site
 *
 * Written in Node rather than shell so it runs the same on Windows, where
 * Quartz already requires Node and rsync does not exist.
 */

import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises"
import { join, relative, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEST = join(REPO, "content")
const VAULT = resolve(process.argv[2] ?? join(REPO, "..", "EM-Vault", "dnd-vault"))

const SKIP_FILES = new Set(["README.md"])
const SKIP_DIRS = new Set([".obsidian", ".git"])

async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(join(dir, entry.name), base, out)
    } else if (entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
      out.push(relative(base, join(dir, entry.name)))
    }
  }
  return out
}

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

if (!(await exists(VAULT))) {
  console.error(`error: vault not found at ${VAULT}`)
  console.error(`pass the path as an argument, e.g. node scripts/sync-from-vault.mjs ~/EM-Vault/dnd-vault`)
  process.exit(1)
}

console.log(`vault: ${VAULT}`)
console.log(`dest:  ${DEST}\n`)

const vaultFiles = await walk(VAULT)
const wanted = new Set()
let copied = 0

for (const rel of vaultFiles) {
  // Quartz serves content/index.md as the site root
  const target = rel === "Home.md" ? "index.md" : rel
  wanted.add(target.split("\\").join("/"))
  const dest = join(DEST, target)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, await readFile(join(VAULT, rel)))
  copied++
}

// remove anything the vault no longer has, so renames do not leave orphans
const existing = (await exists(DEST)) ? await walk(DEST) : []
let removed = 0
for (const rel of existing) {
  if (!wanted.has(rel.split("\\").join("/"))) {
    await rm(join(DEST, rel))
    console.log(`  removed stale: ${rel}`)
    removed++
  }
}

console.log(`\nsynced ${copied} files, removed ${removed} stale`)
