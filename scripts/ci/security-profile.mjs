import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {validateConfig,terraformVariables} from './config.mjs';
const guid=n=>`${n}`.repeat(8)+'-'+`${n}`.repeat(4)+'-4'+`${n}`.repeat(3)+'-8'+`${n}`.repeat(3)+'-'+`${n}`.repeat(12);
const c=validateConfig({...JSON.parse(readFileSync('config/dev.json','utf8')),subscription_id:guid(1),tenant_id:guid(2),owner_object_ids:[guid(3)],security_user_ids:[guid(3)],infrastructure_object_id:guid(4),deployment_object_id:guid(5),publisher_object_id:guid(6)});
mkdirSync('work',{recursive:true});writeFileSync('work/security-dev.tfvars.json',JSON.stringify(terraformVariables(c,guid(4))));
