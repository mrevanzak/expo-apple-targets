// Generate aspects of the plugin from an Xcode project.

import plist from "@expo/plist";
import fs from "fs-extra";
import path from "path";

import {
  PBXAggregateTarget,
  PBXFrameworksBuildPhase,
  PBXLegacyTarget,
  PBXNativeTarget,
  XCBuildConfiguration,
  XcodeProject,
} from "@bacons/xcode";

import { sync as globSync } from "glob";

function assertBasicConfigs(
  target: PBXNativeTarget | PBXAggregateTarget | PBXLegacyTarget
) {
  // assertPBXNativeTarget(target);
  const configs = target.props.buildConfigurationList.props.buildConfigurations;

  // Extract the one named "Release" and the one named "Debug" then assert that any others are unexpected and return Release and Debug.
  const releaseConfig = configs.find(
    (config) => config.props.name === "Release"
  );
  const debugConfig = configs.find((config) => config.props.name === "Debug");
  if (!releaseConfig || !debugConfig) {
    throw new Error(
      `Expected to find Release and Debug configurations for target ${target.getDisplayName()}`
    );
  }
  const otherConfigs = configs.filter(
    (config) => config.props.name !== "Release" && config.props.name !== "Debug"
  );
  if (otherConfigs.length > 0) {
    throw new Error(
      `Unexpected configurations found for target ${target.getDisplayName()}: ${otherConfigs
        .map((config) => config.props.name)
        .join(", ")}`
    );
  }
  return { releaseConfig, debugConfig };
}

function getConfigurationsForTargets(project: XcodeProject) {
  const templateBuildSettings: Record<
    string,
    {
      default: Record<string, string>;
      release: Record<string, string>;
      debug: Record<string, string>;
      info: Record<string, any>;
    }
  > = {};

  project.rootObject.props.targets.forEach((target) => {
    if (!PBXNativeTarget.is(target)) {
      return;
    }

    // console.log("settings for target:", target.props.productType);
    const configs = assertBasicConfigs(target);

    const plist = configs.releaseConfig.getInfoPlist();
    const extensionType = plist.NSExtension?.NSExtensionPointIdentifier;

    // Only collect templates for extensions.
    if (!extensionType) {
      return;
    }

    // Get the build settings from both and create three objects:
    // 1. Shared settings
    // 2. Release-specific settings
    // 3. Debug-specific settings

    const allSettings = {
      ...configs.releaseConfig.props.buildSettings,
      ...configs.debugConfig.props.buildSettings,
    };

    const sharedSettings = {};
    const releaseSettings = {};
    const debugSettings = {};

    const d = configs.debugConfig.props.buildSettings;
    const r = configs.releaseConfig.props.buildSettings;

    Object.entries(allSettings).forEach(([key, value]) => {
      if (d[key] !== r[key]) {
        if (key in r) {
          releaseSettings[key] = r[key];
        }
        if (key in d) {
          debugSettings[key] = d[key];
        }
      } else {
        if (key in r && key in d) {
          sharedSettings[key] = value;
        }
      }
    });

    templateBuildSettings[extensionType] = {
      default: sharedSettings,
      release: releaseSettings,
      debug: debugSettings,
      info: plist,
    };
  });

  console.log(JSON.stringify(templateBuildSettings, null, 2));

  return templateBuildSettings;
}

function findUpProjectRoot(cwd: string) {
  const pkgJsonPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    return cwd;
  }
  const parentDir = path.dirname(cwd);
  if (parentDir === cwd) {
    return null;
  }
  return findUpProjectRoot(parentDir);
}

(async () => {
  const projPath = globSync("ios/*/project.pbxproj", {
    cwd: process.cwd(),
    absolute: true,
  })[0];
  const project = XcodeProject.open(projPath);

  ensureWrite(
    path.join(
      findUpProjectRoot(__dirname),
      "target-plugin/template",
      "XCBuildConfiguration.json"
    ),
    JSON.stringify(getConfigurationsForTargets(project), null, 2)
  );
  process.exit(0);
})();

function ensureWrite(p: string, src: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, src);
}
