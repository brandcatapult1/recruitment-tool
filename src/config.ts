import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see .env.example / PRD §13.5)`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  // Optional: the candidate-facing base URL for apply links (§13.6 careers
  // subdomain). Until that DNS exists, apply links use APP_BASE_URL.
  careersBaseUrl: process.env.CAREERS_BASE_URL,
  port: Number(process.env.PORT ?? 3000),
  isProduction: process.env.NODE_ENV === 'production',
  // Cloudinary keys are validated where they are used (src/files/cloudinary.ts)
  // so M0 can run before a Cloudinary account is configured.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};
