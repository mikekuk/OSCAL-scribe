# Pinned reference content

`reference.json` records exact upstream URLs, commit and SHA-256 hashes for public NIST catalogue/profile sources.
The download/build code is in this repository. The demo and reference preparation scripts share `scripts/reference-content.ts`, which verifies downloads against these committed hashes. Valid cached files are verified again and reused; altered files are downloaded again. Profile resolution still runs during content build.
Nothing is published automatically. See [content publication](../docs/content.md) for approval and deployment steps.
