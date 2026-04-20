// Load environment variables from root .env file
import { config } from 'dotenv';
import { resolve } from 'path';

// Load from root .env file
config({ path: resolve(__dirname, '../../../.env') });

// Re-export for use in this package
export const DATABASE_URL = process.env.DATABASE_URL;
