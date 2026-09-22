/** Relative fetch URLs intentionally resolve against module index.html, not this JS module. */
export async function verifyResources(signal) {
    const response = await fetch('./assets/resource-inventory.json', { signal });
    if (!response.ok)
        throw new Error(`Resource inventory: HTTP ${response.status}`);
    const inventory = await response.json();
    if (inventory.schema !== 1 || !Array.isArray(inventory.files) || inventory.files.length > 100)
        throw new Error('Invalid resource inventory.');
    let verified = 0;
    const hashing = !!globalThis.crypto?.subtle;
    for (const file of inventory.files) {
        if (!/^assets\/vendor\/media\/[A-Za-z0-9._/-]+$/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..'))
            throw new Error('Unsafe resource inventory path.');
        const result = await fetch('./' + file.path, { signal });
        if (!result.ok)
            throw new Error(`${file.path}: HTTP ${result.status}`);
        const bytes = await result.arrayBuffer();
        if (bytes.byteLength !== file.bytes)
            throw new Error(`${file.path}: byte length mismatch`);
        if (hashing) {
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
            if (hex !== file.sha256)
                throw new Error(`${file.path}: SHA-256 mismatch`);
        }
        verified++;
    }
    return `${verified} bundled media files passed ${hashing ? 'byte-length and SHA-256' : 'byte-length (SHA-256 unavailable)'} checks. No BLE operation was performed.`;
}
