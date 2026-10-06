import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
export function assertPlanVariables(plan, expected) {
  for (const [key,value] of Object.entries(expected)) {
    const actual = plan.variables?.[key]?.value;
    const normalized = v => Array.isArray(v) ? [...v].sort() : v;
    if (!isDeepStrictEqual(normalized(actual), normalized(value))) throw Error(`Saved plan configuration changed: ${key}; re-plan and review`);
  }
}
if (process.argv[1]?.endsWith('assert-plan.mjs')) {
  const plan=JSON.parse(execFileSync('terraform',['-chdir=infrastructure','show','-json',process.argv[2]],{encoding:'utf8',maxBuffer:50_000_000}));
  assertPlanVariables(plan,JSON.parse(readFileSync('work/ci/deployment.tfvars.json','utf8')));
}
