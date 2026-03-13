import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfMarkdown, derivePdfTitle, extractPdfBookmark, isLikelyPdfUrl, resolvePdfSourceUrl } from '../src/background/pdf-parser.mjs';

const SAMPLE_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDEgPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgo3MiA3MjAgVGQKKEhlbGxvIFBERikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwMQolJUVPRgo=';

function createPdfResponse(base64 = SAMPLE_PDF_BASE64, contentType = 'application/pdf') {
  const bytes = Buffer.from(base64, 'base64');
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType,
    },
  });
}

test('resolvePdfSourceUrl unwraps browser PDF viewer URLs', () => {
  const viewerUrl = 'chrome-extension://viewer/index.html?src=https%3A%2F%2Fexample.com%2Ffiles%2Freport.pdf';
  assert.equal(resolvePdfSourceUrl(viewerUrl), 'https://example.com/files/report.pdf');
  assert.equal(isLikelyPdfUrl(viewerUrl), true);
});

test('buildPdfMarkdown keeps page structure', () => {
  const markdown = buildPdfMarkdown([
    { pageNumber: 1, text: 'First page' },
    { pageNumber: 2, text: 'Second page' },
  ]);

  assert.equal(markdown, '## Page 1\n\nFirst page\n\n## Page 2\n\nSecond page');
});

test('derivePdfTitle prefers clean metadata and strips viewer noise', () => {
  const title = derivePdfTitle({
    url: 'https://example.com/files/q1-results.pdf',
    fallbackTitle: 'q1-results.pdf - Chrome PDF Viewer',
    metadataTitle: '',
  });

  assert.equal(title, 'q1-results');
});

test('extractPdfBookmark parses text from a PDF response', async () => {
  const bookmark = await extractPdfBookmark({
    fallbackTitle: 'Sample PDF',
    url: 'https://example.com/files/sample.pdf',
    fetchImpl: async () => createPdfResponse(),
  });

  assert.equal(bookmark.url, 'https://example.com/files/sample.pdf');
  assert.equal(bookmark.title, 'Sample PDF');
  assert.match(bookmark.markdownData, /Hello PDF/);
});

test('extractPdfBookmark accepts PDF bytes served as octet-stream', async () => {
  const bookmark = await extractPdfBookmark({
    fallbackTitle: 'Binary Download',
    url: 'https://example.com/download?id=123',
    fetchImpl: async () => createPdfResponse(SAMPLE_PDF_BASE64, 'application/octet-stream'),
  });

  assert.equal(bookmark.title, 'Binary Download');
  assert.match(bookmark.markdownData, /Hello PDF/);
});

test('extractPdfBookmark rejects non-PDF responses', async () => {
  await assert.rejects(
    () => extractPdfBookmark({
      url: 'https://example.com/files/not-a-pdf',
      fetchImpl: async () => createPdfResponse(SAMPLE_PDF_BASE64, 'text/html'),
    }),
    /did not return a PDF/i,
  );
});
