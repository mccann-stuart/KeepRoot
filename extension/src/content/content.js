import { extractPageContent } from './extract-page.js';

function extractContent() {
  try {
    return extractPageContent(document, window.location.href);
  } catch (error) {
    console.error('KeepRoot extraction failed:', error);
    return { error: error.message };
  }
}

globalThis.extractContent = extractContent;
