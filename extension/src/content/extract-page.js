import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export function extractPageContent(sourceDocument = document, pageUrl = window.location.href) {
  const documentClone = sourceDocument.cloneNode(true);
  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (!article || !article.title || !article.content) {
    throw new Error('Could not parse the main content on this page.');
  }

  const turndownService = new TurndownService({
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
  });

  return {
    markdownData: turndownService.turndown(article.content),
    title: article.title,
    url: pageUrl,
  };
}
