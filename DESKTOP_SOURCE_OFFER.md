# Desktop corresponding-source offer

The `desktop-v1.0.0` GitHub release publishes each platform's component archives together with a matching corresponding-source archive at no charge. The source assets are posted beside the binaries on the same release page, with direct instructions in the release notes and a file manifest in each archive:

- [Linux x64 source archive](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v1.0.0/omni-desktop-linux-x64-corresponding-sources.tar)
- [Windows x64 source archive](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v1.0.0/omni-desktop-win32-x64-corresponding-sources.tar)
- [macOS arm64 source archive](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v1.0.0/omni-desktop-darwin-arm64-corresponding-sources.tar)

Each source archive contains the exact source version/revision for Ghostscript, FFmpeg, Poppler, Calibre, and Pandoc distributed on that platform, package/build provenance, license records, and Omni's relocation and packaging scripts. Linux and macOS bundles also include copyleft dependency sources identified from the staged component provenance. Ubuntu source packages are collected at their installed source versions from signed `deb-src` indexes; macOS source archives use the matching Homebrew formula version and a published SHA-256 or exact Git commit; the Windows archive includes immutable upstream source revisions, the FFmpeg vendor release reference and exact build configuration, and the Poppler packaging recipe and patches. `SOURCE_MANIFEST.json` records source URLs/revisions and checksums for every included file.

The source archives are hosted beside the matching component binaries on the same GitHub release. Keep the applicable source archive and `SHA256SUMS` with redistributed component archives. The release preparation workflow verifies each source archive manifest and every component archive against its catalog digest and byte size before upload. macOS files already ad-hoc signed during relocation are included in those final archive hashes. Production Developer ID, Authenticode, and Linux package signing are not configured for this release.

## Supported desktop builds

The 1.0.0 release is built and smoke-tested for macOS arm64, Windows x64, and Linux x64. macOS x64 is unbuilt and untested. Linux arm64 and Windows arm64 are unsupported, and the component stager refuses those targets.
