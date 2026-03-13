import { executeScript } from '../shared/webextension-api.js';
import { PdfExtractionError, extractPdfBookmark, isLikelyPdfUrl, resolvePdfSourceUrl } from './pdf-parser.mjs';

export async function extractHtmlBookmark(tabId, executeScriptImpl = executeScript) {
  let executionResults;

  try {
    await executeScriptImpl({
      files: ['dist/content.js'],
      target: { tabId },
    });

    executionResults = await executeScriptImpl({
      func: () => {
        if (typeof globalThis.extractContent !== 'function') {
          return { error: 'Content extractor failed to initialize.' };
        }

        return globalThis.extractContent();
      },
      target: { tabId },
    });
  } catch (error) {
    if (/Cannot access|Missing host permission|The extensions gallery cannot be scripted/i.test(error.message)) {
      throw new Error('This page cannot be saved because the browser blocks extensions on it.');
    }

    throw error;
  }

  const extraction = executionResults[0]?.result;
  if (!extraction) {
    throw new Error('Content extraction returned no result.');
  }

  if (extraction.error) {
    throw new Error(`Extraction failed: ${extraction.error}`);
  }

  return extraction;
}

export async function extractBookmarkFromTab(tabId, tab, dependencies = {}) {
  const extractHtmlBookmarkImpl = dependencies.extractHtmlBookmarkImpl ?? extractHtmlBookmark;
  const extractPdfBookmarkImpl = dependencies.extractPdfBookmarkImpl ?? extractPdfBookmark;

  const tabUrl = resolvePdfSourceUrl(tab?.url || '');
  const likelyPdf = isLikelyPdfUrl(tab?.url || '');
  const canAttemptPdfExtraction = /^https?:/i.test(tabUrl);

  if (likelyPdf) {
    return extractPdfBookmarkImpl({
      fallbackTitle: tab?.title,
      url: tabUrl,
    });
  }

  try {
    return await extractHtmlBookmarkImpl(tabId);
  } catch (htmlError) {
    if (!canAttemptPdfExtraction) {
      throw htmlError;
    }

    try {
      return await extractPdfBookmarkImpl({
        fallbackTitle: tab?.title,
        url: tabUrl,
      });
    } catch (pdfError) {
      if (
        pdfError instanceof PdfExtractionError &&
        !likelyPdf &&
        (pdfError.code === 'not_pdf' || pdfError.code === 'pdf_fetch_failed')
      ) {
        throw htmlError;
      }

      throw pdfError;
    }
  }
}
