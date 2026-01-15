/**
 * Scenario MCP Server
 * 
 * Provides AI-powered asset generation via Scenario.gg API
 * Implements Streamable HTTP transport for MCP protocol
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';

const VERSION = '1.0.0';
const PORT = process.env.PORT || 3000;

// Scenario API credentials from environment
const SCENARIO_API_KEY = process.env.SCENARIO_API_KEY;
const SCENARIO_SECRET_KEY = process.env.SCENARIO_SECRET_KEY;

if (!SCENARIO_API_KEY || !SCENARIO_SECRET_KEY) {
    console.error('ERROR: SCENARIO_API_KEY and SCENARIO_SECRET_KEY must be set');
    process.exit(1);
}

// Base64 auth for Scenario API
const SCENARIO_AUTH = Buffer.from(`${SCENARIO_API_KEY}:${SCENARIO_SECRET_KEY}`).toString('base64');

/**
 * Make authenticated request to Scenario API
 */
async function scenarioRequest(method, endpoint, body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Basic ${SCENARIO_AUTH}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`https://api.cloud.scenario.com/v1${endpoint}`, options);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Scenario API error ${response.status}: ${error}`);
    }

    return response.json();
}

/**
 * Poll job until completion
 */
async function waitForJob(jobId, maxWaitMs = 120000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const result = await scenarioRequest('GET', `/jobs/${jobId}`);

        if (result.job.status === 'success') {
            return result.job;
        } else if (result.job.status === 'failed') {
            throw new Error(`Job failed: ${JSON.stringify(result.job)}`);
        }

        // Wait 2 seconds before polling again
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Job timed out after ${maxWaitMs}ms`);
}

// Create MCP server
const server = new McpServer({
    name: 'scenario',
    version: VERSION
});

// ============= TOOLS =============

// List available models
server.tool(
    'list_models',
    'List available AI models for image generation. Includes FLUX, SDXL, and trained custom models.',
    {
        privacy: {
            type: 'string',
            enum: ['private', 'public'],
            description: 'Filter by model privacy (default: all)',
        },
        pageSize: {
            type: 'number',
            description: 'Number of models to return (default: 20, max: 100)',
        }
    },
    async ({ privacy, pageSize = 20 }) => {
        const params = new URLSearchParams();
        if (privacy) params.set('privacy', privacy);
        params.set('pageSize', String(pageSize));

        const result = await scenarioRequest('GET', `/models?${params}`);

        const models = result.models.map(m => ({
            id: m.id,
            name: m.name,
            type: m.type,
            status: m.status
        }));

        return {
            content: [{ type: 'text', text: JSON.stringify(models, null, 2) }]
        };
    }
);

// Generate image from text prompt
server.tool(
    'txt2img',
    'Generate images from a text prompt using AI. Supports FLUX and SDXL models.',
    {
        prompt: {
            type: 'string',
            description: 'Text description of the image to generate',
        },
        modelId: {
            type: 'string',
            description: 'Model ID to use (default: flux.1-pro). Use list_models to see available options.',
        },
        numSamples: {
            type: 'number',
            description: 'Number of images to generate (1-4, default: 1)',
        },
        width: {
            type: 'number',
            description: 'Image width in pixels (default: 1024)',
        },
        height: {
            type: 'number',
            description: 'Image height in pixels (default: 1024)',
        },
        negativePrompt: {
            type: 'string',
            description: 'Things to avoid in the generated image',
        }
    },
    async ({ prompt, modelId = 'flux.1-pro', numSamples = 1, width = 1024, height = 1024, negativePrompt }) => {
        const body = {
            modelId,
            prompt,
            numSamples: Math.min(4, Math.max(1, numSamples)),
            width,
            height
        };

        if (negativePrompt) {
            body.negativePrompt = negativePrompt;
        }

        const result = await scenarioRequest('POST', '/generate/txt2img', body);

        // Wait for job to complete
        const job = await waitForJob(result.job.jobId);

        // Get asset URLs
        const assetIds = job.metadata.assetIds;
        const assets = [];

        for (const assetId of assetIds) {
            const assetResult = await scenarioRequest('GET', `/assets/${assetId}`);
            assets.push({
                id: assetId,
                url: assetResult.asset.url,
                width: assetResult.asset.properties?.width,
                height: assetResult.asset.properties?.height
            });
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, assets }, null, 2) }]
        };
    }
);

// Transform image with img2img
server.tool(
    'img2img',
    'Transform an existing image using AI. Apply style changes while preserving structure.',
    {
        prompt: {
            type: 'string',
            description: 'Text description of the desired output',
        },
        imageUrl: {
            type: 'string',
            description: 'URL of the source image to transform',
        },
        modelId: {
            type: 'string',
            description: 'Model ID to use (default: flux.1-pro)',
        },
        strength: {
            type: 'number',
            description: 'How much to transform (0.0-1.0, default: 0.75). Higher = more change.',
        }
    },
    async ({ prompt, imageUrl, modelId = 'flux.1-pro', strength = 0.75 }) => {
        const body = {
            modelId,
            prompt,
            image: imageUrl,
            strength: Math.min(1.0, Math.max(0.0, strength))
        };

        const result = await scenarioRequest('POST', '/generate/img2img', body);
        const job = await waitForJob(result.job.jobId);

        const assets = [];
        for (const assetId of job.metadata.assetIds) {
            const assetResult = await scenarioRequest('GET', `/assets/${assetId}`);
            assets.push({
                id: assetId,
                url: assetResult.asset.url
            });
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, assets }, null, 2) }]
        };
    }
);

// List assets
server.tool(
    'list_assets',
    'List generated assets in your Scenario workspace.',
    {
        pageSize: {
            type: 'number',
            description: 'Number of assets to return (default: 10, max: 100)',
        },
        type: {
            type: 'string',
            description: 'Filter by asset type (e.g., inference-txt2img, uploaded)',
        }
    },
    async ({ pageSize = 10, type }) => {
        const params = new URLSearchParams();
        params.set('pageSize', String(pageSize));
        if (type) params.set('type', type);

        const result = await scenarioRequest('GET', `/assets?${params}`);

        const assets = result.assets.map(a => ({
            id: a.id,
            url: a.url,
            type: a.metadata?.type,
            name: a.metadata?.name,
            description: a.description,
            createdAt: a.createdAt
        }));

        return {
            content: [{ type: 'text', text: JSON.stringify(assets, null, 2) }]
        };
    }
);

// Get asset details
server.tool(
    'get_asset',
    'Get details and download URL for a specific asset.',
    {
        assetId: {
            type: 'string',
            description: 'The asset ID to retrieve',
        }
    },
    async ({ assetId }) => {
        const result = await scenarioRequest('GET', `/assets/${assetId}`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    id: result.asset.id,
                    url: result.asset.url,
                    type: result.asset.metadata?.type,
                    description: result.asset.description,
                    width: result.asset.properties?.width,
                    height: result.asset.properties?.height,
                    createdAt: result.asset.createdAt
                }, null, 2)
            }]
        };
    }
);

// Remove background
server.tool(
    'remove_background',
    'Remove the background from an image.',
    {
        assetId: {
            type: 'string',
            description: 'The asset ID of the image to process',
        }
    },
    async ({ assetId }) => {
        const body = { assetId };

        const result = await scenarioRequest('POST', '/edit/remove-background', body);
        const job = await waitForJob(result.job.jobId);

        const newAssetId = job.metadata.assetIds[0];
        const assetResult = await scenarioRequest('GET', `/assets/${newAssetId}`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    originalAssetId: assetId,
                    newAssetId,
                    url: assetResult.asset.url
                }, null, 2)
            }]
        };
    }
);

// Upscale image
server.tool(
    'upscale',
    'Upscale an image to higher resolution.',
    {
        assetId: {
            type: 'string',
            description: 'The asset ID of the image to upscale',
        },
        scalingFactor: {
            type: 'number',
            description: 'Scale factor (2 or 4, default: 2)',
        }
    },
    async ({ assetId, scalingFactor = 2 }) => {
        const body = {
            assetId,
            scalingFactor: scalingFactor === 4 ? 4 : 2
        };

        const result = await scenarioRequest('POST', '/edit/upscale', body);
        const job = await waitForJob(result.job.jobId, 180000); // Upscale can take longer

        const newAssetId = job.metadata.assetIds[0];
        const assetResult = await scenarioRequest('GET', `/assets/${newAssetId}`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    originalAssetId: assetId,
                    newAssetId,
                    url: assetResult.asset.url,
                    width: assetResult.asset.properties?.width,
                    height: assetResult.asset.properties?.height
                }, null, 2)
            }]
        };
    }
);

// ============= EXPRESS SERVER =============

const app = express();
app.use(express.json());

// Session management for Streamable HTTP
const sessions = new Map();

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', version: VERSION });
});

// MCP endpoint
app.all('/mcp', async (req, res) => {
    // Handle session management
    let sessionId = req.headers['mcp-session-id'];
    let transport = sessions.get(sessionId);

    if (!transport) {
        // Create new transport for this session
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                sessionId = id;
                sessions.set(id, transport);
                console.log(`Session initialized: ${id}`);
            }
        });

        // Connect to MCP server
        await server.connect(transport);
    }

    try {
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('MCP request error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Scenario MCP Server v${VERSION} running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
