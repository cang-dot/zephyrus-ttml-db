import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(scriptsDir, '..');
const catalogPath = path.join(rootDir, 'metadata', 'catalog.json');

const platformFolders = {
  netease: 'ncm-lyrics',
  qq: 'qq-lyrics',
  appleMusic: 'am-lyrics',
  spotify: 'spotify-lyrics'
};

const lyricTextRights = new Set(['CC-BY-SA-4.0', 'separately-authorized', 'not-licensed']);
const timingLicenses = new Set(['CC-BY-SA-4.0']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectTags(value, tagName, result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    if (key === tagName) result.push(...asArray(child));
    if (!key.startsWith('@_')) collectTags(child, tagName, result);
  }
  return result;
}

function parseTime(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return Number.NaN;
  if (input.endsWith('ms')) return Number.parseFloat(input.slice(0, -2)) / 1000;
  if (input.endsWith('s')) return Number.parseFloat(input.slice(0, -1));
  const parts = input.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

function validateTimedNodes(nodes, label, errors) {
  nodes.forEach((node, index) => {
    const begin = node?.['@_begin'];
    const end = node?.['@_end'];
    if (begin === undefined || end === undefined) {
      errors.push(`${label} ${index + 1} must contain both begin and end`);
      return;
    }
    const beginTime = parseTime(begin);
    const endTime = parseTime(end);
    if (!Number.isFinite(beginTime) || !Number.isFinite(endTime)) {
      errors.push(`${label} ${index + 1} contains an invalid time expression`);
    } else if (beginTime > endTime) {
      errors.push(`${label} ${index + 1} ends before it begins (${begin} > ${end})`);
    }
  });
}

function validateDuplicateLines(lines, errors) {
  const signatures = new Map();
  lines.forEach((line, index) => {
    const comparable = { ...line };
    delete comparable['@_itunes:key'];
    const signature = JSON.stringify(comparable);
    const key = line?.['@_itunes:key'] || `line ${index + 1}`;
    if (signatures.has(signature)) {
      errors.push(`duplicate lyric lines: ${signatures.get(signature)} and ${key}`);
    } else {
      signatures.set(signature, key);
    }
  });
}

function metadataMap(document) {
  const result = new Map();
  for (const item of collectTags(document, 'amll:meta')) {
    const key = item?.['@_key'];
    if (!key) continue;
    const values = result.get(key) || [];
    values.push(String(item?.['@_value'] || ''));
    result.set(key, values);
  }
  return result;
}

export async function readCatalog() {
  return JSON.parse(await readFile(catalogPath, 'utf8'));
}

export async function validateEntry(entry) {
  const errors = [];
  const sourcePath = path.resolve(rootDir, entry.source);
  if (!sourcePath.startsWith(`${rootDir}${path.sep}`)) {
    return { entry, errors: ['source must stay inside the repository'], metadata: new Map() };
  }

  let xml;
  try {
    xml = await readFile(sourcePath, 'utf8');
  } catch {
    return { entry, errors: [`source file not found: ${entry.source}`], metadata: new Map() };
  }

  const xmlValidation = XMLValidator.validate(xml);
  if (xmlValidation !== true) {
    return {
      entry,
      errors: [`invalid XML: ${xmlValidation.err.msg}`],
      metadata: new Map()
    };
  }

  const document = parser.parse(xml);
  if (!document.tt) errors.push('root element must be tt');
  const lines = collectTags(document, 'p');
  const words = collectTags(document, 'span').filter(
    (node) => node?.['@_begin'] !== undefined || node?.['@_end'] !== undefined
  );
  if (lines.length === 0) errors.push('TTML must contain at least one p line');
  if (words.length === 0) errors.push('TTML must contain timed span words');
  validateTimedNodes(lines, 'line', errors);
  validateTimedNodes(words, 'timed span', errors);
  validateDuplicateLines(lines, errors);

  const metadata = metadataMap(document);
  for (const key of ['musicName', 'artists', 'album']) {
    if (!(metadata.get(key) || []).some(Boolean)) errors.push(`missing metadata: ${key}`);
  }
  const titles = metadata.get('musicName') || [];
  if (titles.length > 0 && !titles.includes(entry.title)) {
    errors.push(
      `catalog title is not listed in musicName (${entry.title} not in ${titles.join(' | ')})`
    );
  }

  const platformEntries = Object.entries(entry.platformIds || {});
  if (platformEntries.length === 0) errors.push('at least one platform ID is required');
  for (const [platform, platformId] of platformEntries) {
    if (!platformFolders[platform]) errors.push(`unsupported platform: ${platform}`);
    if (!String(platformId || '').trim()) errors.push(`empty platform ID: ${platform}`);
  }

  if (!entry.rights || typeof entry.rights !== 'object') {
    errors.push('missing rights declaration');
  } else {
    if (!lyricTextRights.has(entry.rights.lyricsText)) {
      errors.push(`unsupported lyrics text rights: ${entry.rights.lyricsText || 'empty'}`);
    }
    if (!timingLicenses.has(entry.rights.timingAndMetadata)) {
      errors.push(
        `unsupported timing and metadata license: ${entry.rights.timingAndMetadata || 'empty'}`
      );
    }
    if (!String(entry.rights.attribution || '').trim()) {
      errors.push('rights attribution is required');
    }
  }

  return {
    entry,
    errors,
    metadata,
    bytes: Buffer.byteLength(xml),
    sha256: createHash('sha256').update(xml).digest('hex')
  };
}

export async function validateCatalog() {
  const catalog = await readCatalog();
  const results = [];
  const platformIds = new Map();
  for (const entry of catalog.entries) {
    const result = await validateEntry(entry);
    if (entry.status === 'published' && (entry.issues || []).length > 0) {
      result.errors.push('published entries cannot contain unresolved catalog issues');
    }
    for (const [platform, platformId] of Object.entries(entry.platformIds || {})) {
      const key = `${platform}:${platformId}`;
      if (platformIds.has(key)) {
        result.errors.push(`duplicate platform ID also used by ${platformIds.get(key)}`);
      } else {
        platformIds.set(key, entry.id);
      }
    }
    results.push(result);
  }
  return { catalog, results };
}

export async function buildLibrary() {
  const { catalog, results } = await validateCatalog();
  const published = results.filter((result) => result.entry.status === 'published');
  const invalid = published.filter((result) => result.errors.length > 0);
  if (invalid.length > 0) {
    throw new Error('Published entries failed validation; run npm test for details');
  }

  const distDir = path.join(rootDir, 'dist');
  if (path.dirname(distDir) !== rootDir || path.basename(distDir) !== 'dist') {
    throw new Error('Refusing to clean an unexpected build directory');
  }
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const manifestEntries = [];
  for (const result of published) {
    const files = {};
    for (const [platform, platformId] of Object.entries(result.entry.platformIds)) {
      const folder = platformFolders[platform];
      const relativePath = `${folder}/${platformId}.ttml`;
      const outputPath = path.join(distDir, folder, `${platformId}.ttml`);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await copyFile(path.resolve(rootDir, result.entry.source), outputPath);
      files[platform] = relativePath;
    }
    manifestEntries.push({
      id: result.entry.id,
      title: result.entry.title,
      artists: result.entry.artists,
      album: result.entry.album,
      platformIds: result.entry.platformIds,
      rights: result.entry.rights,
      files,
      sha256: result.sha256,
      bytes: result.bytes
    });
  }

  const manifest = {
    schemaVersion: 1,
    libraryVersion: catalog.libraryVersion,
    generatedAt: new Date().toISOString(),
    entries: manifestEntries
  };
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
