#!/usr/bin/env bash
set -euo pipefail
version=1.11.4
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64 ;;
  Darwin-x86_64) platform=darwin_amd64 ;;
  Darwin-arm64) platform=darwin_arm64 ;;
  *) echo 'Unsupported Terraform build platform' >&2; exit 1 ;;
esac
mkdir -p work/tools
cd work/tools
base="https://releases.hashicorp.com/terraform/$version"
curl --fail --silent --show-error --location "$base/terraform_${version}_${platform}.zip" -o terraform.zip
curl --fail --silent --show-error --location "$base/terraform_${version}_SHA256SUMS" -o SHA256SUMS
expected=$(awk -v file="terraform_${version}_${platform}.zip" '$2 == file {print $1}' SHA256SUMS)
actual=$(shasum -a 256 terraform.zip | awk '{print $1}')
test -n "$expected" && test "$actual" = "$expected"
unzip -qo terraform.zip
chmod +x terraform
printf '##vso[task.prependpath]%s\n' "$PWD"
./terraform version
