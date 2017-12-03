"use babel";

import { CompositeDisposable } from "atom";
import fs from "fs";
import _get from "lodash/get";
import _set from "lodash/set";
import _startsWith from "lodash/startsWith";
import path from "path";

import NpmDependencyUpdaterView from "./npm-dependency-updater-view";

const githubUrlRegex = /^git\+https?\:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.git$/;

export default {
  npmDependencyUpdaterView: null,
  modalPanel: null,
  subscriptions: null,

  activate(state) {
    this.npmDependencyUpdaterView = new NpmDependencyUpdaterView(state.npmDependencyUpdaterViewState);
    this.modalPanel = atom.workspace.addModalPanel({
      item: this.npmDependencyUpdaterView.getElement(),
      visible: false
    });

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this view
    this.subscriptions.add(
      atom.commands.add("atom-workspace", {
        "npm-dependency-updater:update": () => this.readCurrentFileAndUpdate()
      })
    );
  },

  deactivate() {
    this.modalPanel.destroy();
    this.subscriptions.dispose();
    this.npmDependencyUpdaterView.destroy();
  },

  serialize() {
    return {
      npmDependencyUpdaterViewState: this.npmDependencyUpdaterView.serialize()
    };
  },

  readCurrentFileAndUpdate() {
    const editor = atom.workspace.getActiveTextEditor();
    const openPaths = atom.project.getPaths();

    const currentFileName = path.basename(editor.getPath());
    if (currentFileName !== "package.json") {
      alert("Only package.json is supported at the moment.");
      return;
    }

    const allDependencies = {};
    let currentPackageJson;
    try {
      const currentEditorText = editor.getText();
      currentPackageJson = JSON.parse(currentEditorText);

      const allDependencyTypes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

      allDependencyTypes.forEach(dependencyType => {
        if (dependencyType in currentPackageJson) {
          const currentSet = currentPackageJson[dependencyType]; // object reference alias
          for (const dependencyName in currentSet) {
            const dependencyUri = currentSet[dependencyName];
            if (_startsWith(dependencyUri, "github:")) {
              // strip the ending tag if it's there
              let cleanedDependencyUri = dependencyUri;
              const hashIndex = cleanedDependencyUri.lastIndexOf("#");
              if (hashIndex !== -1) {
                cleanedDependencyUri = cleanedDependencyUri.slice(0, hashIndex);
              }

              allDependencies[cleanedDependencyUri] = dependencyType + "." + dependencyName;
            }
          }
        }
        // check if github dependency
      });
    } catch (e) {
      alert("Error parsing current file as JSON.");
      console.log(e);
      return;
    }

    if (allDependencies.length === 0) {
      alert("No dependencies to update.");
      return;
    }

    // check for package.json
    openPaths.forEach(dirPath => {
      const packageJsonPath = path.resolve(dirPath, "./package.json");

      if (fs.existsSync(packageJsonPath)) {
        // yes it does! now we read package.json
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

          const repositoryUrl = _get(packageJson, "repository.url");
          if (repositoryUrl) {
            // extract relevant section of text
            const extractedRepository = repositoryUrl.match(githubUrlRegex);

            if (extractedRepository !== null) {
              const [repositoryOwner, repositoryName] = extractedRepository.slice(1);
              const formattedRepositoryUri = `github:${repositoryOwner}/${repositoryName}`;

              // check if the massaged version exists
              if (formattedRepositoryUri in allDependencies) {
                // if it does, get the version number of the package
                const { version } = packageJson;
                if (version) {
                  // deep set the new repo URI
                  _set(
                    currentPackageJson,
                    allDependencies[formattedRepositoryUri],
                    `${formattedRepositoryUri}#v${version}`
                  );
                }
              }
            }
          }
        } catch (e) {
          console.log("JSON invalid for file " + packageJsonPath, e);
        }
      }
    });

    editor.setText(JSON.stringify(currentPackageJson, null, 2));
  }
};
