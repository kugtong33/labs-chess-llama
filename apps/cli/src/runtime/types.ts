import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const runtimeProfileSchema = z
  .object({
    id: z.string().min(1),
    repository: z.string().min(1),
    file: z.string().min(1),
    quantization: z.string().min(1),
    contextSize: z.number().int().positive(),
    experimental: z.boolean().optional(),
    url: z.url(),
    sha256: sha256Schema,
    source: z
      .object({
        repository: z.string().min(1),
        revision: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const runtimeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    image: z
      .string()
      .regex(/^ghcr\.io\/ggml-org\/llama\.cpp@sha256:[a-f0-9]{64}$/u),
    source: z.object({ image: z.string().min(1) }).strict(),
    profiles: z.array(runtimeProfileSchema).min(1),
  })
  .strict();

export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerAdapter {
  compose(
    args: readonly string[],
    env: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<DockerResult>;
}

export type HealthFetcher = typeof fetch;
