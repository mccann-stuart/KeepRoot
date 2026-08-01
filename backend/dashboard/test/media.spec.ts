import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepRootApi } from '../src/lib/api';
import { loadProtectedMedia } from '../src/lib/media';

describe('protected dashboard media', () => {
	const imagePath = `/images/${'a'.repeat(64)}`;
	const fetchSpy = vi.fn();
	const createObjectUrl = vi.fn().mockReturnValue('blob:protected-image');

	beforeEach(() => {
		fetchSpy.mockReset();
		createObjectUrl.mockClear();
		vi.stubGlobal('fetch', fetchSpy);
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: createObjectUrl,
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: vi.fn(),
		});
	});

	it('loads same-origin stored images through an authenticated blob request', async () => {
		fetchSpy.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
			headers: { 'Content-Type': 'image/png' },
		}));
		const container = document.createElement('div');
		container.innerHTML = `<img src="${imagePath}" alt="Private image">`;
		const fragment = document.createDocumentFragment();
		fragment.append(...container.childNodes);

		await loadProtectedMedia(fragment, new KeepRootApi(() => 'session-secret'));

		expect(fetchSpy).toHaveBeenCalledWith(imagePath, {
			headers: { Authorization: 'Bearer session-secret' },
		});
		expect(createObjectUrl).toHaveBeenCalledTimes(1);
		expect(fragment.querySelector('img')?.src).toBe('blob:protected-image');
	});

	it('leaves external images untouched', async () => {
		const container = document.createElement('div');
		container.innerHTML = '<img src="https://cdn.example.com/image.png" alt="External image">';
		const fragment = document.createDocumentFragment();
		fragment.append(...container.childNodes);

		await loadProtectedMedia(fragment, new KeepRootApi(() => 'session-secret'));

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(fragment.querySelector('img')?.src).toBe('https://cdn.example.com/image.png');
	});
});
