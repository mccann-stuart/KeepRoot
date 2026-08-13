import { describe, it, expect, vi } from 'vitest';
import * as extractUrlModule from '../../src/ingest/extract-url';

const extractBookmarkPayloadFromUrl = extractUrlModule.extractBookmarkPayloadFromUrl;

describe('extractBookmarkPayloadFromUrl', () => {
    it('throws error if URL is unsafe', async () => {
        await expect(extractBookmarkPayloadFromUrl({ url: 'javascript:alert(1)' })).rejects.toThrow('Unsafe initial URL');
    });

    it('fetches basic HTML and extracts bookmark payload', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            url: 'https://example.com/test',
            headers: new Headers({
                'content-type': 'text/html; charset=utf-8'
            }),
            text: async () => '<html><head><title>Test Title</title></head><body><p>This is a test article.</p></body></html>',
        } as unknown as Response);

        const result = await extractBookmarkPayloadFromUrl({
            url: 'https://example.com/test',
            fetchImpl: mockFetch as any
        });

        expect(mockFetch).toHaveBeenCalledWith('https://example.com/test', expect.anything());
        expect(result.title).toBe('Test Title');
        expect(result.textContent).toContain('This is a test article.');
    });

	it('uses Browser Run when the static response looks like a JavaScript shell', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/app',
			headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
			text: async () => '<html><head><title>Loading</title></head><body><div id="root">Loading</div><script type="module" src="/app.js"></script></body></html>',
		} as unknown as Response);
		const quickAction = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			meta: { status: 200, title: 'Rendered Article' },
			result: '<html lang="en"><head><title>Rendered Article</title><meta property="og:site_name" content="Example News"></head><body><main><h1>Rendered Article</h1><p>This article appeared after the application JavaScript ran in the browser.</p></main></body></html>',
			success: true,
		}), {
			headers: {
				'content-type': 'application/json',
				'x-browser-ms-used': '1250',
			},
			status: 200,
		}));
		const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			fetchImpl: mockFetch as typeof fetch,
			url: 'https://example.com/app',
		});

		expect(quickAction).toHaveBeenCalledWith('content', expect.objectContaining({
			url: 'https://example.com/app',
		}));
		expect(result.title).toBe('Rendered Article');
		expect(result.siteName).toBe('Example News');
		expect(result.textContent).toContain('application JavaScript ran');
		expect(result.browserExtraction).toEqual({
			browserMsUsed: 1250,
			engine: 'chromium',
			method: 'browser',
			reason: 'js_shell',
			screenshotCaptured: false,
			status: 'succeeded',
		});
		expect(consoleInfoSpy).toHaveBeenCalled();
	});

	it('selects Kitesurf through the Browser Run REST transport when configured', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/app',
			headers: new Headers({ 'content-type': 'text/html' }),
			text: async () => '<html><body><div id="root">Loading</div><script type="module" src="/app.js"></script></body></html>',
		} as unknown as Response);
		const browserFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			meta: { status: 200, title: 'Kitesurf Article' },
			result: '<html><head><title>Kitesurf Article</title></head><body><p>Rendered by the Kitesurf beta engine.</p></body></html>',
			success: true,
		}), { status: 200 }));
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browserFetchImpl: browserFetch as typeof fetch,
			browserRunAccountId: 'a'.repeat(32),
			browserRunApiToken: 'test-browser-token',
			browserRunEngine: 'kitesurf',
			fetchImpl: mockFetch as typeof fetch,
			url: 'https://example.com/app',
		});

		expect(browserFetch).toHaveBeenCalledWith(
			`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/browser-rendering/content?browser=kitesurf`,
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-browser-token' }),
				method: 'POST',
			}),
		);
		expect(result.textContent).toContain('Kitesurf beta engine');
		expect(result.browserExtraction).toEqual(expect.objectContaining({
			engine: 'kitesurf',
			method: 'browser',
			status: 'succeeded',
		}));
	});

	it('captures a viewport screenshot through the snapshot action', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/article',
			headers: new Headers({ 'content-type': 'text/html' }),
			text: async () => '<html><head><title>Static Article</title></head><body><p>Static content.</p></body></html>',
		} as unknown as Response);
		const quickAction = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			meta: { status: 200, title: 'Rendered Article' },
			result: {
				content: '<html><head><title>Rendered Article</title></head><body><p>Rendered content.</p></body></html>',
				screenshot: 'data:image/png;base64,c2NyZWVuc2hvdA==',
			},
			success: true,
		}), { status: 200 }));
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			captureScreenshot: true,
			fetchImpl: mockFetch as typeof fetch,
			url: 'https://example.com/article',
		});

		expect(quickAction).toHaveBeenCalledWith('snapshot', expect.objectContaining({
			screenshotOptions: expect.objectContaining({ fullPage: false, type: 'png' }),
			url: 'https://example.com/article',
		}));
		expect(result.images).toEqual([{
			contentType: 'image/png',
			dataBase64: 'c2NyZWVuc2hvdA==',
			variant: 'screenshot',
		}]);
		expect(result.browserExtraction?.screenshotCaptured).toBe(true);
	});

	it('falls back to the static extraction when Browser Run fails', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/article',
			headers: new Headers({ 'content-type': 'text/html' }),
			text: async () => '<html><head><title>Static Article</title></head><body><p>Static fallback content.</p></body></html>',
		} as unknown as Response);
		const quickAction = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			errors: [{ message: 'Browser capacity exhausted' }],
			success: false,
		}), { status: 503 }));
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			fetchImpl: mockFetch as typeof fetch,
			render: true,
			url: 'https://example.com/article',
		});

		expect(result.title).toBe('Static Article');
		expect(result.textContent).toContain('Static fallback content.');
		expect(result.browserExtraction).toEqual({
			engine: 'chromium',
			method: 'static',
			reason: 'explicit',
			screenshotCaptured: false,
			status: 'failed',
		});
	});

	it('can recover a forced render when the static fetch is rejected', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			url: 'https://example.com/protected',
			headers: new Headers({ 'content-type': 'text/html' }),
		} as unknown as Response);
		const quickAction = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			meta: { status: 200, title: 'Rendered Access' },
			result: '<html><head><title>Rendered Access</title></head><body><p>The browser-rendered page was available.</p></body></html>',
			success: true,
		}), { status: 200 }));
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			fetchImpl: mockFetch as typeof fetch,
			render: true,
			url: 'https://example.com/protected',
		});

		expect(result.title).toBe('Rendered Access');
		expect(result.textContent).toContain('browser-rendered page was available');
		expect(result.browserExtraction).toEqual(expect.objectContaining({
			method: 'browser',
			reason: 'explicit',
			status: 'succeeded',
		}));
	});

	it('preserves plain-text extraction while adding a screenshot', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/readme.txt',
			headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
			text: async () => 'Original plain text content',
		} as unknown as Response);
		const quickAction = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			meta: { status: 200, title: 'readme.txt' },
			result: {
				content: '<html><body><pre>Original plain text content</pre></body></html>',
				screenshot: 'cGxhaW4tdGV4dC1zY3JlZW5zaG90',
			},
			success: true,
		}), { status: 200 }));
		vi.spyOn(console, 'info').mockImplementation(() => {});

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			captureScreenshot: true,
			fetchImpl: mockFetch as typeof fetch,
			url: 'https://example.com/readme.txt',
		});

		expect(result.textContent).toBe('Original plain text content');
		expect(result.markdownData).toBe('Original plain text content');
		expect(result.images?.[0]).toEqual(expect.objectContaining({
			dataBase64: 'cGxhaW4tdGV4dC1zY3JlZW5zaG90',
			variant: 'screenshot',
		}));
	});

	it('lets callers disable the automatic browser heuristic', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			url: 'https://example.com/app',
			headers: new Headers({ 'content-type': 'text/html' }),
			text: async () => '<html><body><div id="root">Loading</div><script type="module" src="/app.js"></script></body></html>',
		} as unknown as Response);
		const quickAction = vi.fn();

		const result = await extractBookmarkPayloadFromUrl({
			browser: { quickAction } as unknown as BrowserRun,
			fetchImpl: mockFetch as typeof fetch,
			render: false,
			url: 'https://example.com/app',
		});

		expect(quickAction).not.toHaveBeenCalled();
		expect(result.browserExtraction).toBeUndefined();
	});

    it('handles redirects', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async (url) => {
            callCount++;
            if (callCount === 1) {
                return {
                    status: 301,
                    headers: new Headers({
                        'location': 'https://example.com/redirected'
                    }),
                    body: { cancel: vi.fn().mockResolvedValue(undefined) }
                } as unknown as Response;
            }
            return {
                ok: true,
                status: 200,
                url: 'https://example.com/redirected',
                headers: new Headers({
                    'content-type': 'text/html; charset=utf-8'
                }),
                text: async () => '<html><head><title>Redirected Title</title></head><body><p>Redirected article.</p></body></html>',
            } as unknown as Response;
        });

        const result = await extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        });

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://example.com/initial', expect.anything());
        expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/redirected', expect.anything());
        expect(result.title).toBe('Redirected Title');
    });

    it('stops after 5 redirects (too many redirects)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 302,
            headers: new Headers({
                'location': 'https://example.com/loop'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Failed to fetch URL (302)');

        expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('throws error if redirect location is missing', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers(),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Redirect missing location header');
    });

    it('throws error if redirect URL is invalid', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'http://[invalid-url'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Invalid redirect location URL');
    });

    it('throws error if redirect URL is unsafe', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            status: 301,
            headers: new Headers({
                'location': 'javascript:alert(1)'
            }),
            body: { cancel: vi.fn().mockResolvedValue(undefined) }
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/initial',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Unsafe redirect URL');
    });

    it('throws error on non-ok response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
        } as unknown as Response);

        await expect(extractBookmarkPayloadFromUrl({
            url: 'https://example.com/not-found',
            fetchImpl: mockFetch as any
        })).rejects.toThrow('Failed to fetch URL (404)');
    });
});
