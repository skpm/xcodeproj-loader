/* eslint-disable
  multiline-ternary,
*/

const path = require('path');
const fs = require('fs');
const loaderUtils = require('loader-utils');
const validateOptions = require('schema-utils');
const schema = require('./options.json');
const compileXcodeProj = require('./compile-xcodeproj');
const frameworkClass = require('./wrapped-xcodeproj-class');

function findProjectPath(resourcePath) {
  if (!resourcePath) {
    throw new Error('Could not find the project to compile');
  }

  const ext = path.extname(resourcePath);

  if (ext === '.xcodeproj' || ext === '.xcworkspace') {
    return resourcePath;
  }

  return findProjectPath(path.dirname(resourcePath));
}

function emitFolder(emitFile, outputPath, filePath) {
  function walk(currentPath, currentOutputPath) {
    if (fs.statSync(currentPath).isDirectory()) {
      const content = fs.readdirSync(currentPath);
      content.forEach(c =>
        walk(path.join(currentPath, c), path.join(currentOutputPath, c)),
      );
    } else {
      const content = fs.readFileSync(currentPath);
      emitFile(currentOutputPath, content);
    }
  }

  walk(filePath, outputPath);
}

module.exports = function loader() {
  if (!this.emitFile) {
    throw new Error(
      'XcodeProj Loader\n\nemitFile is required from module system',
    );
  }

  const options = loaderUtils.getOptions(this) || {};

  validateOptions(schema, options, 'XcodeProj Loader');

  const context =
    options.context ||
    this.rootContext ||
    (this.options && this.options.context);

  // let url = loaderUtils.interpolateName(this, options.name, {
  //   context,
  //   content,
  //   regExp: options.regExp,
  // });

  const projectPath = findProjectPath(this.resourcePath);

  const url = `${path
    .basename(projectPath, path.extname(projectPath))
    .replace(/-/g, '_')}.framework`;

  let outputPath = url;

  if (options.outputPath) {
    if (typeof options.outputPath === 'function') {
      outputPath = options.outputPath(url);
    } else {
      outputPath = path.posix.join(options.outputPath, url);
    }
  }

  if (options.useRelativePath) {
    const issuer = options.context
      ? context
      : this._module && this._module.issuer && this._module.issuer.context;

    const relativeUrl =
      issuer &&
      path
        .relative(issuer, projectPath)
        .split(path.sep)
        .join('/');

    const relativePath = relativeUrl && `${path.dirname(relativeUrl)}/`;
    // eslint-disable-next-line no-bitwise
    if (~relativePath.indexOf('../')) {
      outputPath = path.posix.join(outputPath, relativePath, url);
    } else {
      outputPath = path.posix.join(relativePath, url);
    }
  }

  let publicPath = `__webpack_public_path__ + ${JSON.stringify(outputPath)}`;

  if (options.publicPath) {
    if (typeof options.publicPath === 'function') {
      publicPath = options.publicPath(url);
    } else if (options.publicPath.endsWith('/')) {
      publicPath = options.publicPath + url;
    } else {
      publicPath = `${options.publicPath}/${url}`;
    }

    if (!options.raw) {
      publicPath = JSON.stringify(publicPath);
    }
  }

  if (options.emitFile === undefined || options.emitFile) {
    if (path.extname(projectPath) === '.framework') {
      // we already have a framework so no need to compile the project
      emitFolder(this.emitFile.bind(this), outputPath, projectPath);
      return frameworkClass(publicPath);
    }

    const callback = this.async();

    const cachePath = path.join(__dirname, '../.cache');

    compileXcodeProj(this, projectPath, cachePath, error => {
      if (error) {
        return callback(
          new Error(`Error compiling Xcode project: ${error.message}`),
        );
      }

      emitFolder(
        this.emitFile.bind(this),
        outputPath,
        path.join(
          cachePath,
          `./Build/Products/Release/${path
            .basename(projectPath, path.extname(projectPath))
            .replace(/-/g, '_')}.framework`,
        ),
      );
      return callback(null, frameworkClass(publicPath));
    });
    return undefined;
  }

  return frameworkClass(publicPath);
};

module.exports.raw = true;
