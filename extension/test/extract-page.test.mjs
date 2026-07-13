import { describe, it, expect, vi } from 'vitest';
import { extractPageContent } from '../src/content/extract-page.js';

// Mock Readability and TurndownService
vi.mock('@mozilla/readability', () => {
  return {
    Readability: vi.fn().mockImplementation((doc) => {
      return {
        parse: () => {
          if (doc.type === 'fail') return null;
          if (doc.type === 'missing_title') return { content: '<p>Content</p>' };
          if (doc.type === 'missing_content') return { title: 'Title' };

          return {
            title: 'Mock Title',
            content: '<p>Mock Content</p>'
          };
        }
      };
    })
  };
});

vi.mock('turndown', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        turndown: (html) => {
          if (html === '<p>Mock Content</p>') return 'Mock Markdown Content';
          return 'Other Markdown Content';
        }
      };
    })
  };
});

describe('extractPageContent', () => {
  it('extracts content correctly when parsing succeeds', () => {
    const mockDocument = {
      cloneNode: vi.fn().mockReturnValue({ type: 'success' })
    };

    const result = extractPageContent(mockDocument, 'https://example.com');

    expect(result).toEqual({
      markdownData: 'Mock Markdown Content',
      title: 'Mock Title',
      url: 'https://example.com'
    });
    expect(mockDocument.cloneNode).toHaveBeenCalledWith(true);
  });

  it('throws an error when parsing fails to return an article', () => {
    const mockDocument = {
      cloneNode: vi.fn().mockReturnValue({ type: 'fail' })
    };

    expect(() => extractPageContent(mockDocument, 'https://example.com'))
      .toThrow('Could not parse the main content on this page.');
  });

  it('throws an error when article is missing title', () => {
    const mockDocument = {
      cloneNode: vi.fn().mockReturnValue({ type: 'missing_title' })
    };

    expect(() => extractPageContent(mockDocument, 'https://example.com'))
      .toThrow('Could not parse the main content on this page.');
  });

  it('throws an error when article is missing content', () => {
    const mockDocument = {
      cloneNode: vi.fn().mockReturnValue({ type: 'missing_content' })
    };

    expect(() => extractPageContent(mockDocument, 'https://example.com'))
      .toThrow('Could not parse the main content on this page.');
  });

  it('uses default document and window.location.href if no arguments are provided', () => {
    // Setup global document and window for this test
    const globalDoc = {
      cloneNode: vi.fn().mockReturnValue({ type: 'success' })
    };
    const globalWindow = {
      location: { href: 'https://global.example.com' }
    };

    vi.stubGlobal('document', globalDoc);
    vi.stubGlobal('window', globalWindow);

    const result = extractPageContent();

    expect(result.url).toBe('https://global.example.com');
    expect(globalDoc.cloneNode).toHaveBeenCalledWith(true);

    vi.unstubAllGlobals();
  });
});
