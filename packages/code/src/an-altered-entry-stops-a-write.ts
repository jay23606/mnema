/**
 * THE QUESTION BEHIND THE REFUSAL OF A WRITE OVER AN ALTERED ENTRY (ADR-396), asked of the files before a
 * door opens anything for writing: the command line's (`a-write-over-an-altered-entry.ts`) and the SDK's.
 * The agent's server asks it of the connection's own caches (`mcp/session.ts`).
 *
 * Over every tree the caller reaches (the project's public and private trees and the machine's global
 * one), the same reach as a line that cannot be read. Over the cache the tree keeps, as a read of the
 * project does: a warm one costs a stat, and the replay and the refresh check each line's hash.
 * It is asked where a writer is about to open, so what it leaves (the cache file a read of the project
 * leaves too) is left by a write that is going to be made. A tree with no files is not opened: asking
 * would make one.
 *
 * ONE TREE AT A TIME, so a line that cannot be read in one is not a reason to leave another unasked:
 * that line is not answered here (the verb meets it and refuses as it always did), and an altered entry
 * in any other tree still is. A gap or a fork is not read here: it is told, never refused.
 *
 * ITS LIMIT, said where the reads say theirs: it is a check and then an append, and an alteration made
 * between the two is not seen, because the writer does not read the hash of the lines it resumes from.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catalogUpcasters,
  ENTRY_HASH_MISMATCH,
  UnreadableLineError,
  verifyChain,
} from '@mnema/chain';
import { type DiscoveryEnv, type ResolvedTrees, reachableTrees, resolveTrees } from '@mnema/core';
import type { ScopedLinkBreak } from './record-integrity.js';
import {
  linkBreaksOf,
  THE_READING_THAT_OPENED_THESE,
  withOpenedCaches,
  withTreesRead,
} from './tree-sources.js';
import { AlteredEntryError, refuseWhileAltered } from './what-a-write-meets.js';

/**
 * THE ENTRIES A DIRECTORY OF TAILS OF SEVERAL RECORDS HOLDS ALTERED. Every reading of such a directory
 * reads no tail (`tailsReadAt`), so the cache sees no entry at all and leaves none out: the question
 * above would find nothing in the very directory `tail relink` writes into. The chain's own check is
 * asked instead, over every tail, and the line is found by the seq the issue names.
 */
function alteredBesideSeveralRecords(
  scope: ScopedLinkBreak['scope'],
  chainRoot: string,
): ScopedLinkBreak[] {
  const verdict = verifyChain({ root: chainRoot }, catalogUpcasters());
  return verdict.issues.flatMap((issue) => {
    if (issue.detail !== ENTRY_HASH_MISMATCH || issue.tail === undefined) return [];
    const where = lineOf(chainRoot, issue.tail, issue.seq);
    return [
      {
        scope,
        tail: issue.tail,
        ...(issue.seq === undefined ? {} : { seq: issue.seq }),
        detail: ENTRY_HASH_MISMATCH,
        retained: where,
      },
    ];
  });
}

/** The segment and the line of the entry of `tail` that holds `seq`, as the sentence names them. */
function lineOf(
  chainRoot: string,
  tail: string,
  seq: number | undefined,
): { segment: string; line: number } {
  const dir = join(chainRoot, 'tails', tail);
  for (const segment of readdirSync(dir)
    .filter((name) => /^\d+\.jsonl$/.test(name))
    .sort()) {
    const lines = readFileSync(join(dir, segment), 'utf-8').split('\n');
    for (const [at, text] of lines.entries()) {
      try {
        const held = JSON.parse(text) as { link?: { seq?: number } };
        if (held.link?.seq === seq) return { segment, line: at + 1 };
      } catch {
        // A line that does not parse is not the entry asked for.
      }
    }
  }
  return { segment: '000001.jsonl', line: 0 };
}

/** What the sources say, and what a directory of several records hides from them. */
function breaksOf(sources: Parameters<typeof linkBreaksOf>[0]): readonly ScopedLinkBreak[] {
  const hidden = sources
    .filter((source) => source.cache.severalRecords().length > 0)
    .flatMap((source) => alteredBesideSeveralRecords(source.scope, source.chainRoot));
  return [...linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE), ...hidden];
}

/** Throws {@link AlteredEntryError} when any tree of `trees` holds an altered entry. */
export function checkForAnAlteredEntry(trees: ResolvedTrees): void {
  const reached = reachableTrees(trees).filter((one) => existsSync(one.chainRoot));
  const facts = reached.flatMap((tree) => {
    try {
      // The machine's global tree keeps no cache for a project's verb: a refusal there leaves it as it
      // found it, so that tree is replayed in memory (it is the small one).
      if (tree.scope === 'global') {
        return withTreesRead([tree], (read) => breaksOf(read));
      }
      return withOpenedCaches(trees, (open, opened) => {
        open(tree.scope);
        return breaksOf(opened);
      });
    } catch (error) {
      if (error instanceof UnreadableLineError) return [];
      throw error;
    }
  });
  refuseWhileAltered(facts);
}

/**
 * The refusal as the library's callers (the SDK) read one, or `undefined` when the write may go on:
 * the shape of every other refusal a library write returns.
 */
export function refusedOverAnAlteredEntry(here: {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}):
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    }
  | undefined {
  try {
    checkForAnAlteredEntry(resolveTrees(here.cwd, here.env));
    return undefined;
  } catch (error) {
    if (error instanceof AlteredEntryError) {
      return { ok: false, reason: 'REFUSED', code: error.code, message: error.message };
    }
    throw error;
  }
}
