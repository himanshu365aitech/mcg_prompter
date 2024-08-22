const express = require('express');
const AWS = require('aws-sdk');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAICacheManager, GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

let contextCacheName = null || "cachedContents/vb4vngzcsnwa";

// API to load and cache context mapping
app.post('/load-context', async (req, res) => {
    try {
        console.log('[LOG-START] /load-context endpoint called'); // LOG-TAG

        // Step 1: Retrieve the file from S3
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: process.env.S3_KEY_NAME,
        };

        const s3Data = await s3.getObject(params).promise();
        const fileContent = s3Data.Body.toString('utf-8');
        console.log('[LOG] File retrieved from S3:', params.Key); // LOG-TAG

        // Step 2: Save the content to a temporary file
        const tempFilePath = path.join(__dirname, 'temp-file.txt');
        fs.writeFileSync(tempFilePath, fileContent);
        console.log('[LOG] File saved temporarily:', tempFilePath); // LOG-TAG

        // Step 3: Upload the file using the file path
        const fileManager = new GoogleAIFileManager(process.env.API_KEY);
        const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: 'text/plain',
            displayName: 'Large Context File',
        });
        console.log('[LOG] File uploaded to Google AI:', uploadResult.file.uri); // LOG-TAG

        // Step 4: Cache the uploaded file content with a TTL
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        const cacheResult = await cacheManager.create({
            model: 'models/gemini-1.5-flash-001',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            fileData: {
                                mimeType: uploadResult.file.mimeType,
                                fileUri: uploadResult.file.uri,
                            },
                        },
                    ],
                },
            ],
            ttlSeconds: 3600, // Cache for 1 hour
        });

        contextCacheName = cacheResult.name; // Save the cache name for later use
        console.log('Context mapping cached successfully:', contextCacheName);

        // Clean up the temporary file
        fs.unlinkSync(tempFilePath);
        console.log("Cache Name:", contextCacheName); // LOG-TAG

        res.status(200).send({ message: 'Context loaded and cached successfully', contextCacheName });
    } catch (error) {
        console.error('Error loading and caching context mapping:', error); // LOG-TAG
        res.status(500).send('Error loading and caching context mapping');
    }
});

// API to delete the cached context
app.delete('/delete-context', async (req, res) => {
    if (!contextCacheName) {
        return res.status(400).send('No cached context to delete.');
    }

    try {
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        await cacheManager.delete(contextCacheName);

        contextCacheName = null;
        console.log('Context cache deleted successfully'); // LOG-TAG
        res.status(200).send({ message: 'Context cache deleted successfully' });
    } catch (error) {
        console.error('Error deleting context cache:', error); // LOG-TAG
        res.status(500).send('Error deleting context cache');
    }
});

// Function to find the closest match in context mapping using Gemini
async function findClosestMatch(inputData, prompt) {
    try {
        if (!contextCacheName) {
            throw new Error('Context cache is not loaded yet. Please load the context first.');
        }

        console.log('[LOG] Using context cache name:', contextCacheName); // LOG-TAG

        const genAI = new GoogleGenerativeAI(process.env.API_KEY);

        const model = genAI.getGenerativeModelFromCachedContent({
            name: contextCacheName,
            model: 'models/gemini-1.5-flash-001' // The model used during caching
        });

        // Adjusting the structure to correctly pass the prompt
        const geminiResult = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt }, // The prompt should be here
                        { text: `Given the input data, find the closest match: ${inputData}` }
                    ],
                },
            ],
        });

        return geminiResult.response.text();
    } catch (error) {
        console.error('Error during findClosestMatch:', error); // LOG-TAG
        await deleteContextCache();
        throw error;
    }
}



// Function to delete the context cache
async function deleteContextCache() {
    if (!contextCacheName) {
        console.error('[LOG] No context cache to delete.'); // LOG-TAG
        return;
    }

    try {
        const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
        await cacheManager.delete(contextCacheName);
        contextCacheName = null;
        console.log('[LOG] Context cache deleted due to an error.'); // LOG-TAG
    } catch (error) {
        console.error('Error deleting context cache:', error); // LOG-TAG
    }
}

// Server endpoint for processing user request
app.post('/find-match', async (req, res) => {
    console.log('[LOG-START] /find-match endpoint called'); // LOG-TAG

    try {
        if (!contextCacheName) {
            console.error('[LOG-ERROR] Context cache is not ready.'); // LOG-TAG
            return res.status(503).send('Service Unavailable: Context cache is not ready yet.');
        }

        console.log('[LOG] Context cache is ready with name:', contextCacheName); // LOG-TAG

        const { data: inputData, prompt } = req.body;
        console.log('[LOG] Request body received:', { inputData, prompt }); // LOG-TAG

        if (!inputData || !prompt) {
            console.error('[LOG-ERROR] Missing data or prompt in request body.'); // LOG-TAG
            return res.status(400).send('Missing data or prompt.');
        }

        console.log('[LOG] Initiating findClosestMatch with inputData:', inputData, 'and prompt:', prompt); // LOG-TAG

        const closestMatch = await findClosestMatch(inputData, prompt);

        console.log('[LOG] findClosestMatch completed successfully. Result:', closestMatch); // LOG-TAG
        res.send({ closestMatch });
    } catch (error) {
        console.error('[LOG-ERROR] Error finding match:', error); // LOG-TAG
        await deleteContextCache(); // Ensure context cache is deleted if an error occurs
        res.status(500).send('Error finding match');
    } finally {
        console.log('[LOG-END] /find-match processing completed'); // LOG-TAG
    }
});

app.listen(port, () => console.log(`Server listening on port ${port}`));
