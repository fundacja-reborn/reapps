import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  plugins: {
    '@tailwindcss/postcss': {
      base: null,
      content: [
        join(__dirname, './src/**/*.{html,js,svelte,ts}')
      ]
    },
    autoprefixer: {},
  },
};
