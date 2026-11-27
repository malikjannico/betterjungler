import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function encodeU32BE(n) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

function encodeLengthPrefixedUtf8(str) {
  const bytes = Buffer.from(String(str), 'utf8');
  return Buffer.concat([encodeU32BE(bytes.length), bytes]);
}

/**
 * Unambiguous domain-separated, length-prefixed canonical signing bytes matching
 * `src-tauri/src/patch_pack.rs::canonical_signing_bytes`:
 * "betterjungler-pack-v1\0" || u32be(schemaVersion) || len(kind) || len(patch) || len(issuedAt) || len(payloadJson)
 */
export function buildCanonicalSigningBytes(envelope) {
  return Buffer.concat([
    Buffer.from('betterjungler-pack-v1\0', 'utf8'),
    encodeU32BE(envelope.schemaVersion),
    encodeLengthPrefixedUtf8(envelope.kind),
    encodeLengthPrefixedUtf8(envelope.patch),
    encodeLengthPrefixedUtf8(envelope.issuedAt),
    encodeLengthPrefixedUtf8(envelope.payloadJson),
  ]);
}

export function extractRawEd25519PublicKeyB64(publicKey) {
  // SubjectPublicKeyInfo (SPKI) DER for Ed25519 is fixed 44 bytes: 12-byte ASN.1 prefix + 32-byte raw key
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPubKey = spkiDer.subarray(spkiDer.length - 32);
  if (rawPubKey.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 public key, got ${rawPubKey.length}`);
  }
  return rawPubKey.toString('base64');
}

export function signPackPayload({ kind, patch, issuedAt, payload, privateKey }) {
  const payloadJson = JSON.stringify(payload);
  const unsigned = {
    schemaVersion: 1,
    kind,
    patch,
    issuedAt,
    payloadJson,
  };
  const message = buildCanonicalSigningBytes(unsigned);
  const signatureB64 = crypto.sign(null, message, privateKey).toString('base64');
  return {
    ...unsigned,
    signatureB64,
  };
}

const DEFAULT_KNOWLEDGE_PAYLOAD = {
  objectiveTimings: {
    scuttleInitialSec: 210,
    dragonFirstSpawnSec: 300,
    dragonRespawnSec: 300,
    elderRespawnSec: 360,
    voidgrubsSpawnSec: 360,
    heraldSpawnSec: 840,
    heraldDespawnSec: 1485,
    atakhanSpawnSec: 1200,
    baronSpawnSec: 1500,
    baronRespawnSec: 360,
  },
  smiteThresholds: {
    baseDamage: 600,
    unleashedDamage: 900,
    primalDamage: 1200,
    unleashedStacks: 20,
    primalStacks: 40,
  },
  metaTierOverrides: [
    { championId: 234, championName: 'Viego', metaTier: 'S+', metaScore: 95.4 },
    { championId: 64, championName: 'Lee Sin', metaTier: 'S', metaScore: 92.8 },
    { championId: 121, championName: "Kha'Zix", metaTier: 'S', metaScore: 91.5 },
    { championId: 62, championName: 'Wukong', metaTier: 'S', metaScore: 90.9 },
  ],
};

const DEFAULT_META_PAYLOAD = {
  patch: '16.23.1',
  region: 'GLOBAL',
  sampleMatches: 2500,
  updatedAt: '2026-11-27T00:00:00Z',
  topJunglers: [
    { championId: 234, championName: 'Viego', winRate: 52.1, pickRate: 14.3, tier: 'S+' },
    { championId: 64, championName: 'Lee Sin', winRate: 51.2, pickRate: 16.8, tier: 'S' },
    { championId: 121, championName: "Kha'Zix", winRate: 51.8, pickRate: 10.4, tier: 'S' },
    { championId: 62, championName: 'Wukong', winRate: 51.6, pickRate: 8.7, tier: 'S' },
  ],
};

function main() {
  const args = new Set(process.argv.slice(2));
  const pemFromEnv = process.env.BETTERJUNGLER_PACK_SIGNING_KEY?.trim();
  const keyFileArg = process.argv.find((a) => a.startsWith('--key-file='))?.slice('--key-file='.length);
  const outKeyFileArg = process.argv.find((a) => a.startsWith('--write-key-outside-repo='))?.slice('--write-key-outside-repo='.length);

  if (args.has('--write') && !pemFromEnv && !keyFileArg && !args.has('--rotate-pinned-key')) {
    console.error(
      'Refusing --write without BETTERJUNGLER_PACK_SIGNING_KEY or --key-file=<path> (or explicit --rotate-pinned-key) to avoid silently breaking the pinned key in src-tauri/src/patch_pack.rs.'
    );
    process.exit(1);
  }

  let privateKey;
  let publicKey;
  if (pemFromEnv) {
    privateKey = crypto.createPrivateKey(pemFromEnv);
    publicKey = crypto.createPublicKey(privateKey);
  } else if (keyFileArg) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(keyFileArg, 'utf8'));
    publicKey = crypto.createPublicKey(privateKey);
  } else if (args.has('--generate-keypair') || args.has('--rotate-pinned-key')) {
    const pair = crypto.generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    if (outKeyFileArg) {
      const resolvedOut = path.resolve(outKeyFileArg);
      const repoRoot = path.resolve(process.cwd());
      if (resolvedOut.toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)) {
        console.error('Refusing to write private signing key inside the repository.');
        process.exit(1);
      }
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.writeFileSync(
        resolvedOut,
        privateKey.export({ type: 'pkcs8', format: 'pem' }),
        { encoding: 'utf8', mode: 0o600 }
      );
      console.log(`Saved private PKCS#8 key outside repo at: ${resolvedOut}`);
    }
  } else {
    console.error(
      'Usage: set BETTERJUNGLER_PACK_SIGNING_KEY (or --key-file=<outside-path>) with --write, or run --generate-keypair --write-key-outside-repo=<path>'
    );
    process.exit(1);
  }

  const patch = '16.23.1';
  const issuedAt = '2026-11-27T00:00:00Z';
  const publicKeyB64 = extractRawEd25519PublicKeyB64(publicKey);

  const knowledgeEnv = signPackPayload({
    kind: 'knowledge',
    patch,
    issuedAt,
    payload: DEFAULT_KNOWLEDGE_PAYLOAD,
    privateKey,
  });
  const metaEnv = signPackPayload({
    kind: 'meta',
    patch,
    issuedAt,
    payload: DEFAULT_META_PAYLOAD,
    privateKey,
  });

  if (args.has('--write')) {
    const outDir = path.resolve(process.cwd(), 'knowledge');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `${patch}.json`),
      `${JSON.stringify(knowledgeEnv, null, 2)}\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(outDir, `meta-${patch}.json`),
      `${JSON.stringify(metaEnv, null, 2)}\n`,
      'utf8'
    );
    console.log(`Signed knowledge/${patch}.json and knowledge/meta-${patch}.json`);
  }

  console.log(`BETTERJUNGLER_PACK_PUBLIC_KEY_B64=${publicKeyB64}`);
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  main();
}
