#!/usr/bin/env bash
set -euo pipefail
version=1.11.4
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64; expected=1ce994251c00281d6845f0f268637ba50c0005657eb3cf096b92f753b42ef4dc ;;
  Darwin-x86_64) platform=darwin_amd64; expected=a56d5002b9f7647291faccc3dd1a70350e60fb61e4c45037629508b8fdc2575b ;;
  Darwin-arm64) platform=darwin_arm64; expected=867e0808fa971217043e25b7a792b10720c79b1546f8a68479b74f138be73e18 ;;
  *) echo 'Unsupported Terraform build platform' >&2; exit 1 ;;
esac
mkdir -p work/tools
cd work/tools
base="https://releases.hashicorp.com/terraform/$version"
curl --fail --silent --show-error --location "$base/terraform_${version}_${platform}.zip" -o terraform.zip
actual=$(shasum -a 256 terraform.zip | awk '{print $1}')
test -n "$expected" && test "$actual" = "$expected"
unzip -qo terraform.zip
chmod +x terraform
printf '##vso[task.prependpath]%s\n' "$PWD"
./terraform version
