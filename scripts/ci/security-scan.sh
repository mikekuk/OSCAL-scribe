#!/usr/bin/env bash
# Pinned official Trivy release; no install script fetched and executed from the network.
set -euo pipefail
version=0.75.0
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=Linux-64bit; checksum=c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f ;;
  Darwin-x86_64) platform=macOS-64bit; checksum=291edaa9778acbe4693d067b5ad60ee11570e5ac68296e85595417528ca641e4 ;;
  Darwin-arm64) platform=macOS-ARM64; checksum=4a77108cccf8e55c8d6823e1e759939a622277e66cd0daa3c1fc621ed69e4568 ;;
  *) echo 'Unsupported scanner platform' >&2; exit 1 ;;
esac
mkdir -p work/security-tools
archive="work/security-tools/trivy_${version}_${platform}.tar.gz"
if [ ! -f "$archive" ]; then
  curl --fail --silent --show-error --location --retry 3 "https://github.com/aquasecurity/trivy/releases/download/v${version}/trivy_${version}_${platform}.tar.gz" -o "$archive"
fi
actual=$(shasum -a 256 "$archive" | awk '{print $1}')
test "$actual" = "$checksum"
tar -xzf "$archive" -C work/security-tools trivy
# Secret scan covers all tracked-source locations. IaC scan evaluates the hardened dev profile.
work/security-tools/trivy fs --cache-dir work/trivy-cache --scanners secret --severity HIGH,CRITICAL --exit-code 1 --skip-dirs node_modules --skip-dirs work --skip-dirs .git --skip-dirs infrastructure/.terraform .
node scripts/ci/security-profile.mjs
work/security-tools/trivy config --ignorefile infrastructure/.trivyignore.yaml --skip-check-update --cache-dir work/trivy-cache --tf-vars work/security-dev.tfvars.json --severity HIGH,CRITICAL --exit-code 1 --skip-dirs .terraform infrastructure
