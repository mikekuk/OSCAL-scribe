import { loadConfig } from './config.mjs';

// Validate without signing in or printing identifiers from the protected settings.
try {
  const config = loadConfig(process.argv[2]);
  console.log(`Valid ${config.environment} configuration. No Azure changes made.`);
} catch (error) {
  console.error(`Configuration check failed: ${error.message}`);
  process.exitCode = 1;
}
