import re

with open('backend/src/storage/bookmarks.ts', 'r') as f:
    content = f.read()

search = """	// ⚡ Bolt: Execute image ingestion processing in parallel using Promise.all to significantly reduce I/O latency
	await Promise.all(
		uniqueDiscoveredUrls.slice(0, MAX_AUTO_FETCH_IMAGES).map(async (imageUrl) => {
			const absoluteImageUrl = resolveAbsoluteImageUrl(imageUrl, pageUrl);
			if (!absoluteImageUrl || existingSourceUrls.has(absoluteImageUrl)) {
				return;
			}

			try {
				const fetchedImage = await fetchImageAsPayload(absoluteImageUrl, pageUrl);
				if (!fetchedImage?.dataBase64) {
					return;
				}
				const sourceCandidates = buildImageSourceCandidates(imageUrl, pageUrl, absoluteImageUrl);
				hydratedImages.push({
					...fetchedImage,
					sourceCandidates,
				});
				for (const candidate of sourceCandidates) {
					existingSourceUrls.add(candidate);
				}
			} catch {
				// Best-effort image ingestion; bookmark save should still succeed.
			}
		})
	);"""

replace = """	// ⚡ Bolt: Execute image ingestion processing in parallel using Promise.all to significantly reduce I/O latency
	const fetchPromises = uniqueDiscoveredUrls.slice(0, MAX_AUTO_FETCH_IMAGES).map(async (imageUrl) => {
		const absoluteImageUrl = resolveAbsoluteImageUrl(imageUrl, pageUrl);
		if (!absoluteImageUrl || existingSourceUrls.has(absoluteImageUrl)) {
			return null;
		}

		try {
			const fetchedImage = await fetchImageAsPayload(absoluteImageUrl, pageUrl);
			if (!fetchedImage?.dataBase64) {
				return null;
			}
			const sourceCandidates = buildImageSourceCandidates(imageUrl, pageUrl, absoluteImageUrl);
			return {
				...fetchedImage,
				sourceCandidates,
			};
		} catch {
			return null;
		}
	});

	const fetchedResults = await Promise.all(fetchPromises);
	for (const fetchedImage of fetchedResults) {
		if (fetchedImage) {
			hydratedImages.push(fetchedImage);
			for (const candidate of fetchedImage.sourceCandidates) {
				existingSourceUrls.add(candidate);
			}
		}
	}"""

new_content = content.replace(search, replace)
with open('backend/src/storage/bookmarks.ts', 'w') as f:
    f.write(new_content)
