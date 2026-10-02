#!/usr/bin/env bash
set -euo pipefail
mkdir -p work/oscal-cli
curl --fail --location --retry 3 'https://repo.maven.apache.org/maven2/dev/metaschema/oscal/oscal-cli-enhanced/3.2.0/oscal-cli-enhanced-3.2.0-oscal-cli.zip' -o work/oscal-cli.zip
node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';if(createHash('sha256').update(readFileSync('work/oscal-cli.zip')).digest('hex')!=='e001b353ee245da6f4ff0ad930c4dfaa88083c63243ca004bd5f5bcef44e8ec8')throw Error('OSCAL CLI checksum mismatch');"
unzip -qo work/oscal-cli.zip -d work/oscal-cli
chmod +x work/oscal-cli/bin/oscal-cli
