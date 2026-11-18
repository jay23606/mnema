/**
 * A PART OF THE RECORD THE DISK WILL NOT OPEN IS NAMED, AND NO COMMAND PRINTS THE SYSTEM'S OWN
 * ERROR (ADR-288, ADR-367).
 *
 * Through the built binary, in a sandbox, one tree at a time is damaged the ways a disk does it (a
 * folder with no permission, a segment with none, a file where `tails/` should be, a folder where a
 * segment should be, a loop of links), and every command that reads or writes the record is asked.
 * The two halves of what is held:
 *
 *   - no stream of any command carries a name from the system's table of errors (`EACCES`, `ENOTDIR`,
 *     `EISDIR`, `ELOOP`, every other the table has): the table is the machine's own, so the guard does
 *     not agree with the code by construction;
 *   - the part is named in the form of a part this mnema does not read (ADR-396): a read serves
 *     around it and says it on the first line, and a write is refused naming where the part is and
 *     what to do. The private and the global tree's refusals name no repair, `mnema tail repair` and
 *     `mnema backup restore` included (ADR-408), because only the committed tree has a history, and
 *     no tree's refusal names the verb that puts back a LINE for a part that is a permission.
 *
 * A mode of 000 does not stop a superuser, and Windows has no equivalent: the cases are skipped
 * there, said as skipped.
 */
// @plants-damage

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTrees } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import { MNEMA_CLI } from './support/the-cli.js';

const CANNOT_CHMOD = process.platform === 'win32' || process.getuid?.() === 0;

/** Every name the system's own table of errors has, as a word of its own in a stream. */
const AN_ERRNO = new RegExp(
  `(^|[^A-Za-z0-9_])(${Object.keys(constants.errno).join('|')})([^A-Za-z0-9_]|$)`,
);

type Sandbox = { repo: string; home: string; made: string };
type Tree = 'public' | 'private' | 'global';

const sandboxes: Sandbox[] = [];
afterEach(() => {
  for (const one of sandboxes.splice(0)) {
    restoreModes(one.made);
    rmSync(one.made, { recursive: true, force: true });
  }
});

/** Gives every folder and file below `dir` an owner's mode again, so the sandbox can be removed. */
function restoreModes(dir: string): void {
  if (!existsSync(dir)) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    return;
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      chmodSync(path, 0o700);
      restoreModes(path);
    } catch {
      // a link that leads nowhere has no mode to give back
    }
  }
}

/** The built binary, its two streams in the order they were written, in a bare HOME. */
const mnema = (box: Sandbox, args: string[]) =>
  spawnSync('bash', ['-c', 'exec "$0" "$@" 2>&1', process.execPath, MNEMA_CLI, ...args], {
    cwd: box.repo,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', HOME: box.home, GIT_CONFIG_NOSYSTEM: '1' },
  });

function aRecord(): Sandbox {
  const made = mkdtempSync(join(tmpdir(), 'mnema-disk-refuses-'));
  const box = { made, repo: join(made, 'repo'), home: join(made, 'home') };
  sandboxes.push(box);
  for (const path of [box.repo, box.home]) mkdirSync(path, { recursive: true });
  expect(mnema(box, ['init', '--yes', '--hosts', 'none']).status).toBe(0);
  for (const tree of ['public', 'private', 'global']) {
    expect(
      mnema(box, ['decision', 'record', `Use ${tree}`, 'Because it is', '--scope', tree]).status,
    ).toBe(0);
  }
  return box;
}

const rootOf = (box: Sandbox, tree: Tree): string => {
  const trees = resolveTrees(box.repo, { home: box.home });
  const root = {
    public: join(box.repo, '.mnema'),
    private: trees.projectPrivate,
    global: trees.global,
  }[tree];
  return root as string;
};

/** The damages: each does one thing to `tails/` or to what is in it, and says how it is told apart. */
const DAMAGES: readonly (readonly [string, (root: string) => void])[] = [
  ['a tails folder with no permission', (root) => chmodSync(join(root, 'tails'), 0)],
  [
    'a segment with no permission',
    (root) => {
      const tail = readdirSync(join(root, 'tails'))[0] as string;
      chmodSync(join(root, 'tails', tail, '000001.jsonl'), 0);
    },
  ],
  [
    'a tail folder with no permission',
    (root) => chmodSync(join(root, 'tails', readdirSync(join(root, 'tails'))[0] as string), 0),
  ],
  [
    'a file where the tails folder should be',
    (root) => {
      renameSync(join(root, 'tails'), join(root, 'tails.kept'));
      writeFileSync(join(root, 'tails'), 'not a folder');
    },
  ],
  [
    'a folder where a segment should be',
    (root) => {
      const segment = join(
        root,
        'tails',
        readdirSync(join(root, 'tails'))[0] as string,
        '000001.jsonl',
      );
      renameSync(segment, `${segment}.kept`);
      mkdirSync(segment);
    },
  ],
  [
    'a link that loops where the tails folder should be',
    (root) => {
      renameSync(join(root, 'tails'), join(root, 'tails.kept'));
      symlinkSync(join(root, 'tails'), join(root, 'tails'));
    },
  ],
];

const READS = [
  ['status'],
  ['show', 'ADR-1'],
  ['search', 'Use'],
  ['brief'],
  ['rules', 'src/x.ts'],
  ['why', 'src/x.ts'],
];
const WRITES = [
  ['decision', 'record', 'Next', 'Because'],
  ['memory', 'a memory', '--scope', 'private'],
  ['switch', 'off', 'agent-accepts'],
];
/** What the sweep asks of every damage: a read of each door, a write, and the verbs that read the tree on their own. */
const SWEPT = [
  ['status'],
  ['brief'],
  ['rules', 'src/x.ts'],
  WRITES[0] as string[],
  ['verify'],
  ['site'],
  ['tail', 'repair', 'nothing'],
  ['backup', 'status'],
];

describe.skipIf(CANNOT_CHMOD)('a part the disk will not open, in every tree', () => {
  describe.each(['public', 'private', 'global'] as const)('in the %s tree', (tree) => {
    // The private and the global tree are asked for the two damages that reach a read of `tails/` itself.
    it.each(tree === 'public' ? DAMAGES : [DAMAGES[0], DAMAGES[3]])(
      '%s: no command prints the system’s own error',
      (_name, damage) => {
        const box = aRecord();
        damage(rootOf(box, tree));
        for (const args of SWEPT) {
          const said = mnema(box, args).stdout;
          expect(said, `mnema ${args.join(' ')}`).not.toMatch(AN_ERRNO);
        }
      },
      240_000,
    );
  });

  describe.each(['public', 'private', 'global'] as const)(
    'a folder with no permission in the %s tree',
    (tree) => {
      it('is said first by every read, which serves on, and refuses every write by its place', () => {
        const box = aRecord();
        damage(box, tree);
        for (const args of READS.filter((one) => one[0] !== 'show')) {
          const read = mnema(box, args);
          const first = read.stdout.split('\n')[0] as string;
          expect(first, `mnema ${args.join(' ')}`).toMatch(
            new RegExp(
              `^issue \\[T1\\] ${tree} tails: a part the disk does not let this mnema open \\(tails\\): .+; this part was not read\\. `,
            ),
          );
          expect(read.status, `mnema ${args.join(' ')}`).toBe(0);
        }
        for (const args of WRITES) {
          const refused = mnema(box, args);
          expect(refused.status, `mnema ${args.join(' ')}`).not.toBe(0);
          expect(refused.stdout).toContain('the disk does not let this mnema open');
          expect(refused.stdout).toContain('tails cannot be opened');
          // Nothing was recorded: the part still does not open, and the one the write was asked for is not there.
        }
      }, 240_000);

      it(tree === 'public'
        ? 'does not name the verb that puts a line back, which puts back no permission'
        : 'names no repair at all: the tree is not versioned (ADR-408)', () => {
        const box = aRecord();
        damage(box, tree);
        for (const args of [
          READS[0],
          READS[5],
          WRITES[0],
          ['verify'],
          ['tail', 'repair', 'nothing'],
        ] as string[][]) {
          const said = mnema(box, args).stdout;
          expect(said, `mnema ${args.join(' ')}`).not.toContain('tail repair');
          if (tree !== 'public')
            expect(said, `mnema ${args.join(' ')}`).not.toContain('backup restore');
        }
      }, 240_000);
    },
  );
});

/** The first damage of the table: a folder of `tails/` with no permission, in `tree`. */
function damage(box: Sandbox, tree: Tree): void {
  chmodSync(join(rootOf(box, tree), 'tails'), 0);
}
