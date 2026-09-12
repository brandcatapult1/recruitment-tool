import { randomUUID } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';

let configured = false;

export function isCloudinaryConfigured(): boolean {
  const { cloudName, apiKey, apiSecret, folder } = config.cloudinary;
  return Boolean(cloudName && apiKey && apiSecret && folder);
}

function ensureConfigured(): void {
  if (configured) return;
  const { cloudName, apiKey, apiSecret, folder } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (PRD §13.5).'
    );
  }
  if (!folder) {
    throw new Error('CLOUDINARY_FOLDER is not set (e.g. dev/hr-pulse). See PRD §13.4.');
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  configured = true;
}

export interface UploadedFile {
  publicId: string;
  originalFilename: string;
  bytes: number;
  format?: string;
}

/**
 * Signed server-side upload. The file is renamed to a system id; the original
 * filename is returned for display only. Folder comes from CLOUDINARY_FOLDER.
 */
export async function uploadCandidateFile(buffer: Buffer, originalFilename: string): Promise<UploadedFile> {
  ensureConfigured();
  const folder = config.cloudinary.folder as string;
  const publicId = randomUUID();
  return new Promise<UploadedFile>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', type: 'authenticated', folder, public_id: publicId },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({
          publicId: result.public_id,
          originalFilename,
          bytes: result.bytes,
          format: result.format,
        });
      }
    );
    stream.end(buffer);
  });
}

export function signedFetchUrl(publicId: string, expiresInSeconds = 60): string {
  ensureConfigured();
  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

export async function streamAuthenticatedFile(publicId: string): Promise<{
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: string | null;
}> {
  const url = signedFetchUrl(publicId);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Cloudinary fetch failed for ${publicId}: HTTP ${response.status}`);
  }
  return {
    body: response.body,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
  };
}

export async function deleteFiles(publicIds: string[]): Promise<void> {
  ensureConfigured();
  if (publicIds.length === 0) return;
  await cloudinary.api.delete_resources(publicIds, {
    resource_type: 'raw',
    type: 'authenticated',
  });
}
