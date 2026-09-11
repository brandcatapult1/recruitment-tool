import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';

/**
 * Cloudinary helpers per PRD §13.4 / §13.7. Established in M0 so that M2's
 * file upload never touches the app server's filesystem.
 *
 * Rules encoded here:
 * - resource_type: raw, type: authenticated — assets can never be exposed by
 *   a delivery settings change.
 * - Uploads are signed server-side; no unsigned presets exist.
 * - Callers store ONLY the returned public_id in Postgres. Never the URL.
 * - Delivery is exclusively via streamAuthenticatedFile behind a
 *   session-and-role-checked route; the Cloudinary URL never reaches the
 *   browser.
 */

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (PRD §13.5).'
    );
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  configured = true;
}

export interface UploadedFile {
  /** Store this in Postgres. Never store the delivery URL (PRD §13.4). */
  publicId: string;
  bytes: number;
  format?: string;
}

/**
 * Signed server-side upload of a candidate document (resume, portfolio,
 * assignment submission). Accepts a Buffer so nothing is written to the app
 * server's filesystem (§13.1).
 */
export async function uploadCandidateFile(buffer: Buffer, folder: string): Promise<UploadedFile> {
  ensureConfigured();
  return new Promise<UploadedFile>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', type: 'authenticated', folder },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ publicId: result.public_id, bytes: result.bytes, format: result.format });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Generates a short-lived signed URL for server-side fetching only. This URL
 * is used by the backend to stream the file to an authenticated user; it must
 * never be sent to the browser (§13.4 delivery rules).
 */
export function signedFetchUrl(publicId: string, expiresInSeconds = 60): string {
  ensureConfigured();
  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

/**
 * Streams an authenticated Cloudinary asset. Feature modules wrap this in a
 * route that has already verified session and role, e.g.
 * GET /api/files/:application_id/:file_key.
 */
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

/**
 * Deletes assets by public_id. Exists for the §10 candidate-deletion action,
 * which must remove Cloudinary files in the same operation that anonymises
 * the person record. This is the only permitted deletion path for files.
 */
export async function deleteFiles(publicIds: string[]): Promise<void> {
  ensureConfigured();
  if (publicIds.length === 0) return;
  await cloudinary.api.delete_resources(publicIds, {
    resource_type: 'raw',
    type: 'authenticated',
  });
}
