/**
 * OmniConverter Studio — Electron Forge Configuration (electron/forge.config.cjs)
 *
 * Configures cross-platform desktop packaging and OS-specific installers:
 * - Windows: Squirrel.Windows (.exe setup & NuGet package)
 * - macOS:   DMG + ZIP (with Hardened Runtime entitlements & optional notarization)
 * - Linux:   Debian (.deb) + RedHat/Fedora (.rpm)
 *
 * Bundles staged resources from ./build into process.resourcesPath:
 * - build/omni-engine      -> Python Local Engine, UI assets, offline vendor/ bundle, THIRD_PARTY_NOTICES.md
 * - build/python-runtime   -> Standalone embedded Python 3.12 runtime + requirements-local.txt packages
 * - build/native-tools     -> OS/arch-specific native CLI binaries (FFmpeg, qpdf, Poppler, Tesseract, etc.)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

function collectExtraResources() {
  const resources = [];
  for (const sub of ['omni-engine', 'python-runtime', 'native-tools']) {
    const candidate = path.join(buildRoot, sub);
    if (fs.existsSync(candidate)) {
      resources.push(candidate);
    }
  }
  return resources;
}

const enableMacSigning = process.platform === 'darwin' && process.env.OMNI_MAC_SIGN === '1';
const enableMacNotarization =
  enableMacSigning &&
  Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID);

module.exports = {
  packagerConfig: {
    name: 'OmniConverter Studio',
    executableName,
    appBundleId: 'io.redmarkforge.omniconverter.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    extraResource: collectExtraResources(),
    ignore: [
      /^\/\.venv($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/build($|\/)/,
      /^\/dist($|\/)/,
      /^\/out($|\/)/,
      /^\/tests($|\/)/,
      /^\/__pycache__($|\/)/,
    ],
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
        },
      },
    },
  ],
};
