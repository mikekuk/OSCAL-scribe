import {loadConfig, assertIdentity} from './config.mjs';
assertIdentity(loadConfig(), process.argv[2]);
