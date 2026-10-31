'use strict';

const Homey = require('homey');
const ProviderManager = require('./lib/ProviderManager');
const ImageBatchManager = require('./lib/ImageBatchManager');

class LLMVisionApp extends Homey.App {

  async onInit() {
    this.log('LLM Vision is starting...');

    this.providerManager =
      new ProviderManager(this.homey);

    this.imageBatchManager =
      new ImageBatchManager(
        this.homey,
        this.providerManager,
      );

    /*
     * Existing multi-frame camera activity card.
     */
    const analyzeCameraActivity =
      this.homey.flow.getActionCard(
        'analyze_camera_activity',
      );

    analyzeCameraActivity
      .registerArgumentAutocompleteListener(
        'model',
        async (query, args) => {
          return this.providerManager
            .getModelSuggestions(
              args.provider,
              query,
            );
        },
      );

    analyzeCameraActivity
      .registerRunListener(async (args) => {
        this.log(
          'Analyze Camera Activity card executed',
        );

        return this.providerManager
          .analyzeCameraActivity(args);
      });

    /*
     * Send a text-only prompt to the selected AI provider.
     */
    const sendTextPrompt =
      this.homey.flow.getActionCard(
        'send_text_prompt',
      );

    sendTextPrompt
      .registerArgumentAutocompleteListener(
        'model',
        async (query, args) => {
          return this.providerManager
            .getModelSuggestions(
              args.provider,
              query,
            );
        },
      );

    sendTextPrompt
      .registerRunListener(async (args) => {
        this.log(
          'Send Text Prompt card executed',
        );

        return this.providerManager
          .sendTextPrompt(args);
      });

    /*
     * Analyze one supplied image and return a free-form text response.
     */
    const analyzeSingleImage =
      this.homey.flow.getActionCard(
        'analyze_single_image',
      );

    analyzeSingleImage
      .registerArgumentAutocompleteListener(
        'model',
        async (query, args) => {
          return this.providerManager
            .getModelSuggestions(
              args.provider,
              query,
            );
        },
      );

    analyzeSingleImage
      .registerRunListener(async (args) => {
        this.log(
          'Analyze Single Image card executed',
        );

        return this.providerManager
          .analyzeSingleImage(args);
      });

    /*
     * Analyze one supplied image and return structured security output.
     */
    const analyzeSingleImageStructured =
      this.homey.flow.getActionCard(
        'analyze_single_image_structured',
      );

    analyzeSingleImageStructured
      .registerArgumentAutocompleteListener(
        'model',
        async (query, args) => {
          return this.providerManager
            .getModelSuggestions(
              args.provider,
              query,
            );
        },
      );

    analyzeSingleImageStructured
      .registerRunListener(async (args) => {
        this.log(
          'Analyze Single Image Structured card executed',
        );

        return this.providerManager
          .analyzeSingleImageStructured(args);
      });

    /*
     * Clear multi-camera image batch.
     */
    const clearImageBatch =
      this.homey.flow.getActionCard(
        'clear_image_batch',
      );

    clearImageBatch
      .registerRunListener(async (args) => {
        this.imageBatchManager.clearBatch(
          args.batch_id,
        );

        return true;
      });

    /*
     * Add one camera image to a batch.
     */
    const addImageToBatch =
      this.homey.flow.getActionCard(
        'add_image_to_batch',
      );

    addImageToBatch
      .registerRunListener(async (args) => {
        const result =
          await this.imageBatchManager.addImage(
            args.batch_id,
            args.source_name,
            args.droptoken,
          );

        return {
          image_count: result.count,
          captured_image: result.image,
        };
      });

    /*
     * New v1.7.0 timed multi-frame batch capture action.
     * Existing seven Flow card handlers remain unchanged.
     */
    const addMultipleImagesToBatch =
      this.homey.flow.getActionCard('add_multiple_images_to_batch');
    addMultipleImagesToBatch.registerRunListener(async (args) => {
      this.log('Add Multiple Images to Batch card executed');
      return this.imageBatchManager.addMultipleImages(args);
    });

    /*
     * Analyze all collected camera images.
     */
    const analyzeImageBatch =
      this.homey.flow.getActionCard(
        'analyze_image_batch',
      );

    analyzeImageBatch
      .registerArgumentAutocompleteListener(
        'model',
        async (query, args) => {
          return this.providerManager
            .getModelSuggestions(
              args.provider,
              query,
            );
        },
      );

    analyzeImageBatch
      .registerRunListener(async (args) => {
        this.log(
          'Analyze Image Batch card executed',
        );

        return this.imageBatchManager
          .analyzeBatch(args);
      });

    this.log(
      'LLM Vision initialized successfully',
    );
  }

}

module.exports = LLMVisionApp;
