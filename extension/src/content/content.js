import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

// KeepRoot Content Script
// This script is injected by the background worker when the user triggers a save

function extractContent() {
  try {
    // 1. Clone the document to avoid modifying the active view
    const documentClone = document.cloneNode(true);
    
    // 2. Parse the article using Readability
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article || !article.title || !article.content) {
      throw new Error('Could not parse the main content on this page.');
    }

    // 3. Convert HTML to Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    
    const markdownData = turndownService.turndown(article.content);
    
    // 4. Return structured response
    return {
      title: article.title,
      url: window.location.href,
      markdownData: markdownData
    };
  } catch (error) {
    console.error('KeepRoot extraction failed:', error);
    return { error: error.message };
  }
}

// Ensure the function is accessible globally in the executing context
window.extractContent = extractContent;
