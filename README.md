# LLMVision for Homey Pro — v1.7.0

Unofficial, source-only community handoff. **Not a published Homey App Store release.**

## Inspiration and Project Independence

LLMVision for Homey Pro was inspired by
[LLM Vision for Home Assistant](https://github.com/valentinfrlch/ha-llmvision).

This application was independently developed specifically for
Homey Pro and its Advanced Flow architecture.

- It is not a fork, port, or direct replacement for Home Assistant's LLM Vision.
- It does not share source code with the Home Assistant project.
- The projects are independent and unaffiliated.
- Compatibility and feature parity should not be assumed.

Credit goes to the original Home Assistant LLM Vision developers
for helping inspire this project.

## Installation from a clean directory

1. Extract the ZIP into an empty directory.
2. Install Node.js and Homey CLI (`npm install --global homey`).
3. Run `npm ci`.
4. Run `homey app validate`.
5. Select a development Homey using `homey login` and `homey select`, then use `homey app run` for a development session or `homey app install` to install.

## Provider configuration

The existing app supports OpenAI, Gemini, and Claude provider integrations. Configure each provider through the **existing application settings/flow cards** and supply your own credentials. No credentials are included. Check the app's existing setting names and model availability before use. Provider availability, model names, quotas, and costs are controlled by their respective providers.

## Working baseline reported by original developer

- OpenAI multi-frame and multi-camera analysis
- Existing Gemini and Claude integrations
- Best-image selection and batch processing
- Structured security/activity results for person, vehicle, direction, delivery, and security level
- Existing Homey Advanced Flow cards
- Existing MQTT integration used with Home Assistant

These are developer-reported capabilities, **not independently regression-tested by this packaging script**.

## Flow cards declared in manifest

- **Actions:** `add_image_to_batch`, `add_multiple_images_to_batch`, `analyze_camera_activity`, `analyze_image_batch`, `analyze_single_image`, `analyze_single_image_structured`, `clear_image_batch`, `send_text_prompt`
- **Conditions:** None declared in app.json
- **Triggers:** None declared in app.json

## Known limitations and planned functionality

- Behavior depends on camera event timing, image quality, provider response times, and rate limits.
- AI detections and classifications can be incorrect; validate against real-world activity.
- Existing app settings and external MQTT/broker configuration are not bundled.
- No new cards, features, or fixes are part of this handoff.
- Future enhancements and community-supported development are **planned/optional, not included or promised**.

## Community maintenance

Shared as-is. The original developer is not committing to ongoing maintenance, bug fixes, technical support, or additional features. Continued community development requires a separate volunteer maintainer.

## Privacy and validation

The build excludes local settings, credentials, caches, logs, dependencies, backups, and non-asset images. The source archive must still be reviewed before sharing, including a scan of all configuration and source files for personal data.
