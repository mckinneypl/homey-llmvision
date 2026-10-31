'use strict';

class ImageBatchManager {

  constructor(homey, providerManager) {
    this.homey = homey;
    this.providerManager = providerManager;

    this.batches = new Map();
    this.batchLimits = new Map();
  }

  normalizeBatchId(batchId) {
    const id = String(batchId || 'default')
      .trim()
      .toLowerCase();

    return id || 'default';
  }

  clearBatch(batchId) {
    const id = this.normalizeBatchId(batchId);

    this.batches.delete(id);
    this.batchLimits.delete(id);

    this.homey.app.log(
      `Image batch cleared: ${id}`,
    );

    return id;
  }

  setBatchLimit(batchId, requestedLimit) {
    const id = this.normalizeBatchId(batchId);
    const limit = Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 12 || limit > 32) {
      throw new Error('Batch limit must be a whole number from 12 to 32.');
    }
    this.batchLimits.set(id, limit);
    return limit;
  }

  getBatchLimit(batchId) {
    return this.batchLimits.get(this.normalizeBatchId(batchId)) || 12;
  }

  async addImage(batchId, sourceName, imageToken) {
    const id = this.normalizeBatchId(batchId);

    if (!imageToken || typeof imageToken.getStream !== 'function') {
      throw new Error('No image token was supplied.');
    }

    const imageDataUrl =
      await this.providerManager.imageToDataUrl(imageToken);

    return this.addImageDataUrl(id, sourceName, imageDataUrl);
  }

  async addImageDataUrl(batchId, sourceName, imageDataUrl) {
    const id = this.normalizeBatchId(batchId);
    if (!/^data:image\/[^;,]+;base64,[a-z0-9+/=]+$/i.test(imageDataUrl)) {
      throw new Error('Invalid captured image data.');
    }

    if (!this.batches.has(id)) {
      this.batches.set(id, []);
    }

    const batch = this.batches.get(id);

    const resolvedSourceName =
      String(sourceName || `Camera ${batch.length + 1}`).trim();

    batch.push({
      source: resolvedSourceName,
      capturedAt: new Date().toISOString(),
      imageDataUrl,
    });

    const frozenImage =
      await this.createHomeyImageFromDataUrl(
        imageDataUrl,
        resolvedSourceName,
      );

    if (batch.length > this.getBatchLimit(id)) {
      batch.shift();
    }

    this.homey.app.log(
      `Added image to batch ${id}: `
      + `${sourceName || 'Unnamed camera'} `
      + `(${batch.length} images)`,
    );

    return {
      batchId: id,
      count: batch.length,
      image: frozenImage,
    };
  }

  async addMultipleImages(args) {
    const batchId = this.normalizeBatchId(args.batch_id);
    const sourceName = String(args.source_name || 'Camera').trim();
    const framesRequested = Number(args.frame_count);
    const delaySeconds = Number(args.delay_seconds);
    if (!Number.isInteger(framesRequested) || framesRequested < 1 || framesRequested > 32) {
      throw new Error('Frame count must be a whole number from 1 to 32.');
    }
    if (!Number.isInteger(delaySeconds) || delaySeconds < 1 || delaySeconds > 10) {
      throw new Error('Delay must be a whole number from 1 to 10 seconds.');
    }
    if (!args.droptoken || typeof args.droptoken.getStream !== 'function') {
      throw new Error('A Homey camera image token is required.');
    }
    const limit = this.setBatchLimit(batchId, Number(args.batch_limit || 12));
    const crypto = require('crypto');
    const unique = new Set();
    let captured = 0;
    let lastImage = null;
    let error = null;
    for (let i = 0; i < framesRequested; i++) {
      // Sleep before each subsequent capture; the input token may be static.
      if (i > 0) {
        await this.providerManager.sleep(delaySeconds * 1000);
      }
      try {
        const dataUrl = await this.providerManager.imageToDataUrl(args.droptoken);
        const digest = crypto.createHash('sha256').update(dataUrl).digest('hex');
        unique.add(digest);
        const added = await this.addImageDataUrl(batchId, sourceName, dataUrl);
        lastImage = added.image;
        captured++;
        this.homey.app.log(`Timed batch ${batchId}: ${captured}/${framesRequested} images captured`);
      } catch (e) {
        error = e;
        this.homey.app.error(`Timed batch ${batchId} capture ${i + 1} failed:`, e);
        break;
      }
    }
    if (!captured) {
      throw error || new Error('No frames captured.');
    }
    return {
      frames_requested: framesRequested,
      frames_captured: captured,
      duplicate_frames: captured - unique.size,
      images_in_batch: this.getBatch(batchId).images.length,
      last_captured_image: lastImage,
      capture_status: captured === framesRequested ? 'completed' : 'partial',
      batch_limit: limit,
    };
  }

  async createHomeyImageFromDataUrl(imageDataUrl, sourceName) {
    const match =
      /^data:([^;,]+);base64,(.+)$/s.exec(imageDataUrl);

    if (!match) {
      throw new Error('Stored batch image is not a valid base64 data URL.');
    }

    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('Stored batch image exceeds Homey\'s 5 MB image limit.');
    }

    const image = await this.homey.images.createImage();

    image.setStream((stream) => {
      stream.end(buffer);
    });

    const cleanupTimer = setTimeout(() => {
      image.unregister().catch((error) => {
        this.homey.app.error(
          `Could not unregister frozen image for ${sourceName}:`,
          error,
        );
      });
    }, 15 * 60 * 1000);

    if (typeof cleanupTimer.unref === 'function') {
      cleanupTimer.unref();
    }

    return image;
  }

  getBatch(batchId) {
    const id = this.normalizeBatchId(batchId);

    return {
      id,
      images: this.batches.get(id) || [],
    };
  }

  async analyzeBatch(args) {
    const provider =
      this.providerManager.normalizeProvider(args.provider);

    let model =
      this.providerManager.normalizeModel(args.model);

    if (!model) {
      model =
        this.providerManager.getDefaultModel(provider);
    }

    if (!model) {
      throw new Error(
        `No model selected and no default model configured for ${provider}.`,
      );
    }

    if (!['openai', 'claude', 'gemini'].includes(provider)) {
      throw new Error(
        `Multi-camera analysis is not implemented yet for ${provider}.`,
      );
    }

    const batch = this.getBatch(args.batch_id);

    if (batch.images.length === 0) {
      throw new Error(
        `Image batch "${batch.id}" is empty.`,
      );
    }

    const userPrompt =
      args.prompt
      || 'Describe the activity shown across these cameras.';

    const cameraList =
      batch.images
        .map(
          (image, index) =>
            `Image ${index + 1}: ${image.source}`,
        )
        .join('. ');

    const visionPrompt =
      `You are analyzing ${batch.images.length} images `
      + 'from different security cameras around the same property. '
      + 'These are independent camera views, not necessarily '
      + 'consecutive frames from one camera. '
      + `${cameraList}. `
      + 'Use all camera views together to determine what is happening. '
      + 'Look for evidence that the same person, vehicle, delivery, '
      + 'or package appears across multiple views, but do not claim '
      + 'it is the same person or vehicle unless the visual evidence '
      + 'reasonably supports that conclusion. '
      + 'Judge every boolean independently. '
      + 'A parked vehicle does not mean it arrived or departed. '
      + 'A visible package does not automatically mean it was delivered. '
      + 'Normal delivery activity is not loitering. '
      + 'Identify a delivery company only when visible evidence supports it. '
      + 'The images are indexed in the order listed above, 1 through '
      + `${batch.images.length}. `
      + 'Set best_image_index to the ONE image with the strongest useful visual '
      + 'evidence for a notification, prioritizing a clear identifiable person '
      + 'over a later vehicle departure; next prefer a person handling a package, '
      + 'then a distinguishable vehicle, then meaningful general activity. '
      + 'Only choose among provided images. Return 0 if no useful image exists. '
      + 'Give a concise best_image_reason. '
      + `User instruction: ${userPrompt}`;

    const imageDataUrls =
      batch.images.map(image => image.imageDataUrl);

    this.homey.app.log(
      `Analyzing batch ${batch.id}: `
      + `${batch.images.length} images using ${provider}/${model}`,
    );

    const result =
      await this.providerManager.callStructuredVision(
        provider,
        model,
        visionPrompt,
        imageDataUrls,
      );

    // Preserve the exact frame sent to the model before clearing the batch.
    const proposedIndex = Number(result.best_image_index);
    const validSelection = Number.isInteger(proposedIndex)
      && proposedIndex >= 1
      && proposedIndex <= batch.images.length;
    // Keep a deterministic fallback when the model returns 0 or an invalid index.
    const selectedIndex = validSelection
      ? proposedIndex - 1
      : (batch.images.length > 1 ? 1 : 0);
    const selected = batch.images[selectedIndex];
    const bestImage = await this.createHomeyImageFromDataUrl(
      selected.imageDataUrl,
      selected.source,
    );
    const bestReason = validSelection
      ? String(result.best_image_reason || 'Selected by AI')
      : 'Fallback: second image if available, otherwise first image';

    this.homey.app.log(
      `Best image for ${batch.id}: image ${selectedIndex + 1} `
      + `(${selected.source}); ${bestReason}`,
    );

    this.clearBatch(batch.id);

    return {
      best_image: bestImage,
      best_image_camera: selected.source,
      best_image_reason: bestReason,
      summary: result.summary,
      activity: result.activity,
      person_present: result.person_present,
      vehicle_present: result.vehicle_present,
      delivery_vehicle: result.delivery_vehicle,
      delivery_company: result.delivery_company,
      package_present: result.package_present,
      package_delivered: result.package_delivered,
      person_approaching: result.person_approaching,
      person_leaving: result.person_leaving,
      vehicle_arrived: result.vehicle_arrived,
      vehicle_departed: result.vehicle_departed,
      loitering: result.loitering,
      security_level: result.security_level,
      confidence: result.confidence,
      image_count: batch.images.length,
      provider_used: provider,
      model_used: model,
    };
  }

}

module.exports = ImageBatchManager;
