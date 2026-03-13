import { describe, expect, it } from 'vitest';
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

describe('pdf-parser', () => {
  it('unwraps browser PDF viewer URLs', () => {
    const viewerUrl = 'chrome-extension://viewer/index.html?src=https%3A%2F%2Fexample.com%2Ffiles%2Freport.pdf';
    expect(resolvePdfSourceUrl(viewerUrl)).toBe('https://example.com/files/report.pdf');
    expect(isLikelyPdfUrl(viewerUrl)).toBe(true);
  });

  it('keeps page structure in markdown output', () => {
    expect(buildPdfMarkdown([
      { pageNumber: 1, text: 'First page' },
      { pageNumber: 2, text: 'Second page' },
    ])).toBe('## Page 1\n\nFirst page\n\n## Page 2\n\nSecond page');
  });

  it('derives a clean title', () => {
    expect(derivePdfTitle({
      fallbackTitle: 'q1-results.pdf - Chrome PDF Viewer',
      metadataTitle: '',
      url: 'https://example.com/files/q1-results.pdf',
    })).toBe('q1-results');
  });

  it('extracts text from PDF bytes', async () => {
    const bookmark = await extractPdfBookmark({
      fallbackTitle: 'Sample PDF',
      fetchImpl: async () => createPdfResponse(),
      url: 'https://example.com/files/sample.pdf',
    });

    expect(bookmark.title).toBe('Sample PDF');
    expect(bookmark.url).toBe('https://example.com/files/sample.pdf');
    expect(bookmark.markdownData).toMatch(/Hello PDF/);
  });

  it('rejects non-PDF responses', async () => {
    await expect(extractPdfBookmark({
      fetchImpl: async () => createPdfResponse(SAMPLE_PDF_BASE64, 'text/html'),
      url: 'https://example.com/not-a-pdf',
    })).rejects.toThrow(/did not return a PDF/i);
  });
});
