'use strict';
var http = require('http');
var https = require('https');
var util = require('util');
var path = require('path');
var yeoman = require('yeoman-generator');
var chalk = require('chalk');
var ramlParser = require('raml-parser');
var fs = require('fs');
var inflect = require('inflection');
var _ = require('lodash');

var RamlangGenerator = yeoman.generators.Base.extend({

  /**
   * The main function called when the generator is executed.
   */
  init: function () {
    /**
     * Gets the list of raml files in the current working directory
     * and populates a variable on the current scope.
     */
    var filePath = path.resolve('.'); // current working directory.

    this.ramlFiles = (fs.readdirSync(filePath) || []).filter(function(item) {
      return path.extname(item).indexOf('.raml') > -1;
    });

    this.ramlFiles.push('Custom');
  },

  /**
   * Prompts the user a series of questions to determine what the generator needs to do.
   */
  initialQuestions: function () {
    var done = this.async();
    var self = this;

    // have Yeoman greet the user
    //this.log(this.yeoman);

    // replace it with a short and sweet description of your generator
    this.log(chalk.magenta('You\'re using the fantastic Ramlang generator.'));

    var prompts = [];
    var prompt1 = {
      type: 'input',
      name: 'apiModuleName',
      message: 'What would you like to call the module',
      validate: function(input) {
        return input && input.trim().length > 0;
      }
    };
    var prompt2 = {
      type: 'list',
      name: 'ramlFilename',
      message: 'Which RAML file would you like to use?',
      choices: this.ramlFiles
    };
    var prompt3 = {
      type: 'input',
      name: 'ramlFilename',
      message: 'I need the path to your RAML file. This can be a url: ',
      validate: function(input) {
        var filePath = path.resolve(input);
        return path.extname(filePath).indexOf('.raml') > -1;
      },
      when: function(answer) {
        return answer.ramlFilename == 'Custom' || self.ramlFiles.length == 1;
      }
    };

    if (this.ramlFiles.length == 2) {
      // There is only one file so just default it.
      this.ramlFilename = this.ramlFiles[0];
      prompts = [prompt1];
    }

    if (this.ramlFiles.length > 2) {
      prompts = [prompt1, prompt2, prompt3];
    } else {
      delete prompt2.when;
      prompts = [prompt1, prompt3];
    }

    this.prompt(prompts, function (props) {
      this.ramlFilename = props.ramlFilename || this.ramlFilename;
      this.apiModuleName = props.apiModuleName;

      done();
    }.bind(this));
  },

  /**
   * Reads the specified raml file provided by the users input from the previous questions.
   * If the file path is a url then we download the file into the current working directory
   * before parsing the raml from it.
   */
  readRamlFile: function() {
    // Return if there is no file to read
    if (!this.ramlFilename) { return; }

    this.ramlFilename = this.ramlFilename.trim();

    var done = this.async();
    var self = this;
    var isHttp = this.ramlFilename.indexOf('http://') == 0;
    var isHttps = this.ramlFilename.indexOf('https://') == 0;
    var isUri = isHttp || isHttps;
    var didManageToPrintADot = false;
    util.print(chalk.blue('Reading RAML file'));

    var progressInterval = setInterval(function() {
      util.print(chalk.cyan('.'));
      didManageToPrintADot = true;
    }, 250);

    var endFn = function() {
      clearInterval(progressInterval);
      done();
    };

    var loadRaml = function() {
      ramlParser.loadFile(self.ramlFilename).then(function(data) {

        if (didManageToPrintADot) {
          self.log(chalk.blue('Done'));
        } else {
          self.log('');
        }

        self.resources = data.resources;
        endFn();
      }, function(error) {
        self.log('');
        self.log(chalk.red('Failed to read RAML file: ' + error));
        endFn();
      });
    };

    if (isUri) {
      var requester = isHttp ? http : https;
      this.ramlFilename = this.ramlFilename;

      // Remove
      var saveFilePath = this.ramlFilename;
      var index = this.ramlFilename.indexOf('?');
      if (index > -1) {
        saveFilePath = this.ramlFilename.substring(0, index);
      }

      if (path.extname(saveFilePath).indexOf('.raml') < 0) {
        saveFilePath += '.raml';
      }

      saveFilePath = path.basename(saveFilePath);

      var file = fs.createWriteStream(saveFilePath);
      requester.get(this.ramlFilename, function(response) {
        response.pipe(file);
        file.on('finish', function() {
          file.close(function() {
            self.ramlFilename = saveFilePath;
            loadRaml();
          });
        });
      }, function(error) {
        self.log('');
        self.log(chalk.red('Failed to download RAML file: ' + error));

        file.close(function() {
          endFn();
        });
      });
    } else {
      loadRaml();
    }
  },

  /**
   * Asks the user a final set of questions before processing his or her request.
   */
  finalQuestions: function() {
    // Return if there are no resources to process
    if (!this.resources) { return; }

    var done = this.async();
    var prompts = [];
    var self = this;

    // Map all of the resource display names
    this.allResourceDisplayNames = self.resources.map(function(item) {
      return item.displayName;
    });

    if (this.ramlFiles.length > 0) {
      prompts.push({
        type: 'confirm',
        name: 'shouldGenAllResources',
        message: 'Would you like to generate all resources?',
        default: true
      }, {
        type: 'checkbox',
        name: 'resourcesToGenerate',
        message: 'Select which resources you want to generate:',
        choices: this.allResourceDisplayNames,
        when: function(response) {
          return !response.shouldGenAllResources
        }
      }, {
        type: 'confirm',
        name: 'allInOneFile',
        message: 'Should I generate all the resources in one file?',
        default: true
      });
    } else {
      this.log(chalk.red('There needs to be at least one \'.raml\' file in the current working directory.'))
    }

    this.prompt(prompts, function (props) {
      var selectedResources = props.resourcesToGenerate || this.allResourceDisplayNames;
      this.generateInOneFile = props.allInOneFile;
      this.resources = this.resources.filter(function(resource) {
        return selectedResources.indexOf(resource.displayName) > -1;
      });

      this.selectedResources = this.resources;
      done();
    }.bind(this));
  },

  /**
   * Generates the angular javascript file(s) based on the users answers.
   */
  generate: function() {
    // Return if there are no resources to process
    if (!this.selectedResources) { return; }
    var self = this;
    var fileContents = '\'use strict\';\n\n';

    var appBindings = {
      app: {
        name: this.apiModuleName + (this.apiModuleName != 'api' ? '-api' : '')
      }
    };

    var stripModuleDecleration = function(templateText) {
      return templateText.replace(/angular.module\(.*\)/, '');
    };

    var formatDescription = function(description, isForComments) {
      description = description || '';
      description = description.trim();
      var result = '';
      var words = description.replace(/[\r\n]/g, ' ').split(' ');
      var totalWordsInRow = 14;
      var wordCount = 0;
      words.forEach(function(word) {

        if (wordCount == totalWordsInRow) {
          result += '\n' + (isForComments ? ' *' : '');
          wordCount = 1;
        }

        if (wordCount == 0) {
          result += word;
        } else {
          result += ' ' + word;
        }

        wordCount++;
      });

      return result;
    };

    /**
     * A helper function to direct the resolved template text into a file or append it to a variable.
     * @param {String} resourceName - The name of the resource to use.
     * @param {String} templateText - The template text value to resolve.
     * @param {Boolean} [excludeAppModule] - A boolean value to determine if this method should exclude the angular module
     *                                       declaration from the top of the templates.
     */
    var writeTemplateToDest = function(resourceName, templateText, excludeAppModule) {
      var resolvedTemplateText = _.template(templateText, appBindings);

      if (self.generateInOneFile) {
        if (excludeAppModule) {
          resolvedTemplateText = stripModuleDecleration(resolvedTemplateText);
        }

        fileContents += resolvedTemplateText;
        self.log(chalk.cyan('Added ->', resourceName));
      } else {
        resourceName = inflect.transform(resourceName, ['underscore', 'dasherize']);
        resolvedTemplateText = fileContents + resolvedTemplateText;
        self.write(resourceName + '.js', resolvedTemplateText + ';');
      }
    };

    var appTemplatePath       = path.join(this.sourceRoot(), 'app.js');
    var providerTemplatePath  = path.join(this.sourceRoot(), 'provider.js');
    var serviceTemplatePath   = path.join(this.sourceRoot(), 'service.js');
    var appModuleTemplateText = this.readFileAsString(appTemplatePath);
    var providerTemplateText  = this.readFileAsString(providerTemplatePath);
    var serviceTemplateText   = this.readFileAsString(serviceTemplatePath);

    writeTemplateToDest(appBindings.app.name, appModuleTemplateText);
    writeTemplateToDest('api-provider', providerTemplateText, this.generateInOneFile);

    this.selectedResources.forEach(function(resource) {
      appBindings.resource = resource;
      appBindings.resource.displayName = inflect.singularize(resource.displayName).replace(' ', '') + 'Api';
      appBindings.resource.description = formatDescription(resource.description, true);

      writeTemplateToDest(appBindings.resource.displayName, serviceTemplateText, self.generateInOneFile);
    });

    if (this.generateInOneFile) {
      fileContents += ';';
      this.write(appBindings.app.name + '.js', fileContents);
    }
  }
});

module.exports = RamlangGenerator;