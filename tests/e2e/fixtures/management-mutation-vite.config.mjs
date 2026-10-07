import productionConfig from '../../../vite.config.ts';
// Preserve production transforms/assets while excluding all developer .env files.
export default { ...productionConfig, envDir: false };
