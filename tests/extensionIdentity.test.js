const assert = require('assert');
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

function run() {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const expectedId = fs.readFileSync(path.join(root, 'EXTENSION_ID'), 'utf8').trim();

    assert.ok(manifest.key, 'manifest.json must include a fixed key so Chrome does not derive the extension ID from the load path');
    assert.strictEqual(extensionIdFromManifestKey(manifest.key), expectedId);
    assert.match(expectedId, /^[a-p]{32}$/);

    console.log('extension identity test passed');
}

run();
