import * as assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveSkillsPackageRoot, runSkills, SKILL_NAME, type SkillsAnnouncement } from './skills';
import { UserFacingError } from './status';

// The test tree lives at out/packages/cli/src; the shipped payload lives in
// the real package tree, which is what the published bin announces.
const REAL_PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'cli');

suite('CLI skills', () => {
  let tempDirectory: string;
  let packageRoot: string;

  setup(() => {
    tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'coggit-cli-skills-'));
    packageRoot = path.join(tempDirectory, 'pkg');
    mkdirSync(path.join(packageRoot, 'skills', SKILL_NAME), { recursive: true });
    writeFileSync(path.join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md'), '---\nname: coggit\n---\n');
  });

  teardown(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('the text face carries the version stamp, both locations, and the install line', () => {
    const lines = runSkills({ packageRoot, version: '1.2.3' }).split('\n');
    assert.strictEqual(lines[0], 'coggit@1.2.3');
    assert.strictEqual(lines[1], `skill tree: ${path.join(packageRoot, 'skills', 'coggit')}`);
    assert.strictEqual(lines[2], `entry: ${path.join(packageRoot, 'skills', 'coggit', 'SKILL.md')}`);
    assert.match(lines[3], /^install: copy or link the whole subtree/);
    // The tool never decides the destination and never writes it.
    assert.match(lines[3], /never writes it/);
    assert.match(lines[3], /--json/);
    assert.strictEqual(lines.length, 4);
  });

  test('the --json face is exactly the four locator fields', () => {
    const parsed = JSON.parse(runSkills({ packageRoot, version: '1.2.3', json: true })) as SkillsAnnouncement;
    assert.deepStrictEqual(Object.keys(parsed).sort(), ['name', 'skillMd', 'skillRoot', 'version']);
    assert.strictEqual(parsed.name, 'coggit');
    assert.strictEqual(parsed.version, '1.2.3');
    assert.strictEqual(parsed.skillRoot, path.join(packageRoot, 'skills', 'coggit'));
    assert.strictEqual(parsed.skillMd, path.join(parsed.skillRoot, 'SKILL.md'));
    assert.ok(path.isAbsolute(parsed.skillRoot));
  });

  test('a missing payload fails loud as a user-facing error', () => {
    rmSync(path.join(packageRoot, 'skills'), { recursive: true, force: true });
    assert.throws(
      () => runSkills({ packageRoot, version: '1.2.3' }),
      (error: unknown) => error instanceof UserFacingError && /skill payload missing: .*SKILL\.md/.test(error.message),
    );
  });

  test('the shipped payload exists and spells the announced name three ways', () => {
    const parsed = JSON.parse(runSkills({ packageRoot: REAL_PACKAGE_ROOT, version: '0.0.0-test', json: true })) as SkillsAnnouncement;
    assert.ok(existsSync(parsed.skillMd), `shipped SKILL.md missing at ${parsed.skillMd}`);
    // Directory name = frontmatter name = announced name (the trigger word is
    // the tool word).
    assert.strictEqual(path.basename(parsed.skillRoot), parsed.name);
    const frontmatter = readFileSync(parsed.skillMd, 'utf8').split('\n---')[0];
    assert.match(frontmatter, new RegExp(`^name: ${parsed.name}$`, 'm'));
    // The face carries the standard payload core (install unit + consent
    // boundary + canon-site pointer) and not the full contract — the
    // reconciliation details live in references/payload.md.
    const face = readFileSync(parsed.skillMd, 'utf8');
    assert.match(face, /\*\*Payload\.\*\*/);
    assert.match(face, /\[references\/payload\.md\]\(references\/payload\.md\)/);
    assert.doesNotMatch(face, /\*\*Payload & reconciliation\.\*\*/);
    assert.match(
      readFileSync(path.join(parsed.skillRoot, 'references', 'payload.md'), 'utf8'),
      /\*\*Payload & reconciliation\.\*\*/,
    );
    // One-time operations are cold content off the face: the install dance
    // and the guidance refresh live in references/setup.md, the face only
    // routes there.
    assert.doesNotMatch(face, /coggit init/);
    assert.doesNotMatch(face, /mcp install/);
    assert.match(
      readFileSync(path.join(parsed.skillRoot, 'references', 'setup.md'), 'utf8'),
      /install dance/,
    );
    // Frontmatter is pure key-value, zero comments (ruling 2026-11-02): the
    // ownership taxonomy lives in references/payload.md, not on the face.
    assert.doesNotMatch(frontmatter, /^\s*#/m);
  });

  test('the package root resolves from the bundle directory through a link', () => {
    // Compare against the canonical path: a temp root may carry a short or
    // differently-cased spelling that realpath normalises.
    assert.strictEqual(resolveSkillsPackageRoot(path.join(packageRoot, 'skills')), realpathSync(packageRoot));
    // A linked install (npm link / junction) announces the real tree it follows.
    const linkPath = path.join(tempDirectory, 'linked-pkg');
    symlinkSync(packageRoot, linkPath, 'junction');
    assert.strictEqual(
      resolveSkillsPackageRoot(path.join(linkPath, 'skills')),
      resolveSkillsPackageRoot(path.join(packageRoot, 'skills')),
    );
  });
});
