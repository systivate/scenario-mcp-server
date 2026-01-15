# Scenario MCP Server

MCP server that connects AI assistants to Scenario.gg for AI-powered asset generation.

## Features

- **txt2img** - Generate images from text prompts (FLUX, SDXL models)
- **img2img** - Transform existing images with AI
- **list_models** - Browse available AI models
- **list_assets** - View generated assets
- **get_asset** - Get asset details and download URLs
- **remove_background** - Remove image backgrounds
- **upscale** - Enhance image resolution (2x or 4x)

## Environment Variables

```bash
SCENARIO_API_KEY=your_api_key
SCENARIO_SECRET_KEY=your_secret_key
PORT=3000  # optional
```

## Local Development

```bash
npm install
npm run dev
```

## Railway Deployment

1. Push to GitHub
2. Connect to Railway
3. Add environment variables from Doppler
4. Deploy

## MCP Configuration

Add to your `mcp_config.json`:

```json
{
  "scenario": {
    "serverUrl": "https://YOUR_RAILWAY_URL/mcp",
    "headers": {}
  }
}
```

## License

MIT
