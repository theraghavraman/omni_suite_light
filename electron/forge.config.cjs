/**
 * OmniConverter Studio — Electron Forge Configuration (electron/forge.config.cjs)
 *
 * Configures cross-platform desktop packaging and OS-specific installers:
 * - Windows: Squirrel.Windows (.exe setup & NuGet package) + ZIP
 * - macOS:   DMG + ZIP (with Hardened Runtime entitlements & optional notarization)
 * - Linux:   Debian (.deb) + RedHat/Fedora (.rpm) + ZIP
 *
 * The installer is the small base app. Copied from ./build into process.resourcesPath:
 * - build/omni-engine             -> Local Engine code, UI, SHA-256-verified vendor/ assets
 * - build/components-catalog.json -> optional components (Python runtime/libraries, LibreOffice,
 *                                    Calibre, FFmpeg, ...) with archive SHA-256s; the Component
 *                                    Manager downloads the ones the user picks (electron/components.cjs)
 * - build/BUNDLE_MANIFEST.json    -> staging record (versions, checksums, probes, audit)
 *
 * Resources are copied by the packageAfterCopy hook (not packagerConfig.extraResource, which
 * rewrites relative symlinks into absolute build-machine paths). Packaging is refused unless
 * scripts/stage_desktop_bundle.py built the base and every component for this platform/arch.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const rpmSpecTemplatePatch = Symbol.for('omni-suite.rpm-spec-template-patch');

try {
  const electronInstaller = require('electron-installer-redhat');
  const electronInstallerCommon = require('electron-installer-common');
  const rpmInstallerPrototype = electronInstaller.Installer.prototype;

  if (!rpmInstallerPrototype[rpmSpecTemplatePatch]) {
    const originalCreateSpec = rpmInstallerPrototype.createSpec;
    rpmInstallerPrototype.createSpec = function createSpecFromConfiguredTemplate() {
      const specTemplate = this.userSupplied.specTemplate;
      if (!specTemplate) return originalCreateSpec.call(this);

      this.options.logger(`Creating spec file at ${this.specPath}`);
      return electronInstallerCommon.wrapError('creating spec file', async () =>
        this.createTemplatedFile(specTemplate, this.specPath),
      );
    };
    Object.defineProperty(rpmInstallerPrototype, rpmSpecTemplatePatch, { value: true });
  }
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'electron-installer-redhat'")) {
    throw error;
  }
}

const repoRoot = path.resolve(__dirname, '..');
const buildRoot = path.join(repoRoot, 'build');
const executableName = 'omni-converter-studio';

// Only the Electron shell itself goes into app.asar; everything else ships as resources.
const APP_ALLOWLIST = [
  /^\/package\.json$/,
  /^\/electron(\/(main|preload|components|components-preload)\.cjs|\/components\.html|\/components-ui\.js)?$/,
  /^\/node_modules(\/|$)/,
];

function ignoreAppFile(file) {
  if (!file) return false;
  return !APP_ALLOWLIST.some((pattern) => pattern.test(file));
}

function readBundleManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(buildRoot, 'BUNDLE_MANIFEST.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function copyTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (process.platform === 'darwin') {
    // ditto preserves symlinks, permissions, extended attributes and code signatures.
    const result = spawnSync('ditto', [src, dest], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`ditto ${src} -> ${dest} failed`);
  } else if (process.platform === 'linux') {
    const result = spawnSync('cp', ['-a', src, dest], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`cp -a ${src} -> ${dest} failed`);
  } else {
    fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  }
}

async function copyBundledResources(_forgeConfig, buildPath, _electronVersion, platform, arch) {
  const platKey = `${platform}-${arch}`;
  const manifest = readBundleManifest();
  const allowIncomplete = process.env.OMNI_ALLOW_INCOMPLETE_BUNDLE === '1';
  if (!manifest) {
    throw new Error('build/BUNDLE_MANIFEST.json is missing. Run `npm run desktop:stage` (scripts/stage_desktop_bundle.py) first.');
  }
  if (manifest.platform !== platKey) {
    throw new Error(`build/ was staged for ${manifest.platform}, but Forge is packaging ${platKey}. Stage on a ${platKey} host.`);
  }
  if (!manifest.complete && !allowIncomplete) {
    throw new Error(
      `The staged desktop bundle is incomplete, refusing to package an installer that would not work:\n  - ${(manifest.errors || ['unknown']).join('\n  - ')}\n` +
        'Fix the staging errors (or set OMNI_ALLOW_INCOMPLETE_BUNDLE=1 for a throwaway development package).'
    );
  }
  const resourcesDir = path.resolve(buildPath, '..');
  const engineSrc = path.join(buildRoot, 'omni-engine');
  if (!fs.existsSync(engineSrc)) throw new Error(`Staged resource ${engineSrc} is missing`);
  copyTree(engineSrc, path.join(resourcesDir, 'omni-engine'));
  const catalog = path.join(buildRoot, 'components-catalog.json');
  if (fs.existsSync(catalog)) {
    fs.copyFileSync(catalog, path.join(resourcesDir, 'components-catalog.json'));
  } else if (!allowIncomplete) {
    throw new Error(`${catalog} is missing`);
  }
  fs.copyFileSync(path.join(buildRoot, 'BUNDLE_MANIFEST.json'), path.join(resourcesDir, 'BUNDLE_MANIFEST.json'));
}

const enableMacSigning = process.platform === 'darwin' && process.env.OMNI_MAC_SIGN === '1';
const enableMacNotarization =
  enableMacSigning &&
  Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID);

// Host libraries the downloadable LibreOffice/Calibre/relocated tools expect from any desktop
// distribution (graphics stack and core X/D-Bus/CUPS libraries). Merged with Electron's defaults.
const DEB_HOST_DEPENDS = [
  'libgl1', 'libegl1', 'libopengl0', 'libgbm1', 'libdrm2', 'libasound2t64 | libasound2',
  'libxcb-cursor0', 'libxkbcommon0', 'libxkbcommon-x11-0', 'libfontconfig1', 'libfreetype6',
  'libdbus-1-3', 'libcups2t64 | libcups2', 'libxinerama1', 'libsm6', 'libice6', 'libxrandr2',
  'libx11-xcb1', 'libxrender1', 'libxext6', 'libglib2.0-0t64 | libglib2.0-0', 'libnss3',
];
const RPM_HOST_REQUIRES = [
  'mesa-libGL', 'mesa-libEGL', 'libglvnd-opengl', 'mesa-libgbm', 'libdrm', 'alsa-lib',
  'xcb-util-cursor', 'libxkbcommon', 'libxkbcommon-x11', 'fontconfig', 'freetype',
  'dbus-libs', 'cups-libs', 'libXinerama', 'libSM', 'libICE', 'libXrandr', 'libX11-xcb',
  'libXrender', 'libXext', 'glib2', 'nss',
];

module.exports = {
  packagerConfig: {
    name: 'OmniConverter Studio',
    executableName,
    appBundleId: 'io.redmarkforge.omniconverter.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    ignore: ignoreAppFile,
    ...(enableMacSigning
      ? {
          osxSign: {
            identity: process.env.APPLE_SIGNING_IDENTITY || 'Developer ID Application',
            hardenedRuntime: true,
            entitlements: path.join(__dirname, 'entitlements.mac.plist'),
            'entitlements-inherit': path.join(__dirname, 'entitlements.mac.plist'),
            'signature-flags': 'library',
          },
        }
      : {}),
    ...(enableMacNotarization
      ? {
          osxNotarize: {
            tool: 'notarytool',
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: copyBundledResources,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'OmniConverterStudio',
        authors: 'Raghav Raman',
        exe: 'omni-converter-studio.exe',
        setupExe: 'OmniConverter-Studio-Setup.exe',
        noMsi: false,
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        name: 'OmniConverter-Studio',
        format: 'ULFO',
        overwrite: true,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          name: 'omni-converter-studio',
          bin: executableName,
          productName: 'OmniConverter Studio',
          genericName: 'Universal File & Data Converter',
          categories: ['Utility', 'Office', 'AudioVideo', 'Science'],
          maintainer: 'Raghav Raman <raghav@redmarkforge.io>',
          homepage: 'https://github.com/theraghavraman/omni_suite_light',
          depends: DEB_HOST_DEPENDS,
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        specTemplate: path.join(__dirname, 'omni-rpm.spec.ejs'),
        options: {
          name: 'omni-converter-studio',
          bin: executableName,
          productName: 'OmniConverter Studio',
          license: 'MIT',
          categories: ['Utility', 'Office', 'AudioVideo'],
          homepage: 'https://github.com/theraghavraman/omni_suite_light',
          requires: RPM_HOST_REQUIRES,
        },
      },
    },
  ],
};

module.exports._internal = { ignoreAppFile, copyBundledResources, DEB_HOST_DEPENDS, RPM_HOST_REQUIRES };
