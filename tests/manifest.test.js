/**
 * Snabby – Manifest Validation Tests
 * Validates extension/manifest.json has the correct MV3 structure,
 * valid permissions, safe CSP, and all required keys present.
 */

const fs   = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'extension', 'manifest.json');
let manifest;

beforeAll(() => {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  manifest = JSON.parse(raw); // throws if JSON is malformed
});

// ─── JSON validity ───────────────────────────────

describe('manifest.json – JSON validity', () => {
  test('is valid JSON (no syntax errors)', () => {
    // If beforeAll didn't throw, the parse succeeded
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe('object');
  });
});

// ─── Required top-level fields ───────────────────

describe('manifest.json – required fields', () => {
  test('manifest_version is 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('name is defined and non-empty', () => {
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  test('version is a valid semver-like string', () => {
    expect(typeof manifest.version).toBe('string');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('description is defined', () => {
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description.length).toBeGreaterThan(0);
  });
});

// ─── Background / Service Worker ─────────────────

describe('manifest.json – background service worker', () => {
  test('background key exists', () => {
    expect(manifest.background).toBeDefined();
  });

  test('background.service_worker is set', () => {
    expect(typeof manifest.background.service_worker).toBe('string');
    expect(manifest.background.service_worker).toBe('background/service-worker.js');
  });

  test('service_worker is NOT inside commands (previous bug)', () => {
    // Commands block must not contain a service_worker key
    if (manifest.commands) {
      expect(manifest.commands.service_worker).toBeUndefined();
    }
  });
});

// ─── Permissions ─────────────────────────────────

describe('manifest.json – permissions', () => {
  const REQUIRED = ['activeTab', 'storage', 'downloads', 'tabs', 'offscreen'];

  test('permissions array is present', () => {
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });

  for (const perm of REQUIRED) {
    test(`includes "${perm}" permission`, () => {
      expect(manifest.permissions).toContain(perm);
    });
  }
});

// ─── Commands ────────────────────────────────────

describe('manifest.json – commands', () => {
  test('commands object is defined', () => {
    expect(manifest.commands).toBeDefined();
  });

  test('capture-screenshot command is defined', () => {
    expect(manifest.commands['capture-screenshot']).toBeDefined();
  });

  test('capture-screenshot has suggested_key', () => {
    const cmd = manifest.commands['capture-screenshot'];
    expect(cmd.suggested_key).toBeDefined();
    expect(typeof cmd.suggested_key.default).toBe('string');
  });

  test('capture-screenshot suggested_key is valid JSON (no stray brackets)', () => {
    // In the broken manifest the ] was used instead of } — verify it's an object
    expect(typeof manifest.commands['capture-screenshot'].suggested_key).toBe('object');
    expect(Array.isArray(manifest.commands['capture-screenshot'].suggested_key)).toBe(false);
  });
});

// ─── Content Security Policy ─────────────────────

describe('manifest.json – content_security_policy', () => {
  test('content_security_policy is defined', () => {
    expect(manifest.content_security_policy).toBeDefined();
  });

  test('extension_pages CSP is set', () => {
    expect(typeof manifest.content_security_policy.extension_pages).toBe('string');
  });

  test('CSP does NOT contain blob: (Chrome rejects this in MV3)', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).not.toContain('blob:');
  });

  test('CSP does NOT contain unsafe-inline', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).not.toContain("'unsafe-inline'");
  });

  test("CSP contains 'self' for script-src", () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("'self'");
  });

  test("CSP contains 'wasm-unsafe-eval' for WASM support", () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("'wasm-unsafe-eval'");
  });
});

// ─── Web Accessible Resources ────────────────────

describe('manifest.json – web_accessible_resources', () => {
  test('web_accessible_resources is an array', () => {
    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true);
    expect(manifest.web_accessible_resources.length).toBeGreaterThan(0);
  });

  test('vendor/tesseract/* is listed as accessible', () => {
    const allResources = manifest.web_accessible_resources.flatMap(e => e.resources || []);
    const hasTesseract = allResources.some(r => r.includes('vendor/tesseract'));
    expect(hasTesseract).toBe(true);
  });

  test('offscreen.html is listed as accessible', () => {
    const allResources = manifest.web_accessible_resources.flatMap(e => e.resources || []);
    const hasOffscreen = allResources.some(r => r.includes('offscreen.html'));
    expect(hasOffscreen).toBe(true);
  });

  test('each entry has a matches array', () => {
    for (const entry of manifest.web_accessible_resources) {
      expect(Array.isArray(entry.matches)).toBe(true);
    }
  });
});

// ─── Content Scripts ─────────────────────────────

describe('manifest.json – content_scripts', () => {
  test('content_scripts array is present', () => {
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
  });

  test('content script includes content/content.js', () => {
    const js = manifest.content_scripts.flatMap(cs => cs.js || []);
    expect(js).toContain('content/content.js');
  });
});

// ─── Icons ───────────────────────────────────────

describe('manifest.json – icons', () => {
  test('icons object is defined', () => {
    expect(manifest.icons).toBeDefined();
  });

  test('icon sizes 16, 48, 128 are present', () => {
    expect(manifest.icons['16']).toBeDefined();
    expect(manifest.icons['48']).toBeDefined();
    expect(manifest.icons['128']).toBeDefined();
  });
});
