#!/usr/bin/env node
// Publish-face gate for the npm-published packages (rules SSOT:
// packages/.agent/rules/npm-publish-face.md, ids PKG-1..PKG-9; every
// violation is prefixed with its rule id).
//
// Coverage:
//   PKG-1  every `dependencies` entry of a published package is external in
//          that package's build.js bundle config;
//   PKG-2  every bare import reachable from a package's `exports` .d.ts
//          entries (transitive relative walk) is declared in
//          dependencies/peerDependencies (node builtins exempt);
//   PKG-5  every published package ships a README.md;
//   PKG-6  every exports/main/types/bin target resolves inside dist/;
//   PKG-7  no hardcoded semver literals in package sources;
//   PKG-9  every named import shown in a published package README's code
//          blocks exists in that package's public exports face
//          (src/public.ts); call tokens must be grep-able there.
// PKG-3 is the PKG-1 check applied to native deps; PKG-4 (pnpm publish) is
// procedural and stays probe-less in the seed. PKG-8 content shape stays
// human-reviewed. The vscode package is out of scope for PKG-9 (Marketplace
// listing face — see packages/vscode/.agent/rules/marketplace-listing.md).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'packages')

function publishedPackages() {
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = join(PACKAGES_ROOT, entry.name)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) return null
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      return manifest.private === true ? null : { name: manifest.name, dir, manifest }
    })
    .filter(Boolean)
}

function externalNames(dir) {
  const buildPath = join(dir, 'build.js')
  if (!existsSync(buildPath)) return []
  const externals = []
  for (const match of readFileSync(buildPath, 'utf8').matchAll(/external\s*:\s*\[([^\]]*)\]/gu)) {
    for (const name of match[1].matchAll(/['"]([^'"]+)['"]/gu)) externals.push(name[1])
  }
  return externals
}

// PKG-1
function dependencyExternals({ name, dir, manifest }, violations) {
  const externals = externalNames(dir)
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (externals.length > 0 && !externals.includes(dep)) {
      violations.push(`PKG-1: ${name} declares dependency ${dep} but build.js does not list it as external`)
    }
  }
}

// PKG-2 — transitive bare-import coverage from the exports type entries.
function importSpecifiers(text) {
  const found = new Set()
  for (const pattern of [/(?:from|import)\s+['"]([^'"]+)['"]/gu, /import\(\s*['"]([^'"]+)['"]\s*\)/gu]) {
    for (const match of text.matchAll(pattern)) found.add(match[1])
  }
  return found
}

function declaredNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
}

function reachableTypeImports({ name, dir, manifest }, violations) {
  const declared = declaredNames(manifest)
  const exportsMap = manifest.exports ?? {}
  const entryTypes = []
  for (const [subpath, target] of Object.entries(exportsMap)) {
    const types = typeof target === 'object' && target !== null ? target.types : target
    if (typeof types === 'string' && types.endsWith('.d.ts')) entryTypes.push([subpath, types])
  }
  if (entryTypes.length === 0) return
  const seen = new Set()
  const queue = entryTypes.map(([subpath, types]) => [subpath, resolve(dir, types)])
  while (queue.length > 0) {
    const [subpath, file] = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    if (!existsSync(file)) {
      violations.push(`PKG-2: ${name} exports entry ${subpath} types target ${relative(dir, file)} does not exist — run the package build`)
      continue
    }
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        const base = resolve(file, '..', specifier.replace(/\.(m?js|m?ts|d\.ts)$/u, ''))
        for (const candidate of [`${base}.d.ts`, base]) {
          if (candidate !== file && existsSync(candidate) && statSync(candidate).isFile()) {
            queue.push([subpath, candidate])
            break
          }
        }
        continue
      }
      if (specifier.startsWith('node:')) continue
      const depName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (!declared.has(depName)) {
        violations.push(`PKG-2: ${name} reachable d.ts ${relative(dir, file)} imports ${depName} which is declared in neither dependencies nor peerDependencies`)
      }
    }
  }
}

// PKG-9 — README example named imports must exist in the package's public face.
// v1 arm covers named imports from the package's own root specifier; the
// full call-shape verification stays human-reviewed (probe line in the seed
// says "named-imports arm" for this reason).
function readmeExampleMatchesExports({ name, dir }, violations) {
  const readmePath = join(dir, 'README.md')
  const publicFacePath = join(dir, 'src', 'public.ts')
  if (!existsSync(readmePath) || !existsSync(publicFacePath)) return // PKG-5 covers the README; no public face = probe n/a (e.g. the vscode Marketplace listing)
  const readme = readFileSync(readmePath, 'utf8')
  const publicFace = readFileSync(publicFacePath, 'utf8')
  const pkgName = name
  for (const block of readme.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)) {
    const code = block[1]
    for (const importMatch of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
      if (importMatch[2] !== pkgName) continue
      for (const raw of importMatch[1].split(',')) {
        // `import { type Foo }` imports a type only — strip the modifier.
        const named = raw.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim()
        if (named.length === 0) continue
        // Signature tokens must be grep-able in the public surface.
        if (!new RegExp(`\\b${named.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(publicFace)) {
          violations.push(`PKG-9: ${name} README example imports { ${named} } from '${pkgName}' but it is not grep-able in src/public.ts — example API drift`)
        }
      }
    }
  }
}

// PKG-5
function packageReadme({ name, dir }, violations) {
  if (!existsSync(join(dir, 'README.md'))) {
    violations.push(`PKG-5: ${name} has no package-root README.md — npm pages would be blank`)
  }
}

// PKG-6
function targetsResolve({ name, dir, manifest }, violations) {
  const targets = []
  for (const field of ['main', 'types']) {
    if (typeof manifest[field] === 'string') targets.push([field, manifest[field]])
  }
  for (const [binName, binPath] of Object.entries(manifest.bin ?? {})) {
    targets.push([`bin/${binName}`, binPath])
  }
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    for (const [condition, value] of Object.entries(typeof target === 'object' && target !== null ? target : { default: target })) {
      if (typeof value === 'string' && !value.includes('*')) targets.push([`exports${subpath}${condition}`, value])
    }
  }
  for (const [label, target] of targets) {
    if (!existsSync(resolve(dir, target))) {
      violations.push(`PKG-6: ${name} ${label} target ${target} does not exist in the built package`)
    }
  }
}

// PKG-7
function collectFiles(path, extensions, result = []) {
  const stat = statSync(path)
  if (stat.isFile()) {
    if (extensions.includes(extname(path))) result.push(path)
    return result
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
    collectFiles(join(path, entry), extensions, result)
  }
  return result
}

function versionLiterals({ name, dir }, violations) {
  for (const file of collectFiles(join(dir, 'src'), ['.ts', '.mts', '.js', '.mjs'])) {
    // Test files carry fixture versions, not shipped identity.
    if (file.includes('.test.')) continue
    for (const match of readFileSync(file, 'utf8').matchAll(/['"]\d+\.\d+\.\d+['"]/gu)) {
      violations.push(`PKG-7: ${name} ${relative(dir, file)} hardcodes version literal ${match[0]} — inject the package version at build time`)
    }
  }
}

const checks = [dependencyExternals, reachableTypeImports, packageReadme, targetsResolve, versionLiterals, readmeExampleMatchesExports]

export function check() {
  const violations = []
  for (const pkg of publishedPackages()) {
    for (const checkFn of checks) checkFn(pkg, violations)
  }
  return violations
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('verify-publish-face.mjs')) {
  const violations = check()
  for (const violation of violations) console.error(violation)
  process.exitCode = violations.length === 0 ? 0 : 1
}
