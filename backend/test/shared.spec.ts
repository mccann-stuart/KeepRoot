import { describe, expect, it } from 'vitest';
import { bufferToBase64URL, base64URLToUint8Array, normalizeCanonicalUrl } from '../src/storage/shared';

describe('shared storage utilities', () => {
	describe('bufferToBase64URL', () => {
		it('handles empty input', () => {
			expect(bufferToBase64URL(new Uint8Array(0))).toBe('');
		});

		it('converts basic bytes to base64url', () => {
			const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
			expect(bufferToBase64URL(input)).toBe('SGVsbG8');
		});

		it('handles characters requiring URL replacement (+ -> -)', () => {
			// Input [251, 255, 191] -> Base64 "+/+/" -> Base64URL "-_-_"
			const input = new Uint8Array([251, 255, 191]);
			expect(bufferToBase64URL(input)).toBe('-_-_');
		});

		it('removes padding characters (=)', () => {
			const input = new Uint8Array([102]); // "f" -> "Zg=="
			expect(bufferToBase64URL(input)).toBe('Zg');
		});

		it('handles large buffers exceeding chunk size (8192)', () => {
			const size = 10000;
			const input = new Uint8Array(size);
			for (let i = 0; i < size; i++) {
				input[i] = i % 256;
			}
			const result = bufferToBase64URL(input);
			expect(result).toBeDefined();
			expect(result.length).toBeGreaterThan(size * 1.3); // Base64 is ~1.33x the size

			// Round trip check for the large buffer
			const recovered = base64URLToUint8Array(result);
			expect(recovered).toEqual(input);
		});

		it('accepts ArrayBuffer as input', () => {
			const buffer = new ArrayBuffer(5);
			const view = new Uint8Array(buffer);
			view.set([72, 101, 108, 108, 111]);
			expect(bufferToBase64URL(buffer)).toBe('SGVsbG8');
		});
	});

	describe('base64URLToUint8Array', () => {
		it('handles empty string', () => {
			expect(base64URLToUint8Array('')).toEqual(new Uint8Array(0));
		});

		it('converts basic base64url to bytes', () => {
			const input = 'SGVsbG8';
			const expected = new Uint8Array([72, 101, 108, 108, 111]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});

		it('handles URL safe characters (- and _)', () => {
			const input = '-_-_';
			const expected = new Uint8Array([251, 255, 191]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});

		it('re-adds necessary padding', () => {
			const input = 'Zg'; // "f" -> "Zg=="
			const expected = new Uint8Array([102]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});
	});

	describe('Round-trip consistency', () => {
		it('correctly round-trips random data', () => {
			const data = crypto.getRandomValues(new Uint8Array(128));
			const encoded = bufferToBase64URL(data);
			const decoded = base64URLToUint8Array(encoded);
			expect(decoded).toEqual(data);
		});
	});

	describe('normalizeCanonicalUrl', () => {
		it('lowercases protocol and hostname', () => {
			expect(normalizeCanonicalUrl('HTTP://EXAMPLE.COM/path')).toBe('http://example.com/path');
		});

		it('removes hash fragments', () => {
			expect(normalizeCanonicalUrl('https://example.com/path#section-1')).toBe('https://example.com/path');
		});

		it('removes default ports', () => {
			expect(normalizeCanonicalUrl('https://example.com:443/path')).toBe('https://example.com/path');
			expect(normalizeCanonicalUrl('http://example.com:80/path')).toBe('http://example.com/path');
		});

		it('preserves non-default ports', () => {
			expect(normalizeCanonicalUrl('https://example.com:8443/path')).toBe('https://example.com:8443/path');
			expect(normalizeCanonicalUrl('http://example.com:8080/path')).toBe('http://example.com:8080/path');
		});

		it('collapses multiple slashes in pathname', () => {
			expect(normalizeCanonicalUrl('https://example.com//path///to////file')).toBe('https://example.com/path/to/file');
		});

		it('removes trailing slashes from pathname (unless root)', () => {
			expect(normalizeCanonicalUrl('https://example.com/path/')).toBe('https://example.com/path');
			expect(normalizeCanonicalUrl('https://example.com/')).toBe('https://example.com/');
		});

		it('adds root slash if pathname is empty', () => {
			// new URL('https://example.com') already adds '/', but this tests the normalization logic explicitly
			expect(normalizeCanonicalUrl('https://example.com')).toBe('https://example.com/');
		});

		it('removes tracking parameters starting with utm_', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?utm_source=twitter&utm_medium=social&utm_campaign=sale&valid=true')).toBe('https://example.com/path?valid=true');
		});

		it('removes tracking parameters in TRACKING_QUERY_KEYS', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?fbclid=123&gclid=456&mc_cid=789&mc_eid=abc&ref=def&ref_src=ghi&src=jkl&keep=me')).toBe('https://example.com/path?keep=me');
		});

		it('sorts remaining query parameters alphabetically', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?z=1&a=2&c=3&b=4')).toBe('https://example.com/path?a=2&b=4&c=3&z=1');
		});

		it('handles multiple identical query parameters', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?b=2&a=1&b=3')).toBe('https://example.com/path?a=1&b=2&b=3');
		});

		it('throws TypeError on malformed URLs', () => {
			expect(() => normalizeCanonicalUrl('not-a-valid-url')).toThrow(TypeError);
		});
	});
});
