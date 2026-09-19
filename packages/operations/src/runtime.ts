import {
  findRuntimeProfile,
  findRuntimeProfileByFile,
  loadRuntimeManifest,
} from './runtime-manifest.js';

async function main(): Promise<void> {
  const manifestPath = process.env.CHESS_LLAMA_RUNTIME_MANIFEST;
  if (!manifestPath)
    throw new Error('CHESS_LLAMA_RUNTIME_MANIFEST is required');
  const manifest = await loadRuntimeManifest(manifestPath);
  const operation = process.argv[2];
  if (operation === 'manifest') {
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (operation === 'default-profile') {
    process.stdout.write(`${manifest.profiles[0]?.id ?? ''}\n`);
    return;
  }
  if (operation === 'image') {
    process.stdout.write(`${manifest.image}\n`);
    return;
  }
  if (operation === 'profile') {
    const profile = findRuntimeProfile(manifest, process.argv[3] ?? '');
    process.stdout.write(`${JSON.stringify(profile)}\n`);
    return;
  }
  if (operation === 'profile-id-for-file') {
    process.stdout.write(
      `${findRuntimeProfileByFile(manifest, process.argv[3] ?? '')?.id ?? ''}\n`,
    );
    return;
  }
  if (operation === 'profile-field') {
    const profile = findRuntimeProfile(manifest, process.argv[3] ?? '');
    const field = process.argv[4];
    if (
      !field ||
      !['contextSize', 'file', 'id', 'sha256', 'url'].includes(field)
    ) {
      throw new Error(`Unknown profile field: ${field ?? ''}`);
    }
    process.stdout.write(
      `${String(profile[field as 'contextSize' | 'file' | 'id' | 'sha256' | 'url'])}\n`,
    );
    return;
  }
  throw new Error(`Unknown runtime operation: ${operation ?? ''}`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
