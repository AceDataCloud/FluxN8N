# Privacy

The node sends the selected image prompt, model, size, optional reference image URL and API token to `https://api.acedata.cloud`. Task queries send only the specified task ID(s) and token to the same host. The node stores no independent telemetry and reads no local files or environment variables. n8n stores the token in its credential store. Do not include tokens in exported workflows or prompts.

See [Ace Data Cloud's privacy policy](https://platform.acedata.cloud/privacy) and [current Flux API documentation](https://platform.acedata.cloud/documents/6b9197c5-7a3f-4878-a43f-7f94e7e66394).
