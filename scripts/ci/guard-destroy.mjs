import {loadConfig} from './config.mjs';
const c=loadConfig();
if (!c.allow_destroy || c.protect_data || c.environment === 'prod') throw Error('Destroy disabled. Follow docs/deployment.md: backups, reviewed unlock apply, then explicit allow_destroy.');
