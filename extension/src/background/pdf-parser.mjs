import { VerbosityLevel, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

if (!globalThis.pdfjsWorker) {
  globalThis.pdfjsWorker = pdfjsWorker;
}

const PDF_VIEWER_PARAM_KEYS = ['src', 'file', 'url'];
const PDF_CONTENT_TYPES = new Set(['application/pdf']);
const NO_EXTRACTABLE_TEXT_MARKDOWN = '_No extractable text was found in this PDF. OCR is not currently supported._';

export class PdfExtractionError extends Error {
  constructor(message, code = 'pdf_extract_failed', options = {}) {
    super(message, options);
    this.name = 'PdfExtractionError';
    this.code = code;
  }
}

export function resolvePdfSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return '';
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return parsedUrl.toString();
    }

    for (const paramKey of PDF_VIEWER_PARAM_KEYS) {
      const candidate = parsedUrl.searchParams.get(paramKey);
      if (!candidate) {
        continue;
      }

      try {
        const resolvedUrl = new URL(candidate, parsedUrl).toString();
        const resolvedProtocol = new URL(resolvedUrl).protocol;
        if (resolvedProtocol === 'http:' || resolvedProtocol === 'https:') {
          return resolvedUrl;
        }
      } catch {
        continue;
      }
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function isLikelyPdfUrl(rawUrl) {
  const resolvedUrl = resolvePdfSourceUrl(rawUrl);
  if (!resolvedUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(resolvedUrl);
    const pathname = decodeURIComponent(parsedUrl.pathname).toLowerCase();
    return pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

export function buildPdfMarkdown(pages) {
  const normalizedPages = pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      text: normalizePdfText(page.text),
    }))
    .filter((page) => page.text);

  if (!normalizedPages.length) {
    return NO_EXTRACTABLE_TEXT_MARKDOWN;
  }

  if (normalizedPages.length === 1) {
    return normalizedPages[0].text;
  }

  return normalizedPages
    .map((page) => `## Page ${page.pageNumber}\n\n${page.text}`)
    .join('\n\n');
}

export function derivePdfTitle({ url, fallbackTitle, metadataTitle }) {
  const titleCandidates = [
    sanitizeTitleCandidate(metadataTitle),
    sanitizeTitleCandidate(fallbackTitle),
    sanitizeTitleCandidate(filenameTitleFromUrl(url)),
  ];

  return titleCandidates.find(Boolean) ?? 'Untitled PDF';
}

export function normalizePdfText(rawText) {
  return String(rawText ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function extractPdfBookmark({ fallbackTitle, url, fetchImpl = fetch } = {}) {
  const sourceUrl = resolvePdfSourceUrl(url);
  if (!sourceUrl) {
    throw new PdfExtractionError('Missing PDF URL.', 'pdf_missing_url');
  }

  let response;
  try {
    response = await fetchImpl(sourceUrl, {
      credentials: 'include',
      headers: {
        Accept: 'application/pdf, application/octet-stream;q=0.9, */*;q=0.1',
      },
    });
  } catch (error) {
    throw new PdfExtractionError('Failed to fetch the PDF URL.', 'pdf_fetch_failed', { cause: error });
  }

  if (!response.ok) {
    throw new PdfExtractionError(`Failed to fetch the PDF URL (${response.status}).`, 'pdf_fetch_failed');
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));
  if (contentType && !PDF_CONTENT_TYPES.has(contentType) && contentType !== 'application/octet-stream') {
    throw new PdfExtractionError('The URL did not return a PDF document.', 'not_pdf');
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  if (!PDF_CONTENT_TYPES.has(contentType) && !looksLikePdfBinary(pdfBytes) && !(contentType === 'application/octet-stream' && isLikelyPdfUrl(sourceUrl))) {
    throw new PdfExtractionError('The URL did not return a PDF document.', 'not_pdf');
  }

  const loadingTask = getDocument({
    data: pdfBytes,
    disableFontFace: true,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });

  try {
    const document = await loadingTask.promise;
    const metadata = await loadPdfMetadata(document);
    const pages = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const pageText = extractTextFromPdfItems(textContent.items ?? []);
        if (pageText) {
          pages.push({ pageNumber, text: pageText });
        }
      } finally {
        page.cleanup();
      }
    }

    return {
      title: derivePdfTitle({
        fallbackTitle,
        metadataTitle: metadata.title,
        url: sourceUrl,
      }),
      url: sourceUrl,
      markdownData: buildPdfMarkdown(pages),
    };
  } catch (error) {
    throw new PdfExtractionError('Failed to parse the PDF document.', 'pdf_parse_failed', { cause: error });
  } finally {
    await loadingTask.destroy();
  }
}

function extractTextFromPdfItems(items) {
  const parts = [];

  for (const item of items) {
    const text = normalizePdfText(item?.str ?? '');
    if (text) {
      const previousPart = parts[parts.length - 1] ?? '';
      if (parts.length && previousPart !== '\n' && shouldInsertSpace(previousPart, text)) {
        parts.push(' ');
      }
      parts.push(text);
    }

    if (item?.hasEOL && parts[parts.length - 1] !== '\n') {
      parts.push('\n');
    }
  }

  return normalizePdfText(parts.join(''));
}

async function loadPdfMetadata(document) {
  try {
    const metadata = await document.getMetadata();
    return {
      title: metadata?.info?.Title ?? null,
    };
  } catch {
    return { title: null };
  }
}

function filenameTitleFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const filename = decodeURIComponent(parsedUrl.pathname.split('/').pop() ?? '').trim();
    return filename || null;
  } catch {
    return null;
  }
}

function normalizeContentType(contentType) {
  return String(contentType ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function looksLikePdfBinary(bytes) {
  if (!bytes || bytes.length < 5) {
    return false;
  }

  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function sanitizeTitleCandidate(value) {
  const trimmedValue = String(value ?? '').trim();
  if (!trimmedValue) {
    return null;
  }

  let normalizedValue = trimmedValue.replace(/\s+-\s+[^-]+$/u, (suffix) => (
    /\.pdf$/i.test(trimmedValue.slice(0, -suffix.length)) ? '' : suffix
  ));

  normalizedValue = normalizedValue.replace(/\.pdf$/i, '').trim();
  if (!normalizedValue || /^untitled$/i.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function shouldInsertSpace(previousPart, nextPart) {
  if (!previousPart || !nextPart) {
    return false;
  }

  if (previousPart.endsWith('-')) {
    return false;
  }

  if (/^[,.;:!?)}\]]/.test(nextPart)) {
    return false;
  }

  if (/[([{]$/.test(previousPart)) {
    return false;
  }

  return true;
}
