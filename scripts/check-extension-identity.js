#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function extensionIdFromManifestKey(manifestKey) {
    const publicKeyDer = Buffer.from(manifestKey, 'base64');
    const digest = crypto.createHash('sha256').update(publicKeyDer).digest();
    const first128Bits = digest.subarray(0, 16).toString('hex');
    return first128Bits.replace(/[0-9a-f]/g, char =>
        String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(char, 16))
    );
}

function main() {
    const manifestPath = path.join(root, 'manifest.json');
    const expectedIdPath = path.join(root, 'EXTENSION_ID');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const expectedId = fs.readFileSync(expectedIdPath, 'utf8').trim();

    if (!manifest.key) {
        throw new Error('manifest.json is missing key; Chrome will derive the extension ID from the load path.');
    }

    const actualId = extensionIdFromManifestKey(manifest.key);
    if (actualId !== expectedId) {
        throw new Error(`Extension ID mismatch: manifest key resolves to ${actualId}, expected ${expectedId}.`);
    }

    console.log(`Smart Bookmark extension ID is stable: ${actualId}`);
}

main();
