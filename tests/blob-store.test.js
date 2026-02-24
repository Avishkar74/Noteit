/**
 * Snabby – BlobStore Tests
 * Tests the IndexedDB-backed image and metadata storage layer.
 * Uses fake-indexeddb (injected via tests/setup.js) to run IDB in Node.js.
 */

const { IDBFactory } = require('fake-indexeddb');
const BlobStore = require('../extension/lib/blob-store');

// Reset the cached DB connection and provide a fresh IDBFactory before each test
// so tests don't share IndexedDB state.
beforeEach(() => {
  global.indexedDB = new IDBFactory();
  BlobStore._resetDb();
  jest.clearAllMocks();
});

// ─── Utility helpers ────────────────────────────

describe('BlobStore utilities', () => {
  describe('dataUrlToBlob', () => {
    test('converts a PNG data URL to a Blob', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
      const blob = BlobStore.dataUrlToBlob(dataUrl);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBeGreaterThan(0);
    });

    test('converts a JPEG data URL to a Blob', () => {
      // Minimal valid 1×1 white JPEG
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AVMAA/9k=';
      const blob = BlobStore.dataUrlToBlob(dataUrl);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
    });

    test('defaults to image/png for unknown mime type', () => {
      const dataUrl = 'data:;base64,AAAA';
      const blob = BlobStore.dataUrlToBlob(dataUrl);
      expect(blob.type).toBe('image/png');
    });

    test('produces a Blob with correct byte content', async () => {
      // "Hello" in base64
      const dataUrl = 'data:text/plain;base64,SGVsbG8=';
      const blob = BlobStore.dataUrlToBlob(dataUrl);
      const buf = Buffer.from(await blob.arrayBuffer());
      expect(buf.toString()).toBe('Hello');
    });
  });

  describe('blobToDataUrl', () => {
    test('converts a Blob back to a data URL', async () => {
      const original = 'data:image/png;base64,AQID';
      const blob = BlobStore.dataUrlToBlob(original);
      const result = await BlobStore.blobToDataUrl(blob);
      expect(result).toMatch(/^data:image\/png;base64,/);
      // Verify the round-trip preserves content
      expect(result.split(',')[1]).toBe(original.split(',')[1]);
    });

    test('round-trip dataUrl → blob → dataUrl is lossless', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
      const blob = BlobStore.dataUrlToBlob(dataUrl);
      const result = await BlobStore.blobToDataUrl(blob);
      expect(result).toBe(dataUrl);
    });
  });
});

// ─── Image Store (saveImage / getImage) ─────────

describe('BlobStore image operations', () => {
  const testId = 'img-001';

  async function makeBlob(text = 'test-image') {
    return new Blob([text], { type: 'image/png' });
  }

  test('saveImage then getImage returns the stored record', async () => {
    const blob = await makeBlob('pixel');
    const ts = Date.now();
    await BlobStore.saveImage(testId, blob, null, ts);

    const record = await BlobStore.getImage(testId);
    expect(record).not.toBeNull();
    expect(record.id).toBe(testId);
    expect(record.timestamp).toBe(ts);
    expect(record.thumbnail).toBeNull();
  });

  test('saveImage with thumbnail stores thumbnail blob', async () => {
    const blob = await makeBlob('img');
    const thumb = new Blob(['thumb'], { type: 'image/jpeg' });
    await BlobStore.saveImage(testId, blob, thumb, Date.now());

    const record = await BlobStore.getImage(testId);
    expect(record.thumbnail).toBeInstanceOf(Blob);
  });

  test('getImage returns null for missing id', async () => {
    const record = await BlobStore.getImage('nonexistent-id');
    expect(record).toBeNull();
  });

  test('saveImage overwrites existing record', async () => {
    await BlobStore.saveImage(testId, new Blob(['v1']), null, 100);
    await BlobStore.saveImage(testId, new Blob(['v2']), null, 200);

    const record = await BlobStore.getImage(testId);
    expect(record.timestamp).toBe(200);
  });

  test('deleteImage removes the record', async () => {
    await BlobStore.saveImage(testId, new Blob(['img']), null, Date.now());
    await BlobStore.deleteImage(testId);
    const record = await BlobStore.getImage(testId);
    expect(record).toBeNull();
  });

  test('deleteImage is idempotent for missing ids', async () => {
    await expect(BlobStore.deleteImage('ghost-id')).resolves.not.toThrow();
  });
});

// ─── Metadata Store (saveMeta / getMeta) ────────

describe('BlobStore metadata operations', () => {
  test('saveMeta then getMeta round-trip', async () => {
    const id = 'meta-001';
    const meta = {
      ocrText: 'hello world',
      ocrWords: [{ text: 'hello', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }],
      ocrImageWidth: 800,
      ocrImageHeight: 600,
      ocrAttempted: true,
    };

    await BlobStore.saveMeta(id, meta);
    const result = await BlobStore.getMeta(id);

    expect(result.id).toBe(id);
    expect(result.ocrText).toBe('hello world');
    expect(result.ocrWords).toHaveLength(1);
    expect(result.ocrImageWidth).toBe(800);
    expect(result.ocrAttempted).toBe(true);
  });

  test('getMeta returns null for missing id', async () => {
    const result = await BlobStore.getMeta('nonexistent');
    expect(result).toBeNull();
  });

  test('saveMeta overwrites existing metadata', async () => {
    const id = 'meta-002';
    await BlobStore.saveMeta(id, { ocrText: 'v1', ocrAttempted: false });
    await BlobStore.saveMeta(id, { ocrText: 'v2', ocrAttempted: true });

    const result = await BlobStore.getMeta(id);
    expect(result.ocrText).toBe('v2');
    expect(result.ocrAttempted).toBe(true);
  });

  test('deleteImage also removes metadata', async () => {
    const id = 'del-meta-001';
    await BlobStore.saveImage(id, new Blob(['x']), null, Date.now());
    await BlobStore.saveMeta(id, { ocrText: 'text', ocrAttempted: true });

    await BlobStore.deleteImage(id);

    const meta = await BlobStore.getMeta(id);
    expect(meta).toBeNull();
  });
});

// ─── Batch Operations (getImages / getMetaBatch) ─

describe('BlobStore batch operations', () => {
  const ids = ['b1', 'b2', 'b3'];

  beforeEach(async () => {
    for (const id of ids) {
      await BlobStore.saveImage(id, new Blob([id]), null, Date.now());
      await BlobStore.saveMeta(id, { ocrText: `text-${id}`, ocrAttempted: true });
    }
  });

  test('getImages returns all records in order', async () => {
    const results = await BlobStore.getImages(ids);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.id)).toEqual(ids);
  });

  test('getImages returns null for missing ids', async () => {
    const results = await BlobStore.getImages(['b1', 'missing', 'b3']);
    expect(results[0].id).toBe('b1');
    expect(results[1]).toBeNull();
    expect(results[2].id).toBe('b3');
  });

  test('getImages with empty array returns empty array', async () => {
    const results = await BlobStore.getImages([]);
    expect(results).toHaveLength(0);
  });

  test('getMetaBatch returns metadata in order', async () => {
    const results = await BlobStore.getMetaBatch(ids);
    expect(results).toHaveLength(3);
    expect(results[0].ocrText).toBe('text-b1');
    expect(results[2].ocrText).toBe('text-b3');
  });

  test('getMetaBatch returns null for missing ids', async () => {
    const results = await BlobStore.getMetaBatch(['b1', 'ghost']);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull();
  });

  test('getMetaBatch with empty array returns empty array', async () => {
    const results = await BlobStore.getMetaBatch([]);
    expect(results).toHaveLength(0);
  });
});

// ─── clearAll / deleteImages ─────────────────────

describe('BlobStore clearAll and deleteImages', () => {
  beforeEach(async () => {
    await BlobStore.saveImage('c1', new Blob(['c1']), null, Date.now());
    await BlobStore.saveImage('c2', new Blob(['c2']), null, Date.now());
    await BlobStore.saveMeta('c1', { ocrText: 'one', ocrAttempted: true });
    await BlobStore.saveMeta('c2', { ocrText: 'two', ocrAttempted: true });
  });

  test('clearAll removes all images and metadata', async () => {
    await BlobStore.clearAll();
    expect(await BlobStore.getImage('c1')).toBeNull();
    expect(await BlobStore.getImage('c2')).toBeNull();
    expect(await BlobStore.getMeta('c1')).toBeNull();
    expect(await BlobStore.getMeta('c2')).toBeNull();
  });

  test('deleteImages removes selected ids and their metadata', async () => {
    await BlobStore.deleteImages(['c1']);
    expect(await BlobStore.getImage('c1')).toBeNull();
    expect(await BlobStore.getMeta('c1')).toBeNull();
    // c2 should still exist
    expect(await BlobStore.getImage('c2')).not.toBeNull();
    expect(await BlobStore.getMeta('c2')).not.toBeNull();
  });

  test('deleteImages with empty array does nothing', async () => {
    await BlobStore.deleteImages([]);
    expect(await BlobStore.getImage('c1')).not.toBeNull();
  });

  test('deleteImages is idempotent for nonexistent ids', async () => {
    await expect(BlobStore.deleteImages(['ghost1', 'ghost2'])).resolves.not.toThrow();
  });
});

// ─── Concurrent access ───────────────────────────

describe('BlobStore concurrent access', () => {
  test('parallel saves do not corrupt data', async () => {
    const saves = Array.from({ length: 10 }, (_, i) =>
      BlobStore.saveImage(`parallel-${i}`, new Blob([`data-${i}`]), null, i)
    );
    await Promise.all(saves);

    const results = await BlobStore.getImages(
      Array.from({ length: 10 }, (_, i) => `parallel-${i}`)
    );
    expect(results.every(r => r !== null)).toBe(true);
    expect(results.map(r => r.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `parallel-${i}`)
    );
  });
});
