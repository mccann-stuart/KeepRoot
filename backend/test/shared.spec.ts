import { describe, expect, it } from 'vitest';
import { bufferToBase64URL, base64URLToUint8Array, compactObject } from '../src/storage/shared';

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

	describe('compactObject', () => {
		it('handles empty objects', () => {
			expect(compactObject({})).toEqual({});
		});

		it('leaves valid objects unchanged', () => {
			const input = { a: 1, b: 'test', c: true };
			expect(compactObject(input)).toEqual(input);
		});

		it('filters out null, undefined, and empty string', () => {
			const input = {
				a: 1,
				b: null,
				c: undefined,
				d: '',
				e: 'keep',
			};
			expect(compactObject(input)).toEqual({
				a: 1,
				e: 'keep',
			});
		});

		it('preserves falsy values like 0, false, and NaN', () => {
			const input = {
				a: 0,
				b: false,
				c: NaN,
				d: '',
				e: null,
			};
			expect(compactObject(input)).toEqual({
				a: 0,
				b: false,
				c: NaN,
			});
		});
	});
});
