'use strict';

const PROVIDER_MODELS = {
  openai: [
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
  ],

  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ],

  claude: [
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4-1',
  ],

  openai_compatible: [
    'custom-model',
  ],
};

const EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,

  properties: {
    summary: {
      type: 'string',
      description:
        'A concise natural-language description of what actually happened across the frames.',
    },

    activity: {
      type: 'string',
      description:
        'A short classification of the primary activity, such as package delivery, person approaching, vehicle arriving, vehicle departing, loitering, or stationary scene.',
    },

    person_present: {
      type: 'boolean',
      description:
        'True only if at least one person is visibly present in one or more frames.',
    },

    vehicle_present: {
      type: 'boolean',
      description:
        'True only if a vehicle is visibly present in one or more frames.',
    },

    delivery_vehicle: {
      type: 'boolean',
      description:
        'True only if a visible vehicle is reasonably identifiable as being used for a delivery.',
    },

    delivery_company: {
      type: 'string',
      description:
        'The delivery company only when supported by visible branding or strong visual evidence.',
      enum: [
        'amazon',
        'ups',
        'fedex',
        'usps',
        'dhl',
        'other',
        'none',
        'unknown',
      ],
    },

    package_present: {
      type: 'boolean',
      description:
        'True if a package or parcel is visibly present in at least one frame.',
    },

    package_delivered: {
      type: 'boolean',
      description:
        'True only when the ordered frame sequence shows a package being newly left at the property. A package merely sitting there is not a delivery event.',
    },

    person_approaching: {
      type: 'boolean',
      description:
        'True only when the sequence shows a person moving toward the house, door, camera, or protected area.',
    },

    person_leaving: {
      type: 'boolean',
      description:
        'True only when the sequence shows a person moving away from the house, door, camera, or protected area.',
    },

    vehicle_arrived: {
      type: 'boolean',
      description:
        'True only when the sequence visibly shows a vehicle entering or arriving during the captured event. A vehicle already parked throughout the sequence does not count.',
    },

    vehicle_departed: {
      type: 'boolean',
      description:
        'True only when the sequence visibly shows a vehicle leaving during the captured event.',
    },

    loitering: {
      type: 'boolean',
      description:
        'True only if a person remains or lingers unusually without simply approaching, delivering, passing through, or leaving. Normal delivery activity is not loitering.',
    },

    security_level: {
      type: 'string',
      description:
        'Security significance based only on visible evidence. '
        + 'low = normal or expected activity with no clear security concern; '
        + 'medium = unusual activity that deserves attention but shows no immediate security concern; '
        + 'high = clearly observable intrusive, aggressive, tampering, forced-entry, or other immediate security concern. '
        + 'Do not infer intent. When evidence is ambiguous, choose the lower level.',
      enum: [
        'low',
        'medium',
        'high',
      ],
    },

    best_image_index: {
      type: 'integer',
      description: 'For a numbered batch, choose the 1-based image number with the best useful evidence. Prioritize clear identifiable people, then person/package interactions, then identifiable vehicles, then other relevant activity. Prefer clarity and relevance over recency. Return 0 if no usable image or numbering is not given.',
      minimum: 0,
      maximum: 12,
    },
    best_image_reason: {
      type: 'string',
      description: 'A short explanation of why the chosen image is the most useful evidence; empty if none.',
    },

    confidence: {
      type: 'number',
      description:
        'Overall confidence in the event interpretation from 0 to 100.',
      minimum: 0,
      maximum: 100,
    },
  },

  required: [
    'summary',
    'activity',
    'person_present',
    'vehicle_present',
    'delivery_vehicle',
    'delivery_company',
    'package_present',
    'package_delivered',
    'person_approaching',
    'person_leaving',
    'vehicle_arrived',
    'vehicle_departed',
    'loitering',
    'security_level',
    'confidence',
    'best_image_index',
    'best_image_reason',
  ],
};

class ProviderManager {

  constructor(homey) {
    this.homey = homey;
  }

  normalizeProvider(provider) {
    if (!provider) return 'openai';

    if (typeof provider === 'string') {
      return provider;
    }

    if (typeof provider === 'object' && provider.id) {
      return provider.id;
    }

    return 'openai';
  }

  normalizeModel(model) {
    if (!model) return '';

    if (typeof model === 'string') {
      return model;
    }

    if (typeof model === 'object') {
      return model.id || model.name || '';
    }

    return '';
  }

  getModelSuggestions(provider, query = '') {
    const providerId = this.normalizeProvider(provider);
    const models = PROVIDER_MODELS[providerId] || [];

    const search = String(query).toLowerCase();

    return models
      .filter(model => model.toLowerCase().includes(search))
      .map(model => ({
        id: model,
        name: model,
      }));
  }

  getDefaultModel(provider) {
    const providerId = this.normalizeProvider(provider);

    const settingKeys = {
      openai: 'openai_default_model',
      gemini: 'gemini_default_model',
      claude: 'claude_default_model',
      openai_compatible: 'compatible_default_model',
    };

    const settingKey = settingKeys[providerId];

    if (!settingKey) {
      return '';
    }

    return this.homey.settings.get(settingKey) || '';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async streamToBuffer(stream) {
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk),
      );
    }

    return Buffer.concat(chunks);
  }

  async imageToDataUrl(image) {
    if (!image || typeof image.getStream !== 'function') {
      throw new Error('No image was supplied to the Flow card.');
    }

    const imageStream = await image.getStream();

    const contentType =
      imageStream?.meta?.contentType || 'image/jpeg';

    const buffer = await this.streamToBuffer(imageStream);
    const base64 = buffer.toString('base64');

    return `data:${contentType};base64,${base64}`;
  }

  parseDataUrl(imageDataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(imageDataUrl);

    if (!match) {
      throw new Error('Image data is not a valid base64 data URL.');
    }

    return {
      mediaType: match[1],
      data: match[2],
    };
  }

  sanitizeSchemaForClaude(value) {
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeSchemaForClaude(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const unsupportedKeys = new Set([
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'multipleOf',
      'pattern',
    ]);

    const descriptionAdditions = [];
    const sanitized = {};

    for (const [key, child] of Object.entries(value)) {
      if (unsupportedKeys.has(key)) {
        descriptionAdditions.push(`${key}: ${JSON.stringify(child)}`);
        continue;
      }

      sanitized[key] = this.sanitizeSchemaForClaude(child);
    }

    if (
      descriptionAdditions.length > 0
      && typeof sanitized.description === 'string'
    ) {
      sanitized.description =
        `${sanitized.description} Constraints: ${descriptionAdditions.join(', ')}.`;
    } else if (descriptionAdditions.length > 0) {
      sanitized.description =
        `Constraints: ${descriptionAdditions.join(', ')}.`;
    }

    return sanitized;
  }

  async captureFrames(imageToken, frameCount, captureSeconds) {
    if (!imageToken || typeof imageToken.getStream !== 'function') {
      throw new Error('No image token was supplied.');
    }

    const totalFrames = Math.max(1, Number(frameCount || 1));
    const totalSeconds = Math.max(1, Number(captureSeconds || 1));

    const frames = [];

    if (totalFrames === 1) {
      frames.push(await this.imageToDataUrl(imageToken));
      return frames;
    }

    const intervalMs = Math.max(
      250,
      Math.floor(
        (totalSeconds * 1000) / (totalFrames - 1),
      ),
    );

    for (let i = 0; i < totalFrames; i++) {
      this.homey.app.log(
        `Capturing frame ${i + 1} of ${totalFrames}`,
      );

      frames.push(
        await this.imageToDataUrl(imageToken),
      );

      if (i < totalFrames - 1) {
        await this.sleep(intervalMs);
      }
    }

    return frames;
  }

  extractOutputText(data) {
    let outputText = '';

    for (const item of data.output || []) {
      if (item.type !== 'message') continue;

      for (const contentItem of item.content || []) {
        if (
          contentItem.type === 'output_text'
          && contentItem.text
        ) {
          outputText += contentItem.text;
        }
      }
    }

    return outputText.trim();
  }

  extractClaudeText(data) {
    let outputText = '';

    for (const block of data.content || []) {
      if (block.type === 'text' && block.text) {
        outputText += block.text;
      }
    }

    return outputText.trim();
  }

  normalizeEventResult(result) {
    if (!result.person_present) {
      result.person_approaching = false;
      result.person_leaving = false;
      result.loitering = false;
    }

    if (!result.vehicle_present) {
      result.delivery_vehicle = false;
      result.vehicle_arrived = false;
      result.vehicle_departed = false;
    }

    if (!result.delivery_vehicle) {
      result.delivery_company = 'none';
    }

    if (typeof result.delivery_company === 'string') {
      result.delivery_company = result.delivery_company.toLowerCase();
    }

    if (result.delivery_vehicle && result.delivery_company === 'none') {
      result.delivery_company = 'unknown';
    }

    if (result.package_delivered) {
      result.package_present = true;
    }

    if (
      result.package_delivered
      && result.person_approaching
      && result.person_leaving
    ) {
      result.loitering = false;
    }

    if (typeof result.security_level === 'string') {
      result.security_level = result.security_level.toLowerCase();
    }

    if (
      !['low', 'medium', 'high'].includes(result.security_level)
    ) {
      result.security_level = 'low';
    }

    if (typeof result.confidence !== 'number') {
      result.confidence = Number(result.confidence || 0);
    }

    if (Number.isNaN(result.confidence)) {
      result.confidence = 0;
    }

    result.confidence = Math.max(0, Math.min(100, result.confidence));

    return result;
  }

  async callOpenAI(model, prompt, imageDataUrls) {
    const apiKey = this.homey.settings.get('openai_api_key');

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured.');
    }

    const content = [
      {
        type: 'input_text',
        text: prompt,
      },
    ];

    for (const imageDataUrl of imageDataUrls) {
      content.push({
        type: 'input_image',
        image_url: imageDataUrl,
      });
    }

    const body = {
      model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'homey_camera_event',
          strict: true,
          schema: EVENT_SCHEMA,
        },
      },
    };

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `OpenAI request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText = this.extractOutputText(data);

    if (!outputText) {
      throw new Error('OpenAI returned no structured output.');
    }

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (error) {
      throw new Error(
        `Could not parse OpenAI structured output: ${error.message}`,
      );
    }

    this.homey.app.log(`Raw OpenAI event result: ${JSON.stringify(result)}`);

    return this.normalizeEventResult(result);
  }

  async callClaude(model, prompt, imageDataUrls) {
    const apiKey = this.homey.settings.get('claude_api_key');

    if (!apiKey) {
      throw new Error('Claude API key is not configured.');
    }

    const content = [];

    for (let i = 0; i < imageDataUrls.length; i++) {
      const parsed = this.parseDataUrl(imageDataUrls[i]);

      content.push({
        type: 'text',
        text: `Image ${i + 1}:`,
      });

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType,
          data: parsed.data,
        },
      });
    }

    content.push({
      type: 'text',
      text: prompt,
    });

    const body = {
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: this.sanitizeSchemaForClaude(EVENT_SCHEMA),
        },
      },
    };

    const response = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Claude request failed with status ${response.status}`;

      throw new Error(message);
    }

    if (data.stop_reason === 'refusal') {
      throw new Error('Claude refused the request.');
    }

    const outputText = this.extractClaudeText(data);

    if (!outputText) {
      throw new Error('Claude returned no structured output.');
    }

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (error) {
      throw new Error(
        `Could not parse Claude structured output: ${error.message}`,
      );
    }

    this.homey.app.log(`Raw Claude event result: ${JSON.stringify(result)}`);

    return this.normalizeEventResult(result);
  }

  async callOpenAIText(model, prompt) {
    const apiKey = this.homey.settings.get('openai_api_key');

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured.');
    }

    const body = {
      model,
      input: prompt,
    };

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `OpenAI request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText = this.extractOutputText(data);

    if (!outputText) {
      throw new Error('OpenAI returned no text output.');
    }

    return outputText;
  }

  async callClaudeText(model, prompt) {
    const apiKey = this.homey.settings.get('claude_api_key');

    if (!apiKey) {
      throw new Error('Claude API key is not configured.');
    }

    const body = {
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    const response = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Claude request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText = this.extractClaudeText(data);

    if (!outputText) {
      throw new Error('Claude returned no text output.');
    }

    return outputText;
  }

  async callOpenAIImageText(model, prompt, imageDataUrl) {
    const apiKey = this.homey.settings.get('openai_api_key');

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured.');
    }

    const body = {
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt,
            },
            {
              type: 'input_image',
              image_url: imageDataUrl,
            },
          ],
        },
      ],
    };

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `OpenAI request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText = this.extractOutputText(data);

    if (!outputText) {
      throw new Error('OpenAI returned no image-analysis output.');
    }

    return outputText;
  }

  async callClaudeImageText(model, prompt, imageDataUrl) {
    const apiKey = this.homey.settings.get('claude_api_key');

    if (!apiKey) {
      throw new Error('Claude API key is not configured.');
    }

    const parsed = this.parseDataUrl(imageDataUrl);

    const body = {
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: parsed.mediaType,
                data: parsed.data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Claude request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText = this.extractClaudeText(data);

    if (!outputText) {
      throw new Error('Claude returned no image-analysis output.');
    }

    return outputText;
  }

  parseImageDataUrl(imageDataUrl) {
    const match =
      /^data:([^;,]+);base64,(.+)$/s.exec(imageDataUrl);

    if (!match) {
      throw new Error('Image is not a valid base64 data URL.');
    }

    return {
      mimeType: match[1],
      data: match[2],
    };
  }

  extractGeminiText(data) {
    const parts =
      data?.candidates?.[0]?.content?.parts || [];

    return parts
      .filter(part => typeof part?.text === 'string')
      .map(part => part.text)
      .join('')
      .trim();
  }

  async callGeminiImageText(model, prompt, imageDataUrl) {
    const apiKey =
      this.homey.settings.get('gemini_api_key');

    if (!apiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }

    const image =
      this.parseImageDataUrl(imageDataUrl);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
            {
              inline_data: {
                mime_type: image.mimeType,
                data: image.data,
              },
            },
          ],
        },
      ],
    };

    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(
      endpoint,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },

        body: JSON.stringify(body),
      },
    );

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Google Gemini returned an unreadable response (status ${response.status}).`,
      );
    }

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Google Gemini request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText =
      this.extractGeminiText(data);

    if (!outputText) {
      const finishReason =
        data?.candidates?.[0]?.finishReason;

      const reasonText = finishReason
        ? ` Finish reason: ${finishReason}.`
        : '';

      throw new Error(
        `Google Gemini returned no image-analysis output.${reasonText}`,
      );
    }

    return outputText;
  }

  async callGeminiText(model, prompt) {
    const apiKey =
      this.homey.settings.get('gemini_api_key');

    if (!apiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Google Gemini returned an unreadable response (status ${response.status}).`,
      );
    }

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Google Gemini request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText =
      this.extractGeminiText(data);

    if (!outputText) {
      const finishReason =
        data?.candidates?.[0]?.finishReason;

      const reasonText = finishReason
        ? ` Finish reason: ${finishReason}.`
        : '';

      throw new Error(
        `Google Gemini returned no text output.${reasonText}`,
      );
    }

    return outputText;
  }

  async callGemini(model, prompt, imageDataUrls) {
    const apiKey =
      this.homey.settings.get('gemini_api_key');

    if (!apiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }

    const parts = [
      {
        text: prompt,
      },
    ];

    for (const imageDataUrl of imageDataUrls) {
      const image =
        this.parseImageDataUrl(imageDataUrl);

      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data,
        },
      });
    }

    const body = {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: EVENT_SCHEMA,
      },
    };

    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error(
        `Google Gemini returned an unreadable response (status ${response.status}).`,
      );
    }

    if (!response.ok) {
      const message =
        data?.error?.message
        || `Google Gemini request failed with status ${response.status}`;

      throw new Error(message);
    }

    const outputText =
      this.extractGeminiText(data);

    if (!outputText) {
      const finishReason =
        data?.candidates?.[0]?.finishReason;

      const reasonText = finishReason
        ? ` Finish reason: ${finishReason}.`
        : '';

      throw new Error(
        `Google Gemini returned no structured output.${reasonText}`,
      );
    }

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (error) {
      throw new Error(
        `Could not parse Google Gemini structured output: ${error.message}`,
      );
    }

    this.homey.app.log(
      `Raw AI event result: ${JSON.stringify(result)}`,
    );

    return this.normalizeEventResult(result);
  }

  async callStructuredVision(provider, model, prompt, imageDataUrls) {
    if (provider === 'openai') {
      return this.callOpenAI(model, prompt, imageDataUrls);
    }

    if (provider === 'claude') {
      return this.callClaude(model, prompt, imageDataUrls);
    }

    if (provider === 'gemini') {
      return this.callGemini(model, prompt, imageDataUrls);
    }

    throw new Error(
      `Structured vision analysis is not implemented yet for ${provider}.`,
    );
  }

  async analyzeSingleImage(args) {
    const provider = this.normalizeProvider(args.provider);

    let model = this.normalizeModel(args.model);

    if (!model) {
      model = this.getDefaultModel(provider);
    }

    if (!model) {
      throw new Error(
        `No model selected and no default model configured for ${provider}.`,
      );
    }

    const prompt = String(args.prompt || '').trim();

    if (!prompt) {
      throw new Error('An image-analysis prompt is required.');
    }

    if (!['openai', 'claude', 'gemini'].includes(provider)) {
      throw new Error(
        `Single-image analysis is not implemented yet for ${provider}.`,
      );
    }

    const imageDataUrl = await this.imageToDataUrl(args.droptoken);

    let response;

    if (provider === 'openai') {
      response = await this.callOpenAIImageText(
        model,
        prompt,
        imageDataUrl,
      );
    } else if (provider === 'claude') {
      response = await this.callClaudeImageText(
        model,
        prompt,
        imageDataUrl,
      );
    } else {
      response = await this.callGeminiImageText(model, prompt, imageDataUrl);
    }

    return {
      response,
      provider_used: provider,
      model_used: model,
    };
  }

  async analyzeSingleImageStructured(args) {
    const provider = this.normalizeProvider(args.provider);

    let model = this.normalizeModel(args.model);

    if (!model) {
      model = this.getDefaultModel(provider);
    }

    if (!model) {
      throw new Error(
        `No model selected and no default model configured for ${provider}.`,
      );
    }

    const prompt =
      String(args.prompt || '').trim()
      || 'Describe the security-relevant activity visible in this image.';

    if (!['openai', 'claude', 'gemini'].includes(provider)) {
      throw new Error(
        `Structured single-image analysis is not implemented yet for ${provider}.`,
      );
    }

    const imageDataUrl = await this.imageToDataUrl(args.droptoken);

    const visionPrompt =
      'Analyze this single security-camera image. '
      + 'Judge every boolean independently and use only visible evidence in this image. '
      + 'Do not infer motion or a sequence of events that a single still image cannot prove. '
      + 'In particular, person_approaching, person_leaving, vehicle_arrived, '
      + 'vehicle_departed, and package_delivered should normally be false for a single image '
      + 'unless the image itself contains unusually explicit visual evidence for that exact condition. '
      + 'A visible package means package_present may be true, but it does not prove package_delivered. '
      + 'A visible vehicle means vehicle_present may be true, but it does not prove arrival or departure. '
      + 'Normal presence near a door is not loitering. '
      + `User instruction: ${prompt}`;

    const result = await this.callStructuredVision(
      provider,
      model,
      visionPrompt,
      [imageDataUrl],
    );

    return {
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
      provider_used: provider,
      model_used: model,
    };
  }

  async sendTextPrompt(args) {
    const provider = this.normalizeProvider(args.provider);

    let model = this.normalizeModel(args.model);

    if (!model) {
      model = this.getDefaultModel(provider);
    }

    if (!model) {
      throw new Error(
        `No model selected and no default model configured for ${provider}.`,
      );
    }

    const prompt = String(args.prompt || '').trim();

    if (!prompt) {
      throw new Error('A text prompt is required.');
    }

    let response;

    if (provider === 'openai') {
      response = await this.callOpenAIText(model, prompt);
    } else if (provider === 'claude') {
      response = await this.callClaudeText(model, prompt);
    } else if (provider === 'gemini') {
      response = await this.callGeminiText(model, prompt);
    } else {
      throw new Error(
        `Text prompting is not implemented yet for ${provider}.`,
      );
    }

    return {
      response,
      provider_used: provider,
      model_used: model,
    };
  }

  async analyzeCameraActivity(args) {
    const provider = this.normalizeProvider(args.provider);

    let model = this.normalizeModel(args.model);

    if (!model) {
      model = this.getDefaultModel(provider);
    }

    if (!model) {
      throw new Error(
        `No model selected and no default model configured for ${provider}.`,
      );
    }

    const captureSeconds = Math.max(1, Number(args.capture_seconds || 8));
    const frameCount = Math.max(1, Number(args.frame_count || 6));
    const prompt = args.prompt || 'Describe what happened during this event.';

    if (!['openai', 'claude', 'gemini'].includes(provider)) {
      throw new Error(
        `Structured multi-frame analysis is not implemented yet for ${provider}.`,
      );
    }

    const frames = await this.captureFrames(
      args.droptoken,
      frameCount,
      captureSeconds,
    );

    const visionPrompt =
      `Analyze these ${frames.length} ordered security-camera frames. `
      + `They were captured across approximately ${captureSeconds} seconds. `
      + 'The images are chronological from earliest to latest. '
      + 'Judge every boolean independently. '
      + 'Do NOT mark every field true simply because an event occurred. '
      + 'A field must be true only when the images provide visual evidence '
      + 'for that exact condition. '
      + 'Normal walking toward and away from a door is not loitering. '
      + 'A parked vehicle does not mean vehicle_arrived or vehicle_departed. '
      + 'A visible package does not automatically mean package_delivered; '
      + 'delivery requires evidence that it appeared during this sequence. '
      + 'Likewise, package_delivered does not by itself prove that a delivery '
      + 'vehicle was visible. '
      + 'Evaluate what changed between frames, not simply everything that '
      + 'appears anywhere in them. '
      + `User instruction: ${prompt}`;

    const result = await this.callStructuredVision(
      provider,
      model,
      visionPrompt,
      frames,
    );

    return {
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
      provider_used: provider,
      model_used: model,
    };
  }

}

module.exports = ProviderManager;
